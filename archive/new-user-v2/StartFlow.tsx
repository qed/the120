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
  type CaptureFieldError,
  type ProgressStep,
} from "@/app/lib/funnel/capture-rules";
import { navCardForStep } from "@/app/lib/funnel/nav-card-rules";
import { ProgressNavCard } from "@/app/components/funnel/ProgressNavCard";

/**
 * U10 fidelity (audit items 1 + 4, drift 2a): the eyebrow is ALWAYS
 * "HOW IT WORKS" (R29 and the handoff spec agree), and the titles and
 * bodies are the handoff's EXP array, byte for byte (handoff copy is final).
 */
const EXPLAINER_EYEBROW = "HOW IT WORKS";

const EXPLAINER_COPY = [
  {
    headline: "Your child designs a real business.",
    body: "A guided 10-minute project builder. You can do it together, or hand them the device.",
  },
  {
    headline: "You'll see exactly where it leads.",
    body: "We'll show you their first phase complete, and every step between here and there.",
  },
  {
    headline: "This is the application.",
    body: "What your child builds today carries into the program. Nothing is throwaway.",
  },
] as const;

type Stage = 0 | 1 | 2 | 3;

/**
 * `group` rides through capture to Add a Child and on to the doors (R35/R36 —
 * U8 is its consumer). It is a HINT: never validated here, because doorsModel
 * treats an unknown slug as cold, and dropping it early would kill the
 * pre-selection for the one child it is meant for.
 */
export function StartFlow({ source, group }: { source?: string; group?: string }) {
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
  // `pending` ends the moment the transition callback returns — which is
  // BEFORE the browser finishes the window.location.assign navigation in the
  // captured branch. `navigating` keeps the controls dead for the full
  // lifetime of the redirect so a second submit (duplicate captureAction +
  // duplicate c1 event) or a stage change mid-unload is impossible.
  const [navigating, setNavigating] = useState(false);
  const busy = pending || navigating;

  // Narrowed once, so the three explainer slides and the capture screen are
  // genuinely exclusive to the compiler rather than by convention.
  const explainer = stage === 3 ? null : EXPLAINER_COPY[stage];
  const step: ProgressStep = stage === 3 ? "capture" : EXPLAINER_STEPS[stage];

  const submit = () => {
    const found = captureFieldErrors(fields);
    setErrors(found);
    if (found.length > 0) return;
    setOutcome(null);
    startTransition(async () => {
      const result = await captureAction({ ...fields, source });
      if (result.kind === "captured") {
        setNavigating(true);
        // The session is live; Add a Child is next. A full navigation rather
        // than a router push: the session cookie was just set by the Server
        // Action, and the destination is a server-rendered route that must
        // read it. The `?g=` hint rides along — it dies here or reaches the
        // doors (R36: first child only; the grid enforces that half).
        window.location.assign(
          group ? `/start/children?g=${encodeURIComponent(group)}` : "/start/children"
        );
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

  // U10 fidelity, batch B3 (audit drift 16/X7): the explainer/capture is a
  // marketing-register scene in the handoff — its desktop body is the 960px
  // column (`.fp-appframe.is-desktop .fp-appbody{max-width:960px}`), with
  // the nav card spanning it and the text/form keeping their own 440/430px
  // measures, left-aligned (screenshot 13 + the prototype's inline
  // max-widths). Mobile is untouched below lg.
  return (
    <>
    {/* R32/X1: the floating nav card runs from the first explainer through
        submission. It mounts ABOVE the column (2026-07-30) so it holds the
        home nav's exact full-width geometry. */}
    {/* Pre-auth capture: no logged-in dashboard exists yet, so the logo
        leads home (every signed-in flow surface takes the /dashboard
        default). */}
    <ProgressNavCard model={navCardForStep(step, null)} logoHref="/" />
    <main className="mx-auto flex min-h-[80vh] w-full max-w-lg flex-col justify-center px-6 py-16 lg:max-w-[960px]">

      {/* R5 (reconnect): visible back between swipes. Disabled while a
          transition is pending — a resolving action must never race a
          navigation the user just made (see docs/solutions/ui-bugs/
          a-pending-transitions-resolution-must-not-override-user-navigation-2026-07-29.md). */}
      {stage > 0 ? (
        <button
          onClick={() => {
            // Backing off the capture screen retires its notices — a banner
            // about a submission that predates the navigation must not
            // resurface when the user walks forward again.
            setOutcome(null);
            setErrors([]);
            setStage((s) => (s - 1) as Stage);
          }}
          disabled={busy}
          className="mb-6 inline-flex items-center self-start font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted transition-colors hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
        >
          ← Back
        </button>
      ) : null}

      {explainer ? (
        <section>
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-red">
            {EXPLAINER_EYEBROW}
          </p>
          {/* U10 fidelity (audit drift 12): Georgia display for the funnel's
              application-register headings — `.display`, never `font-display`
              (that token is Space Grotesk, the site body face). */}
          <h1 className="display mt-3 text-3xl text-ink">
            {explainer.headline}
          </h1>
          <p className="mt-4 text-base leading-7 text-ink-soft lg:max-w-[440px]">{explainer.body}</p>
          <button
            onClick={() => setStage((s) => (s + 1) as Stage)}
            className="mt-8 inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
          >
            {/* Spec CTA labels (audit item 4): "Continue" on the first two
                swipes, "Start Building →" into capture. */}
            {stage === 2 ? "Start Building →" : "Continue"}
          </button>
        </section>
      ) : (
        <section>
          <h1 className="display text-3xl text-ink">
            Where should we send it?
          </h1>
          <p className="mt-3 text-base leading-7 text-ink-soft lg:max-w-[430px]">
            So you can pick this up on any device, and see what your child builds.
          </p>

          <div className="mt-7 flex flex-col gap-4 lg:max-w-[430px]">
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
            <p className="mt-5 rounded-xl border border-line bg-white p-4 text-sm leading-6 text-ink-soft lg:max-w-[430px]">
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
            <p className="mt-5 text-sm leading-6 text-ink-soft lg:max-w-[430px]">
              That&apos;s a few tries in a short window — give it a couple of minutes.
              Already have an application?{" "}
              <Link href="/dashboard" className="text-red underline underline-offset-4">
                Sign in
              </Link>
              .
            </p>
          )}
          {outcome === "failed" && (
            <p className="mt-5 text-sm leading-6 text-ink-soft lg:max-w-[430px]">
              Something went wrong on our end. Try that again in a moment.
            </p>
          )}

          {/* Spec capture CTA "Next Step →" with the handoff's disabled
              state: white on #d8d5cf (--color-line-strong), never a faded
              red (audit items 2 + 4). */}
          <button
            onClick={submit}
            disabled={busy}
            className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-wait disabled:bg-line-strong disabled:hover:bg-line-strong lg:max-w-[430px]"
          >
            {pending ? "One moment…" : "Next Step →"}
          </button>
        </section>
      )}
    </main>
    </>
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
