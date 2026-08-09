/**
 * First-name → public-site handle derivation (parent-gated auto-provisioned
 * sites plan, Unit 3 — first-profit repo docs/plans/2026-08-08-001-feat-parent-
 * gated-auto-provisioned-sites-plan.md, R6–R10).
 *
 * THIS MODULE IS THE ALLOCATOR'S PURE HALF, and it is deliberately the ONLY
 * place a first name becomes a handle. Two callers share it so they can never
 * disagree:
 *   - the /start add-kid WEBSITE PREVIEW (site-preview-core.ts, fpv03 U3
 *     amendment): shows the parent the actual address their kid will get;
 *   - the future `POST /api/fp/site/ensure` allocation loop (plan Unit 4):
 *     grants that address at auto-provisioning time.
 * Same function ⇒ same answer for the same inputs, modulo claim races — which
 * is what makes the preview truthful without reserving anything.
 *
 * The pipeline (R7/R8): lowercase → NFKD fold, strip combining marks (José →
 * jose, Zoë → zoe, Anh-Thư → anh-thu) → DROP every out-of-charset character
 * (apostrophes, spaces: O'Brien → obrien, Mary Jane → maryjane) → collapse/trim
 * hyphens → clip to 20 → pad with digits while under 3 (Al → al2). The result
 * is validated through `handleShapeVerdict` — this module NEVER restates the
 * charset, reserved, or blocklist rules (the composition discipline the plan
 * pins; the predicates live in fp-public-site-rules.ts).
 *
 * COLLISIONS (R9): resolved by `suggestHandleCandidates` — the SAME
 * deterministic variants the claim surface already offers (`name2` … `name9`,
 * then `name-co`) — via `siteHandleCandidates` / `pickFirstFreeHandle`. No
 * other disambiguation exists anywhere; do not invent one.
 *
 * FALLBACK (R10) IS THE CALLER'S: an `unusable` verdict (empty after cleaning,
 * reserved, blocklisted) is a refusal, never a throw and never a blank handle.
 * The ensure allocator falls back to the fp_username local part then a
 * `founder` stem; the /start preview — where no fp_username exists yet — shows
 * its neutral placeholder instead of speculating.
 *
 * Pure module: no Next, no Supabase, no DB — unit-testable in the node-only
 * harness (sibling of fp-username-rules.ts), drivable by any collision loop.
 */

import {
  handleShapeVerdict,
  suggestHandleCandidates,
} from "@/app/api/fp/site/site-rules";

/* ------------------------------------------------------------------- stem */

export type SiteHandleStemVerdict =
  | { ok: true; stem: string }
  | { ok: false; reason: "empty" | "rejected" };

/**
 * The legal handle stem for a first name, or a refusal.
 *
 * `empty`    — nothing survives the fold/strip (emoji-only, whitespace-only, a
 *              script with no Latin decomposition). Padding an empty stem
 *              would mint a name-free `222`, so emptiness refuses BEFORE the
 *              pad.
 * `rejected` — the cleaned stem is reserved ("admin"), blocklisted, or
 *              otherwise refused by the full server pipeline. The verdict is
 *              deliberately not more specific: the caller's answer is "no
 *              derivable address", and the reasons stay server-side exactly as
 *              `handleShapeVerdict` collapses them.
 */
export function deriveSiteHandleStem(firstName: string): SiteHandleStemVerdict {
  const cleaned = firstName
    .toLowerCase()
    // NFKD first so accented letters decompose into base + combining mark …
    .normalize("NFKD")
    // … and the marks strip away (José → jose, Zoë → zoe, Thư → thu).
    .replace(/\p{M}+/gu, "")
    // Everything out-of-charset is DROPPED, not dashed (R7): apostrophes and
    // spaces vanish (O'Brien → obrien, Mary Jane → maryjane); a real hyphen
    // is in-charset and survives (Anh-Thư → anh-thu).
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length === 0) return { ok: false, reason: "empty" };

  // Clip to the 20-char cap, re-trimming a hyphen the cut may have exposed.
  let stem = cleaned.slice(0, 20).replace(/-+$/g, "");
  // R8: pad with digits while under the 3-char floor (Al → al2, J → j22).
  // The digit is the suggestion set's first (`2`), so a padded stem reads
  // like the collision variants families will also see.
  while (stem.length < 3) stem = `${stem}2`;

  // The FULL server pipeline (charset → reserved → blocklist), composed, never
  // restated. A stem the claim would refuse must never leave this function.
  const verdict = handleShapeVerdict(stem);
  if (!verdict.ok) return { ok: false, reason: "rejected" };
  return { ok: true, stem: verdict.handle };
}

/* ------------------------------------------------------------- candidates */

/**
 * The allocator's FULL candidate ladder for a stem, in allocation order: the
 * stem itself, then the claim surface's deterministic collision variants
 * (plan Unit 4: "derived stem first, then `suggestHandleCandidates`"). One
 * list, so a DB taken-check and the pick below always agree on what was
 * considered.
 */
export function siteHandleCandidates(stem: string): string[] {
  const out = [stem];
  for (const candidate of suggestHandleCandidates(stem)) {
    if (!out.includes(candidate)) out.push(candidate);
  }
  return out;
}

/* -------------------------------------------------------------------- pick */

export type SiteHandlePick =
  | { ok: true; handle: string }
  | { ok: false; reason: "exhausted" };

/**
 * The first free handle on the candidate ladder — the pure mirror of Unit 4's
 * allocation loop, which advances a candidate only on a `handle` conflict.
 * `isTaken` is the caller's view of fp_public_sites (a DB read for the
 * preview; the 23505 arbiter remains the real judge at claim time —
 * `exhausted` means every deterministic variant is held, which at family
 * scale means something is very wrong).
 */
export function pickFirstFreeHandle(input: {
  stem: string;
  isTaken: (candidate: string) => boolean;
}): SiteHandlePick {
  for (const candidate of siteHandleCandidates(input.stem)) {
    if (!input.isTaken(candidate)) return { ok: true, handle: candidate };
  }
  return { ok: false, reason: "exhausted" };
}
