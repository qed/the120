import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import { FP_CONSENT_POLICY } from "@/app/api/fp/signup/consent-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";
import { parentOwesConsentDecision } from "@/app/lib/funnel/consent-wall-rules";
import { ConsentWall } from "./ConsentWall";

/**
 * `/consent` — THE CONSENT WALL (founder, 2026-08-10).
 *
 * Six of the eight remaining beta families were provisioned on 2026-08-04,
 * before the v3 consent flow shipped on 2026-08-08, so their children have no
 * `fp_parental_consent` row at all while actively using the product. This screen
 * is where those parents are made to say yes or no.
 *
 * Shaped after `/set-password`, the repo's existing forced interstitial, and it
 * inherits that page's most important sentence:
 *
 * ⚠ THE PAGE GATE IS NOT THE SECURITY CONTROL. It is a routing courtesy — it
 * sends a signed-out visitor to sign in and bounces a parent who does not owe a
 * decision, so nobody lands on a screen that would do nothing. The control is
 * `requireConsentClear`, called inside every consequential Server Action; a
 * Server Action is a separately-addressable POST endpoint and no page render
 * stands in front of it (the page-vs-action gating learning, 2026-08-05).
 *
 * The gate runs HERE, in this page, rather than in a shared layout — same reason
 * the four `/dashboard` pages each run their own (see dashboard/layout.tsx): a
 * gate that lives next to the data it protects cannot be inherited-and-forgotten
 * by a new route.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Parental consent — The 120",
  description: "Please read and answer before continuing.",
};

// `cache()` a NON-throwing loader, keep `redirect()` in the page and OUTSIDE any
// try (the memoized-auth-gate learning; a caught NEXT_REDIRECT reports failure
// on success, which this repo has shipped once).
const loadDashboardGateFacts = cache(() => loadDashboardGateFactsCore());

export default async function ConsentWallPage() {
  const facts = await loadDashboardGateFacts();
  // No session: the dashboard renders SignIn. Never a wall a stranger can read.
  if (!facts.hasSession) redirect("/dashboard");
  // Nothing owed (including every fail-open shape, which reads as "owes
  // nothing"): there is no decision to make, so do not manufacture one.
  if (!parentOwesConsentDecision({ children: facts.consentWallChildren })) {
    redirect("/dashboard");
  }

  return (
    <main className="min-h-dvh w-full">
      {/* The TEXT and the VERSION come from the server's own constant and are
          rendered verbatim, so what the parent reads and what
          `captureLegacyChildConsent` snapshots are the same string by
          construction — there is no client bundle here that could be stale. */}
      <ConsentWall
        policyText={FP_CONSENT_POLICY.text}
        policyVersion={FP_CONSENT_POLICY.version}
      />
    </main>
  );
}
