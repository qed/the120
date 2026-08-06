/**
 * Image Lab — the child-content picker: a doc-version-gated save reader that
 * fills the four `{{slot}}` values
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5; origin R12, R12a, R15, R17).
 *
 * PLAIN module — no next/supabase/react imports. Every I/O touch arrives on
 * {@link ContentPickerDeps}, so the whole thing is exercised against in-memory
 * fakes in `__tests__/content-picker-core.test.ts`; `content-picker-loader.ts`
 * builds the real deps from `imageLabDb()` and `run-actions.ts` holds the gate.
 *
 * ⚠ THIS IS THE ONE PLACE IN THE IMAGE LAB THAT READS CHILD DATA, and four
 * separate protections live here rather than in four different callers:
 *
 *  1. THE FLAG. `IMAGE_LAB_REAL_CONTENT_LIVE` gates this module's entry points —
 *     a SEPARATE switch from `IMAGE_LAB_LIVE`, because they authorize different
 *     things. Generation being on says the bench may spend money; the picker
 *     being on says a real child's authored text may be sent to a third-party
 *     model, which is the consent-and-provider-terms question. Unset means the
 *     picker is absent and manual prompts still generate normally.
 *
 *  2. THE DOC VERSION GATE. An unknown `docVersion` is SKIPPED, never parsed —
 *     the same rule the site projection trigger applies (`SITE_DOC_VERSION_GATE`,
 *     imported rather than restated). A doc shape we do not recognize is a doc
 *     whose fields we cannot claim to know the meaning of, and guessing would
 *     put arbitrary child text under a slot name a prompt trusts.
 *
 *  3. TEST FAMILIES ARE EXCLUDED, through the repo's ONE predicate
 *     (`isRealFamily` / `excludeTestFamilies`, app/crm/lib/test-family-filter.ts).
 *     Both layers: the loader filters in SQL and this module filters the rows it
 *     got, because the SQL filter is invisible to this suite and a query that
 *     silently lost its `.not()` would otherwise ship green.
 *
 *  4. THE NAME SCRUB, and it is a HARD REQUIREMENT from the Unit 1 security
 *     review rather than a nicety. A first-person pitch conventionally OPENS with
 *     the child's own name — "Hi, I'm Maya, and I make…" — so a child's name
 *     arrives inside `{{pitch}}` as a matter of course. The names ARE available
 *     on this shared project (children.first_name, children.fp_username), so
 *     there is no excuse for shipping them to a vendor. See {@link scrubNames}.
 *
 * And one exclusion by CONSTRUCTION rather than by scrubbing: the `sale` slot is
 * built from `fp_ledger` WITHOUT ever selecting `payer`. The buyer's name is a
 * THIRD party who never consented to anything, and no panel needs it (origin
 * R12a). It is not fetched, so it cannot leak.
 */

import { SITE_DOC_VERSION_GATE } from "@/app/fp/lib/fp-public-site-rules";
import { isRealFamily } from "@/app/crm/lib/test-family-filter";
import { IMAGE_LAB_SLOTS, type ImageLabSlot } from "./image-lab-rules";
import type { SlotValues } from "./run-rules";

// ── The go-live flag ─────────────────────────────────────────────────────────

/**
 * The picker is off unless `IMAGE_LAB_REAL_CONTENT_LIVE` is explicitly on.
 *
 * Read at CALL TIME, never captured at module load (a module-level constant
 * freezes into a warm serverless instance, so flipping the flag would take effect
 * only for containers that happened to cold-start after it). Allowlisted values
 * only, for the same reason `isImageLabLive` uses one: `=false` and `=0` are how
 * an operator says "off" in a dashboard, and a truthiness check reads both as on.
 *
 * ⚠ SERVER-SIDE ONLY. There is deliberately no `NEXT_PUBLIC_` twin — a
 * build-time public copy would be a second reader of the same switch that could
 * disagree with the server on a warm deploy (a repo-wide test pins its absence).
 */
