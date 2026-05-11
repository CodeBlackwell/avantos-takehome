import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs/lib/elk.bundled.js";
import type { BlueprintEdge, BlueprintNode } from "../api/blueprint";
import type { NodeDep } from "../app/deps";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface Props {
  /** Blueprint nodes, in any order — ELK lays them out. */
  nodes: BlueprintNode[];
  /** Blueprint edges (parent → child). */
  edges: BlueprintEdge[];
  /** Currently selected node id, or `null` for none. Drives tile styling. */
  selectedId: string | null;
  /** Optional `nodeId → NodeDep[]` projection driving in-tile dep rows + tooltip. */
  depsByNode?: Map<string, NodeDep[]>;
}

/** ELK output projected into render-ready geometry. */
interface Layout {
  width: number;
  height: number;
  nodes: LaidNode[];
  edges: { id: string; d: string }[];
}

/** One node positioned by ELK with all the strings the render needs. */
interface LaidNode {
  id: string;
  formName: string;
  /** Title wrapped to `TITLE_MAX_CHARS` per line. */
  titleLines: string[];
  /** One-line per dep: `"<field> ← <source>"`, ellipsized. */
  depRows: string[];
  /** Underlying deps, used by the hover tooltip. */
  deps: NodeDep[];
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── SVG node-tile layout constants ─────────────────────────────────────────
// `_W` = width per character (calibrated by eye against the rendered font),
// `_H` = line height in SVG units. `MIN/MAX` node widths bracket how
// aggressively a long label or dep row stretches a tile. ZOOM constants bound
// the wheel-zoom and ± buttons.
const PADDING = 24;
const TITLE_MAX_CHARS = 16;
const TITLE_CHAR_W = 7;
const DEP_CHAR_W = 6;
const TITLE_LINE_H = 16;
const DEP_LINE_H = 14;
const PAD_X = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 10;
const DIVIDER_GAP_T = 8;
const DIVIDER_GAP_B = 6;
const MIN_NODE_W = 120;
const MAX_NODE_W = 240;
const FIELD_MAX = 14;
const SOURCE_MAX = 14;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.15;
const WHEEL_ZOOM_K = 0.0015;

/** Single shared ELK instance — its `layout()` is async and stateless. */
const elk = new ELK();

/** Hover anchor for the dependency tooltip (screen coords from the mouse event). */
interface HoverState {
  nodeId: string;
  x: number;
  y: number;
}

/**
 * SVG dependency graph rendered with an ELK "layered" layout.
 *
 * **Visual-only** — clicks/keyboard pan and zoom the viewBox; nothing
 * here writes back to mappings. The view auto-resets when the node set
 * changes (new blueprint loaded). Hover surfaces a `DepTooltip` with
 * each node's prefill mappings.
 *
 * Layout pipeline:
 *   1. {@link measureNode} sizes each tile based on title + dep rows.
 *   2. ELK lays nodes out left-to-right with orthogonal edge routing.
 *   3. {@link toLayout} projects ELK's output into render-ready shape.
 *
 * Pan/zoom:
 *   - Wheel zoom is anchored on the cursor (point under cursor stays
 *     under cursor across zoom changes).
 *   - Mouse drag pans the viewBox.
 *   - Arrow keys pan in 10% steps.
 */
export function GraphView({ nodes, edges, selectedId, depsByNode }: Props) {
  const [layout, setLayout] = useState<Layout | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [view, setView] = useState({ zoom: 1, x: 0, y: 0 });
  const svgRef = useRef<SVGSVGElement>(null);
  // Mouse-drag start state: cursor position + viewBox origin at mousedown.
  // Cleared on mouseup/mouseleave.
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);

  // Reset pan/zoom when the node set changes (new blueprint loaded).
  useEffect(() => {
    setView({ zoom: 1, x: 0, y: 0 });
  }, [nodes]);

