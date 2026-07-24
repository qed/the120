"use client";

/**
 * Onboarding — add a founder (T1 Unit 15; handoff scene 2, copy verbatim where
 * it fits the built reality). THE ENROLLED-FAMILY PATH IS PRIMARY and the
 * handoff does not design it: R31 links an EXISTING public.children row —
 * authoritative for name and grade, band DERIVED and shown confirm-not-choose.
 * The handoff's "name field + three band cards" create scene is the FALLBACK
 * when nothing is linkable, reshaped to ask for a GRADE (the roster truth the
 * band derives from) rather than letting a band be chosen directly — a chosen
 * band with no grade would leave a null-grade roster row provisioning must
 * refuse.
 *
 * Steps: welcome (first visit only, scene 1 verbatim) → pick (link list or
 * create form; band card rendered as CONFIRMATION) → password (net-new — the
 * handoff has no auth; students sign in name+password, R29 floor server-side)
 * → ready (scene 4, "can never mark their own work done" verbatim).
 *
 * The handoff's skin-choice step is CUT for T1: there is no persisted skin —
 * the shell derives it from band (Trail for 3–5, HQ above), and the toggle is
 * T2. The band card's "default: Trail/HQ" pill still tells the parent what
 * view their child gets.
 *
 * Every awaited action: try/catch/finally + unwrapActionResult (the Unit 6/14
 * carry-forwards this surface consumes).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/fp/components/system/Button";
import { cn } from "@/app/fp/components/system/cn";
import { phaseColor } from "@/app/fp/components/system/phases";
import type { PhaseKey } from "@/app/fp/content/types";
import { unwrapActionResult } from "@/app/fp/lib/now-card-rules";
import {
  BAND_CARDS,
  bandCardFor,
  bandVerdictForGrade,
  type LinkableFounder,
} from "@/app/fp/lib/onboarding-rules";
import { provisionStudentAction } from "@/app/fp/lib/actions/provision";
import { createFounderAction } from "@/app/fp/lib/actions/onboarding";

const PHASE_DOTS: PhaseKey[] = ["SELL", "BUILD", "VALIDATE", "GROW", "SCALE"];

type Step = "welcome" | "pick" | "password" | "ready";

export function AddFounder({
  familyId,
  founders,
  initialMode,
  canCreate,
  showWelcome,
}: {
  familyId: string;
  founders: readonly LinkableFounder[];
  /** The pure link-vs-create resolution, computed server-side. */
  initialMode: "link" | "create";
  /** The create path needs the caller's public.parents row (FK). */
  canCreate: boolean;
  /** First visit (no provisioned founder yet) opens on the welcome scene. */
  showWelcome: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(showWelcome ? "welcome" : "pick");
  const [mode, setMode] = useState<"link" | "create">(initialMode);

  // Link path: the picked roster child.
  const [pickedChildId, setPickedChildId] = useState<string | null>(null);
  // Create path: the typed founder.
  const [firstName, setFirstName] = useState("");
  const [gradeText, setGradeText] = useState("");

  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [readyName, setReadyName] = useState("");

  const linkable = founders.filter((f) => f.kind === "linkable");
  const needsGrade = founders.filter((f) => f.kind === "needs_grade");
  const provisioned = founders.filter((f) => f.kind === "provisioned");

  const picked = linkable.find((f) => f.kind === "linkable" && f.childId === pickedChildId) as
    | Extract<LinkableFounder, { kind: "linkable" }>
    | undefined;

  const grade = useMemo(() => {
    const n = Number.parseInt(gradeText, 10);
    return Number.isFinite(n) ? n : null;
  }, [gradeText]);
  const createBand = useMemo(() => bandVerdictForGrade(grade), [grade]);

  const pendingName = mode === "link" ? (picked?.firstName ?? "") : firstName.trim();

  const canContinueFromPick =
    mode === "link" ? picked !== undefined : pendingName.length > 0 && createBand.ok;

  const handleProvision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    // Local guards at the point of use — the same invariant the Continue
    // button enforces, re-checked HERE so a future step-flow edit can't turn
    // a stale pick/grade into a runtime throw (Unit 15 review; replaces the
    // previous NonNullable casts).
    if (mode === "link" && !picked) {
      setStep("pick");
      return;
    }
    if (mode === "create" && grade === null) {
      setStep("pick");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = unwrapActionResult(
        mode === "link" && picked
          ? await provisionStudentAction({
              childId: picked.childId,
              familyId,
              password,
            })
          : await createFounderAction({
              familyId,
              firstName: pendingName,
              grade: grade ?? 0, // unreachable: guarded above; zod refuses 0 anyway
              password,
            })
      );
      if (result.ok) {
        setReadyName(pendingName);
        setPassword("");
        setStep("ready");
      } else {
        setError(result.message ?? "Something went wrong — please try again.");
      }
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  };

  const eyebrowCls = "font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted";
  const headingCls = "mt-2 font-path-display text-2xl font-semibold tracking-tight text-hq-ink";
  const inputCls =
    "h-12 w-full rounded-lg border border-hq-border bg-hq-canvas px-3.5 font-path-body text-sm text-hq-ink outline-none placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10";

  /* ── band card, rendered as CONFIRMATION of the derived band ─────────── */
  const bandConfirm = (band: Extract<LinkableFounder, { kind: "linkable" }>["band"]) => {
    const card = bandCardFor(band);
    return (
      <div className="mt-3 rounded-[14px] border-2 border-hq-ink bg-hq-sunken p-3.5">
        <div className="flex items-center justify-between">
          <span className="font-path-body text-[14px] font-semibold text-hq-ink">{card.label}</span>
          <span className="rounded-full border border-hq-border bg-hq-canvas px-2.5 py-0.5 font-path-body text-[11px] font-medium text-hq-ink-soft">
            default: {card.defaultSkinLabel}
          </span>
        </div>
        <p className="mt-1.5 font-path-body text-xs leading-5 text-hq-ink-soft">{card.description}</p>
      </div>
    );
  };

  /* ─────────────────────────────────────────────────────── the steps ───── */

  if (step === "welcome") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-2 text-center">
        <h1 className="font-path-display text-3xl font-semibold tracking-tight text-hq-ink">
          Welcome to First Profit
        </h1>
        <p className="mt-3 max-w-[300px] font-path-body text-sm leading-6 text-hq-ink-soft">
          One app, two skins. 125 real things done in the real world — each verified by a real
          adult, celebrated like it matters.
        </p>
        <div className="mt-6 flex items-center gap-2" aria-hidden>
          {PHASE_DOTS.map((key) => (
            <span
              key={key}
              className="h-[9px] w-[9px] rounded-full"
              style={{ backgroundColor: phaseColor(key) }}
            />
          ))}
        </div>
        <p className={cn(eyebrowCls, "mt-2")}>Sell · Build · Validate · Grow · Scale</p>
        <Button type="button" skin="hq" size="lg" className="mt-8 w-full max-w-xs" onClick={() => setStep("pick")}>
          Set up your family
        </Button>
      </div>
    );
  }

  if (step === "ready") {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-2 text-center">
        <span
          className="flex h-14 w-14 items-center justify-center rounded-full bg-verified/15 text-verified"
          aria-hidden
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <h1 className="mt-4 font-path-display text-3xl font-semibold tracking-tight text-hq-ink">
          {readyName} is ready
        </h1>
        <p className="mt-3 max-w-[300px] font-path-body text-sm leading-6 text-hq-ink-soft">
          Their Founder File is open and empty, waiting for real proof. One rule is on for every
          band: <strong className="text-hq-ink">{readyName} can never mark their own work done</strong> — a
          real adult always verifies.
        </p>
        <p className="mt-3 max-w-[300px] font-path-body text-xs leading-5 text-hq-ink-muted">
          {readyName} signs in on this device or their own with their name and the password you set.
        </p>
        <Button
          type="button"
          skin="hq"
          size="lg"
          className="mt-8 w-full max-w-xs"
          onClick={() => {
            router.push("/fp/family");
            router.refresh();
          }}
        >
          Back to the family dashboard
        </Button>
      </div>
    );
  }

  if (step === "password") {
    return (
      <form className="mx-auto max-w-md pt-6" onSubmit={handleProvision}>
        <p className={eyebrowCls}>Add a founder · their password</p>
        <h1 className={headingCls}>{pendingName}&apos;s password</h1>
        <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
          {pendingName} signs in with their name and this password — no email needed. You can reset
          it from the family dashboard any time.
        </p>
        <label className="mt-5 block" htmlFor="founder-password">
          <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Password
          </span>
          <input
            id="founder-password"
            type="text"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="A few unrelated words work well"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        {error && (
          <p role="alert" className="mt-4 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-xs leading-5 text-hq-ink">
            {error}
          </p>
        )}
        <div className="mt-6 flex gap-2.5">
          <Button
            type="button"
            skin="hq"
            variant="secondary"
            size="lg"
            onClick={() => {
              setStep("pick");
              setError(null);
            }}
            disabled={busy}
          >
            Back
          </Button>
          <Button type="submit" skin="hq" size="lg" className="flex-1" disabled={busy}>
            {busy ? "Creating…" : `Create ${pendingName}'s account`}
          </Button>
        </div>
      </form>
    );
  }

  /* ── step: pick ───────────────────────────────────────────────────────── */
  return (
    <div className="mx-auto max-w-md pt-6">
      <p className={eyebrowCls}>Add a founder</p>
      <h1 className={headingCls}>Who&apos;s starting First Profit?</h1>

      {mode === "link" ? (
        <>
          <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
            Your family&apos;s roster is already here — pick who&apos;s starting. Name and grade
            come from your 120 application; nothing to re-enter.
          </p>
          <div className="mt-4 space-y-2.5">
            {linkable.map((f) =>
              f.kind === "linkable" ? (
                <button
                  key={f.childId}
                  type="button"
                  onClick={() => setPickedChildId(f.childId)}
                  aria-pressed={pickedChildId === f.childId}
                  className={cn(
                    "w-full rounded-[14px] border p-3.5 text-left transition-colors",
                    pickedChildId === f.childId
                      ? "border-2 border-hq-ink bg-hq-sunken"
                      : "border-hq-border bg-hq-canvas hover:border-hq-border-strong"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-path-body text-[14px] font-semibold text-hq-ink">{f.firstName}</span>
                    <span className="font-path-body text-[12px] text-hq-ink-soft">
                      Grade {f.grade} · {bandCardFor(f.band).label}
                    </span>
                  </div>
                </button>
              ) : null
            )}
          </div>

          {picked && (
            <>
              <p className={cn(eyebrowCls, "mt-5")}>Their band — set by their grade</p>
              {bandConfirm(picked.band)}
            </>
          )}

          {needsGrade.length > 0 && (
            <div className="mt-4 space-y-2">
              {needsGrade.map((f) => (
                <p
                  key={f.childId}
                  className="rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-xs leading-5 text-hq-ink"
                >
                  <strong>{f.firstName}</strong> needs a grade on the roster first — set it from
                  your 120 dashboard, then come back. First Profit covers Grades 3–12.
                </p>
              ))}
            </div>
          )}

          {provisioned.length > 0 && (
            <p className="mt-4 font-path-body text-xs leading-5 text-hq-ink-muted">
              Already on First Profit: {provisioned.map((f) => f.firstName).join(", ")}.
            </p>
          )}

          {canCreate && (
            <button
              type="button"
              className="mt-4 font-path-body text-[12px] text-hq-ink-muted underline-offset-2 hover:underline"
              onClick={() => setMode("create")}
            >
              Someone new? Create a founder instead.
            </button>
          )}
        </>
      ) : (
        <>
          <label className="mt-4 block" htmlFor="founder-name">
            <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
              Name
            </span>
            <input
              id="founder-name"
              type="text"
              className={inputCls}
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="First name"
              autoCapitalize="words"
              spellCheck={false}
              required
            />
          </label>

          <label className="mt-4 block" htmlFor="founder-grade">
            <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
              Grade — this sets their band
            </span>
            <select
              id="founder-grade"
              className={cn(inputCls, "appearance-none")}
              value={gradeText}
              onChange={(e) => setGradeText(e.target.value)}
              required
            >
              <option value="" disabled>
                Pick a grade
              </option>
              {Array.from({ length: 10 }, (_, i) => i + 3).map((g) => (
                <option key={g} value={String(g)}>
                  Grade {g}
                </option>
              ))}
            </select>
          </label>

          <div className="mt-4 space-y-2.5">
            {BAND_CARDS.map((card) => {
              const selected = createBand.ok && createBand.band === card.band;
              return (
                <div
                  key={card.band}
                  className={cn(
                    "rounded-[14px] border p-3.5 transition-colors",
                    selected ? "border-2 border-hq-ink bg-hq-sunken" : "border-hq-border bg-hq-canvas opacity-70"
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-path-body text-[14px] font-semibold text-hq-ink">{card.label}</span>
                    <span className="rounded-full border border-hq-border bg-hq-canvas px-2.5 py-0.5 font-path-body text-[11px] font-medium text-hq-ink-soft">
                      default: {card.defaultSkinLabel}
                    </span>
                  </div>
                  <p className="mt-1.5 font-path-body text-xs leading-5 text-hq-ink-soft">{card.description}</p>
                </div>
              );
            })}
          </div>

          {founders.length > 0 && (
            <button
              type="button"
              className="mt-4 font-path-body text-[12px] text-hq-ink-muted underline-offset-2 hover:underline"
              onClick={() => setMode("link")}
            >
              Back to the roster list.
            </button>
          )}
        </>
      )}

      <p className="mt-5 font-path-body text-xs leading-5 text-hq-ink-muted">
        The band sets the default skin and the depth of each task — never the pass bar. A Grade 3
        completion means the same as a Grade 12 one.
      </p>

      <div className="mt-6">
        <Button
          type="button"
          skin="hq"
          size="lg"
          className="w-full"
          disabled={!canContinueFromPick}
          onClick={() => {
            setError(null);
            setStep("password");
          }}
        >
          Continue
        </Button>
      </div>
    </div>
  );
}