export function isImageLabRealContentLive(): boolean {
  const raw = process.env.IMAGE_LAB_REAL_CONTENT_LIVE?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

// ── Shapes ───────────────────────────────────────────────────────────────────

/**
 * A candidate child, as the loader hands it over.
 *
 * `isTest` rides along RATHER THAN being filtered away in SQL alone: the SQL
 * predicate is invisible to a node suite, and a query that lost its `.not()`
 * would ship green. The pure filter below re-applies the same one predicate.
 */
export type PickerChildRow = {
  readonly childId: string;
  readonly profileId: string;
  /** Roster first name — a SCRUB INPUT, never an output field. */
  readonly firstName: string;
  readonly lastName: string;
  /** FP login username — also a scrub input (it may be email-shaped). */
  readonly username: string | null;
  readonly isTest: boolean | null;
};

/** What the picker's child dropdown renders. NO name is a prompt input. */
export type PickerChildOption = {
  readonly childId: string;
  readonly label: string;
};

export type SaleRow = {
  /** ⚠ `payer` IS NOT PART OF THIS TYPE. See the module header. */
  readonly amountCents: number;
  readonly source: string;
  readonly createdAt: string;
};

export type PickerIdea = {
  /** Stable id when the doc carries one; a positional fallback otherwise. */
  readonly ideaId: string;
  readonly index: number;
  readonly productName: string;
  readonly oneLiner: string;
  readonly pitch: string;
  readonly label: string;
};

/**
 * A field the picker deliberately did NOT read.
 *
 * Surfaced so the composer can render an "excluded" CHIP rather than a blank —
 * requirement 21, and the reason is behavioural: a blank field reads as a missing
 * value, and a staff member helpfully types it back in, reintroducing precisely
 * what the exclusion removed.
 */
export type ExcludedField = {
  readonly slot: ImageLabSlot;
  readonly field: string;
  readonly why: string;
};

export const IMAGE_LAB_EXCLUDED_FIELDS: readonly ExcludedField[] = [
  {
    slot: "sale",
    field: "Buyer name",
    why:
      "the buyer is a third party who consented to nothing, and no panel needs " +
      "their name (origin R12a). It is never selected from the ledger.",
  },
];

export type PickerContent = {
  ok: true;
  readonly childId: string;
  readonly ideaId: string | null;
  readonly taskId: string | null;
  /** Every slot present, "" where there is nothing — never a missing key. */
  readonly slots: SlotValues;
  /** Slots whose value came back empty. Drives the honest empty-state copy. */
  readonly emptySlots: readonly ImageLabSlot[];
  /** True when the scrub actually removed something (for the UI note). */
  readonly scrubbed: boolean;
  /**
   * Did the scrub have a first-name token to work with AT ALL?
   *
   * ⚠ FALSE MUST NEVER RENDER AS "the name was removed". A roster first name
   * that yields no token (empty, or a single ASCII initial) makes the scrub a
   * no-op, and the surface asserting a protection that did not run is worse than
   * no protection at all — a staff member reads the note and stops checking.
   */
  readonly scrubCovered: boolean;
  /**
   * True when NO idea was requested and the picker defaulted to the first one.
   * The composer re-syncs its select from {@link ideaId} so the surface and the
   * `source_idea_id` it will record can never disagree.
   */
  readonly substituted: boolean;
  /** False when the save doc failed the docVersion gate — a DIFFERENT state from
   *  "this child has no ideas", and it needs its own copy. */
  readonly docReadable: boolean;
  readonly excluded: readonly ExcludedField[];
};

export type PickerRefusal =
  | { ok: false; reason: "disabled" }
  | { ok: false; reason: "unknown_child" }
  /** The requested idea id no longer resolves. NEVER silently substituted:
   *  positional ids (`idea:2`) move when the child edits between the two round
   *  trips, and spending on a different idea than the one selected also files
   *  the consent trail against the wrong `source_idea_id`. */
  | { ok: false; reason: "unknown_idea" }
  | { ok: false; reason: "unavailable" };

export type ContentPickerDeps = {
  /** Candidate children. The loader ALSO excludes test families in SQL. */
  listChildren(): Promise<PickerChildRow[]>;
  findChild(childId: string): Promise<PickerChildRow | null>;
  /** The raw `fp_player_saves.doc`. Never pre-parsed — the gate lives here. */
  loadSaveDoc(profileId: string): Promise<unknown>;
  /** Sale ledger rows. The loader NEVER selects `payer`. */
  loadSales(profileId: string): Promise<SaleRow[]>;
  /** Overridable so tests never touch process.env. */
  isLive?: () => boolean;
};

// ── The name scrub ───────────────────────────────────────────────────────────

/** What a removed name is replaced WITH. A visible marker rather than a deletion:
 *  "Hi, I'm , and I make…" reads as a typo a staff member would fix by typing the
 *  name back in, which is the one outcome this whole mechanism exists to prevent. */
export const IMAGE_LAB_NAME_REDACTION = "[name]";

/**
 * Tokens shorter than this are not scrubbed — FOR PLAIN-ASCII TOKENS ONLY.
 *
 * A one-character ASCII "name" (an initial, a placeholder row) would match a
 * letter everywhere and turn every slot into redaction markers. Two is the floor
 * at which a boundary match is still meaningfully a name — and a real child IS
 * called Jo, Al, Bo or Vi, so two is a floor rather than a suggestion (a suite
 * with no two-character fixture cannot tell 2 from 3, and 3 ships those four
 * children's names to a vendor).
 *
 * ⚠ IT DOES NOT APPLY OUTSIDE ASCII. A given name written 美 is one character,
 * and applying a character count designed for the Latin alphabet to it produced
 * ZERO tokens — a scrub that ran, removed nothing, and reported success while
 * the full name went to the vendor. See {@link isScrubbableToken}.
 */
const MIN_SCRUBBABLE_TOKEN = 2;

/** Is this token specific enough to redact everywhere it appears? */
function isScrubbableToken(token: string): boolean {
  if (token === "") return false;
  // Anything outside printable ASCII is a name in a script the two-character
  // floor was never about. One CJK character IS a whole given name.
  if (/[^ -~]/.test(token)) return true;
  return token.length >= MIN_SCRUBBABLE_TOKEN;
}

/**
 * Lowercase forms NFD cannot reach.
 *
 * Turkish dotless ı is the one that matters here and it is not hypothetical: a
 * roster typed "Irem" against a pitch typed "İrem" (or the reverse) leaves the
 * name intact under any comparison that is not folded.
 */
const EXTRA_FOLD: Readonly<Record<string, string>> = {
  "ı": "i", // ı  LATIN SMALL LETTER DOTLESS I
  "İ": "i", // İ  LATIN CAPITAL LETTER I WITH DOT ABOVE
  "ß": "ss", // ß
  "ø": "o",
  "Ø": "o",
  "ł": "l", // ł
  "Ł": "l",
  "đ": "d", // đ
  "Đ": "d",
};

const foldChar = (ch: string): string =>
  (EXTRA_FOLD[ch] ?? ch)
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");

/** A folded string plus, per folded UTF-16 unit, the ORIGINAL index it came from. */
export type FoldedText = { readonly text: string; readonly map: readonly number[] };

/**
 * Case- and accent-folded text, WITH AN OFFSET MAP BACK TO THE ORIGINAL.
 *
 * ⚠ THE MAP IS THE WHOLE POINT. Comparing on a fold is what makes "Jose" match
 * "José" (an accent typed in one field and omitted in the other is routine, in
 * both directions), but a redaction emitted into the FOLDED string would hand a
 * vendor a prompt with every accent stripped and every capital lowered. So the
 * match runs on the fold and the replacement lands in the original at the mapped
 * offsets.
 *
 * Folding is per code point and may produce zero units (a lone combining mark)
 * or two (ß → ss), so the map cannot be an arithmetic offset.
 */
export function foldForScrub(input: string): FoldedText {
  let text = "";
  const map: number[] = [];
  let original = 0;
  for (const ch of input) {
    const piece = foldChar(ch);
    for (let i = 0; i < piece.length; i++) {
      text += piece[i];
      map.push(original);
    }
    original += ch.length;
  }
  return { text, map };
}

/** Folded alphanumerics — the class that decides where a word ends. Non-Latin
 *  scripts are DELIBERATELY outside it, so a CJK neighbour reads as a boundary
 *  and a one-character given name still matches. */
const FOLDED_ALNUM = /[a-z0-9]/;

/**
 * Every token derived from one child's identity that must not reach a vendor.
 *
 * The username is decomposed as well as taken whole, because this project's
 * usernames MAY BE EMAIL-SHAPED (the120#129, 2026-08-04): `maya.chen@example.com`
 * must remove `maya` and `chen` too, or the scrub removes a string that never
 * appears in prose while leaving the two that do.
 *
 * ⚠ ONLY THE LOCAL PART OF AN EMAIL-SHAPED HANDLE IS DECOMPOSED. Splitting the
 * whole string put `icloud` and `com` — cohort-wide strings that are nobody's
 * name — into the redaction set, degrading the very prompt whose output quality
 * this bench exists to measure.
 *
 * ⚠ THE RETURNED ORDER IS NOT MEANINGFUL, and deliberately so. The longest-first
 * rule that stops a compound becoming `[name].[name]` is enforced INSIDE
 * {@link scrubNames}, where the replacement actually happens — one sort, in the
 * place whose behaviour depends on it. A second sort here looked like a defence
 * and was not one: it could be deleted with the whole suite green, because the
 * caller re-sorted anyway. `scrubNames` therefore accepts tokens in any order.
 */
export function nameTokensFor(identity: {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}): string[] {
  const tokens = new Set<string>();
  const add = (value: string) => {
    const trimmed = value.trim();
    if (isScrubbableToken(trimmed)) tokens.add(trimmed);
  };
  // `\p{L}\p{N}` rather than `A-Za-z0-9`: an accented or non-Latin name split on
  // an ASCII-only class shatters into nothing.
  const parts = (value: string) => value.split(/[^\p{L}\p{N}]+/u);

  for (const value of [identity.firstName, identity.lastName]) {
    if (typeof value !== "string") continue;
    add(value);
    for (const part of parts(value.trim())) add(part);
  }

  const username = typeof identity.username === "string" ? identity.username.trim() : "";
  if (username !== "") {
    add(username);
    const at = username.indexOf("@");
    const local = at > 0 ? username.slice(0, at) : username;
    if (at > 0) add(local);
    for (const part of parts(local)) add(part);
  }

  return [...tokens];
}

/** Does this identity yield ANY token from the child's own first name? */
export function firstNameIsScrubbable(firstName: string | null | undefined): boolean {
  return nameTokensFor({ firstName }).length > 0;
}

/** May a match that starts here begin a word? */
function leadingBoundaryOk(folded: string, at: number): boolean {
  return at === 0 || !FOLDED_ALNUM.test(folded[at - 1]!);
}

/**
 * May a match that ends here end a name?
 *
 * ⚠ THIS IS NOT THE MIRROR OF THE LEADING RULE, and the asymmetry is the fix for
 * the widest hole this scrub ever had. A plain "not followed by an alphanumeric"
 * guard left `Mayas Cards`, `MayaCorp` and `MAYA123` completely untouched — and a
 * dropped apostrophe or a camel-cased brand name is exactly how a nine-year-old
 * writes their own business name. So three shapes end a name:
 *
 *   * a genuine boundary (`Maya's`, `Maya.`, `Maya `);
 *   * an INFLECTION — a trailing `s` that itself ends the word (`Mayas`);
 *   * a COMPOUND — the original text starts a new capital or a digit right here
 *     (`MayaCorp`, `Maya123`).
 *
 * The compound rule reads the ORIGINAL (not the fold) because it is a rule about
 * CASE, and it is why `sample` still survives a child called Sam: `p` is neither
 * uppercase nor a digit.
 */
function trailingBoundaryOk(
  folded: FoldedText,
  after: number,
  original: string
): boolean {
  const next = folded.text[after];
  if (next === undefined || !FOLDED_ALNUM.test(next)) return true;

  if (next === "s") {
    const afterS = folded.text[after + 1];
    if (afterS === undefined || !FOLDED_ALNUM.test(afterS)) return true;
  }

  const originalNext = original[folded.map[after] ?? original.length];
  return originalNext !== undefined && /[A-Z0-9]/.test(originalNext);
}

/**
 * Remove a child's own name and username from text bound for a model.
 *
 * ⚠ FOLDED, BOUNDARY-AWARE, AND DELIBERATELY OVER-EAGER. A child called Art
 * selling art supplies will see "[name] supplies", and that is the correct trade:
 * an over-scrubbed prompt makes a slightly worse picture, an under-scrubbed one
 * sends a real child's name to OpenAI or Google. The preview above the Generate
 * button is where a staff member sees the result and can reword.
 *
 * ⚠ THE REDACTION LANDS IN THE ORIGINAL STRING. Matching happens on the fold
 * (see {@link foldForScrub}); the offsets are mapped back, so the surviving text
 * keeps its accents and its capitals.
 *
 * Longest token first, and an overlapping match is DROPPED rather than nested —
 * without that, a username `Ann.Bel` over the text "Ann.Bel" becomes
 * `[name].[name]` instead of `[name]`.
 */
export function scrubNames(text: string, tokens: readonly string[]): string {
  if (text === "" || tokens.length === 0) return text;
  const folded = foldForScrub(text);
  /** Accepted spans, in ORIGINAL coordinates. */
  const spans: { start: number; end: number }[] = [];

  for (const token of [...tokens].sort((a, b) => b.length - a.length)) {
    const needle = foldForScrub(token).text;
    if (needle === "") continue;
    for (let from = 0; ; ) {
      const at = folded.text.indexOf(needle, from);
      if (at === -1) break;
      from = at + 1;
      const after = at + needle.length;
      if (!leadingBoundaryOk(folded.text, at)) continue;
      if (!trailingBoundaryOk(folded, after, text)) continue;
      const start = folded.map[at] ?? text.length;
      const end = folded.map[after] ?? text.length;
      if (spans.some((span) => start < span.end && end > span.start)) continue;
      spans.push({ start, end });
    }
  }
  if (spans.length === 0) return text;

  spans.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    out += text.slice(cursor, span.start) + IMAGE_LAB_NAME_REDACTION;
    cursor = span.end;
  }
  return out + text.slice(cursor);
}

