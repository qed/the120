import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseV3AddKid,
  parseV3EditKid,
  parseV3Provision,
  parseV3SaveStory,
} from "../v3-onboarding-rules";

/**
 * The steps 2-5 request parsers (plan Unit 3), pinned (review FIX 10c).
 *
 * Two properties matter here and neither is visible from the core's own tests:
 *
 *   1. EVERY schema is `.strict()`. An unknown key is a REFUSAL, not a silently
 *      ignored field — which is what stops a client from smuggling a
 *      server-derived name (`parentId`, `differentChild` on the wrong action)
 *      into a body the core then trusts.
 *   2. NOTHING SERVER-DERIVED IS IN THESE SCHEMAS. The parent id, the parent's
 *      email, the client IP and the user agent are attested by the ACTION from
 *      the session and the request headers. A client that could name its own
 *      `parentId` would be naming whose kid it is adding, so the absence of
 *      those fields is a security property and is asserted as one.
 */

const uuid = () => randomUUID();
const hash = "a".repeat(64);

const addKid = (over: Record<string, unknown> = {}) => ({
  fullName: "Remi Newal",
  age: "9",
  consentVersion: "2026-08-05",
  consentHash: hash,
  ...over,
});

describe("parseV3AddKid", () => {
  it("accepts the designed body and trims the full name", () => {
    const parsed = parseV3AddKid(addKid({ fullName: "  Remi Newal  " }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.data.fullName).toBe("Remi Newal");
  });

  it("accepts a numeric age as well as a string one (the input may send either)", () => {
    expect(parseV3AddKid(addKid({ age: 9 })).ok).toBe(true);
  });

  it("REFUSES an unknown key — .strict(), so a smuggled field is never silently dropped", () => {
    expect(parseV3AddKid(addKid({ parentId: "someone-else" })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ draftId: uuid() })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ ip: "1.2.3.4" })).ok).toBe(false);
  });

  it("`differentChild` must be the LITERAL true — never a defaulted flag a client drifts into", () => {
    expect(parseV3AddKid(addKid({ differentChild: true })).ok).toBe(true);
    expect(parseV3AddKid(addKid({ differentChild: false })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ differentChild: "true" })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ differentChild: 1 })).ok).toBe(false);
  });

  it("`photoDeclined` is an optional boolean — false/absent are harmless, non-booleans refused (fpv03 U3)", () => {
    // Deliberately a plain boolean, not literal(true): the UI only sends it
    // when true, but a client that sends false must be a no-op rather than a
    // whole-add refusal (fail-safe: absent/false = no tombstone).
    expect(parseV3AddKid(addKid({ photoDeclined: true })).ok).toBe(true);
    expect(parseV3AddKid(addKid({ photoDeclined: false })).ok).toBe(true);
    expect(parseV3AddKid(addKid({ photoDeclined: "true" })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ photoDeclined: 1 })).ok).toBe(false);
  });

  it("`photoDeclined` belongs to ADD only — the edit path re-uses the recorded consent", () => {
    expect(
      parseV3EditKid({ draftId: uuid(), fullName: "Remi Newal", age: "9", photoDeclined: true }).ok
    ).toBe(false);
  });

  it("bounds the name (1..160) and the age bytes (<= 8)", () => {
    expect(parseV3AddKid(addKid({ fullName: "" })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ fullName: "   " })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ fullName: "N".repeat(160) })).ok).toBe(true);
    expect(parseV3AddKid(addKid({ fullName: "N".repeat(161) })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ age: "9".repeat(8) })).ok).toBe(true);
    expect(parseV3AddKid(addKid({ age: "9".repeat(9) })).ok).toBe(false);
  });

  it("the consent echo must be a 64-char lowercase hex hash and a bounded version", () => {
    expect(parseV3AddKid(addKid({ consentHash: hash.toUpperCase() })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ consentHash: "a".repeat(63) })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ consentHash: "g".repeat(64) })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ consentVersion: "" })).ok).toBe(false);
    expect(parseV3AddKid(addKid({ consentVersion: "v".repeat(41) })).ok).toBe(false);
  });

  it("refuses a missing echo outright (a bare body can never reach recordConsent)", () => {
    expect(parseV3AddKid({ fullName: "Remi Newal", age: "9" }).ok).toBe(false);
  });

  it("refuses non-objects", () => {
    for (const body of [null, undefined, "x", 7, [], true]) {
      expect(parseV3AddKid(body).ok, String(body)).toBe(false);
    }
  });
});

