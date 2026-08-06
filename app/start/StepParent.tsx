"use client";

/**
 * Step 1 — the parent: name, email, password, the account-terms affirmation, and
 * then the INLINE 6-digit code, on the same screen (R1/R2). No email round trip
 * to a link, no second page: the parent types the code where they are.
 *
 * ── WHAT THIS SCREEN KNOWS ABOUT THE BACKEND CONTRACT ──
 * Unit 2's security fix means there is NO attempt id on the wire. Verify, resend
 * and edit-email are all keyed on the EMAIL the parent typed, which this
 * component keeps in state for exactly that reason. It is not a credential and
 * it is not a resume handle — the typed CODE is the only secret in the exchange.
 *
 * Every branch of every result union is rendered, because each one is a family
 * standing in front of a screen (R14):
 *   start   code_sent | existing_account | locked | pending_elsewhere
 *           | retryable | failed
 *   verify  verified | invalid_code | expired | locked | post_verify_failed
 *           | failed
 *   resend  sent | cooldown | locked | failed
 * `post_verify_failed` is the subtle one: the code was SPENT, so the input is
 * deliberately NOT cleared — re-submitting the same code lands on the redeem's
 * `already` branch and recovers end to end. Clearing it would take away the only
 * thing that can finish the signup.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  v3EditEmailAction,
  v3ResendCodeAction,
  v3StartAction,
  v3VerifyCodeAction,
} from "./actions";
import { V3Button, V3Field, V3Notice, V3TextButton, V3_INPUT_CLASSES } from "./v3-ui";

/** Seconds the resend button stays disabled after a send. Mirrors the server's
 *  CAS cooldown; the server is the enforcement, this is only the affordance. */
const RESEND_COOLDOWN_SECONDS = 60;

type Phase = "form" | "code";

