import type { NextConfig } from "next";

/**
 * VERSION SKEW PROTECTION (Staff Front Door Unit 5 — Peter's decision, 2026-07-27).
 *
 * ── The failure this closes
 *
 * A guide's iPad sits open on the field all day. We deploy. The iPad is still running
 * the old bundle. The guide taps sign out, and the old code does what it was written
 * to do: clear the device's residue FIRST — queue, roster cache, app shell — and only
 * then call the Server Action that ends the session. Under a new deployment that
 * action's id no longer resolves. The device is now wiped and looks handed-over-ready,
 * the session is still authenticated, and the copy says "try again", which can never
 * work, when only a reload can. It was documented as a hazard in
 * docs/solutions/best-practices/deleting-a-use-server-export-is-a-deploy-skew-hazard-…
 * and Unit 4's review carried it here as Peter's call, because it changes deployment
 * semantics for the whole site, not just this subtree.
 *
 * ── What setting it actually does
 *
 * Per node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/
 * deploymentId.md: Next stamps `?dpl=` on static asset URLs, sends `x-deployment-id`
 * on client navigations, returns `x-nextjs-deployment-id` on responses, and — the part
 * that matters here — when the client detects a mismatch it performs a HARD NAVIGATION
 * instead of a client-side one. The reload the stale tab needed becomes automatic, and
 * the docs state explicitly that Server Functions work correctly across deployment
 * boundaries under it (App Router).
 *
 * ── Why the value is resolved rather than hardcoded, and why undefined is fine
 *
 * The identifier must be STABLE across every instance of one deployment and DIFFERENT
 * between deployments; that is the entire contract. On Vercel `VERCEL_DEPLOYMENT_ID` is
 * exactly that. `VERCEL_GIT_COMMIT_SHA` is the fallback because it is a build-time
 * system variable on every Vercel build and satisfies the same contract — two builds of
 * one commit produce the same bundle and the same Server Action ids, so sharing an id
 * is correct rather than a collision. `NEXT_DEPLOYMENT_ID` is honoured first because
 * that is the name the framework documents for overriding it.
 *
 * Locally all three are unset and this is `undefined`, which disables the feature —
 * i.e. exactly today's `next dev` behaviour, deliberately. Skew protection during
 * development would fight the fast-refresh loop it exists to survive in production.
 */
const deploymentId =
  process.env.NEXT_DEPLOYMENT_ID ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  undefined;

const nextConfig: NextConfig = {
  deploymentId,
  async headers() {
    return [
      // First Profit service worker (T1 Unit 11). A CDN-cached service worker is a
      // multi-hour outage of the update path — the file must revalidate on
      // every check (plus updateViaCache:'none' at registration).
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      // The Founders Weekend projected board (FW Unit 6) — the repo's only
      // UNAUTHENTICATED read surface, hash-validated per request. Both the page
      // and its poll feed must never be cached (a CDN edge holding one poll's
      // grid would show a stale room its own numbers) and must never be indexed
      // (a search engine must never surface a minor's first-name-plus-initial).
      // The feed route ALSO sets these on its own Response — belt and suspenders,
      // and so the header is provably on the payload, not only the page.
      {
        source: "/fp/fw/board/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, must-revalidate" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // FW Unit 10 — the whole-app /path → /fp rename (FW-D7/FW-R30). The app
      // moved from app/path to app/fp; every old /path URL 308s to its /fp twin,
      // preserving sub-path AND query (`:path*` carries both). Permanent (308,
      // method-preserving) because the move is one-way and cacheable; the ONLY
      // /path route literal that survives the straggler grep lives right here.
      // A 308 (not the proxy) owns this so a session-less old sign-in URL lands
      // on its /fp twin cleanly rather than being gated first — the proxy matcher
      // no longer covers the old prefix at all (see proxy.ts).
      { source: "/path/:path*", destination: "/fp/:path*", permanent: true },
      // The game was briefly live as /raiders before the Gauntlet rename.
      { source: "/raiders", destination: "/gauntlet", permanent: false },
      // The old GT sub-site was retired in the 2026-07 rebrand; the Scholars
      // program page at /scholars is its permanent home.
      { source: "/gt", destination: "/scholars", permanent: true },
      // Canonical domain: the120.school. The old jointhe120.vercel.app alias
      // stays reachable but 308s here so links, SEO, and share cards converge.
      {
        source: "/:path*",
        has: [{ type: "host", value: "jointhe120.vercel.app" }],
        destination: "https://the120.school/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
