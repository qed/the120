/**
 * Request parsing for the v3 onboarding flow's steps 2-5 (plan Unit 3). Pure:
 * zod schemas and nothing else, the sibling of
 * app/api/fp/signup/signup-rules.ts's `parseSignupRequest` and
 * app/lib/v3-signup/v3-signup-rules.ts's four parsers.
 *
 * WHY THE PARSE LIVES HERE AND NOT IN THE ACTION: a Server Action's arguments
 * arrive from the wire as `unknown`, so the core must be the thing that refuses
 * a malformed body — a wrapper that parses is a wrapper with a decision in it,
 * and the next caller (a route, a script, a test) would not get the same guard.
 * Every schema is `.strict()`, so an unknown key is a refusal rather than a
 * silently-ignored field.
 *
 * NOTHING SERVER-DERIVED IS IN THESE SCHEMAS. The parent id, the parent's
 * email, the client IP and the user agent are context the ACTION attests from
 * the session and the request headers; a client that could name its own
 * `parentId` would be naming whose kid it is adding.
 */

import { z } from "zod";

/** Draft/child ids are uuids; anything else never reaches a query. */
const idField = z.uuid();

/** The typed full name. Bounded well above any real name, refused below the
 *  point `validateKidInput` would refuse it anyway. */
const fullNameField = z.string().trim().min(1).max(160);

/** Age arrives from a numeric input, so it may be a string. The RANGE check is
 *  `validateKidInput`'s (one place, shared with the client), not this schema's —
 *  this only bounds the bytes. */
const ageField = z.union([z.string().trim().max(8), z.number()]);

/** The bind-to-rendered echo. Hex sha256, and a published-version SHAPE; the
 *  actual version/hash comparison is `consentVerdict`'s. */
const consentEcho = {
  consentVersion: z.string().trim().min(1).max(40),
  consentHash: z.string().trim().regex(/^[0-9a-f]{64}$/),
};

const addKidSchema = z
  .object({
    fullName: fullNameField,
    age: ageField,
    ...consentEcho,
    // The ONLY way past the duplicate guard, and it must be an explicit literal
    // choice the parent made — not a defaulted flag a client can drift into.
    differentChild: z.literal(true).optional(),
    // fpv03 U3: the S04 photo checkbox, DEFAULT ON in the UI. `true` means the
    // parent UNCHECKED it (declined photo use), and the per-child
    // photo-consent tombstone is stamped when the child is created. A plain
    // boolean rather than literal(true) so a client that sends `false` is
    // harmlessly a no-op instead of a whole-add refusal; the core acts only on
    // `=== true`. FAIL-SAFE: absent/false = no tombstone.
    photoDeclined: z.boolean().optional(),
  })
  .strict();

export type V3AddKidBody = z.infer<typeof addKidSchema>;

const editKidSchema = z
  .object({ draftId: idField, fullName: fullNameField, age: ageField })
  .strict();

export type V3EditKidBody = z.infer<typeof editKidSchema>;

const saveStorySchema = z
  .object({
    draftId: idField,
    // Values are bounded here so a paste bomb is refused by the parser rather
    // than truncated by the core; unknown KEYS are tolerated by the record and
    // then dropped by the core's known-id filter (an unknown key is a client
    // version skew, not an attack, and refusing the whole save would strand a
    // family behind a stale tab).
    answers: z.record(z.string().max(64), z.string().max(4000)),
  })
  .strict();

export type V3SaveStoryBody = z.infer<typeof saveStorySchema>;

const provisionSchema = z.object({ draftId: idField }).strict();

export type V3ProvisionBody = z.infer<typeof provisionSchema>;

export type Parsed<T> = { ok: true; data: T } | { ok: false };

const parseWith = <T>(schema: z.ZodType<T>, body: unknown): Parsed<T> => {
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
};

export const parseV3AddKid = (body: unknown): Parsed<V3AddKidBody> =>
  parseWith(addKidSchema, body);
export const parseV3EditKid = (body: unknown): Parsed<V3EditKidBody> =>
  parseWith(editKidSchema, body);
export const parseV3SaveStory = (body: unknown): Parsed<V3SaveStoryBody> =>
  parseWith(saveStorySchema, body);
export const parseV3Provision = (body: unknown): Parsed<V3ProvisionBody> =>
  parseWith(provisionSchema, body);

/** One parent-facing message for every non-designed failure of steps 2-5, the
 *  same posture `V3_FAILED_MESSAGE` takes for step 1. */
export const V3_ONBOARDING_FAILED_MESSAGE =
  "That didn't save just now. Give it a second and try again.";
