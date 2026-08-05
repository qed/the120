/**
 * The v3 onboarding flow's PURE navigation + guard decisions (plan Unit 3): the
 * `?step=` resolver, the kid-name/age parse, and the duplicate-kid matcher. No
 * Next, no Supabase, no clock — the client component and the server page both
 * call the same functions, so the URL can never mean one thing on the server and
 * another after hydration.
 *
 * ── `?step=` IS THE STEP STATE, THE DRAFT ROW IS THE RESUME ANCHOR ──
 * Exactly the MiniAppShell precedent (app/start/child/[childId]/MiniAppShell.tsx):
 * the step DERIVES from the URL, `go()` only writes it, and Back walks the
 * ladder. What the URL cannot be is AUTHORITY — a family who has not verified
 * their email may not reach step 4 by typing `?step=story`. So resolution is a
 * CLAMP against server facts, not a parse:
 *
 *     resolveV3Step(raw, facts) = min(parse(raw) ?? landing, ceiling)
 *
 * TWO derived steps, not one, and the difference is the point:
 *
 *   - the CEILING (`furthestReachableV3Step`) is the AUTHORITY line. Only the
 *     load-bearing gates raise it: a verified parent session, a named kid on a
 *     live draft, and — terminally — a provisioned child. A `?step=` past it is
 *     silently clamped.
 *   - the LANDING (`firstIncompleteV3Step`) is where a URL that says NOTHING
 *     goes. It is the first step whose work is not done, so a family returning
 *     to a bare `/start/v3` resumes where they actually are.
 *
 * They differ because the cover and story steps are OPTIONAL and SKIPPABLE. A
 * family may legitimately stand on `ready` with no cover and no answers, so
 * neither may act as a gate — but a family who has not seen the cover yet should
 * still LAND there. Consequence, stated rather than discovered: skipping an
 * optional step is remembered by the URL (`?step=`, which survives refresh and
 * Back exactly as in MiniAppShell) and NOT by the draft row, so a family who
 * skips the cover and then opens the flow fresh in a new tab lands on the cover
 * again. That is a re-offer of something optional, never lost work.
 *
 * Everything else FAILS OPEN TO THE LANDING — the same rule the v2 flow uses —
 * so a garbled URL puts a family where they are instead of on an error.
 */

/* ------------------------------------------------------------ destinations */

/**
 * Where "Keep building" sends the family. A HARDCODED first-party destination,
 * never a redirect parameter: the handoff will carry a one-time sign-in code in
 * the URL fragment (plan Unit 5), and an attacker-chosen destination would be
 * handed that code. Two first-party sites, one hardcoded target, no open
 * redirect to reason about.
 *
 * Until Unit 5's mint lands, this is where the account-ready screen sends the
 * family to sign in with the username and password it just showed them.
 */
export const FIRST_PROFIT_SIGN_IN_URL = "https://firstprofit.school/";

/* ---------------------------------------------------------------- the steps */

/**
 * The five screens, in order. The names are the `?step=` values, so they are a
 * user-visible contract: renaming one breaks every bookmark and every link the
 * launch email will carry.
 *   parent — name / email / password / consent + the inline 6-digit code
 *   kid    — the kid's name and age (+ the per-kid consent re-affirmation)
 *   cover  — the comic cover (Unit 4's generator; template until then)
 *   story  — the six OPTIONAL story questions
 *   ready  — credentials + the handoff to First Profit
 */
export const V3_STEPS = ["parent", "kid", "cover", "story", "ready"] as const;
export type V3Step = (typeof V3_STEPS)[number];

export const isV3Step = (v: unknown): v is V3Step =>
  typeof v === "string" && (V3_STEPS as readonly string[]).includes(v);

/** `?step=` → a known step, or null. Null is not an error: it means "the URL
 *  said nothing usable", and the resolver answers with the facts. */
export function parseV3Step(raw: string | null | undefined): V3Step | null {
  const v = (raw ?? "").trim().toLowerCase();
  return isV3Step(v) ? v : null;
}

