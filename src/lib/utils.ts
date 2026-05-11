import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Tailwind-aware class name combiner — the shadcn/ui standard helper.
 *
 * `clsx` resolves the `ClassValue` recursion (arrays, objects,
 * conditionals); `twMerge` then collapses conflicting Tailwind utility
 * classes so the *last* one wins. Without it, `cn("p-2", "p-4")` would
 * emit both classes and the cascade would resolve them by source order;
 * with it, the result is `"p-4"` alone, matching what humans expect.
 *
 * Use everywhere you build a `className` from conditional pieces.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
