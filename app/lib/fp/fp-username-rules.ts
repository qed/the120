/**
 * First Profit CHILD USERNAME — the pure decision surface (Slice B Unit 12).
 *
 * Every The120 child logs into First Profit with a GLOBALLY-UNIQUE username, no
 * email (the login re-scope lands in later units; U12 only adds the column,
 * generation, and backfill). This module owns the two pure decisions that
 * generation needs, plus the one shared `generate-if-missing` primitive that
 * child-creation, the backfill script, AND the future U13 login-time lazy fill
 * all call — so the three can never disagree on what "a valid username for this
 * child" means.
 *
 * NO `server-only`, NO Next/Supabase imports — a sibling of provision-rules.ts,
 * so it is unit-testable in the node-only harness and safe to import from a
 * `tsx` script (the backfill). The impure shells (child-core's insert, the
 * backfill's paged writer) add I/O and the DB unique-index arbiter around it.
 *
 * The username base reuses the FW/funnel address slugger
 * (`buildFwLocalBaseFromFirstName`): the SAME fold-to-ASCII homoglyph/
 * control-char guard, the SAME first-name-only slug (`Álex` → `alex`), and the
 * SAME collision-suffix shape (`alex`, `alex2`, `alex3`, …) as
 * `pickStudentLocalPart`. One slugger, so a child's username base and any future
 * derived address can never drift.
 *
 * FAIL-CLOSED, then FALL BACK: `generateUsernameBase` refuses (verdict, never a
 * throw) an unfoldable / empty first name — the caller decides the fallback.
 * `mintUsername` is the caller most callers want: it applies the safe
 * `student`-base fallback so a child with an unnameable first name still gets a
 * unique, loginable username instead of being blocked.
 */

import { buildFwLocalBaseFromFirstName } from "@/app/lib/fp/fw-provision-rules";

/** The safe base for a first name that cannot be folded to an address-safe slug
 *  (empty, all-emoji, a non-Latin script the guard refuses). A child is NEVER
 *  blocked from getting a username; they get `student`, `student2`, … — unique
 *  via the same suffixer, and changeable later. */
export const USERNAME_FALLBACK_BASE = "student";

/** Bound on the collision search — mirrors MAX_LOCAL_PART_ATTEMPTS / the FW
 *  rule and its reasoning: reaching it means something is very wrong (hundreds
 *  of identically-named children) and guessing further would be worse. */
export const MAX_USERNAME_ATTEMPTS = 200;

/* ------------------------------------------------------------------- base */

export type UsernameBaseVerdict =
  | { ok: true; base: string }
  | { ok: false; reason: "underivable"; detail: string };

/**
 * The username base for a first name — `Álex` → `alex` — as a VERDICT, not a
 * throw. Reuses `buildFwLocalBaseFromFirstName` (fold + slug + the homoglyph/
 * control-char refusal), and turns its throw into `underivable` so a batch
 * caller (the backfill) or an inline caller (child-creation) never errors on a
 * genuinely empty / unfoldable first name — they choose a fallback instead.
 * Mirrors `deriveStudentLocalBaseFromFirstName`, kept separate so the username
 * vocabulary is not coupled to the deposit/address module.
 *
 * SEPARATOR STRIP (whole-branch review P0): `buildFwLocalBaseFromFirstName`
 * LEVELS internal separators/punctuation to a DASH (`Mary Jane` → `mary-jane`,
 * `Anna-Lee` → `anna-lee`) — valid for the FW/funnel `.fw@` ADDRESS path, where
 * `first.last` separators are legitimate. But a USERNAME lives in a strictly
 * `^[a-z0-9]+$` namespace: the storage CHECK (`children_fp_username_format`),
 * the case-insensitive unique index, and login's `USERNAME_FORMAT` +
 * `childUsernameMatches` ALL forbid a dash. A generated `mary-jane` would fail
 * the CHECK (Postgres 23514) on write and be unclassifiable at login. So the
 * username path — and ONLY it — strips every non-`[a-z0-9]` character AFTER the
 * shared fold: `Mary Jane` → `maryjane`, `Anna-Lee` → `annalee`. The FW address
 * deriver is untouched (dashes remain valid there). If nothing survives the
 * strip (a name that was purely separators/punctuation), the verdict is
 * `underivable` so `mintUsername` applies the `student`-base fallback. The net
 * invariant: generator output stays `^[a-z0-9]+$`, which is a strict SUBSET of the
 * (now broadened) storage CHECK / login regex that ALSO accept email-shaped
 * usernames (`@ . _ + -`, e.g. `cedric@firstprofit.school`; see migration
 * 20260904120000 + login-rules `USERNAME_FORMAT`). Generated handles therefore
 * always pass the CHECK and classify at login; the charset-agreement invariant
 * holds as generator ⊆ CHECK === login regex (they need not be equal, only nested).
 */