// ── Doc parsing (gated) ──────────────────────────────────────────────────────

const isJsonObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * The pitch beats, in the order they are spoken (first-profit `src/lib/pitch.ts`
 * PITCH_BEATS). Joined with a blank line so the four beats stay four beats in the
 * resolved prompt rather than collapsing into one run-on sentence.
 */
const PITCH_BEAT_KEYS = ["pitchHook", "pitchWhat", "pitchWhy", "pitchAsk"] as const;

const readString = (source: Record<string, unknown>, key: string): string => {
  const value = source[key];
  return typeof value === "string" ? value.trim() : "";
};

/**
 * Ideas out of a save doc, or null when the doc must not be parsed at all.
 *
 * ⚠ NULL FOR AN UNKNOWN `docVersion`, and the distinction from "no ideas" is
 * load-bearing: an unknown version means we do not know what the keys mean, so
 * reading `fields.oneLiner` out of it would put arbitrary child text under a slot
 * name the prompt trusts. The gate is the SAME constant the site projection
 * trigger uses, imported, not restated.
 */
export function extractPickerIdeas(doc: unknown): PickerIdea[] | null {
  if (!isJsonObject(doc)) return null;
  const version = doc.docVersion;
  if (typeof version !== "number" || String(version) !== SITE_DOC_VERSION_GATE) {
    return null;
  }
  const ideas = doc.ideas;
  if (!Array.isArray(ideas)) return [];

  const out: PickerIdea[] = [];
  for (let i = 0; i < ideas.length; i++) {
    const idea: unknown = ideas[i];
    if (!isJsonObject(idea)) continue;
    const fields = isJsonObject(idea.fields) ? idea.fields : {};
    const productName = readString(fields, "productName");
    const oneLiner = readString(fields, "oneLiner");

    const beats = PITCH_BEAT_KEYS.map((key) => readString(fields, key)).filter(
      (beat) => beat !== ""
    );
    // The legacy single-block pitch is the fallback, not the preference: the four
    // beats are what the panel engine's templates are written against.
    const pitch = beats.length > 0 ? beats.join("\n\n") : readString(fields, "pitch");

    out.push({
      ideaId: typeof idea.id === "string" && idea.id !== "" ? idea.id : `idea:${i}`,
      index: i,
      productName,
      oneLiner,
      pitch,
      label: productName || oneLiner || `Idea ${i + 1}`,
    });
  }
  return out;
}

