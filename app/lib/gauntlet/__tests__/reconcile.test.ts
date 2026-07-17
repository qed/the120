import { describe, expect, it } from "vitest";
import { decideReconcileLink, type ReconcileEntry } from "../reconcile";

const CONFIRMED = "2026-08-05T00:00:00Z";

function entry(over: Partial<ReconcileEntry> = {}): ReconcileEntry {
  return {
    id: "e1",
    parent_email: "parent@example.com",
    handle: "RAIDER-X",
    confirmed_at: CONFIRMED,
    user_id: null,
    ...over,
  };
}

describe("decideReconcileLink — happy path (proven-email match)", () => {
  it("links a confirmed, unlinked entry whose parent_email matches the caller", () => {
    const d = decideReconcileLink({
      callerUserId: "u1",
      callerEmail: "Parent@Example.com", // case-insensitive
      emailConfirmed: true,
      entries: [entry()],
    });
    expect(d).toEqual({ action: "link", entryId: "e1", via: "email" });
  });

  it("ignores unconfirmed and already-linked rows when choosing an email match", () => {
    const d = decideReconcileLink({
      callerUserId: "u1",
      callerEmail: "parent@example.com",
      emailConfirmed: true,
      entries: [
        entry({ id: "pending", confirmed_at: null }), // not yet confirmed
        entry({ id: "otheracct", user_id: "u2" }), // linked to someone else
        entry({ id: "mine" }), // confirmed + unlinked + email match
      ],
    });
    expect(d).toEqual({ action: "link", entryId: "mine", via: "email" });
  });
});

describe("decideReconcileLink — already-linked skip (one prize band per identity)", () => {
  it("skips when the caller already holds a confirmed entry under their user_id", () => {
    const d = decideReconcileLink({
      callerUserId: "u1",
      callerEmail: "parent@example.com",
      emailConfirmed: true,
      // A stampable email match ALSO exists, but the caller already ranks →
      // must not stamp a second one.
      entries: [
        entry({ id: "already", user_id: "u1" }),
        entry({ id: "another", parent_email: "parent@example.com" }),
      ],
    });
    expect(d).toEqual({ action: "skip", reason: "already_linked" });
  });
});

describe("decideReconcileLink — email-unconfirmed reject (forged-consent lesson)", () => {
  it("never links when the caller's auth email is unconfirmed", () => {
    const d = decideReconcileLink({
      callerUserId: "u1",
      callerEmail: "parent@example.com",
      emailConfirmed: false,
      entries: [entry()], // a perfect match exists, but the email isn't proven
    });
    expect(d).toEqual({ action: "skip", reason: "email_unconfirmed" });
  });

  it("skips when there is no auth email at all", () => {
    const d = decideReconcileLink({
      callerUserId: "u1",
      callerEmail: null,
      emailConfirmed: true,
      entries: [entry()],
    });
    expect(d).toEqual({ action: "skip", reason: "email_unconfirmed" });
  });
});

describe("decideReconcileLink — handle-claim fallback (different email)", () => {
  it("claims by handle when no email matches but the requested handle does", () => {
    const d = decideReconcileLink({
      callerUserId: "u1",
      callerEmail: "newaccount@example.com", // account email != entry.parent_email
      emailConfirmed: true,
      requestedHandle: "raider-x", // normalizes to RAIDER-X
      entries: [entry({ parent_email: "otherparent@example.com" })],
    });
    expect(d).toEqual({ action: "link", entryId: "e1", via: "handle" });
  });

  it("prefers an email match over a handle claim", () => {
    const d = decideReconcileLink({
      callerUserId: "u1",
      callerEmail: "parent@example.com",
      emailConfirmed: true,
      requestedHandle: "OTHER-HANDLE",
      entries: [
        entry({ id: "byhandle", parent_email: "x@y.com", handle: "OTHER-HANDLE" }),
        entry({ id: "byemail", handle: "RAIDER-X" }),
      ],
    });
    expect(d).toEqual({ action: "link", entryId: "byemail", via: "email" });
  });

  it("does not claim an already-linked entry by handle", () => {
    const d = decideReconcileLink({
      callerUserId: "u1",
      callerEmail: "newaccount@example.com",
      emailConfirmed: true,
      requestedHandle: "RAIDER-X",
      entries: [entry({ user_id: "u2", parent_email: "x@y.com" })],
    });
    expect(d).toEqual({ action: "skip", reason: "no_match" });
  });
});

describe("decideReconcileLink — no match", () => {
  it("skips when nothing matches the caller's email or handle", () => {
    const d = decideReconcileLink({
      callerUserId: "u1",
      callerEmail: "nobody@example.com",
      emailConfirmed: true,
      entries: [entry({ parent_email: "someoneelse@example.com" })],
    });
    expect(d).toEqual({ action: "skip", reason: "no_match" });
  });
});