export const v3StepIndex = (step: V3Step): number => V3_STEPS.indexOf(step);

/**
 * Everything the resolver is allowed to know. All SERVER facts (session +
 * draft row); nothing here is client-assertable.
 */
export type V3FlowFacts = {
  /** A verified parent cookie session exists. False = step 1 is the only step. */
  parentVerified: boolean;
  /** A live (status `active`) draft row exists for this parent. */
  hasDraft: boolean;
  /** The draft carries a usable kid name AND age. */
  kidNamed: boolean;
  /** A cover decision is PERSISTED on the draft (`cover_status !== 'none'`).
   *  Written by Unit 4's generator; a SKIP does not persist, by design. */
  coverSettled: boolean;
  /** At least one story answer is persisted on the draft. */
  storyStarted: boolean;
  /** A child was provisioned from this draft (the draft is `consumed`). */
  childCreated: boolean;
};

/**
 * The AUTHORITY line: the furthest step a URL may address. Only the load-bearing
 * gates raise it — the optional cover and story steps never do (see the module
 * header). `childCreated` is terminal: a family whose child exists is pinned to
 * `ready`, so no URL can walk them back toward a second mint.
 */
export function furthestReachableV3Step(facts: V3FlowFacts): V3Step {
  if (facts.childCreated) return "ready";
  if (!facts.parentVerified) return "parent";
  if (!facts.hasDraft || !facts.kidNamed) return "kid";
  return "ready";
}

/**
 * The LANDING: the first step whose work is not done, for a URL that carries no
 * `?step=`. Read strictly top-down — each rung requires everything below it.
 */
export function firstIncompleteV3Step(facts: V3FlowFacts): V3Step {
  if (facts.childCreated) return "ready";
  if (!facts.parentVerified) return "parent";
  if (!facts.hasDraft || !facts.kidNamed) return "kid";
  if (!facts.coverSettled) return "cover";
  if (!facts.storyStarted) return "story";
  return "ready";
}

/**
 * THE resolver. Exactly one screen for every (`?step=`, facts) pair.
 *
 * - no/garbage param → the landing (fail-open to the first incomplete step);
 * - a step at or behind the ceiling → honored (back-navigation, re-editing, and
 *   forward through the optional steps);
 * - a step past the ceiling → clamped to the ceiling.
 */
export function resolveV3Step(raw: string | null | undefined, facts: V3FlowFacts): V3Step {
  const ceiling = furthestReachableV3Step(facts);
  const asked = parseV3Step(raw);
  if (asked === null) return firstIncompleteV3Step(facts);
  return v3StepIndex(asked) <= v3StepIndex(ceiling) ? asked : ceiling;
}

/* --------------------------------------------------------------- kid input */

/** Age bounds the kid step accepts. Narrower than the draft table's sanity CHECK
 *  (4..25), which exists to stop nonsense, not to state the product's range. */
export const KID_MIN_AGE = 5;
export const KID_MAX_AGE = 18;

export type KidNameParts = { firstName: string; lastName: string };

/**
 * Split a typed full name the way the username generator will consume it: the
 * FIRST whitespace-delimited token is the first name, everything after it is the
 * last name (so "Remi van Newal" keeps "van Newal" together). Mirrors
 * `splitParentName` (app/api/fp/signup/signup-rules.ts) rather than inventing a
 * second convention.
 */
export function splitKidName(fullName: string): KidNameParts {
  const trimmed = (fullName ?? "").trim().replace(/\s+/g, " ");
  const idx = trimmed.indexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: "" };
  return { firstName: trimmed.slice(0, idx), lastName: trimmed.slice(idx + 1) };
}

export type KidInputVerdict =
  | { ok: true; firstName: string; lastName: string; age: number }
  | { ok: false; field: "name" | "age"; message: string };

/**
 * Validate the kid step's two fields. Parent-readable messages (the prototype's
 * copy), and the FIELD is named so the form can focus it.
 */
