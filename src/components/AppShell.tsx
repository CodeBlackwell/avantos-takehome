import type { ReactNode } from "react";

interface Props {
  /** Page title — usually the loaded blueprint's `name`. */
  title: string;
  /** Optional secondary line under the title (the blueprint's `description`). */
  subtitle?: string;
  /** Optional uppercase chip beside the title (the blueprint's `category`). */
  category?: string;
  /** Page body — sort control, form list, blueprint selector, graph view, … */
  children: ReactNode;
}

/**
 * Page chrome.
 *
 * A fixed-width centered column with a title bar (title + optional
 * category chip + optional subtitle) and a slot for the page body.
 * No state, no behavior — purely presentational so it can wrap any
 * page-level layout.
 */
export function AppShell({ title, subtitle, category, children }: Props) {
  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-[60vw] min-w-[40rem] max-w-5xl flex-col gap-6 px-6 py-8">
        <header className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3">
            <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
            {category && (
              <span className="rounded bg-muted px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                {category}
              </span>
            )}
          </div>
          {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
        </header>
        {children}
      </div>
    </main>
  );
}
