"use client";

import { useState } from "react";
import {
  captureChildConsentAction,
  resetKidPasswordAction,
  revokeChildConsentAction,
} from "@/app/lib/v3-signup/actions/kid-credentials";
import type { Child } from "./data";

/**
 * The policy bundle, handed DOWN from the server page.
 *
 * ⚠ IT IS A PROP, NOT AN IMPORT, AND THAT IS NOT A STYLE CHOICE.
 * `app/api/fp/signup/consent-rules.ts` imports `node:crypto` at module scope,
 * so importing it from a `"use client"` file would drag Node's crypto into the
 * browser bundle and break the build. Passing the trio down also keeps the
 * bind-to-rendered property exact: the text this component RENDERS and the hash
 * it ECHOES come from the same object, computed once on the server, so they
 * cannot describe two different strings.
 */
export type ConsentPolicyBundle = { version: string; hash: string; text: string };

/**
 * WHICH PHOTO-PERMISSION AFFORDANCE THIS PANEL OFFERS — a pure function, and
 * exported, so the one branch that matters most is executable in a node-env
 * test (v3 Unit 8 review, FIX 5b; this repo has no DOM test environment).
 *
 * ⚠ `null` IS NOT "CLOSED". It means the server's consent read FAILED this page
 * load. Offering "give permission" to a family who already consented, or
 * "withdraw" to one who never did, are both worse than offering nothing until
 * the next load — so `null` gets an explanatory line and NEITHER button.
 */
export type PhotoAffordance = "unknown" | "withdraw" | "give";

export const photoAffordance = (consentOpen: boolean | null): PhotoAffordance =>
  consentOpen === null ? "unknown" : consentOpen ? "withdraw" : "give";

/**
 * PER-KID CREDENTIALS + PHOTO PERMISSION (plan Unit 8). LAYOUT ONLY — every
 * decision (who owns this child, whether the password is acceptable, whether the
 * consent echo binds) belongs to the actions and their cores.
 *
 * ── WHY THE DASHBOARD IS THE ONLY RECOVERY PATH ──
 * A child's login is a non-deliverable `students.the120.invalid` address, so
 * there is no inbox to mail a reset link to. The account-ready screen shows the
 * password exactly once. If that tab closes, THIS panel is the whole recovery
 * story — which is why it ships in the same build as the flow that creates the
 * credential rather than after it.
 *
 * ── THE CONSENT ECHO ──
 * The checkbox does not send a boolean. It sends the policy VERSION and the
 * HASH OF THE TEXT RENDERED BELOW, and the server refuses anything that does not
 * bind to what it currently renders. The hash is computed from the same constant
 * this component displays, so a stale bundle after a policy deploy is refused
 * rather than silently recorded as consent to text nobody read.
 *
 * Mobile-first: one column, 44px controls, nothing wider than its card.
 */