  // Wheel zoom is a native listener (not React's `onWheel`) because we
  // need `passive: false` to call `preventDefault()` and stop the page
  // from scrolling underneath the SVG.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !layout) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Anchor zoom on the cursor: the canvas point under the cursor
      // before the zoom must still be under the cursor after. Compute
      // the cursor in (a) screen-fraction coords [0..1] and (b) canvas
      // coords pre-zoom, then solve for the new viewBox origin at the
      // new zoom. exp(-deltaY * k) gives a smooth multiplicative zoom.
      const zoomFactor = Math.exp(-e.deltaY * WHEEL_ZOOM_K);
      const rect = svg.getBoundingClientRect();
      const cursorFracX = (e.clientX - rect.left) / rect.width;
      const cursorFracY = (e.clientY - rect.top) / rect.height;
      setView((prev) => {
        const nextZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev.zoom * zoomFactor));
        const cursorCanvasX = prev.x + cursorFracX * (layout.width / prev.zoom);
        const cursorCanvasY = prev.y + cursorFracY * (layout.height / prev.zoom);
        return {
          zoom: nextZoom,
          x: cursorCanvasX - cursorFracX * (layout.width / nextZoom),
          y: cursorCanvasY - cursorFracY * (layout.height / nextZoom),
        };
      });
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [layout]);

  // Run ELK whenever the graph changes. `cancelled` flag prevents a
  // stale layout from racing into state if `nodes`/`edges` change
  // before the previous layout resolves.
  useEffect(() => {
    if (nodes.length === 0) {
      setLayout(null);
      return;
    }
    let cancelled = false;
    const meta = new Map(
      nodes.map((node) => [node.id, measureNode(node.data.name, depsByNode?.get(node.id) ?? [])]),
    );
    const formNames = new Map(nodes.map((node) => [node.id, node.data.name]));
    const root: ElkNode = {
      id: "root",
      layoutOptions: {
        "elk.algorithm": "layered",
        "elk.direction": "RIGHT",
        "elk.edgeRouting": "ORTHOGONAL",
        "elk.layered.spacing.nodeNodeBetweenLayers": "60",
        "elk.spacing.nodeNode": "24",
        "elk.padding": `[top=${PADDING},left=${PADDING},bottom=${PADDING},right=${PADDING}]`,
      },
      children: nodes.map((node) => {
        const m = meta.get(node.id)!;
        return { id: node.id, width: m.w, height: m.h, labels: [{ text: node.data.name }] };
      }),
      edges: edges.map((edge, i): ElkExtendedEdge => ({
        id: `e${i}`,
        sources: [edge.source],
        targets: [edge.target],
      })),
    };
    elk
      .layout(root)
      .then((laid) => {
        if (cancelled) return;
        setLayout(toLayout(laid, meta, formNames));
      })
      .catch(() => !cancelled && setLayout(null));
    return () => {
      cancelled = true;
    };
  }, [nodes, edges, depsByNode]);

  if (!layout) {
    return (
      <Card className="h-32 grid place-items-center text-sm text-muted-foreground">
        Laying out graph…
      </Card>
    );
  }

  const hoveredNode = hover ? layout.nodes.find((node) => node.id === hover.nodeId) ?? null : null;

  // Pan handlers. We snapshot mouse + viewBox at mousedown, then map
  // pixel deltas back into canvas units (accounting for zoom).
  const onPanDown = (e: ReactMouseEvent<SVGSVGElement>) => {
    dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y };
    setHover(null);
  };
  const onPanMove = (e: ReactMouseEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = ((e.clientX - drag.x) / rect.width) * (layout.width / view.zoom);
    const dy = ((e.clientY - drag.y) / rect.height) * (layout.height / view.zoom);
    setView((prev) => ({ ...prev, x: drag.vx - dx, y: drag.vy - dy }));
  };
  const endPan = () => {
    dragRef.current = null;
  };
  const onKeyDown = (e: ReactKeyboardEvent<SVGSVGElement>) => {
    // Pan in 10% increments of the visible canvas width/height —
    // proportional, so the perceived speed stays the same at any zoom.
    const stepX = (layout.width / view.zoom) * 0.1;
    const stepY = (layout.height / view.zoom) * 0.1;
    if (e.key === "ArrowLeft") setView((prev) => ({ ...prev, x: prev.x - stepX }));
    else if (e.key === "ArrowRight") setView((prev) => ({ ...prev, x: prev.x + stepX }));
    else if (e.key === "ArrowUp") setView((prev) => ({ ...prev, y: prev.y - stepY }));
    else if (e.key === "ArrowDown") setView((prev) => ({ ...prev, y: prev.y + stepY }));
    else return;
    e.preventDefault();
  };
  // Same anchor-on-center logic as wheel zoom, but with cursorFrac=0.5,0.5.
  const zoomAtCenter = (factor: number) => {
    setView((prev) => {
      const nextZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev.zoom * factor));
      const centerX = prev.x + layout.width / prev.zoom / 2;
      const centerY = prev.y + layout.height / prev.zoom / 2;
      return {
        zoom: nextZoom,
        x: centerX - layout.width / nextZoom / 2,
        y: centerY - layout.height / nextZoom / 2,
      };
    });
  };

  return (
    <>
      <Card className="relative p-2">
        <div className="absolute right-3 top-3 z-10 flex gap-1">
          <Button size="icon-sm" variant="outline" aria-label="Zoom in" onClick={() => zoomAtCenter(ZOOM_STEP)}>
            +
          </Button>
          <Button size="icon-sm" variant="outline" aria-label="Zoom out" onClick={() => zoomAtCenter(1 / ZOOM_STEP)}>
            −
          </Button>
          <Button size="sm" variant="outline" onClick={() => setView({ zoom: 1, x: 0, y: 0 })}>
            Reset
          </Button>
        </div>
        <svg
          ref={svgRef}
          role="img"
          aria-label="Form dependency graph"
          tabIndex={0}
          viewBox={`${view.x} ${view.y} ${layout.width / view.zoom} ${layout.height / view.zoom}`}
          preserveAspectRatio="xMidYMid meet"
          className="block h-auto w-full cursor-grab outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
          onMouseDown={onPanDown}
          onMouseMove={onPanMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
          onKeyDown={onKeyDown}
        >
          <g className="text-muted-foreground">
            {layout.edges.map((edge) => (
              <path
                key={edge.id}
                d={edge.d}
                fill="none"
                stroke="currentColor"
                strokeWidth={1.5}
                strokeOpacity={0.5}
              />
            ))}
          </g>
          {layout.nodes.map((node) => (
            <NodeTile
              key={node.id}
              node={node}
              selected={selectedId === node.id}
              onEnter={(e) => setHover({ nodeId: node.id, x: e.clientX, y: e.clientY })}
              onMove={(e) => setHover({ nodeId: node.id, x: e.clientX, y: e.clientY })}
              onLeave={() =>
                setHover((prev) => (prev?.nodeId === node.id ? null : prev))
              }
            />
          ))}
        </svg>
      </Card>
      {hoveredNode && hover && <DepTooltip node={hoveredNode} x={hover.x} y={hover.y} />}
    </>
  );
}

