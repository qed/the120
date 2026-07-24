/**
 * The board token's hash — one definition, deliberately in a module of its own.
 *
 * SHA-256 hex is the ONLY form a board token is ever stored in, so a database
 * read can never reconstruct a live projector URL. It is the sibling of
 * `hashGuideInviteToken` (fw-guide-core).
 *
 * ── Why it lives HERE and not in `fw-ops-core.ts`
 *
 * The mint/revoke SEQUENCE lives in `fw-ops-core.ts`, next to the audit writer,
 * the anonymize action, and the match reads — a heavy graph that a bridge-gated
 * staff surface pays for happily. Unit 6's board route hashes the presented token
 * on EVERY page load and EVERY poll, and it is the repo's only UNAUTHENTICATED
 * read surface. Importing `fw-ops-core` there would drag the entire ops graph into
 * that route's module for a two-line hash — the same maintainability trap Unit 5
 * broke `recordFwOpsAudit` out of so the guide door would stop pulling the ops
 * core. So the hash lives in its own tiny module: `fw-ops-core` re-exports it (its
 * mint sequence and tests are unchanged), and the board route imports only this.
 */

import { createHash } from "node:crypto";

export function hashFwBoardToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
