"use client";

/**
 * The redeem control (funnel U3). One button; redemption happens on the
 * POSTed Server Action, never on load (R7a). The four non-ready states
 * mirror `resumeVerdict`'s reasons; `expired` carries the resend affordance
 * (R7: not a dead end), whose address comes from the token row server-side —
 * this form never collects an email, so it cannot become an enumeration
 * surface.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  redeemResumeTokenAction,
  resendFromExpiredTokenAction,
} from "@/app/lib/funnel/actions/resume";

type ViewState = "ready" | "not_found" | "expired" | "redeemed" | "error" | "resent";

export function ResumeForm({
  token,
  initialState,
}: {
  token: string;
  initialState: "ready" | "not_found" | "expired" | "redeemed";
}) {
  const [state, setState] = useState<ViewState>(initialState);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const redeem = () =>
    startTransition(async () => {
      const result = await redeemResumeTokenAction({ token });
      if (result.success) {
        router.push(result.destination);
        return;
      }
      setState(
        result.state === "invalid" ? "not_found"
        : result.state === "expired" ? "expired"
        : result.state === "redeemed" ? "redeemed"
        : "error"
      );
    });

  const resend = () =>
    startTransition(async () => {
      await resendFromExpiredTokenAction({ token });
      setState("resent");
    });

  if (state === "ready") {
    return (
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold text-ink">Welcome back.</h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          Pick up your application right where you left off.
        </p>
        <button
          onClick={redeem}
          disabled={pending}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Opening…" : "Continue your application"}
        </button>
      </div>
    );
  }

  if (state === "expired") {
    return (
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold text-ink">This link has expired.</h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          Links last an hour. We can send a fresh one to the same address.
        </p>
        <button
          onClick={resend}
          disabled={pending}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-full bg-ink px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white disabled:cursor-wait disabled:opacity-60"
        >
          {pending ? "Sending…" : "Send a fresh link"}
        </button>
      </div>
    );
  }

  if (state === "resent") {
    return (
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold text-ink">Check your email.</h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          If that address has an application with us, a fresh link is on its way.
        </p>
      </div>
    );
  }

  if (state === "redeemed") {
    return (
      <div className="text-center">
        <h1 className="font-display text-2xl font-bold text-ink">
          This link was already used.
        </h1>
        <p className="mt-2 text-sm leading-6 text-ink-soft">
          Each link works once. If that wasn&apos;t you, we can email you a fresh one.
        </p>
        <StartOver />
      </div>
    );
  }

  return (
    <div className="text-center">
      <h1 className="font-display text-2xl font-bold text-ink">
        {state === "error" ? "Something went wrong." : "This link isn't valid."}
      </h1>
      <p className="mt-2 text-sm leading-6 text-ink-soft">
        {state === "error"
          ? "Give it a minute and try the link again — your link is still good."
          : "Check that the whole link copied over, or ask us for a fresh one."}
      </p>
      <StartOver />
    </div>
  );
}

/**
 * Every dead-end state gets a real way out. The prose used to point at "the
 * application page" without linking it, which is a dead end with directions
 * (adversarial review) — and the error state must not strand a family whose
 * link is in fact still valid, because a failed mint hands its claim back.
 */
function StartOver() {
  return (
    <p className="mt-6">
      <Link
        href="/start"
        className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-red underline underline-offset-4"
      >
        Go to the application →
      </Link>
    </p>
  );
}