/**
 * The `sale` slot text — money and timing only.
 *
 * Deliberately a SUMMARY rather than a transcript: "sold 3 for $18.00, most
 * recently on 2026-08-01" is everything a panel needs about a first sale, and it
 * cannot accidentally carry a field nobody audited. The buyer's name is not in
 * the input to this function, so it cannot be in the output.
 */
export function summarizeSales(sales: readonly SaleRow[]): string {
  if (sales.length === 0) return "";
  const totalCents = sales.reduce((sum, s) => sum + (Number(s.amountCents) || 0), 0);
  const sorted = [...sales].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  const latest = sorted[0]!;
  const day = latest.createdAt.slice(0, 10);
  const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
  return sales.length === 1
    ? `One sale: ${money(totalCents)} on ${day}.`
    : `${sales.length} sales totalling ${money(totalCents)}; the most recent was ${money(latest.amountCents)} on ${day}.`;
}

// ── The sequences ────────────────────────────────────────────────────────────

/** Which children the picker offers. Test families excluded, twice. */
export async function listPickerChildren(
  deps: ContentPickerDeps
): Promise<{ ok: true; children: PickerChildOption[] } | PickerRefusal> {
  const isLive = deps.isLive ?? isImageLabRealContentLive;
  if (!isLive()) return { ok: false, reason: "disabled" };

  let rows: PickerChildRow[];
  try {
    rows = await deps.listChildren();
  } catch (e) {
    console.error("[image-lab/picker] child listing failed:", e);
    return { ok: false, reason: "unavailable" };
  }

  return {
    ok: true,
    children: rows.filter((row) => isRealFamily({ is_test: row.isTest })).map((row) => ({
      childId: row.childId,
      // A NAME IS SHOWN IN THE DROPDOWN AND NOWHERE ELSE. It never becomes a slot
      // value, is never stored on a run row (the run records ids only, origin
      // R17), and is scrubbed out of everything that does.
      label: [row.firstName, row.lastName].filter(Boolean).join(" ") || row.childId,
    })),
  };
}

