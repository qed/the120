import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the mailer so we can assert it is NEVER called for a suppressed family
// (no real mail to a test address / an unsubscribed family) and inspect the
// payload when it IS. `vi.hoisted` makes the mock fn available inside the hoisted
// factory without a temporal-dead-zone error.
const { sendEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(
    async (): Promise<{ ok: true } | { ok: false; error?: string }> => ({ ok: true })
  ),
}));
vi.mock("@/app/lib/email", () => ({ sendEmail: sendEmailMock }));

import { sendLoginCodeEmail, sendProgressDigest, sendSignupRecap } from "../send";

// The unsubscribe-link HMAC needs a secret (always set in the server env); supply
// one for the test so the footer link renders instead of throwing.
process.env.UNSUBSCRIBE_SECRET ||= "test-unsub-secret";

/** A one-table fake supabase client: `.from("families").select().eq().is()
 *  .maybeSingle()` resolves to the configured family row (or error). */
function fakeDb(family: Record<string, unknown> | null, opts: { error?: boolean } = {}) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: () => builder,
    is: () => builder,
    maybeSingle: () =>
      Promise.resolve(opts.error ? { data: null, error: { message: "boom" } } : { data: family, error: null }),
  };
  return { from: () => builder } as never;
}

const realFamily = {
  id: "fam1",
  email: "parent@example.com",
  parent_name: "Dana Rivers",
  is_test: false,
  consent_revoked_at: null,
  merged_into_id: null,
};

afterEach(() => sendEmailMock.mockClear());

