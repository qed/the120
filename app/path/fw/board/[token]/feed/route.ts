import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { loadFwBoard, resolveFwBoardToken } from "@/app/path/lib/fw-board-loader";

/**
 * /path/fw/board/[token]/feed — the board's poll transport (FW Unit 6).
 *
 * A route handler INSIDE the same UNGUARDED token subtree as the page (Unit 2
 * carved `/path/fw/board/` out of the proxy), so the unguarded prefix and the
 * per-request token check provably cover the PAYLOAD, not just the page. The
 * polling client hits this every few seconds; it re-runs the WHOLE token check on
 * every call — hash → lookup → expiry/revocation — so a token revoked mid-event
 * stops the feed on the next poll, not just the next page load.
 *
 * GET NEVER MUTATES. Every refusal (garbage / expired / revoked / unreadable) is
 * the SAME bare 404 — no cohort-existence leak, nothing a token-guesser can learn.
 * A transient read failure of a GOOD token is a 503, not a 404: the token is
 * valid, so the client keeps its last board and shows "catching up" rather than
 * treating the projector as dead.
 *
 * Force-dynamic + no-store: this is live data behind a per-request auth check, and
 * a CDN edge caching one poll's grid would show a room stale numbers under a URL
 * that looks live. The headers are set here on the Response (so the test can
 * assert them on the payload directly) AND in next.config for the subtree.
 */

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow",
};

const JSON_HEADERS: Record<string, string> = {
  ...NO_STORE_HEADERS,
  "Content-Type": "application/json; charset=utf-8",
};

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = supabaseAdmin();

  const auth = await resolveFwBoardToken(db, { token });
  if (!auth.ok) {
    // One 404 for every refusal — a probe learns nothing about which cohorts or
    // tokens exist. No body: there is nothing safe to say.
    return new Response(null, { status: 404, headers: NO_STORE_HEADERS });
  }

  const board = await loadFwBoard(db, { cohortId: auth.cohortId });
  if (!board.ok) {
    // The token is GOOD; the read just failed. 503 tells the poller to hold its
    // last frame and show the stale indicator — never a blank board.
    return new Response(JSON.stringify({ ok: false }), { status: 503, headers: JSON_HEADERS });
  }

  // `columns` rides along on every frame so the client can RESYNC its grid layout
  // — a board opened before check-in (empty cohort → empty columns) fills once the
  // first member exists, instead of a permanently columnless grid (adversarial
  // review). Static, non-PII program structure; cheap to resend.
  return new Response(
    JSON.stringify({
      ok: true,
      cohortSlug: board.data.cohortSlug,
      model: board.data.model,
      columns: board.data.columns,
    }),
    { status: 200, headers: JSON_HEADERS }
  );
}
