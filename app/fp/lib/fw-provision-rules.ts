/**
 * Pure FW student-identity decisions (FW Unit 1; FW-R8–R11, FW-D2, Decisions 7,
 * 10, 13) — the address vocabulary, the collision suffixer, the createUser
 * contract, the no-auth-mail choke-point, and the FW progress-row builder.
 *
 * Free of Next/Supabase imports per repo convention: only pure logic is
 * defensible in this repo's node-only test setup, so every decision that could
 * be wrong lives here and the impure shell (provision-core.ts, the FW actions)
 * adds I/O only. Sibling of provision-rules.ts, deliberately NOT an extension of
 * it — the two account models share nothing but their shape.
 *
 * The FW account model, and why it is the near-opposite of the Path's:
 *
 *   - A Path student IS a public.children row: the address is derived from an
 *     opaque roster UUID on the reserved `.invalid` TLD, so no mail can ever be
 *     attempted. An FW student has no roster row — a guide types a name at the
 *     check-in table — and their address is NAME-DERIVED on a REAL, DELIVERABLE
 *     domain (the120.school), because FW-D2 makes that address a future contact
 *     channel for the family.
 *
 *   - Deliverable is exactly what makes it dangerous. These are minors' de-facto
 *     addresses on a domain whose MX answers. The invariant is therefore
 *     MECHANISM-ENFORCED, not remembered:
 *       (a) accounts are PASSWORD-LESS and dormant — nothing to sign into, so
 *           no sign-in flow can trigger a recovery mail;
 *       (b) `email_confirm: true` is pinned at the TYPE level, so a createUser
 *           call that would make Supabase send a signup confirmation to a real
 *           child's namespace is a COMPILE error (the hosted project has
 *           confirmations ON — config.toml lies about it; see docs/solutions/
 *           integration-issues/supabase-admin-createuser-non-deliverable-email-
 *           requires-email-confirm-2026-07-21.md);
 *       (c) `assertNoAuthMailToFwStudent` — the guard every SERVER-SIDE
 *           mail-capable call must pass. ⚠️ Read `no-auth-mail-guard.test.ts`
 *           before trusting this bullet: as of Unit 1 the guard has no
 *           production caller, and it CANNOT gate the two pre-existing
 *           `resetPasswordForEmail` forms (`app/dashboard/SignIn.tsx`,
 *           `app/crm/login/LoginForm.tsx`) because those call Supabase from the
 *           BROWSER with the public anon key — no server-side function sits in
 *           that path. That hole is closed at the platform level or not at all;
 *           the test named above fails if a new server-side mail call appears
 *           without this guard, and documents the client-side gap it cannot fix.
 *     Standing ops invariant that pairs with all three, and the reason the
 *     client-side gap is currently inert: no Workspace catch-all ever arms
 *     `*.fw@the120.school`, so recovery mail addressed there bounces into
 *     nothing. Arming that catch-all (which FW-D2 contemplates) turns the gap
 *     live — the two probes in the plan's Operational Notes exist to prove the
 *     current state, and must be re-run before any catch-all is enabled.
 *
 *   - The address is a PROMISE. `maya.chen.fw@` names a specific child, so when
 *     that child is anonymized (Decision 10) the freed local part is recorded in
 *     `path_fw_released_aliases` FOREVER and never re-minted for the next Maya
 *     Chen — otherwise a channel someone still holds would silently repoint at a
 *     different family's kid. `pickFwLocalPart` takes released parts in its
 *     `taken` set for that reason, not as a nicety.
 */

import { BANDS, type Band } from "@/app/fp/content/types";
import type { InitialProgressRow, SeedTaskRow } from "./progress-core";

/* ------------------------------------------------------------------- bands */

/**
 * Narrow a `path_student_profiles.band` value read across the service-role
 * boundary — the `narrowTaskState` discipline, for the column FW puts in the
 * place the Path derives from `children(grade)`.
 *
 * A bare `as Band` here would be a promise to the compiler with nothing behind
 * it, on the value that decides which per-band instruction line a guide reads
 * aloud to a child and which band an FW check-in stamps onto the record. The
 * migration's CHECK constrains the column, but this function is what stops a
 * NULL (every Path row has one) or a future fourth band from being cast into
 * existence by a read.
 */
export function narrowFwBand(x: unknown): Band | null {
  return typeof x === "string" && (BANDS as readonly string[]).includes(x) ? (x as Band) : null;
}

/* --------------------------------------------------------------- addresses */

/** Real and deliverable, unlike the Path's `.invalid` domain — by design (FW-D2). */
export const FW_STUDENT_EMAIL_DOMAIN = "the120.school";

/**
 * The namespace label every FW address carries immediately before the `@`. It is
 * what `isFwStudentAddress` recognises, so it is the whole basis of the refusal
 * guard — an FW address is identifiable by shape alone, with no database lookup.
 */
