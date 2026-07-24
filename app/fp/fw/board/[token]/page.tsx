import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { loadFwBoardShell, resolveFwBoardToken } from "@/app/fp/lib/fw-board-loader";
import FwBoard from "@/app/fp/fw/components/board/FwBoard";

/**
 * /fp/fw/board/[token] — the projected cohort board (FW Unit 6).
 *
 * The tokened URL a room's projector shows. UNGUARDED in the proxy (a venue
 * projector has no session and never will), so this page OWNS its auth: it hashes
 * the presented token, looks it up, and 404s any garbage/expired/revoked token
 * with the SAME notFound() — no cohort-existence leak (`resolveFwBoardToken`
 * collapses every refusal). GET never mutates; the token is the credential.
 *
 * ── Why the page carries NO student data (the no-store posture)
 *
 * A `force-dynamic` page cannot be served `no-store`: Next fixes its Cache-Control
 * to `no-cache, must-revalidate`, and neither next.config nor the proxy can
 * override the framework there (verified). So rather than argue that a minor's
 * name is safe in a `no-cache` HTML frame, the page renders only the PII-FREE
 * shell — the cohort title and the grid's column skeleton (static program
 * structure). EVERY student name flows exclusively through the `/feed` route,
 * which IS `private, no-store`. The client hydrates the board from that feed on
 * mount (an immediate first poll), so the shell fills in well under a second and
 * nothing sensitive ever lands in a cacheable response.
 *
 * Force-dynamic: the token lookup needs the service-role client at request time,
 * and the env-less build must never try to prerender it. noindex is set here (and
 * as an X-Robots-Tag header on the subtree in next.config).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Founders Weekend",
  // A search engine must never surface a minor's first-name-plus-initial from a
  // projected board. Reinforced by the X-Robots-Tag header on the subtree.
  robots: { index: false, follow: false },
};

export default async function FwBoardPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const db = supabaseAdmin();

  const auth = await resolveFwBoardToken(db, { token });
  if (!auth.ok) notFound();

  const shell = await loadFwBoardShell(db, { cohortId: auth.cohortId });

  return <FwBoard token={token} shell={shell} />;
}