export type PickerIdeasResult = {
  ok: true;
  readonly ideas: PickerIdea[];
  /** False when the doc failed the docVersion gate. */
  readonly docReadable: boolean;
};

/**
 * The ideas one child has, for the second dropdown.
 *
 * ⚠ EVERY PROSE FIELD IS SCRUBBED BEFORE IT LEAVES THIS FUNCTION. Only `label`
 * is rendered today, but `productName`/`oneLiner`/`pitch` used to travel to the
 * browser raw — one wiring change away from a surface that bypasses the scrub
 * entirely. Nothing here is the paid path's protection (that is `createRun`'s);
 * this is the rule that no raw child prose leaves the server at all.
 */
export async function listPickerIdeas(
  deps: ContentPickerDeps,
  childId: string
): Promise<PickerIdeasResult | PickerRefusal> {
  const isLive = deps.isLive ?? isImageLabRealContentLive;
  if (!isLive()) return { ok: false, reason: "disabled" };

  let child: PickerChildRow | null;
  try {
    child = await deps.findChild(childId);
  } catch (e) {
    console.error("[image-lab/picker] child lookup failed:", e);
    return { ok: false, reason: "unavailable" };
  }
  if (!child || !isRealFamily({ is_test: child.isTest })) {
    return { ok: false, reason: "unknown_child" };
  }

  let doc: unknown;
  try {
    doc = await deps.loadSaveDoc(child.profileId);
  } catch (e) {
    console.error("[image-lab/picker] save read failed:", e);
    return { ok: false, reason: "unavailable" };
  }

  // Unknown/absent version → skipped, never parsed. An empty list, not an error:
  // a child mid-migration is an ordinary state, and the composer says so — with
  // its OWN copy, because "we could not read the save" invites a staff member to
  // type the content in by hand, which bypasses the scrub.
  const parsed = extractPickerIdeas(doc);
  const tokens = nameTokensFor({
    firstName: child.firstName,
    lastName: child.lastName,
    username: child.username,
  });
  return {
    ok: true,
    docReadable: parsed !== null,
    ideas: (parsed ?? []).map((idea) => ({
      ...idea,
      productName: scrubNames(idea.productName, tokens),
      oneLiner: scrubNames(idea.oneLiner, tokens),
      pitch: scrubNames(idea.pitch, tokens),
      label: scrubNames(idea.label, tokens),
    })),
  };
}

