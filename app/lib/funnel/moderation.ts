/**
 * Input moderation (funnel U9; R39a, R41) — the in-repo rules module Peter
 * chose over a hosted API (2026-07-28): no child free-text leaves us, no
 * vendor in the write path, testable against an adversarial corpus. PURE.
 *
 * Runs BEFORE storage and BEFORE any model call. The two passes differ:
 * storage REDACTS (the stored value must contain no PII this pass is
 * specified to catch — the plan's verification), while the model pass also
 * REJECTS input carrying the reserved prompt delimiter (redaction can't fix
 * an injection attempt; refusing it can).
 *
 * Honest scope: this is regex-and-list moderation. It catches the shapes a
 * child plausibly types — emails, phone numbers, street addresses, handles,
 * the profanity and brand lists below — not novel adversarial evasion. It
 * gates storage of quiz answers, not safety-critical decisions, and U10's
 * compose prompt treats every field as untrusted regardless.
 */

/* ─────────────────────────────── caps (R41) ─────────────────────────────── */

/** Free-text cap per answer. Generous for a real answer, hostile to a paste. */
export const ANSWER_MAX_CHARS = 400;
/** The own-idea seed box gets more room; it replaces a whole template. */
export const OWN_IDEA_MAX_CHARS = 800;

/* ────────────────────────── the reserved delimiter ────────────────────────── */

/**
 * U10's compose prompt fences child input with this sequence. Input that
 * CONTAINS it is rejected before any call — an injection attempt cannot be
 * repaired by redaction, and accepting a "cleaned" version would still store
 * text written to break a prompt. Exported so compose and this module cannot
 * drift on the spelling.
 */
export const RESERVED_DELIMITER = "⟦⟧";
const DELIMITER_PATTERN = /[⟦⟧]/;

/* ─────────────────────────────── PII patterns ─────────────────────────────── */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * Phone shapes a child types: 416-555-0192, (416) 555 0192, 4165550192,
 * +1 416 555 0192, and the local 555-0192 (separator REQUIRED on the
 * 7-digit form, so "$1200" and "120 kids" stay quiz answers). Known
 * trade-off, accepted: a bare 10-digit run ("1000000000 stickers") redacts
 * as a phone — over-redacting a hyperbolic count beats storing a number.
 */