export const FW_LOCAL_SUFFIX = "fw";

/**
 * Each name part is capped before assembly so `local@domain` stays inside the
 * 64-octet local-part limit even for two long names plus the suffix and a
 * collision integer. Truncation can manufacture a collision; the suffixer below
 * resolves it, which is why capping here is safe.
 */
export const FW_NAME_PART_MAX = 24;

/** Bound on the collision search. Reaching it means something is very wrong
 *  (hundreds of same-named students), and guessing further would be worse. */
export const MAX_FW_LOCAL_ATTEMPTS = 200;

/**
 * Latin-script characters with NO Unicode decomposition, so `NFD` + strip-marks
 * cannot reduce them. Transliterated explicitly rather than dropped, because
 * dropping is the silent-mangling failure this module exists to avoid: `Weiß`
 * must not become `wei`, and `Ørsted` must not become `rsted`.
 */
const LATIN_TRANSLITERATIONS: readonly (readonly [RegExp, string])[] = [
  [/ß/g, "ss"],
  [/æ/g, "ae"],
  [/œ/g, "oe"],
  [/ø/g, "o"],
  [/ð/g, "d"],
  [/đ/g, "d"],
  [/þ/g, "th"],
  [/ł/g, "l"],
  [/ı/g, "i"],
  [/ŋ/g, "n"],
];

/**
 * ASCII-fold one human name fragment: NFKC compose, decompose-and-strip
 * diacritics, transliterate the undecomposable Latin letters, drop elision
 * marks, lowercase. `José` → `jose`, `O’Brien` → `obrien`, `Weiß` → `weiss`.
 *
 * THROWS on two classes the caller must never store or mint from — both of
 * which previously slipped through as a silent dash substitution, producing an
 * address for a DIFFERENT child than the one whose name was typed:
 *
 *   1. Unicode control/format characters (bidi overrides, zero-width joiners).
 *      `Ma‮ya` used to fold to `ma-ya`; the raw string, override intact,
 *      was then stored and would later render on a guide roster and a projected
 *      board with its display order spoofed.
 *   2. Any letter or digit that survives folding without becoming ASCII — i.e.
 *      a homoglyph or a non-Latin script. `Mаya` (Cyrillic а, visually
 *      identical to `Maya` in most fonts) used to fold to `m-ya`, minting
 *      `m-ya.chen@…` for a child the roster shows as "Maya Chen", and producing
 *      a normalized key that would never match the real Maya.
 *
 * Refusing is the right answer for both: the guide is standing at the table and
 * can retype. Silently minting a near-miss address is unrecoverable, because
 * FW-D2 makes that address a lasting contact channel for the family.
 */
function foldToAscii(raw: string, label: string): string {
  // Lowercase BEFORE transliterating and before stripping marks. Both orderings
  // matter: the transliteration table is lowercase-only, so `Ørsted` would
  // otherwise miss and be refused; and `İ` lowercases INTO a combining dot,
  // which only a mark-strip that runs afterwards can remove.
  let folded = raw
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, ""); // é → e
  for (const [pattern, replacement] of LATIN_TRANSLITERATIONS) {
    folded = folded.replace(pattern, replacement);
  }
  folded = folded.replace(/['’ʼ`´]/g, ""); // O'Brien → obrien

  if (/\p{C}/u.test(folded)) {
    throw new Error(`${label} contains a Unicode control or format character`);
  }
  // What is left after removing the ASCII alphanumerics: if any of it is still a
  // letter or a digit, folding did not actually reach ASCII.
  if (/[\p{L}\p{N}]/u.test(folded.replace(/[a-z0-9]/g, ""))) {
    throw new Error(`${label} has characters that cannot be folded to ASCII — retype it in Latin letters`);
  }
  return folded.trim();
}

/**
 * The name key both sides of a PROPOSED-1 match compare on — and the value
 * stored in `path_student_profiles.normalized_name`. ONE normalization for BOTH
 * sides of every comparison (the rule provision-rules.ts states for Path names),
 * which is precisely why this is a stored column and not a `lower()` expression
 * index: the full fold is not an immutable SQL function, so an index built in
 * SQL would silently disagree with this function on every accented name.
 *
 * Separators are levelled to single spaces, so `Jean-Luc` and `Jean Luc` are the
 * same student to the matcher — the realistic guide-typing variance.
 * Returns "" when nothing survives; callers treat that as unmatched, never as a
 * wildcard.
 *
 * THROWS on the same two refusal classes as `buildFwLocalBase` (see
 * `foldToAscii`). A homoglyph must not be allowed to produce a *quietly
 * different* match key — that is the failure mode where the roster shows one
 * "Maya Chen" and the matcher insists there is no such student.
 */
export function buildNormalizedFwName(firstName: string, lastName: string): string {
  const part = (raw: string, label: string) =>
    foldToAscii(raw, label)
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return [part(firstName, "first name"), part(lastName, "last name")]
    .filter((p) => p.length > 0)
    .join(" ");
}

/**
 * The email-safe local base for a name pair — `Maya Chen` → `maya.chen`. This is
 * the unit the collision suffixer increments and the unit
 * `path_fw_released_aliases` stores, so the two can never disagree about what
 * "the address that was freed" means.
 *
 * FAILS CLOSED (throws) when either part folds to nothing — an empty part would
 * produce `.chen` or `maya.`, addresses that are both malformed and liable to
 * collide every unnameable student onto one account.
 */
export function buildFwLocalBase(firstName: string, lastName: string): string {
  const part = (raw: string, label: string) => {
    const folded = foldToAscii(raw, label)
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, FW_NAME_PART_MAX)
      .replace(/-+$/g, ""); // a cap landing mid-separator must not leave a trailing dash
    if (folded.length === 0) {
      throw new Error(`buildFwLocalBase: ${label} has no address-safe characters`);
    }
    return folded;
  };
  return `${part(firstName, "first name")}.${part(lastName, "last name")}`;
}