describe("sendSignupRecap suppression", () => {
  const base = {
    parentId: "u1",
    children: [{ firstName: "Kai", username: "kai" }],
    signInUrl: "https://firstprofit.school",
    resetUrl: "https://firstprofit.school/reset",
  };

  it("sends to a real, subscribed family and derives the greeting first name", async () => {
    const out = await sendSignupRecap(fakeDb(realFamily), base);
    expect(out.status).toBe("sent");
    expect(sendEmailMock).toHaveBeenCalledOnce();
    const arg = (sendEmailMock.mock.calls[0] as unknown[])[0] as {
      to: string;
      html: string;
      idempotencyKey?: string;
    };
    expect(arg.to).toBe("parent@example.com");
    expect(arg.html).toContain("Hi Dana,");
    expect(arg.idempotencyKey).toBe("fp-recap:fam1");
  });

  it("SUPPRESSES a guarded test family — never calls the mailer", async () => {
    const out = await sendSignupRecap(fakeDb({ ...realFamily, is_test: true }), base);
    expect(out).toEqual({ status: "suppressed", reason: "test_family", familyId: "fam1" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("SUPPRESSES an unsubscribed family — never calls the mailer", async () => {
    const out = await sendSignupRecap(
      fakeDb({ ...realFamily, consent_revoked_at: "2026-08-01T00:00:00Z" }),
      base
    );
    expect(out).toEqual({ status: "suppressed", reason: "unsubscribed", familyId: "fam1" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("reports no_family when the parent has no family row, and never mails", async () => {
    const out = await sendSignupRecap(fakeDb(null), base);
    expect(out.status).toBe("no_family");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("does not throw on a lookup error", async () => {
    const out = await sendSignupRecap(fakeDb(null, { error: true }), base);
    expect(out.status).toBe("error");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("is NON-FATAL on a mailer failure — returns send_failed, never throws (child route stays 200)", async () => {
    // The child route awaits this in a try/catch and only logs on a non-sent,
    // non-suppressed status; a send_failed must be a clean typed return (not a
    // throw) so the already-minted, playable child still yields a 200.
    sendEmailMock.mockResolvedValueOnce({ ok: false as const, error: "resend 503" });
    const out = await sendSignupRecap(fakeDb(realFamily), base);
    expect(out).toEqual({ status: "send_failed", error: "resend 503" });
    expect(sendEmailMock).toHaveBeenCalledOnce();
  });
});

describe("sendLoginCodeEmail suppression (fpv03 U3c)", () => {
  // The pure rendered artifact is pinned by login-code-email.test.ts; here we
  // prove the SUPPRESSION GATE is actually enforced in the impure send — the
  // login-code route must be unable to mail a suppressed family even though it
  // never reasons about suppression itself.
  const base = { parentId: "u1", childFirstName: "Remi", code: "123456" };

  it("sends to a real, subscribed family — the code rides the mail, no unsubscribe footer, no idempotency key", async () => {
    const out = await sendLoginCodeEmail(fakeDb(realFamily), base);
    expect(out).toEqual({ status: "sent", familyId: "fam1" });
    expect(sendEmailMock).toHaveBeenCalledOnce();
    const arg = (sendEmailMock.mock.calls[0] as unknown[])[0] as {
      to: string;
      html: string;
      emailHeaders?: Record<string, string>;
      idempotencyKey?: string;
    };
    expect(arg.to).toBe("parent@example.com");
    expect(arg.html).toContain("123456");
    // Transactional safety notice: NOT a marketing send — no list-unsubscribe
    // header and, deliberately, NO idempotency key (each request mints a fresh
    // code, so a retry is a NEW email by design).
    expect(arg.emailHeaders).toBeUndefined();
    expect(arg.idempotencyKey).toBeUndefined();
  });

  it("SUPPRESSES a guarded test family — never calls the mailer", async () => {
    const out = await sendLoginCodeEmail(fakeDb({ ...realFamily, is_test: true }), base);
    expect(out).toEqual({ status: "suppressed", reason: "test_family", familyId: "fam1" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("SUPPRESSES an unsubscribed family — never calls the mailer", async () => {
    const out = await sendLoginCodeEmail(
      fakeDb({ ...realFamily, consent_revoked_at: "2026-08-01T00:00:00Z" }),
      base
    );
    expect(out).toEqual({ status: "suppressed", reason: "unsubscribed", familyId: "fam1" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("reports no_family when the parent has no family row, and never mails", async () => {
    const out = await sendLoginCodeEmail(fakeDb(null), base);
    expect(out.status).toBe("no_family");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("returns error (never throws) on a family lookup error, and never mails", async () => {
    const out = await sendLoginCodeEmail(fakeDb(null, { error: true }), base);
    expect(out.status).toBe("error");
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("reports send_failed on a mailer failure, never throwing", async () => {
    sendEmailMock.mockResolvedValueOnce({ ok: false as const, error: "resend 503" });
    const out = await sendLoginCodeEmail(fakeDb(realFamily), base);
    expect(out).toEqual({ status: "send_failed", error: "resend 503" });
    expect(sendEmailMock).toHaveBeenCalledOnce();
  });

  it("swallows a THROWN mailer error into a clean typed error (never logs the code)", async () => {
    sendEmailMock.mockRejectedValueOnce(new Error("network down"));
    const out = await sendLoginCodeEmail(fakeDb(realFamily), base);
    expect(out).toEqual({ status: "error", error: "login-code send threw" });
  });
});

describe("sendProgressDigest suppression + selection", () => {
  const base = {
    parentId: "u1",
    children: [{ firstName: "Kai", tasksCompleted: 2, criteriaPassed: 1 }],
    signInUrl: "https://firstprofit.school",
  };

  it("sends when there is progress to a real family", async () => {
    const out = await sendProgressDigest(fakeDb(realFamily), base);
    expect(out.status).toBe("sent");
    expect(sendEmailMock).toHaveBeenCalledOnce();
  });

  it("does not send (or even look up the family) when there is no progress", async () => {
    const spyDb = fakeDb(realFamily);
    const fromSpy = vi.spyOn(spyDb as unknown as { from: () => unknown }, "from");
    const out = await sendProgressDigest(spyDb, {
      ...base,
      children: [{ firstName: "Kai", tasksCompleted: 0, criteriaPassed: 0 }],
    });
    expect(out.status).toBe("suppressed");
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(fromSpy).not.toHaveBeenCalled();
  });

  it("SUPPRESSES a test family even with progress — never mails", async () => {
    const out = await sendProgressDigest(fakeDb({ ...realFamily, is_test: true }), base);
    expect(out).toMatchObject({ status: "suppressed", reason: "test_family" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("SUPPRESSES an unsubscribed family even with progress — never mails", async () => {
    const out = await sendProgressDigest(
      fakeDb({ ...realFamily, consent_revoked_at: "2026-08-01T00:00:00Z" }),
      base
    );
    expect(out).toMatchObject({ status: "suppressed", reason: "unsubscribed" });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});
