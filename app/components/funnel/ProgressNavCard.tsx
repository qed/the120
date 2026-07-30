"use client";

/**
 * The floating white nav card (U10 fidelity, audit X1 — the handoff's
 * biggest single drift). One component for every application-register funnel
 * surface, explainer → submit → arrival: brand lockup left; on the right the
 * 4px red bar on the `#eceae5` track (width transition .35s, the handoff's
 * number) with its mono percent, then NAME · SIGN OUT from the wizard on,
 * and name + SIGN OUT alone on next steps/arrival. WHICH of those renders is
 * `nav-card-rules`' decision (`NavCardModel`) — this component owns layout
 * and nothing else.
 *
 * Chrome from the prototype's card verbatim: white, 14px radius,
 * `0 4px 18px rgba(19,20,22,.14)` shadow — the same card floats over the
 * child's skin on the mini-app steps (the dc.html skinned scenes carry it
 * unchanged), so no per-skin variant exists.
 *
 * GEOMETRY (2026-07-30): the card is STRUCTURALLY the home page's <Nav> —
 * the same `sticky top-[18px] mx-5 mt-[18px]` wrapper, 14px radius, 22/11
 * padding and 64px min row height — so the bar sits in the exact same
 * place, same width, on every surface. The contract with mount sites: this
 * renders as a sibling ABOVE the page's centered column (never inside a
 * max-w container, which would shrink it). Change <Nav> and this together.
 *
 * Sign-out reuses the dashboard's mechanism: supabase `auth.signOut()` then
 * a full navigation home (`DashHeader` is `signOut` + `<Link href="/">`).
 * Surfaces that already hold a sign-out (the dashboard store) pass theirs in.
 */

import { useState } from "react";
import Link from "next/link";
import Wordmark from "@/app/components/Wordmark";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import type { NavCardModel } from "@/app/lib/funnel/nav-card-rules";

export function ProgressNavCard({
  model,
  onSignOut,
  logoHref = "/dashboard",
}: {
  model: NavCardModel;
  /** Override for surfaces with their own sign-out (the dashboard store). */
  onSignOut?: () => void;
  /** Where the logo lockup links (2026-07-30): inside the application
   *  process it goes to the parent's logged-in dashboard (the default);
   *  the pre-auth capture flow overrides it to "/" — everywhere else on
   *  the site the logo already leads home. */
  logoHref?: string;
}) {
  // Await the revocation BEFORE the hard navigation: window.location.assign
  // unloads the document and can abort an in-flight signOut network call,
  // leaving the server-side session unrevoked (the pending-navigation
  // lesson, docs/solutions/ui-bugs/, 2026-07-29). The latch also prevents a
  // double-fire while the round-trip runs.
  const [signingOut, setSigningOut] = useState(false);
  const handleSignOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      if (onSignOut) await onSignOut();
      else await supabaseBrowser().auth.signOut();
    } catch {
      // Revocation failed or timed out; still leave the page — the local
      // session is cleared either way and staying stuck here is worse.
    }
    window.location.assign("/");
  };

  const showsBar = model.kind === "progress" || model.kind === "progress_identity";
  const showsIdentity = model.kind === "progress_identity" || model.kind === "identity";

  return (
    <div className="sticky top-[18px] z-50 mx-5 mt-[18px]">
      <div className="flex min-h-16 items-center justify-between gap-3 rounded-[14px] bg-white px-[22px] py-[11px] shadow-[0_4px_18px_rgba(19,20,22,0.14)]">
        <Link href={logoHref} aria-label="The 120">
          <Wordmark />
        </Link>
        <span className="flex min-w-0 items-center gap-2.5">
          {showsBar && (
            <>
              <span
                aria-hidden
                className={`h-1 flex-none overflow-hidden rounded-[2px] bg-track ${
                  model.kind === "progress" ? "w-20" : "w-16"
                }`}
              >
                <span
                  className="block h-full rounded-[2px] bg-red transition-[width] duration-[350ms]"
                  style={{ width: `${model.percent}%` }}
                />
              </span>
              <span className="whitespace-nowrap font-mono text-[0.6rem] tracking-[0.08em] text-ink-soft">
                {model.label}
              </span>
            </>
          )}
          {showsIdentity && (
            <span className="truncate font-mono text-[0.6rem] tracking-[0.1em] text-ink-soft">
              {model.identity ? `${model.identity} · ` : ""}
              <button
                type="button"
                onClick={handleSignOut}
                disabled={signingOut}
                className="text-muted transition-colors hover:text-red disabled:cursor-not-allowed disabled:opacity-30"
              >
                SIGN OUT
              </button>
            </span>
          )}
        </span>
      </div>
    </div>
  );
}