/** `maya.chen` → `maya.chen.fw@the120.school`. */
export function fwEmailForLocalPart(localPart: string): string {
  return `${localPart}.${FW_LOCAL_SUFFIX}@${FW_STUDENT_EMAIL_DOMAIN}`;
}

/**
 * The inverse — `maya.chen.fw@the120.school` → `maya.chen`, or null for anything
 * that is not an FW address. The impure collision probe uses this to turn the
 * account list it read into the `taken` set `pickFwLocalPart` consumes, so both
 * directions of the mapping live in one tested place.
 */
export function fwLocalPartFromEmail(email: string): string | null {
  const at = `.${FW_LOCAL_SUFFIX}@${FW_STUDENT_EMAIL_DOMAIN}`;
  const lowered = email.trim().toLowerCase();
  if (!lowered.endsWith(at)) return null;
  const base = lowered.slice(0, -at.length);
  return base.length > 0 ? base : null;
}

/** Whether an address lives in the FW student namespace — shape only, no lookup. */
export function isFwStudentAddress(email: string): boolean {
  return fwLocalPartFromEmail(email) !== null;
}

/**
 * The SERVER-SIDE choke-point. Every server-side path that could cause Supabase
 * (or our own mailer) to send to a recipient must pass through here first.
 * Throws — loudly, not a typed refusal — because a stray auth mail to a minor's
 * real address is not a recoverable branch to render copy for, and the throw is
 * what makes the omission visible in a test rather than in a parent's inbox.
 *
 * ⚠️ WHAT THIS DOES NOT COVER, stated plainly because the plan's "mechanism-
 * enforced" language reads stronger than the mechanism is: a pure function
 * cannot gate a call the BROWSER makes. `app/dashboard/SignIn.tsx` and
 * `app/crm/login/LoginForm.tsx` both call
 * `supabaseBrowser().auth.resetPasswordForEmail(<user-typed address>)` directly
 * against Supabase with the public anon key. Nothing server-side is in that
 * path, so nothing server-side can stop a request addressed to a guessable
 * `<first>.<last>.fw@the120.school`. Closing that requires either routing those
 * two forms through a Server Action or a project-level Supabase Auth
 * send-email hook — an open decision recorded in the plan, not something this
 * function can do. `no-auth-mail-guard.test.ts` pins both the coverage and the
 * gap so neither drifts silently.
 *
 * Covers the anonymize tombstone address too (`removed-<id>.fw@`), which is
 * deliberately kept INSIDE this namespace for exactly that reason.
 *
 * Also refuses a blank recipient: "not an FW address" and "not an address at
 * all" must not share an outcome, or a caller passing an unpopulated field
 * would read as cleared-to-send.
 */
export function assertNoAuthMailToFwStudent(email: string, context: string): void {
  if (email.trim().length === 0) {
    throw new Error(`${context}: refusing to send mail to a blank recipient`);
  }
  if (isFwStudentAddress(email)) {
    throw new Error(
      `${context}: refusing to send mail to the FW student namespace (${email}). ` +
        `FW accounts are password-less and dormant; no auth or notification mail may ever reach them.`
    );
  }
}

/**
 * The address an anonymized student's account is renamed to (Decision 10).
 * Stays inside the `.fw@` namespace so the guard above still covers it, and is
 * keyed on the profile id so it is unique without carrying a name. Unit 5b's
 * deletion action consumes this; it lives here with the rest of the address
 * vocabulary so the two shapes cannot drift.
 */