export default function KidCredentials({
  child,
  /** null = the consent read failed this page load; offer neither affordance. */
  photoConsentOpen,
  policy,
  /** TEST-ONLY seam. This repo's vitest renders with `renderToStaticMarkup`,
   *  which captures only the FIRST render and cannot click — so a render test of
   *  the EXPANDED panel needs the disclosure to start open. Production never
   *  passes it (default false = collapsed, the shipped behaviour). */
  initialOpen = false,
}: {
  child: Child;
  photoConsentOpen: boolean | null;
  policy: ConsentPolicyBundle;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consentOpen, setConsentOpen] = useState(photoConsentOpen);

  const ageBand = ageBandFor(child);

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const res = await resetKidPasswordAction({ childId: child.id, password });
    setBusy(false);
    if (!res.ok) {
      setMessage({ tone: "bad", text: res.message });
      return;
    }
    setPassword("");
    setMessage({
      tone: "ok",
      text: "New password saved. Write it down somewhere your kid can find it.",
    });
  };

  const giveConsent = async () => {
    setBusy(true);
    setMessage(null);
    const res = await captureChildConsentAction({
      childId: child.id,
      consentVersion: policy.version,
      // The hash OF THE TEXT THIS COMPONENT RENDERED — the bind-to-rendered
      // proof. The server recomputes its own and refuses a mismatch.
      consentHash: policy.hash,
      childAgeBand: ageBand,
    });
    setBusy(false);
    if (!res.ok) {
      setMessage({ tone: "bad", text: res.message });
      return;
    }
    setConsentOpen(true);
    setConsentChecked(false);
    setMessage({
      tone: "ok",
      text: "Thank you. Their comic cover can be drawn from inside First Profit now.",
    });
  };

  const withdrawConsent = async () => {
    setBusy(true);
    setMessage(null);
    const res = await revokeChildConsentAction({ childId: child.id });
    setBusy(false);
    if (!res.ok) {
      setMessage({ tone: "bad", text: res.message });
      return;
    }
    setConsentOpen(false);
    setMessage({ tone: "ok", text: "Photo permission withdrawn." });
  };

  const rowClass =
    "inline-flex h-11 items-center justify-center rounded-full border border-hq-border-strong bg-white px-4 font-path-mono text-[0.65rem] uppercase tracking-[0.1em] text-hq-ink transition-colors hover:bg-hq-sunken disabled:cursor-not-allowed disabled:opacity-60";

  return (
    <div className="mt-4 border-t border-hq-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex h-11 w-full items-center justify-between gap-2 text-left font-path-mono text-[0.6rem] uppercase tracking-[0.12em] text-hq-ink-soft hover:text-hq-ink"
      >
        <span>Login &amp; permissions</span>
        <span aria-hidden>{open ? "–" : "+"}</span>
      </button>

      {open && (
        <div className="mt-2">
          <p className="font-path-mono text-[0.6rem] uppercase tracking-[0.1em] text-hq-ink-muted">
            Username
          </p>
          {/* `break-all`: an email-shaped handle is long and must wrap inside a
              390px card rather than pushing the page sideways. */}
          <p className="mt-1 break-all font-path-mono text-sm text-hq-ink">
            {child.fpUsername ?? "Not set up yet"}
          </p>

          {child.fpUsername && (
            <form onSubmit={submitPassword} className="mt-4">
              <label
                htmlFor={`kid-pw-${child.id}`}
                className="block font-path-mono text-[0.6rem] uppercase tracking-[0.1em] text-hq-ink-muted"
              >
                Set a new password
              </label>
              <input
                id={`kid-pw-${child.id}`}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-2 h-11 w-full rounded-xl border border-hq-border bg-white px-3 text-base text-hq-ink outline-none focus:border-hq-ink"
                required
              />
              <button type="submit" disabled={busy} className={`${rowClass} mt-3 w-full`}>
                {busy ? "Saving…" : "Save new password"}
              </button>
            </form>
          )}

          <div className="mt-5">
            <p className="font-path-mono text-[0.6rem] uppercase tracking-[0.1em] text-hq-ink-muted">
              Photo &amp; comic cover
            </p>
            {photoAffordance(consentOpen) === "unknown" ? (
              <p className="mt-2 text-sm leading-6 text-hq-ink-soft">
                We couldn&rsquo;t load this setting just now. Refresh the page to see it.
              </p>
            ) : photoAffordance(consentOpen) === "withdraw" ? (
              <>
                <p className="mt-2 text-sm leading-6 text-hq-ink-soft">
                  You have given permission for {child.firstName || "your child"}&rsquo;s photo to
                  be used to draw their comic cover.
                </p>
                <button
                  type="button"
                  onClick={withdrawConsent}
                  disabled={busy}
                  className={`${rowClass} mt-3 w-full`}
                >
                  {busy ? "Working…" : "Withdraw permission"}
                </button>
              </>
            ) : (
              <>
                <p className="mt-2 whitespace-pre-line text-sm leading-6 text-hq-ink-soft">
                  {policy.text}
                </p>
                <p className="mt-2 font-path-mono text-[0.55rem] uppercase tracking-[0.1em] text-hq-ink-muted">
                  Version {policy.version}
                </p>
                <label className="mt-3 flex items-start gap-3 text-sm leading-6 text-hq-ink-soft">
                  <input
                    type="checkbox"
                    checked={consentChecked}
                    onChange={(e) => setConsentChecked(e.target.checked)}
                    className="mt-1 h-5 w-5 flex-none"
                  />
                  <span>I have read and agree to the above.</span>
                </label>
                <button
                  type="button"
                  onClick={giveConsent}
                  disabled={busy || !consentChecked}
                  className={`${rowClass} mt-3 w-full`}
                >
                  {busy ? "Working…" : "Give permission"}
                </button>
              </>
            )}
          </div>

          {message && (
            <p
              className={`mt-3 text-sm leading-6 ${
                message.tone === "ok" ? "text-verified" : "text-red"
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * The consent record's age band, from the child's GRADE — the only age signal a
 * pre-v3 roster row carries (v3 collects an age; v2 collected a grade).
 * Deliberately conservative: an unknown grade records `under_13`, the band with
 * the STRICTEST obligations, because over-protecting a 16-year-old costs nothing
 * and under-protecting a 10-year-old is a compliance failure.
 *
 * ⚠ MUST AGREE WITH `ageBandForGrade` in app/lib/funnel/consent-wall-rules.ts
 * for EVERY grade — not "roughly", exactly. The two write the same NOT NULL
 * column of the same legal-evidence table from the same signal, and a
 * disagreement means the band on a child's record depends on which screen the
 * parent happened to consent from. They are two functions rather than one
 * because that module is server-side and this one is `"use client"`; the
 * equality is PINNED by a cross-importing test (funnel-consent-wall-rules.test),
 * the same convention `normalizeKidNamePart` follows in flow-rules.test.ts.
 *
 * ⚠ `Number.isFinite`, NOT `typeof === "number"` (review 2026-08-10, P2-e).
 * `NaN` is a number, and `NaN + 5 < 13` is false, and `NaN <= 15` is false — so
 * the naive check fell through to `16_plus`, the LEAST protective band, for the
 * one input that means "we do not know". The conservative answer wins.
 */
export function ageBandFor(child: Child): "under_13" | "13_to_15" | "16_plus" {
  if (typeof child.grade !== "number" || !Number.isFinite(child.grade)) return "under_13";
  // Canadian grade → typical age is grade + 5.
  const age = child.grade + 5;
  if (age < 13) return "under_13";
  if (age <= 15) return "13_to_15";
  return "16_plus";
}