/**
 * Fill the four slots from one child's real business content.
 *
 * EVERY SLOT COMES BACK PRESENT, "" where there is nothing — a child with zero
 * ideas or a missing sale yields explicit empties, never a crash and never a
 * missing key that would make `{{sale}}` silently resolve to the literal for a
 * reason the composer cannot explain.
 */
export async function pickSlotValues(
  deps: ContentPickerDeps,
  input: { childId: string; ideaId?: string | null; taskId?: string | null }
): Promise<PickerContent | PickerRefusal> {
  const isLive = deps.isLive ?? isImageLabRealContentLive;
  if (!isLive()) return { ok: false, reason: "disabled" };

  let child: PickerChildRow | null;
  try {
    child = await deps.findChild(input.childId);
  } catch (e) {
    console.error("[image-lab/picker] child lookup failed:", e);
    return { ok: false, reason: "unavailable" };
  }
  if (!child || !isRealFamily({ is_test: child.isTest })) {
    return { ok: false, reason: "unknown_child" };
  }

  let doc: unknown;
  let sales: SaleRow[];
  try {
    [doc, sales] = await Promise.all([
      deps.loadSaveDoc(child.profileId),
      deps.loadSales(child.profileId),
    ]);
  } catch (e) {
    console.error("[image-lab/picker] content read failed:", e);
    return { ok: false, reason: "unavailable" };
  }

  const parsed = extractPickerIdeas(doc);
  const ideas = parsed ?? [];

  // ⚠ AN UNRESOLVABLE REQUESTED IDEA IS A REFUSAL, NOT A SUBSTITUTION. The old
  // fallback to `ideas[0]` spent money on a different idea than the one selected
  // AND recorded that other idea as `source_idea_id`, pointing the consent trail
  // at the wrong thing. Positional ids (`idea:2`) are exactly the ones that move
  // when the child edits between the two round trips.
  const requested =
    typeof input.ideaId === "string" && input.ideaId !== "" ? input.ideaId : null;
  const match = requested === null ? null : ideas.find((c) => c.ideaId === requested);
  if (requested !== null && !match) return { ok: false, reason: "unknown_idea" };
  const idea = match ?? ideas[0] ?? null;
  const substituted = requested === null && idea !== null;

  const raw: Record<ImageLabSlot, string> = {
    product: idea?.productName ?? "",
    oneLiner: idea?.oneLiner ?? "",
    pitch: idea?.pitch ?? "",
    sale: summarizeSales(sales),
  };

  // ⚠ THE SCRUB RUNS OVER EVERY SLOT, not only `pitch`. A product called "Maya's
  // Cards" carries the same name into the same vendor.
  const tokens = nameTokensFor({
    firstName: child.firstName,
    lastName: child.lastName,
    username: child.username,
  });
  const slots: SlotValues = {};
  const emptySlots: ImageLabSlot[] = [];
  let scrubbed = false;
  for (const slot of IMAGE_LAB_SLOTS) {
    const before = raw[slot];
    const after = scrubNames(before, tokens);
    if (after !== before) scrubbed = true;
    slots[slot] = after;
    if (after.trim() === "") emptySlots.push(slot);
  }

  return {
    ok: true,
    childId: child.childId,
    ideaId: idea?.ideaId ?? null,
    taskId: typeof input.taskId === "string" && input.taskId !== "" ? input.taskId : null,
    slots,
    emptySlots,
    scrubbed,
    scrubCovered: firstNameIsScrubbable(child.firstName),
    substituted,
    docReadable: parsed !== null,
    excluded: IMAGE_LAB_EXCLUDED_FIELDS,
  };
}