/**
 * Floating dependency tooltip rendered next to the cursor.
 *
 * Auto-flips to the cursor's left if it would clip the right edge of
 * the viewport, and clamps vertically so it never falls off the bottom.
 * `pointer-events-none` so it never steals hover from the underlying tile.
 */
function DepTooltip({ node, x, y }: { node: LaidNode; x: number; y: number }) {
  const [pos, setPos] = useState<{ left: number; top: number }>({ left: x + 14, top: y + 14 });
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const margin = 8;
    let left = x + 14;
    let top = y + 14;
    // Flip to the cursor's left if right-anchored would clip the viewport.
    if (left + rect.width + margin > window.innerWidth) left = x - rect.width - 14;
    // Clamp vertically — a long tooltip near the bottom edge should
    // settle just inside the viewport rather than scroll the page.
    if (top + rect.height + margin > window.innerHeight) {
      top = Math.max(margin, window.innerHeight - rect.height - margin);
    }
    setPos({ left, top });
  }, [x, y, node.id]);

  return (
    <div
      ref={ref}
      role="tooltip"
      className="pointer-events-none fixed z-50 w-80 rounded-md border border-border bg-popover text-popover-foreground shadow-lg"
      style={{ left: pos.left, top: pos.top }}
    >
      <div className="border-b border-border px-3 py-2 text-sm font-semibold">{node.formName}</div>
      {node.deps.length === 0 ? (
        <div className="px-3 py-2 text-xs text-muted-foreground">No prefill mappings</div>
      ) : (
        <ul className="px-3 py-2 space-y-1.5">
          {node.deps.map((dep) => (
            <li key={dep.fieldLabel} className="text-xs leading-snug">
              <div className="font-medium text-foreground">{dep.fieldTitle}</div>
              <div className="text-muted-foreground">
                <span className="mr-1">←</span>
                <span className="font-medium">{dep.sourceFieldTitle}</span>
                <span className="mx-1">from</span>
                <span>{dep.sourceFormName}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Single ELK-positioned node tile.
 *
 * Title block is centered; an optional dep block sits below a divider
 * with one line per `NodeDep`. Selected tiles invert the palette
 * (primary fill, primary-foreground text). Hover events bubble up so
 * the parent can drive the floating tooltip.
 */
function NodeTile({
  node,
  selected,
  onEnter,
  onMove,
  onLeave,
}: {
  node: LaidNode;
  selected: boolean;
  onEnter: (e: ReactMouseEvent) => void;
  onMove: (e: ReactMouseEvent) => void;
  onLeave: (e: ReactMouseEvent) => void;
}) {
  // Per-line Y offsets. `-4` / `-3` nudge the baseline so the text
  // sits visually centered within its line height.
  const titleY = (lineIndex: number) => PAD_TOP + (lineIndex + 1) * TITLE_LINE_H - 4;
  const dividerY = PAD_TOP + node.titleLines.length * TITLE_LINE_H + DIVIDER_GAP_T;
  const depY = (lineIndex: number) => dividerY + DIVIDER_GAP_B + (lineIndex + 1) * DEP_LINE_H - 3;

  return (
    <g
      transform={`translate(${node.x},${node.y})`}
      aria-label={buildTooltip(node)}
      onMouseEnter={onEnter}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
    >
      <rect
        width={node.w}
        height={node.h}
        rx={8}
        ry={8}
        className={selected ? "fill-primary stroke-primary" : "fill-card stroke-border"}
        strokeWidth={selected ? 2 : 1}
      />

      <text
        textAnchor="middle"
        className={
          selected
            ? "fill-primary-foreground text-[13px] font-medium"
            : "fill-foreground text-[13px] font-medium"
        }
      >
        {node.titleLines.map((line, i) => (
          <tspan key={i} x={node.w / 2} y={titleY(i)}>
            {line}
          </tspan>
        ))}
      </text>

      {node.depRows.length > 0 && (
        <>
          <line
            x1={PAD_X * 0.6}
            x2={node.w - PAD_X * 0.6}
            y1={dividerY}
            y2={dividerY}
            className={selected ? "stroke-primary-foreground/40" : "stroke-border"}
            strokeWidth={1}
          />
          <text
            textAnchor="start"
            className={
              selected
                ? "fill-primary-foreground/85 text-[11px]"
                : "fill-muted-foreground text-[11px]"
            }
          >
            {node.depRows.map((row, i) => (
              <tspan key={node.deps[i]?.fieldLabel ?? i} x={PAD_X} y={depY(i)}>
                {row}
              </tspan>
            ))}
          </text>
        </>
      )}
    </g>
  );
}

/**
 * Project ELK output into render-ready geometry.
 *
 * Falls back to safe defaults for any field ELK didn't populate
 * (shouldn't happen in practice, but the types are optional).
 */
function toLayout(
  root: ElkNode,
  meta: Map<string, NodeMeta>,
  formNames: Map<string, string>,
): Layout {
  const laidNodes: LaidNode[] = (root.children ?? []).map((child) => {
    const m = meta.get(child.id);
    return {
      id: child.id,
      formName: formNames.get(child.id) ?? child.labels?.[0]?.text ?? child.id,
      titleLines: m?.titleLines ?? [child.labels?.[0]?.text ?? child.id],
      depRows: m?.depRows ?? [],
      deps: m?.deps ?? [],
      x: child.x ?? 0,
      y: child.y ?? 0,
      w: child.width ?? MIN_NODE_W,
      h: child.height ?? TITLE_LINE_H + PAD_TOP + PAD_BOTTOM,
    };
  });
  const laidEdges = (root.edges ?? []).map((edge) => ({
    id: edge.id,
    d: edgePath(edge),
  }));
  return {
    width: root.width ?? 0,
    height: root.height ?? 0,
    nodes: laidNodes,
    edges: laidEdges,
  };
}

/** Pre-layout metadata: title wrap, dep rows, and the resulting tile size. */
interface NodeMeta {
  titleLines: string[];
  depRows: string[];
  deps: NodeDep[];
  w: number;
  h: number;
}

/**
 * Pre-layout sizing pass.
 *
 * Wraps the title to `TITLE_MAX_CHARS` per line, formats one dep row
 * per `NodeDep` (`"<field> ← <source>"`), then sizes the tile to fit
 * the widest line plus padding — clamped to `[MIN_NODE_W, MAX_NODE_W]`
 * so a single long string can't blow up the layout.
 */
function measureNode(label: string, deps: NodeDep[]): NodeMeta {
  const titleLines = wrapLabel(label, TITLE_MAX_CHARS);
  const depRows = deps.map(
    (d) => `${ellipsize(d.fieldLabel, FIELD_MAX)} ← ${ellipsize(d.sourceLabel, SOURCE_MAX)}`,
  );

  const titleW = titleLines.reduce((max, line) => Math.max(max, line.length * TITLE_CHAR_W), 0);
  const depsW = depRows.reduce((max, row) => Math.max(max, row.length * DEP_CHAR_W), 0);
  const w = Math.min(MAX_NODE_W, Math.max(MIN_NODE_W, Math.max(titleW, depsW) + 2 * PAD_X));

  const titleH = PAD_TOP + titleLines.length * TITLE_LINE_H;
  const depH = depRows.length > 0 ? DIVIDER_GAP_T + DIVIDER_GAP_B + depRows.length * DEP_LINE_H : 0;
  const h = titleH + depH + PAD_BOTTOM;

  return { titleLines, depRows, deps, w, h };
}

/** Naive word-wrap. Single words longer than `maxChars` are not broken. */
function wrapLabel(label: string, maxChars: number): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/** Truncate `s` to at most `max` characters, appending `…` when truncated. */
function ellipsize(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

/** Multi-line aria-label / native tooltip for a node tile. */
function buildTooltip(node: LaidNode): string {
  if (node.deps.length === 0) return node.formName;
  const lines = [node.formName, ""];
  for (const d of node.deps) {
    lines.push(`${d.fieldTitle} is prefilled by ${d.sourceFieldTitle} from ${d.sourceFormName}`);
  }
  return lines.join("\n");
}

/**
 * Convert an ELK edge into an SVG path `d` attribute.
 *
 * ELK edges have one or more sections; each section has a `startPoint`,
 * `endPoint`, and optional `bendPoints`. We concatenate them into a
 * single `M ... L ...` path — orthogonal routing means each leg is
 * just a straight line.
 */
function edgePath(edge: ElkExtendedEdge): string {
  const parts: string[] = [];
  for (const section of edge.sections ?? []) {
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint];
    points.forEach((p, i) => {
      parts.push(`${i === 0 ? "M" : "L"} ${p.x} ${p.y}`);
    });
  }
  return parts.join(" ");
}
