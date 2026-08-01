/**
 * /api/fp/signup/consent-policy — the rendered parental-consent policy, READ ONLY
 * (Slice B Unit 9; R15). A public cross-origin GET the First Profit SPA fetches
 * BEFORE it displays the consent step, so the client renders and echoes exactly
 * the version + hash the server currently records (consent binds to the rendered
 * text — echo + refuse stale). Returning it here removes the client-side
 * byte-identical DEFAULT_CONSENT_POLICY constant as a drift risk: the SPA no
 * longer has to keep a copy of the text in sync with the server.
 *
 * CORS MIRROR of /api/fp/login + ../route.ts: OPTIONS 204 with the echoed origin,
 * 403 for a disallowed Origin, no-store. It exposes nothing sensitive (the policy
 * is shown to every parent), takes no input, and mutates nothing, so there is no
 * rate-limit strike and no generic-refusal laundering here — a bad Origin is the
 * only refusal. `dynamic` so the response is never statically cached across a
 * policy text change.
 */

import {
  buildAllowedOrigins,
  checkOrigin,
} from "../signup-rules";
import {
  CONSENT_METHODS,
  FP_CONSENT_POLICY,
  currentPolicyHash,
} from "../consent-rules";

export const dynamic = "force-dynamic";

/** The consent policy namespace (its own, not the Stripe refund-policy space). */
const CONSENT_POLICY_NAMESPACE = "fp_parental_consent";

function corsJsonHeaders(origin: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": verdict.origin,
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "content-type",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export async function GET(req: Request): Promise<Response> {
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  // The rendered snapshot: version + text + its hash (the binding the consent
  // write checks) + the namespace and this build's consent method. The client
  // echoes version + hash back on submit; the server refuses anything that does
  // not bind to the text it currently serves.
  return new Response(
    JSON.stringify({
      namespace: CONSENT_POLICY_NAMESPACE,
      version: FP_CONSENT_POLICY.version,
      hash: currentPolicyHash(),
      method: CONSENT_METHODS[0],
      text: FP_CONSENT_POLICY.text,
    }),
    { status: 200, headers: corsJsonHeaders(verdict.origin) }
  );
}