export function StepParent({
  consentPolicy,
  onVerified,
}: {
  consentPolicy: { version: string; hash: string; text: string };
  onVerified: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<"info" | "error">("error");
  const [showSignIn, setShowSignIn] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [pending, startTransition] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (phase === "code") codeRef.current?.focus();
  }, [phase]);

  const say = (message: string, tone: "info" | "error" = "error") => {
    setNotice(message);
    setNoticeTone(tone);
  };

  /** Start and edit-email share every outcome, because edit-email IS a start for
   *  the corrected address (Unit 2's non-destructive redesign). */
  const applyStartResult = (kind: string) => {
    setShowSignIn(false);
    switch (kind) {
      case "code_sent":
        setPhase("code");
        setCode("");
        setCooldown(RESEND_COOLDOWN_SECONDS);
        say(`We sent a 6-digit code to ${email}. It expires in 10 minutes.`, "info");
        return;
      case "existing_account":
        setShowSignIn(true);
        say("There is already an account for that email. Sign in instead and we will pick up from there.");
        return;
      case "locked":
        say("Too many wrong codes were tried for that email. Wait a little while, then start again.");
        return;
      case "pending_elsewhere":
        say("There is already a sign-up link waiting in that inbox. Open it to finish, or check back in ten minutes.");
        return;
      case "retryable":
        say("We could not send that code just now. Try again in a moment.");
        return;
      default:
        say("We couldn't complete that just now. Please check your details and try again.");
    }
  };

  const submitForm = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (!accepted) {
      say("Please tick the box to continue.");
      return;
    }
    setNotice(null);
    startTransition(async () => {
      const result = await v3StartAction({
        parentName: name.trim(),
        parentEmail: email.trim(),
        parentPassword: password,
        consentAccepted: true,
      });
      applyStartResult(result.kind);
    });
  };

  const submitCode = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    setNotice(null);
    startTransition(async () => {
      const result = await v3VerifyCodeAction({
        email: email.trim(),
        password,
        code: code.trim(),
      });
      switch (result.kind) {
        case "verified":
          onVerified();
          return;
        case "invalid_code":
          setCode("");
          codeRef.current?.focus();
          say(
            result.guessesRemaining === 1
              ? "That code is not right. One more try before this sign-up locks."
              : `That code is not right. ${result.guessesRemaining} tries left.`
          );
          return;
        case "expired":
          setCode("");
          say("That code has expired. Send a fresh one and try again.");
          return;
        case "locked":
          say("Too many wrong codes. Wait a little while, then start again with the same email.");
          return;
        case "post_verify_failed":
          // The code is SPENT. Keep it in the box — re-submitting recovers.
          say("Your email checked out, but the last step did not finish. Press Continue again to pick it up.");
          return;
        default:
          say("We couldn't complete that just now. Please check your details and try again.");
      }
    });
  };

  const resend = () => {
    if (pending || cooldown > 0) return;
    setNotice(null);
    startTransition(async () => {
      const result = await v3ResendCodeAction({ email: email.trim() });
      switch (result.kind) {
        case "sent":
          setCooldown(RESEND_COOLDOWN_SECONDS);
          say("A fresh code is on its way. The previous one no longer works.", "info");
          return;
        case "cooldown":
          setCooldown(RESEND_COOLDOWN_SECONDS);
          say("A code went out very recently. Give it a minute before asking for another.", "info");
          return;
        case "locked":
          say("Too many wrong codes. A new code will not unlock this sign-up.");
          return;
        default:
          say("We couldn't send that just now. Try again in a moment.");
      }
    });
  };

  /** "Wrong address" — a fresh signup for the corrected email. The old attempt
   *  is deliberately left alone server-side (no unauthenticated delete). */
  const editEmail = () => {
    setPhase("form");
    setCode("");
    say("Fix the address below and we will send a new code.", "info");
  };

  const resubmitCorrectedEmail = (previousEmail: string) => {
    // The SAME guard `submitForm`, `submitCode` and `resend` all open with
    // (review FIX 6). The button's `disabled` attribute is not one: an Enter
    // keypress or a rapid double-activation can land two submits before React
    // re-renders it, and each one is a fresh v3EditEmailAction — two strikes,
    // two codes, two abandoned rows for one user-perceived submit.
    if (pending) return;
    startTransition(async () => {
      const result = await v3EditEmailAction({
        parentName: name.trim(),
        parentEmail: email.trim(),
        parentPassword: password,
        consentAccepted: true,
        previousEmail,
      });
      applyStartResult(result.kind);
    });
  };

  if (phase === "code") {
    return (
      <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
        <p className="v3-label text-v3-one20">Check your inbox</p>
        <h1 className="mt-3 font-path-display text-3xl leading-[1.05] font-black text-v3-ink sm:text-4xl">
          Type the 6-digit code.
        </h1>
        <p className="mt-4 text-base leading-relaxed text-v3-stone">
          We sent it to <span className="font-semibold text-v3-ink">{email}</span>. It expires in
          ten minutes.
        </p>

        <form onSubmit={submitCode} noValidate className="mt-8 space-y-5">
          <V3Field id="v3-code" label="Verification code">
            <input
              ref={codeRef}
              id="v3-code"
              // `text` + inputMode numeric, not type=number: a number input on a
              // phone strips leading zeros and offers a spinner, and this code is
              // zero-padded by construction.
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="000000"
              className={`${V3_INPUT_CLASSES} text-center font-path-mono text-2xl tracking-[0.4em]`}
            />
          </V3Field>

          {notice && <V3Notice tone={noticeTone}>{notice}</V3Notice>}

          <V3Button type="submit" disabled={pending || code.trim().length === 0}>
            {pending ? "Checking…" : "Continue"}
          </V3Button>

          <div className="flex flex-col gap-1 pt-2 sm:flex-row sm:items-center sm:gap-5">
            <V3TextButton type="button" onClick={resend} disabled={pending || cooldown > 0}>
              {cooldown > 0 ? `Resend in ${cooldown}s` : "Send a new code"}
            </V3TextButton>
            <V3TextButton type="button" onClick={editEmail} disabled={pending}>
              Use a different email
            </V3TextButton>
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="v3-label text-v3-one20">Welcome from The 120</p>
      <h1 className="mt-3 font-path-display text-4xl leading-[1.05] font-black text-v3-ink sm:text-5xl">
        Start your kid&rsquo;s first business.
      </h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-v3-stone">
        First Profit turns starting a real, tiny business into a guided graphic novel. It begins
        with one page &mdash; theirs. This part is yours: it takes a minute.
      </p>

      <form
        onSubmit={(e) => {
          // A corrected address after "Use a different email" goes through the
          // edit-email action so the abandoned attempt is logged for ops.
          if (notice?.startsWith("Fix the address")) {
            e.preventDefault();
            resubmitCorrectedEmail(email.trim());
            return;
          }
          submitForm(e);
        }}
        noValidate
        className="mt-8 space-y-5"
      >
        <V3Field id="v3-parent-name" label="Your name">
          <input
            id="v3-parent-name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex Newal"
            className={V3_INPUT_CLASSES}
          />
        </V3Field>

        <V3Field id="v3-parent-email" label="Your email">
          <input
            id="v3-parent-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className={V3_INPUT_CLASSES}
          />
        </V3Field>

        <V3Field
          id="v3-parent-password"
          label="Choose a password"
          hint="At least 8 characters. You will use this to sign in later."
        >
          <input
            id="v3-parent-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={V3_INPUT_CLASSES}
          />
        </V3Field>

        <label className="flex items-start gap-3 rounded-2xl border border-v3-ink/10 bg-white/70 p-4">
          <input
            type="checkbox"
            checked={accepted}
            onChange={(e) => setAccepted(e.target.checked)}
            className="mt-1 h-5 w-5 flex-none accent-v3-profit"
          />
          <span className="text-sm leading-relaxed text-v3-stone">
            I am the parent or guardian, I am at least 18, and I agree to The 120&rsquo;s terms for
            this account. The full consent notice comes next, before we create your kid&rsquo;s
            account.
            <span className="v3-label mt-1 block text-v3-stone/70">
              Notice version {consentPolicy.version}
            </span>
          </span>
        </label>

        {notice && <V3Notice tone={noticeTone}>{notice}</V3Notice>}
        {showSignIn && (
          <Link
            href="/dashboard"
            className="v3-label inline-flex min-h-[44px] items-center text-v3-profit underline underline-offset-4"
          >
            Go to sign in
          </Link>
        )}

        <V3Button type="submit" disabled={pending}>
          {pending ? "Sending…" : "Email me a code"}
        </V3Button>
      </form>
    </section>
  );
}