export function validateKidInput(input: {
  fullName: string;
  age: string | number;
}): KidInputVerdict {
  const { firstName, lastName } = splitKidName(String(input.fullName ?? ""));
  if (firstName.length < 2) {
    return { ok: false, field: "name", message: "Please enter your kid's full name." };
  }
  if (firstName.length + lastName.length > 120) {
    return { ok: false, field: "name", message: "That name is too long for us to store." };
  }
  const raw = typeof input.age === "number" ? input.age : String(input.age ?? "").trim();
  const age = typeof raw === "number" ? raw : Number(raw);
  if (raw === "" || !Number.isFinite(age) || !Number.isInteger(age) || age < KID_MIN_AGE || age > KID_MAX_AGE) {
    return {
      ok: false,
      field: "age",
      message: `Please enter an age between ${KID_MIN_AGE} and ${KID_MAX_AGE}.`,
    };
  }
  return { ok: true, firstName, lastName, age };
}

/**
 * The child age band the consent record is written with. Derived from the age
 * the parent typed, against the SAME three bands `fp_parental_consent`'s CHECK
 * and `signup-rules.CHILD_AGE_BANDS` define. Kept here (as a plain string
 * union member) so this module stays free of the signup surface's imports; the
 * server core is what hands it to `recordConsent`, and the type is checked
 * there.
 */
export function ageBandForAge(age: number): "under_13" | "13_to_15" | "16_plus" {
  if (age < 13) return "under_13";
  if (age <= 15) return "13_to_15";
  return "16_plus";
}

/* ------------------------------------------------------- duplicate-kid guard */

/**
 * One normalization for BOTH sides of every kid-name comparison — NFKC, trimmed,
 * inner whitespace collapsed, lowercased. Deliberately the same recipe as
 * `normalizeStudentName` (app/fp/lib/provision-rules.ts); duplicated rather than
 * imported only to keep this module free of the fp surface, and pinned equal by
 * test.
 */
export function normalizeKidNamePart(raw: string | null | undefined): string {
  return (raw ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The comparison key: first and last together, with a separator that cannot
 *  occur inside either part, so "Ann Marie"+"Lee" and "Ann"+"Marie Lee" are
 *  correctly DIFFERENT keys rather than colliding on a naive concatenation. */
export function kidNameKey(firstName: string, lastName: string): string {
  return `${normalizeKidNamePart(firstName)}\u0000${normalizeKidNamePart(lastName)}`;
}

/** A kid the parent already has — either a provisioned child or a live draft. */
export type ExistingKid = {
  /** The child id or the draft id, depending on `kind`. */
  id: string;
  kind: "child" | "draft";
  firstName: string;
  lastName: string;
};

/**
 * The step-2 duplicate guard: has this parent already started (or finished) THIS
 * kid? Case-insensitive on first AND last name together.
 *
 * Why both names must match: a family with two children called Alex is ordinary,
 * and interrupting them with "Resume Alex?" when they are adding a different
 * Alex would be worse than the silent `alex2` this guard exists to prevent. Two
 * kids sharing a first AND last name in one family is not.
 *
 * CHILDREN WIN OVER DRAFTS when both match: a provisioned child is the stronger
 * fact (the draft that produced it may simply not be stamped yet), and the
 * "Resume" offer must point at the kid who actually exists.
 */
export function findDuplicateKid(
  input: { firstName: string; lastName: string },
  existing: readonly ExistingKid[]
): ExistingKid | null {
  const key = kidNameKey(input.firstName, input.lastName);
  // An entirely blank key would match every blank roster row (children.first_name
  // defaults to ''), so it never matches anything — fail closed, exactly as
  // `studentNameMatches` does.
  if (key === "\u0000") return null;
  const matches = existing.filter((k) => kidNameKey(k.firstName, k.lastName) === key);
  return matches.find((k) => k.kind === "child") ?? matches[0] ?? null;
}
