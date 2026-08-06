import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/app/crm/lib/auth";
import { IMAGE_LAB_SHELL_COPY } from "./lib/shell-rules";

/**
 * Force-dynamic. THE GATE BELOW READS THE SESSION, so this segment can never be
 * prerendered — and this is the one guarded module in the Lab whose dynamic-ness
 * would otherwise be neither declared nor pinned, since the pages beneath it all
 * declare their own.
 *
 * Declared even though `app/staff/layout.tsx` (which wraps this) omits it: a
 * directive inherited from a parent that never states it is a directive nobody
 * can find, and Next resolves segment config per segment anyway. Pinned by
 * `__tests__/gate-enforcement.test.ts` alongside the pages'.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Image Lab — The 120 (staff)",
  // Declared here AND on every page beneath it. Next merges `metadata` shallowly
  // from the root segment DOWN, nearest wins — so a page without its own
  // declaration inherits this noindex rather than the root layout's PUBLIC
  // marketing directive, and a page WITH one is covered if this is ever removed.
  robots: { index: false, follow: false },
};

/**
 * `/staff/image-lab` — the Lab's shell (first-profit repo:
 * docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md, Unit 3; requirements in
 * first-profit repo: docs/brainstorms/2026-08-05-image-lab-requirements.md,
 * R1 and R14).
 *
 * ── THE SOFT-NAVIGATION RULE, STATED ONCE, HERE ────────────────────────────
 * Every other module in the Lab points at THIS paragraph rather than repeating
 * it. THE GATE RUNS HERE AND IN EVERY PAGE BENEATH IT, deliberately, and this is the
 * repo rule rather than this feature's invention (see the docblock on
 * `requireStaff` itself): Next 16 layouts do not re-render on soft navigation, so
 * a page leaning on its layout alone is gated only on the render that MOUNTED it
 * — bench → history → kit would then be three ungated renders after one gated
 * one. `requireStaff()` is request-memoized with React's `cache()`, so the second
 * call inside a request costs nothing.
 *
 * The layout is also the third fence, not the first: `proxy.ts` refuses anything
 * under `/staff` without an admin claim, and `app/staff/layout.tsx` (which wraps
 * this one) gates and mounts the StaffBar. THE BAR DOES NOT MOUNT HERE — one bar
 * per application, in the outermost guarded layout, pinned by
 * `app/lib/staff-bar/__tests__/bar-wiring.test.ts`.
 *
 * No `error.tsx` of its own: a throw from the gate in THIS file is not caught by
 * an `error.js` in the same segment (Next's documented rule), so it bubbles to
 * `app/staff/error.tsx` / `app/error.tsx`, both of which offer the retry that is
 * the only useful control for an unreadable session.
 */
export default async function ImageLabLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireStaff();

  return (
    // `px-5` at the base, `px-6` from sm: at 390px the narrower gutter is what
    // keeps the nav's three 44px targets on one row without overflow.
    <main className="mx-auto w-full max-w-3xl px-5 py-10 sm:px-6 sm:py-12">
      <Link
        href="/staff"
        className="inline-flex min-h-11 items-center font-path-mono text-[13px] text-crm-blue"
      >
        ← Staff
      </Link>
      <h1 className="mt-2 font-path-display text-2xl text-hq-ink">
        {IMAGE_LAB_SHELL_COPY.title}
      </h1>
      <p className="mt-2 text-sm text-hq-ink-soft">
        {IMAGE_LAB_SHELL_COPY.subtitle}
      </p>
      {children}
    </main>
  );
}