const PHONE =
  /(?:\+?\d{1,2}[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}\b|\b\d{3}[\s.-]\d{4}\b/g;

/**
 * Street addresses: a number followed within a few words by a street-type
 * word. Catches "516 Glencairn Avenue", "12 Main St", "221b Baker Street".
 * The intermediate words must LOOK like a street name: determiners,
 * pronouns, and measure words are excluded, so the product's own honest
 * vocabulary — "3 houses on my street", "20 minutes down the road",
 * "2 doors down the street" — survives (both reviewers hit this).
 */
const STREET_STOPWORD =
  "(?:my|the|a|an|our|your|his|her|their|on|down|up|in|at|of|to|per|min|mins|minute|minutes|hour|hours|day|days|week|weeks|block|blocks|door|doors|house|houses|kid|kids|dog|dogs|mile|miles|km|kms|people|families)";
const STREET = new RegExp(
  `\\b\\d{1,5}[a-z]?\\s+(?:(?!${STREET_STOPWORD}\\b)[A-Za-z'.-]+\\s+){0,3}(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|cres|crescent|crt|court|ln|lane|way|pl|place|terr|terrace)\\b\\.?`,
  "gi"
);

/** Social handles — a kid's @name is contact info too. A short stoplist
 *  spares kid-shorthand ("lemonade @home and @school"). */
const HANDLE = /(?<![\w.])@(?!(?:home|school|work|night|the|my|first|least)\b)[A-Za-z0-9_.]{2,30}\b/g;

/** Canadian postal codes ("M6B 1Z1") — precise enough to be safe to redact. */
const POSTAL = /\b[ABCEGHJ-NPRSTVXY]\d[A-Z][ -]?\d[A-Z]\d\b/gi;

export const REDACTED = "▮▮▮";

/* ─────────────────────────────── word lists ─────────────────────────────── */

/**
 * Profanity: matched as whole words, case-insensitive. Compact and common —
 * the goal is that a stored answer or a model prompt never carries these,
 * not linguistic completeness.
 */
const PROFANITY = [
  "fuck", "fucking", "shit", "bitch", "asshole", "bastard", "dick", "piss",
  "cunt", "whore", "slut", "damn", "crap",
];

/**
 * Brand names (§8.3: brand filtering on the kid's inputs): the marks a kid
 * most plausibly builds a pitch around. Replaced with a generic, because a
 * project called "My Nike Store" is a trademark problem the moment the
 * Reveal renders it back.
 */
const BRANDS = [
  "nike", "adidas", "mcdonald's", "mcdonalds", "disney", "lego", "roblox",
  "minecraft", "fortnite", "youtube", "tiktok", "instagram", "pokemon",
  "pokémon", "nintendo", "starbucks", "amazon", "netflix", "barbie",
  // NOT "apple": the case-insensitive whole-word match would genericize
  // "apple cider" and "apple pies" — a founders-stand kid's honest product.
  // The trademark risk lives in U10's compose prompt instead.
];

const wordList = (words: string[]) =>
  new RegExp(`\\b(?:${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`, "gi");

const PROFANITY_RE = wordList(PROFANITY);
const BRANDS_RE = wordList(BRANDS);

/* ─────────────────────────────── the passes ─────────────────────────────── */

export type ModerationResult = {
  /** Safe to store / send: PII redacted, profanity masked, brands genericized. */
  clean: string;
  /** What fired, for the caller's copy and for tests. Never the matched text. */
  flags: ("email" | "phone" | "address" | "handle" | "postal" | "profanity" | "brand")[];
};

/**
 * Truncate WITHOUT splitting a surrogate pair: `slice` at a raw UTF-16 index
 * can cut an emoji in half, and the lone surrogate then rides into JSON /
 * UTF-8 serialization as U+FFFD or an encoding error.
 */
export function capWellFormed(value: string, maxChars: number): string {
  let cut = value.slice(0, maxChars);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut;
}

/**
 * The storage pass: REDACT, never reject. A child who typed their email into
 * "who's your first customer?" gave a real answer with a real mistake in it;
 * the answer survives, the address does not. The cap is the CALLER's field
 * cap — a server-side call site enforces R41 here even when a crafted POST
 * skipped the textarea's client cap.
 */
export function moderateForStorage(
  raw: string,
  maxChars = ANSWER_MAX_CHARS
): ModerationResult {
  const flags: ModerationResult["flags"] = [];
  let clean = capWellFormed(raw, maxChars);

  const apply = (re: RegExp, flag: ModerationResult["flags"][number], replacement: string) => {
    re.lastIndex = 0;
    if (re.test(clean)) {
      flags.push(flag);
      re.lastIndex = 0;
      clean = clean.replace(re, replacement);
    }
  };

  // Order matters: emails before handles (an email contains an @token).
  apply(EMAIL, "email", REDACTED);
  apply(PHONE, "phone", REDACTED);
  apply(STREET, "address", REDACTED);
  apply(POSTAL, "postal", REDACTED);
  apply(HANDLE, "handle", REDACTED);
  apply(PROFANITY_RE, "profanity", "▮▮");
  apply(BRANDS_RE, "brand", "a big brand");

  return { clean, flags };
}

export type ModelInputVerdict =
  | { ok: true; clean: string }
  | { ok: false; reason: "reserved_delimiter" | "too_long" | "empty" };

/**
 * The model pass (R39a adjacent): everything the storage pass does, plus
 * REJECTION of the reserved delimiter and hard length enforcement. Runs on
 * the ALREADY-STORED clean value by convention, but re-moderates anyway —
 * belt to the storage pass's braces, because the model call is the surface
 * where a miss becomes an instruction.
 */
export function moderateForModel(raw: string, maxChars = ANSWER_MAX_CHARS): ModelInputVerdict {
  if (DELIMITER_PATTERN.test(raw)) return { ok: false, reason: "reserved_delimiter" };
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, reason: "empty" };
  if (trimmed.length > maxChars) return { ok: false, reason: "too_long" };
  // Note: brand replacement GROWS text ("nike" → "a big brand"), so `clean`
  // can exceed maxChars by a few characters — size prompt fields accordingly.
  return { ok: true, clean: moderateForStorage(trimmed, maxChars).clean };
}

/**
 * The storage seam U10's compose action MUST pass a whole answer set
 * through before any insert — exported HERE, in U9, so the "no stored quiz
 * answer contains PII" verification has a named function to wire rather
 * than a convention to remember. Flags are the union across fields, deduped.
 */
export function moderateAnswers<K extends string>(
  answers: Partial<Record<K, string>>,
  maxChars = ANSWER_MAX_CHARS
): { clean: Partial<Record<K, string>>; flags: ModerationResult["flags"] } {
  const clean: Partial<Record<K, string>> = {};
  const flags = new Set<ModerationResult["flags"][number]>();
  for (const [key, value] of Object.entries(answers) as [K, string | undefined][]) {
    if (typeof value !== "string") continue;
    const result = moderateForStorage(value, maxChars);
    clean[key] = result.clean;
    for (const f of result.flags) flags.add(f);
  }
  return { clean, flags: [...flags] };
}
