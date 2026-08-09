/**
 * The /start add-kid WEBSITE PREVIEW core (fpv03 U3 amendment, founder
 * request): given the kid's typed full name, answer with THE ACTUAL ADDRESS
 * auto-provisioning would grant — normalization, 3-char floor, charset,
 * reserved handles, blocked terms, AND the duplicate ladder against existing
 * fp_public_sites rows — by running the SAME shared derivation the allocator
 * runs (app/lib/fp/fp-handle-derive.ts; parent-gated auto-provisioned sites
 * plan, first-profit docs/plans/2026-08-08-001). Same function ⇒ same answer
 * for the same inputs, modulo claim races; nothing is reserved here.
 *
 * House core-module pattern (kid-credentials-core is the sibling): plain
 * module, deps-injected, no Next — the action wrapper owns the session gate,
 * the rate-limit strike, and the service-role read.
 *
 * ── The enumeration-oracle posture (why the result is shaped this way) ──
 * Handle-availability probes correlate with fp_username (the documented
 * learning behind the site availability endpoint's gating). This core narrows
 * that surface three ways:
 *   - input is a kid's NAME; the probed handles are DERIVED server-side —
 *     a caller cannot ask about an arbitrary string;
 *   - the answer is ONLY the picked handle — never a per-candidate taken/free
 *     map, and `exhausted` collapses into `unusable` so a caller cannot
 *     distinguish "every variant held" from "underivable name";
 *   - the wrapper adds the verified-parent gate and a per-parent budget.
 */

import { splitKidName } from "@/app/lib/v3-signup/flow-rules";
import {
  deriveSiteHandleStem,
  pickFirstFreeHandle,
  siteHandleCandidates,
} from "@/app/lib/fp/fp-handle-derive";

export type SitePreviewDeps = {
  /** Which of these candidate handles are already held in fp_public_sites.
   *  null = the read failed (outage), never "none taken". */
  loadTakenHandles: (
    candidates: readonly string[]
  ) => Promise<ReadonlySet<string> | null>;
};

export type SitePreviewResult =
  /** The address the allocator would grant right now. */
  | { kind: "ok"; handle: string }
  /** No derivable address for this name (empty/emoji-only after the fold,
   *  reserved, blocklisted — or every deterministic variant already held).
   *  The client shows its neutral placeholder. */
  | { kind: "unusable" }
  /** Malformed input — caller-induced, keeps its rate-limit strike. */
  | { kind: "bad_request" }
  /** Our fault (DB read failed) — the wrapper refunds the strike and the
   *  client falls back to its local predicate preview. */
  | { kind: "outage" };

/** Roomier than `validateKidInput`'s 120-char combined-name cap (flow-rules) —
 *  the preview runs while the parent is mid-typing, but anything past this is
 *  not a name being typed. */
const PREVIEW_NAME_MAX_CHARS = 200;

export async function previewKidSiteHandle(
  deps: SitePreviewDeps,
  input: unknown
): Promise<SitePreviewResult> {
  // Defensive read, no zod needed for one string field (the rateLimitEmail
  // precedent in app/start/actions.ts).
  const raw = (input as { fullName?: unknown } | null)?.fullName;
  if (typeof raw !== "string" || raw.length > PREVIEW_NAME_MAX_CHARS) {
    return { kind: "bad_request" };
  }

  // The SAME first-token split the username generator and the old client-only
  // preview use — the handle derives from the FIRST name only (R6).
  const { firstName } = splitKidName(raw);
  const stem = deriveSiteHandleStem(firstName);
  if (!stem.ok) return { kind: "unusable" };

  // ONE ladder feeds both the taken-check and the pick, so they cannot
  // disagree on what was considered.
  const candidates = siteHandleCandidates(stem.stem);
  const taken = await deps.loadTakenHandles(candidates);
  if (taken === null) return { kind: "outage" };

  const pick = pickFirstFreeHandle({
    stem: stem.stem,
    isTaken: (candidate) => taken.has(candidate),
  });
  // `exhausted` deliberately collapses into `unusable` — see the oracle note.
  if (!pick.ok) return { kind: "unusable" };
  return { kind: "ok", handle: pick.handle };
}