export function buildFwTombstoneEmail(profileId: string): string {
  if (!profileId || /[\s@]/.test(profileId)) {
    throw new Error("buildFwTombstoneEmail: malformed profile id");
  }
  return fwEmailForLocalPart(`removed-${profileId.toLowerCase()}`);
}

/** What the collision search settled on. `attempt` is 1 for the un-suffixed base. */
export type FwLocalPartPick = {
  localPart: string;
  email: string;
  attempt: number;
};

/**
 * Pick the first free local part for a name, skipping everything in `taken`.
 *
 * `taken` must contain BOTH the local parts of live FW accounts AND every row of
 * `path_fw_released_aliases` — the released ones are why `maya.chen` can be
 * technically free and still refused (Decision 10). The impure caller assembles
 * the set; this function only decides.
 *
 * The suffix starts at 2 (`maya.chen`, `maya.chen2`, `maya.chen3`) so the first
 * student of a name gets the clean address, and it is appended to the BASE, not
 * the last name, keeping the released-alias ledger's key one dotted string.
 *
 * The database's unique constraint on the address remains the real arbiter under
 * a race; this pick is the fast path, and the caller retries on conflict.
 */
export function pickFwLocalPart(input: {
  firstName: string;
  lastName: string;
  taken: ReadonlySet<string>;
}): FwLocalPartPick {
  const base = buildFwLocalBase(input.firstName, input.lastName);
  for (let attempt = 1; attempt <= MAX_FW_LOCAL_ATTEMPTS; attempt += 1) {
    const localPart = attempt === 1 ? base : `${base}${attempt}`;
    if (!input.taken.has(localPart)) {
      return { localPart, email: fwEmailForLocalPart(localPart), attempt };
    }
  }
  throw new Error(
    `pickFwLocalPart: exhausted ${MAX_FW_LOCAL_ATTEMPTS} candidates for "${base}" — refusing to guess further`
  );
}

/* ------------------------------------------------------- createUser payload */

/**
 * `email_confirm` is the LITERAL `true`: omitting it (or passing false) is a
 * compile error, not a signup confirmation mailed to a nine-year-old.
 *
 * There is NO `password` key, and its absence is the design: an FW account is
 * DORMANT. Nothing signs into it during the weekend — the guide holds the
 * session, the student holds the record — so there is no credential to leak, no
 * reset flow to trigger, and nothing for a shared iPad to strand. A future
 * FW→Path conversion is where a password is first set.
 */
export type FwStudentCreateUserPayload = {
  email: string;
  email_confirm: true;
  app_metadata: { role: "student" };
};

/**
 * The exact payload every FW `admin.createUser` call sends — built here, used
 * verbatim by provision-core, asserted by test. `app_metadata.role` is
 * server-set and is what keeps any future FW session off the `/crm` path
 * (proxy-rules checks `role !== "admin"`).
 */
export function buildFwStudentCreateUserPayload({
  email,
}: {
  email: string;
}): FwStudentCreateUserPayload {
  if (!isFwStudentAddress(email)) {
    // An address outside the namespace would escape the refusal guard, the
    // released-alias ledger, and the ops invariant all at once.
    throw new Error(`buildFwStudentCreateUserPayload: ${email} is not an FW student address`);
  }
  return { email, email_confirm: true, app_metadata: { role: "student" } };
}

/* --------------------------------------------- FW progress materialization */

/**
 * Build an FW student's `path_task_progress` rows: one per task in the pinned
 * version, EVERY ONE `locked`, no band snapshot, and — the caller's half — no
 * `unlock` events.
 *
 * The sibling of `buildInitialProgressRows`, not a mode of it, and the
 * difference is the whole feature. The Path opens the first task of each
 * first-phase criterion and snapshots a band there, because a Path student
 * works a gated journey. FW has NO GATING (FW-D5): a guide reaches any task in
 * the catalog by drill-down and taps it, so a promoted `available` row would be
 * a lie about a distinction FW does not make, and a band snapshotted at
 * materialization would predate the check-in that Unit 3's `fw_move_task`
 * actually stamps it on.
 *
 * Throws on zero tasks — an FW student with no rows is a student whose every tap
 * would echo "provisioning gap", reported as a successful provisioning.
 */
export function buildFwProgressRows(input: {
  studentId: string;
  programVersionId: string;
  tasks: readonly SeedTaskRow[];
}): InitialProgressRow[] {
  if (input.tasks.length === 0) {
    throw new Error(
      `buildFwProgressRows: zero tasks for version ${input.programVersionId} — the content seed has not run`
    );
  }
  return input.tasks.map((t) => ({
    student_id: input.studentId,
    program_version_id: input.programVersionId,
    criterion_id: t.criterion_id,
    task_id: t.task_id,
    state: "locked" as const,
    snapshot_band: null,
  }));
}
