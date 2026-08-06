import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Same mailer mock shape as app/lib/fp/parent-email/__tests__/send.test.ts, so
// the payload handed to the transactional sender can be inspected directly.
type SentEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
  idempotencyKey?: string;
};

const { sendEmailMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(
    async (_opts: {
      to: string;
      subject: string;
      html: string;
      text: string;
      idempotencyKey?: string;
    }): Promise<{ ok: boolean; error?: string }> => ({ ok: true })
  ),
}));
vi.mock("@/app/lib/email", () => ({ sendEmail: sendEmailMock }));

import { sendNurtureEmail } from "../send-nurture";

process.env.UNSUBSCRIBE_SECRET ||= "test-unsub-secret";

const email = { subject: "Subject", html: "<p>Body</p>", text: "Body" };

beforeEach(() => sendEmailMock.mockClear());
afterEach(() => vi.clearAllMocks());

const sent = (): SentEmail[] => sendEmailMock.mock.calls.map((c) => c[0]);
const payload = (): SentEmail => {
  const [first] = sent();
  if (!first) throw new Error("sendEmail was never called");
  return first;
};

/**
 * The idempotency key is what makes the one-shot v3 launch campaign safe to
 * re-run after a crash. Until now it was pinned only as source text in the
 * script's own test ("the script passes launchIdempotencyKey(...)"), which
 * cannot see whether the parameter actually reaches the sender — a pin that
 * would stay green if the argument were dropped on the floor here.
 */
describe("sendNurtureEmail idempotency key", () => {
  it("forwards a supplied key to the transactional sender", async () => {
    await sendNurtureEmail("fam-1", "parent@example.com", email, "v3-launch-2026-08:fam-1");
    expect(payload().idempotencyKey).toBe("v3-launch-2026-08:fam-1");
  });

  it("sends no key when the caller supplies none (the recurring cron path)", async () => {
    await sendNurtureEmail("fam-1", "parent@example.com", email);
    expect(payload().idempotencyKey).toBeUndefined();
  });

  it("scopes the key per family, so two families never collide", async () => {
    await sendNurtureEmail("fam-a", "a@example.com", email, "v3-launch-2026-08:fam-a");
    await sendNurtureEmail("fam-b", "b@example.com", email, "v3-launch-2026-08:fam-b");
    expect(new Set(sent().map((e) => e.idempotencyKey)).size).toBe(2);
  });
});

/** The footer is a legal obligation (CASL), so it is asserted here rather than
 *  trusted to every call site — the reason the sender wraps it at all. */
describe("sendNurtureEmail CASL footer", () => {
  it("appends identification and a working unsubscribe link to both parts", async () => {
    await sendNurtureEmail("fam-1", "parent@example.com", email);
    const { text, html } = payload();

    expect(text).toContain("Body");
    expect(text).toContain("Unsubscribe: ");
    expect(text).toContain("the120.school");
    expect(html).toContain("<p>Body</p>");
    expect(html).toContain(">Unsubscribe</a>");
  });

  it("carries a family-scoped unsubscribe link, not a shared one", async () => {
    await sendNurtureEmail("fam-a", "a@example.com", email);
    await sendNurtureEmail("fam-b", "b@example.com", email);
    const [a, b] = sent();
    const link = (t: string) => t.slice(t.indexOf("Unsubscribe: "));
    expect(a && b).toBeTruthy();
    expect(link(a!.text)).not.toBe(link(b!.text));
  });
});
