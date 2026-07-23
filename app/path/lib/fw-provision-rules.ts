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
 *       (c) `assertNoAuthMailToFwStudent` is the single choke-point every
 *           future mail-capable call must pass, with a regression test.
 *     Standing ops invariant that pairs with all three: no Workspace catch-all
 *     ever arms `*.fw@the120.school`.
 *
 *   - The address is a PROMISE. `maya.chen.fw@` names a specific child, so when
 *     that child is anonymized (Decision 10) the freed local part is recorded in
 *     `path_fw_released_aliases` FOREVER and never re-minted for the next Maya
 *     Chen — otherwise a channel someone still holds would silently repoint at a
 *     different family's kid. `pickFwLocalPart` takes released parts in its
 *     `taken` set for that reason, not as a nicety.
 */

import type { InitialProgressRow, SeedTaskRow } from "./progress-core";

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
 * ASCII-fold one human name fragment: NFKC compose, decompose-and-strip
 * diacritics, drop elision marks, lowercase, trim. `José` → `jose`,
 * `O’Brien` → `obrien`, `Ægis` → `gis` is NOT wanted — but note that characters
 * with no decomposition (æ, ø, ß) survive folding and are removed by the
 * caller's alphanumeric filter, which is the fail-closed direction: a name that
 * folds to nothing is REFUSED rather than silently mangled into someone else's
 * address.
 */
function foldToAscii(raw: string): string {
  return raw
    .normalize("NFKC")
    .normalize("NFD")
    .replace(/\p{M}+/gu, "") // combining marks: é → e
    .replace(/['’ʼ`´]/g, "") // elisions join: O'Brien → OBrien
    .toLowerCase()
    .trim();
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
 */
export function buildNormalizedFwName(firstName: string, lastName: string): string {
  const part = (raw: string) =>
    foldToAscii(raw)
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return [part(firstName), part(lastName)].filter((p) => p.length > 0).join(" ");
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
    const folded = foldToAscii(raw)
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
 * THE CHOKE-POINT. Any code path that could cause Supabase (or our own mailer)
 * to send to a recipient must pass through here first. Throws — loudly, not a
 * typed refusal — because a stray auth mail to a minor's real address is not a
 * recoverable branch to render copy for, and the throw is what makes the
 * omission visible in a test rather than in a parent's inbox.
 *
 * Covers the anonymize tombstone address too (`removed-<id>.fw@`), which is
 * deliberately kept INSIDE this namespace for exactly that reason.
 */
export function assertNoAuthMailToFwStudent(email: string, context: string): void {
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
