import Link from "next/link";
import { ctaClass, type CtaVariant } from "./Cta";
import { FUNNEL_CTA_LABEL, funnelEntryHref, type CtaSource } from "@/app/lib/cta-source";

/**
 * The funnel entry CTA (funnel U4/U6; R10, R11, R13) — what replaced
 * `JoinButton` on every marketing surface.
 *
 * A `<Link>`, not a button: the destination is a real route, so it is
 * crawlable, middle-clickable, and works with JavaScript still loading. The
 * old CTA had to be a button because it opened a modal; nothing about the
 * funnel needs that.
 *
 * Not a client component either — it holds no state. `JoinButton` was
 * `"use client"` only because `useAccountModal` is a context hook, and
 * dropping that removes the modal provider from the critical path of every
 * marketing page.
 *
 * `source` is REQUIRED and typed: a surface cannot ship an unattributed CTA
 * by forgetting a prop, which is the failure the old `SRC_MARKER` had (applied
 * at two call sites, read back nowhere).
 *
 * ── Three call sites deliberately keep `JoinButton` ──
 * `app/dashboard/SignIn.tsx` ("Create an account" — R9 preserves it, and it is
 * the app's only remaining `signUp()`), and the Gauntlet's two, where the
 * modal is a functional tournament-entry gate rather than a marketing CTA.
 * `app/lib/__tests__/cta-reroute.test.ts` asserts all three by count.
 */
export default function StartCta({
  source,
  group,
  variant = "primary",
  className = "",
  children = FUNNEL_CTA_LABEL,
  onClick,
}: {
  source: CtaSource;
  group?: string;
  variant?: CtaVariant;
  className?: string;
  children?: React.ReactNode;
  /** Side effects that must run on navigate — the mobile nav closes its menu.
   *  Never the navigation itself: that is the href's job, so the link keeps
   *  working when JavaScript has not loaded. */
  onClick?: () => void;
}) {
  return (
    <Link
      href={funnelEntryHref(source, { group })}
      onClick={onClick}
      className={ctaClass(variant, className)}
    >
      {children}
    </Link>
  );
}
