type ClassValue = string | false | null | undefined;

/**
 * Minimal class-name joiner for The Path's design system.
 *
 * The design prototype used `tailwind-merge` for last-wins conflict resolution,
 * but this repo carries no `clsx`/`tailwind-merge` dependency and the plan adds
 * only `lucide-react`. A plain filtered join is the faithful port: these
 * components put the caller's `className` last, and none of them pass conflicting
 * utilities that would need merge semantics. If a real conflict ever appears,
 * reach for `tailwind-merge` deliberately rather than by default.
 */
export function cn(...classes: ClassValue[]): string {
  return classes.filter(Boolean).join(" ");
}
