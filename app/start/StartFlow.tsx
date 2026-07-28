"use client";

/**
 * The `/start` flow (funnel U6; R28–R30a, R32): three explainer swipes, then
 * capture. Every decision it renders comes from `capture-rules.ts` — the
 * percentages, the field errors, the consent text and version. This component
 * owns layout and nothing else, because `environment: "node"` cannot test it.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { captureAction } from "@/app/lib/funnel/actions/capture";
import {
  CAPTURE_FIELD_MESSAGES,
  CASL_CONSENT_TEXT,
  EXPLAINER_STEPS,
  captureFieldErrors,
  progressPercent,
  type CaptureFieldError,
  type ProgressStep,
} from "@/app/lib/funnel/capture-rules";

const EXPLAINER_COPY = [
  {
    kicker: "STEP ONE",
    headline: "Your kid picks something they actually care about.",
    body: "Sport, a company, art, ideas, service — whichever door they walk through, the work is theirs.",
  },
  {
    kicker: "STEP TWO",
    headline: "They design a real business around it, in ten minutes.",
    body: "Not a worksheet. A name, an offer, a first customer, and the first three things to do about it.",
  },
  {
    kicker: "STEP THREE",
    headline: "You see where it goes.",
    body: "A picture of the same child months from now, having sold something real to a stranger.",
  },
] as const;

type Stage = 0 | 1 | 2 | 3;

/**
 * `group` is deliberately NOT a prop yet. `/start` reads `?g=` (Decision 4 —
 * this is the only route that may), but nothing consumes it until U7's Add a
 * Child pre-selects the door. Passing it now would be an unused prop that
 * reads like wiring; U7 adds it back with its consumer.
 */
export function StartFlow({ source }: { source?: string }) {
  const [stage, setStage] = useState<Stage>(0);
  const [fields, setFields] = useState({
    firstName: "",
    lastName: "",
    email: "",
    consentTicked: false,
  });
  const [errors, setErrors] = useState<CaptureFieldError[]>([]);
  const [outcome, setOutcome] = useState<null | "existing" | "limited" | "failed">(null);
  const [pending, startTransition] = useTransition();

  // Narrowed once, so the three explainer slides and the capture screen are
  // genuinely exclusive to the compiler rather than by convention.
  const explainer = stage === 3 ? null : EXPLAINER_COPY[stage];
  const step: ProgressStep = stage === 3 ? "capture" : EXPLAINER_STEPS[stage];
  const percent = progressPercent(step);

  const submit = () => {
    const found = captureFieldErrors(fields);
    setErrors(found);
    if (found.length > 0) return;
    setOutcome(null);
    startTransition(async () => {
      const result = await captureAction({ ...fields, source });
      if (result.kind === "captured") {
        // The session is live; Add a Child is next (U7). A full navigation
        // rather than a router push: the session cookie was just set by the
        // Server Action, and the destination is a server-rendered route that
        // must read it.
        window.location.assign("/start/children");
        return;
      }
      if (result.kind === "invalid") {
        setErrors(result.fields);
        return;
      }
      setOutcome(
        result.kind === "existing_account" ? "existing"
        : result.kind === "rate_limited" ? "limited"
        : "failed"
      );
    });
  };

  return (
    <main className="mx-auto flex min-h-[80vh] w-full max-w-lg flex-col justify-center px-6 py-16">
      {/* R32: the progress bar runs from the first explainer through submission. */}
      <div className="mb-10" aria-hidden>
        <div className="h-1 w-full overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-red transition-[width] duration-300"
            style={{ width: `${percent}%` }}
          />
        </div>
        <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
          {percent}% · Application
        </p>
      </div>

      {explainer ? (
        <section>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-red">
            {explainer.kicker}
          </p>
          <h1 className="mt-3 font-display text-3xl leading-tight text-ink">
            {explainer.headline}
          </h1>
          <p className="mt-4 text-base leading-7 text-ink-soft">{explainer.body}</p>
          <button
            onClick={() => setStage((s) => (s + 1) as Stage)}
            className="mt-8 inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
          >
            {stage === 2 ? "Start Here →" : "Next →"}
          </button>
        </section>
      ) : (
        <section>
          <h1 className="font-display text-3xl leading-tight text-ink">
            Where should we send it?
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-soft">
            So you can pick this up on any device, and see what your child builds.
          </p>

          <div className="mt-7 flex flex-col gap-4">
            <Field
              label="Your first name"
              value={fields.firstName}
              error={errors.includes("first_name") ? CAPTURE_FIELD_MESSAGES.first_name : null}
              onChange={(v) => setFields((f) => ({ ...f, firstName: v }))}
              autoComplete="given-name"
            />
            <Field
              label="Your last name"
              value={fields.lastName}
              error={errors.includes("last_name") ? CAPTURE_FIELD_MESSAGES.last_name : null}
              onChange={(v) => setFields((f) => ({ ...f, lastName: v }))}
              autoComplete="family-name"
            />
            <Field
              label="Your email"
              type="email"
              value={fields.email}
              error={errors.includes("email") ? CAPTURE_FIELD_MESSAGES.email : null}
              onChange={(v) => setFields((f) => ({ ...f, email: v }))}
              autoComplete="email"
            />

            {/* F6/R30a: explicit, UNTICKED, and submitting without it succeeds —
                consent cannot be a condition of applying. */}
            <label className="mt-1 flex cursor-pointer items-start gap-3 text-[13px] leading-6 text-ink-soft">
              <input
                type="checkbox"
                checked={fields.consentTicked}
                onChange={(e) =>
                  setFields((f) => ({ ...f, consentTicked: e.target.checked }))
                }
                className="mt-1 h-4 w-4 flex-shrink-0 accent-red"
              />
              <span>{CASL_CONSENT_TEXT}</span>
            </label>
          </div>

          {outcome === "existing" && (
            <p className="mt-5 rounded-xl border border-line bg-white p-4 text-sm leading-6 text-ink-soft">
              You already have an application with us.{" "}
              <Link href="/dashboard" className="text-red underline underline-offset-4">
                Sign in
              </Link>{" "}
              — or we can email you a link back in.
            </p>
          )}
          {outcome === "limited" && (
            // A shared network (school, library, siblings behind one router)
            // can hit the per-IP bound, and a returning family would otherwise
            // never learn they already have an account. Always offer the door
            // the old modal always offered.
            <p className="mt-5 text-sm leading-6 text-ink-soft">
              That&apos;s a few tries in a short window — give it a couple of minutes.
              Already have an application?{" "}
              <Link href="/dashboard" className="text-red underline underline-offset-4">
                Sign in
              </Link>
              .
            </p>
          )}
          {outcome === "failed" && (
            <p className="mt-5 text-sm leading-6 text-ink-soft">
              Something went wrong on our end. Try that again in a moment.
            </p>
          )}

          <button
            onClick={submit}
            disabled={pending}
            className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "One moment…" : "Start Here →"}
          </button>
        </section>
      )}
    </main>
  );
}

function Field({
  label,
  value,
  onChange,
  error,
  type = "text",
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  error: string | null;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted">
        {label}
      </span>
      <input
        type={type}
        value={value}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={error ? true : undefined}
        className="h-11 rounded-xl border border-line bg-white px-3.5 text-[15px] text-ink outline-none focus:border-ink"
      />
      {error && <span className="text-[12px] leading-5 text-red">{error}</span>}
    </label>
  );
}