describe("parseV3EditKid", () => {
  it("requires a UUID draftId", () => {
    expect(parseV3EditKid({ draftId: uuid(), fullName: "Remi Newal", age: "9" }).ok).toBe(true);
    expect(parseV3EditKid({ draftId: "not-a-uuid", fullName: "Remi Newal", age: "9" }).ok).toBe(
      false
    );
    // A blank id must never reach a query as a wildcard-ish value.
    expect(parseV3EditKid({ draftId: "", fullName: "Remi Newal", age: "9" }).ok).toBe(false);
  });

  it("REFUSES a consent echo on the edit path — an edit re-uses the recorded consent, it does not mint one", () => {
    expect(
      parseV3EditKid({
        draftId: uuid(),
        fullName: "Remi Newal",
        age: "9",
        consentVersion: "2026-08-05",
        consentHash: hash,
      }).ok
    ).toBe(false);
  });

  it("REFUSES `differentChild` — the duplicate override belongs to add, not edit", () => {
    expect(
      parseV3EditKid({ draftId: uuid(), fullName: "Remi Newal", age: "9", differentChild: true }).ok
    ).toBe(false);
  });
});

describe("parseV3SaveStory", () => {
  it("accepts a bounded answer sheet, including an empty one (the questions are optional)", () => {
    expect(parseV3SaveStory({ draftId: uuid(), answers: {} }).ok).toBe(true);
    expect(parseV3SaveStory({ draftId: uuid(), answers: { matters: "Soccer" } }).ok).toBe(true);
  });

  it("bounds each answer at 4000 bytes — a paste bomb is REFUSED by the parser, not truncated later", () => {
    expect(parseV3SaveStory({ draftId: uuid(), answers: { matters: "x".repeat(4000) } }).ok).toBe(
      true
    );
    expect(parseV3SaveStory({ draftId: uuid(), answers: { matters: "x".repeat(4001) } }).ok).toBe(
      false
    );
  });

  it("bounds the KEY length too, so an enormous key cannot ride in the jsonb", () => {
    expect(parseV3SaveStory({ draftId: uuid(), answers: { ["k".repeat(64)]: "a" } }).ok).toBe(true);
    expect(parseV3SaveStory({ draftId: uuid(), answers: { ["k".repeat(65)]: "a" } }).ok).toBe(false);
  });

  it("TOLERATES an unknown answer key (a stale tab is version skew, not an attack) — the core drops it", () => {
    // Deliberately asymmetric with the strict() top level: refusing the whole
    // save would strand a family behind a cached bundle. The KEY FILTER lives in
    // the core (only STORY_QUESTION_IDS are written), which is asserted in
    // v3-onboarding-core.test.ts.
    expect(parseV3SaveStory({ draftId: uuid(), answers: { unknownQuestion: "hi" } }).ok).toBe(true);
  });

  it("refuses a non-string answer value and an unknown top-level key", () => {
    expect(parseV3SaveStory({ draftId: uuid(), answers: { matters: 7 } }).ok).toBe(false);
    expect(parseV3SaveStory({ draftId: uuid(), answers: {}, parentId: "x" }).ok).toBe(false);
    expect(parseV3SaveStory({ draftId: uuid() }).ok).toBe(false);
  });
});

describe("parseV3Provision", () => {
  it("takes a UUID draftId and NOTHING else — no attempt id, no child id, no parent id", () => {
    const id = uuid();
    const parsed = parseV3Provision({ draftId: id });
    expect(parsed).toEqual({ ok: true, data: { draftId: id } });

    // Every one of these would be a caller naming a server-derived fact.
    expect(parseV3Provision({ draftId: id, attemptId: uuid() }).ok).toBe(false);
    expect(parseV3Provision({ draftId: id, childId: uuid() }).ok).toBe(false);
    expect(parseV3Provision({ draftId: id, parentId: "someone-else" }).ok).toBe(false);
    expect(parseV3Provision({ draftId: id, username: "chosen.handle" }).ok).toBe(false);
    expect(parseV3Provision({ draftId: id, childPassword: "hunter2hunter2" }).ok).toBe(false);
  });

  it("refuses a malformed or absent id", () => {
    expect(parseV3Provision({ draftId: "1" }).ok).toBe(false);
    expect(parseV3Provision({}).ok).toBe(false);
    expect(parseV3Provision(null).ok).toBe(false);
  });
});