export function generateUsernameBase(firstName: string): UsernameBaseVerdict {
  try {
    const base = buildFwLocalBaseFromFirstName(firstName).replace(/[^a-z0-9]/g, "");
    if (base.length === 0) {
      return {
        ok: false,
        reason: "underivable",
        detail: "first name has no [a-z0-9] characters after separator strip",
      };
    }
    return { ok: true, base };
  } catch (err) {
    return {
      ok: false,
      reason: "underivable",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

/* --------------------------------------------- two-name base (v3 Unit 3) */

/**
 * The v3 onboarding flow collects the kid's FULL name and mints
 * `firstname.lastname` (`Remi Newal` → `remi.newal`) — a friendlier, far less
 * collision-prone handle than the first-name-only base above, which the FP HTTP
 * door keeps using (it only ever collects a first name).
 *
 * ── THE THREE-PARTY NESTING INVARIANT, RE-VERIFIED FOR THE DOT ──
 * `generateUsernameBase` guarantees each SEGMENT is `^[a-z0-9]+$`; joining two
 * with a single `.` yields `^[a-z0-9]+\.[a-z0-9]+$`. That is still a strict
 * SUBSET of both acceptors, which is the whole invariant (generator ⊆ CHECK ===
 * login regex):
 *   - `children_fp_username_format` (migration 20260904120000):
 *     `^[a-z0-9]([a-z0-9._+@-]*[a-z0-9])?$` — `.` is an interior character and
 *     both ends are alphanumeric, so a dotted base passes;
 *   - login's `USERNAME_FORMAT` (app/api/fp/login/login-rules.ts): the SAME
 *     regex, so a dotted handle classifies as a username and resolves.
 * The dot can never be leading, trailing, or doubled here, because each side is
 * a non-empty `[a-z0-9]+` run by construction — that is exactly why this builds
 * on `generateUsernameBase` rather than slugging the whole name in one pass.
 *
 * DEGRADES, NEVER FAILS ON A HALF-NAME: an underivable LAST name (absent,
 * emoji-only, pure punctuation) yields the first-name base alone — never
 * `remi.` — so a one-name kid gets `remi`, exactly what the old generator would
 * have given them. Only an underivable FIRST name is a verdict-level refusal,
 * and `mintUsernameFromNames` answers that with the same `student` fallback.
 */
export function generateUsernameLocalPart(
  firstName: string,
  lastName?: string | null
): UsernameBaseVerdict {
  const first = generateUsernameBase(firstName);
  if (!first.ok) return first;
  const last = generateUsernameBase(lastName ?? "");
  if (!last.ok) return first;
  return { ok: true, base: `${first.base}.${last.base}` };
}

/* ------------------------------------------------------------- suffixer */

export type UsernamePick =
  | { ok: true; username: string; attempt: number }
  | { ok: false; reason: "exhausted"; detail: string };

/**
 * Place a collision suffix on a base — `remi.newal` → `remi.newal2`.
 *
 * THE SUFFIX GOES BEFORE THE `@` when the base is email-shaped. No GENERATOR in
 * this module emits an `@` (both bases are alphanumerics and at most one dot),
 * so today this is always a plain append and the behaviour of every existing
 * caller is byte-identical. It matters because the storage CHECK and the login
 * regex both ADMIT email-shaped usernames (migration 20260904120000): a handle
 * adopted from that space and re-suffixed naively would become
 * `cedric@firstprofit.school2`, which is a different mailbox-looking string and
 * — worse — could collide with a genuinely different address. Suffixing the
 * LOCAL PART keeps the domain intact and the result inside both acceptors.
 */
export function appendUsernameSuffix(base: string, attempt: number): string {
  if (attempt <= 1) return base;
  const at = base.indexOf("@");
  if (at === -1) return `${base}${attempt}`;
  return `${base.slice(0, at)}${attempt}${base.slice(at)}`;
}

/**
 * Pick the first free username for a base, appending a numeric suffix until
 * `isTaken` returns false — `alex`, `alex2`, `alex3`, … The suffix starts at 2
 * (attempt 1 is the un-suffixed base) so the first child of a name gets the
 * clean handle, exactly as `pickStudentLocalPart` does.
 *
 * `isTaken` is the caller's in-memory ledger (existing usernames + everything
 * this run has already handed out). The database's partial-unique index on
 * `children.fp_username` remains the real arbiter under a race; this pick is
 * the fast path, and the caller retries on a 23505 conflict.
 */
export function pickUniqueUsername(input: {
  base: string;
  isTaken: (candidate: string) => boolean;
}): UsernamePick {
  for (let attempt = 1; attempt <= MAX_USERNAME_ATTEMPTS; attempt += 1) {
    const username = appendUsernameSuffix(input.base, attempt);
    if (!input.isTaken(username)) return { ok: true, username, attempt };
  }
  return {
    ok: false,
    reason: "exhausted",
    detail: `no free username for "${input.base}" after ${MAX_USERNAME_ATTEMPTS} attempts`,
  };
}

/* --------------------------------------------- generate-if-missing primitive */

export type UsernameMint =
  | { ok: true; username: string; base: string; attempt: number; usedFallback: boolean }
  | { ok: false; reason: "exhausted"; detail: string };

/**
 * The shared "give this child a unique username" primitive — derive the base
 * from the first name, fall back to `student` when the name is unfoldable, then
 * suffix until free. This is the function BOTH real callers share:
 *
 *   - child-creation (child-core): assigns `fp_username` at insert, retrying on
 *     the unique-index conflict;
 *   - the backfill script: fills every existing child that lacks one.
 *
 * LOGIN-TIME LAZY-FILL WAS DESCOPED (whole-branch review P2). An earlier header
 * claimed a THIRD caller — "U13 login-time lazy fill" — that NEVER shipped: the
 * login route (app/api/fp/login/route.ts) does no lazy fill, and a child whose
 * `fp_username` is null simply never matches a typed username. It is
 * CHICKEN-AND-EGG by construction: the child logs in BY typing their username,
 * so a child who has no username has nothing to type that could trigger a fill —
 * lazy-fill-on-login cannot mint the very handle the login is keyed on.
 *
 * CONSEQUENCE, stated plainly so it is not rediscovered as a bug: children
 * created by OTHER products (funnel / FW / Path) AFTER the one-time backfill runs
 * receive NO `fp_username` and therefore cannot log into First Profit until a
 * handle is minted for them. The stopgap is to RE-RUN `fp:backfill-usernames
 * --apply` (it is idempotent — fills only still-NULL rows). The DURABLE
 * follow-up (NOT built here) is a `children`-INSERT auto-username trigger /
 * server hook so every new child is born loginable; recommended as the next
 * unit of this workstream.
 *
 * `isTaken` MUST reflect both the persisted usernames and everything the current
 * run has already issued, or two same-named children collide. The caller adds
 * each returned username to its own ledger before minting the next.
 */
export function mintUsername(input: {
  firstName: string;
  isTaken: (candidate: string) => boolean;
}): UsernameMint {
  return mintUsernameFromNames({ firstName: input.firstName, isTaken: input.isTaken });
}

/**
 * The v3 variant: the SAME primitive, but the base is `firstname.lastname` when
 * a usable last name is supplied (`generateUsernameLocalPart`). With no last
 * name it is byte-identical to `mintUsername` — which is exactly how
 * `mintUsername` is now implemented, so the two can never diverge on the
 * fallback, the suffixer, or the exhaustion bound.
 *
 * The `student` fallback still applies to an underivable FIRST name, so a child
 * is never blocked from getting a loginable handle.
 */
export function mintUsernameFromNames(input: {
  firstName: string;
  lastName?: string | null;
  isTaken: (candidate: string) => boolean;
}): UsernameMint {
  const derived = generateUsernameLocalPart(input.firstName, input.lastName);
  const base = derived.ok ? derived.base : USERNAME_FALLBACK_BASE;
  const pick = pickUniqueUsername({ base, isTaken: input.isTaken });
  if (!pick.ok) return pick;
  return {
    ok: true,
    username: pick.username,
    base,
    attempt: pick.attempt,
    usedFallback: !derived.ok,
  };
}
