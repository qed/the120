"use client";

/**
 * The merged flow's application-form sections (unified-flow Unit 6; R3, R6,
 * R8) — the five wizard screens PORTED into the mini-app shell, dark behind
 * `MERGED_FLOW_ENABLED`. The fields are the wizard components' fields
 * (app/dashboard/wizard/*, which Unit 9 deletes after this port), adapted to
 * the funnel's write pattern:
 *
 * - SAVE-ON-NEXT through `saveFormStepAction` — never the dashboard store's
 *   debounced full-row upsert (the Unit 3 contract: no cross-step client
 *   draft store). Each section's draft is component state seeded from the
 *   SERVER fields and remounted per step (`key={step}` at the call site), so
 *   draft state is keyed by the server facts it edits (the 2026-07-28
 *   scoped-state learning) and dies once Next persists it.
 * - Every control is pending-guarded through the shell's single
 *   useTransition (`frozen = pending || !editable`); `{kind:"locked"}`
 *   latches through the shell's `lockDiscovered` (the `onLocked` callback),
 *   so a refused write renders the ONE locked notice, never retry copy.
 * - Read-only walks (the dual `mergedLockVerdict`) render the same inputs
 *   disabled under the shell's single locked notice card (the locked
 *   micro-spec — never a per-step invention). The GROUP step alone stays
 *   editable at submitted+ until a paid deposit (`stepEditableInWalk`), and
 *   shows a difference note when the built project's door differs from the
 *   current group (wizard semantics: a group change NEVER resets the
 *   project).
 * - Interests renders on the ACADEMICS section, not Project & interests as
 *   the wizard laid it out: the Unit 5 save schema owns the split (the
 *   academics action carries `interests`; the project action does not), and
 *   one field must have one saving step. The review checklist's jump map
 *   overrides that one label locally for the same reason.
 * - The legacy-subjects prefill is IN-MEMORY only (seeded into the entries
 *   draft): the per-step schema deliberately has no `subjects` writer, so
 *   the old column empties when the dashboard store retires (Unit 9), not
 *   here.
 *
 * Register: these screens render inside the shell's 560px app column
 * (`max-w-xl`, the U10b3 register split) but speak the APPLICATION register
 * — the shell wraps this component in `APPLICATION_REGISTER_CLASSES`, the
 * same nested-register swap the reveal close strip uses. All class strings
 * are complete Tailwind literals (the scanner rule).
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  removeChildAction,
  saveFormStepAction,
  submitApplicationAction,
} from "@/app/lib/funnel/actions/form-steps";
import { askFullCoreAction } from "@/app/lib/funnel/actions/full-core";
import { REVIEW_SCREEN, WAITLIST_SCREEN } from "@/app/lib/funnel/offer-rules";
import {
  checklistChildForFields,
  formStepNumber,
  mergedLockVerdict,
  mergedStepNeighbour,
  stepEditableInWalk,
  terminalTreatment,
  type MergedFlowFacts,
  type MergedFormStep,
  type MergedStep,
} from "@/app/lib/funnel/merged-flow-rules";
import { initialStepForFacts } from "@/app/lib/funnel/miniapp-rules";
import type { MergedFlowFields } from "@/app/lib/funnel/miniapp-core";
import {
  ACADEMIC_PLANS,
  ACADEMIC_SUBJECTS,
  GRADES,
  checklist,
  type Academic,
} from "@/app/dashboard/data";
import {
  birthYearForGrade,
  childEmailPatch,
  stepForChecklistLabel,
} from "@/app/dashboard/wizard-rules";
import { groupBySlug, groups } from "@/app/lib/site";

/* ─────────────── verdict copy (the existing shell patterns) ─────────────── */

const RETRY_COPY = "That didn't save. Give it a second and tap again.";
const SESSION_COPY = "Your session expired. Start again and we'll pick this up.";

/* ─────────────── the ported chrome (complete literals) ─────────────── */

const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue";

const labelCls =
  "mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft";

const inputCls =
  "h-11 w-full rounded-xl border border-line-strong bg-white px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-red disabled:cursor-not-allowed disabled:opacity-60";

const textareaCls =
  "w-full resize-y rounded-xl border border-line-strong bg-white px-3.5 py-3 text-sm leading-6 text-ink outline-none transition-colors placeholder:text-muted focus:border-red disabled:cursor-not-allowed disabled:opacity-60";

const nextBtnCls = `mt-7 inline-flex h-12 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-xs uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`;

/** The terminal's explicit dashboard control (Unit 7, R9a) — the next-steps
 *  final-screen Link idiom (a real navigation, never a form button), in the
 *  review-wait screen's outlined-pill chrome and its exact label. */
const dashboardLinkCls = `mt-7 inline-flex h-11 items-center justify-center self-start rounded-full border border-line-strong px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink transition-colors hover:border-ink ${focusRing}`;

/** The wizard's white card section, ported byte-for-byte (StepSection). */
function StepCard({
  n,
  title,
  hint,
  children,
}: {
  n: string;
  title: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-6 sm:p-7">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-red">{n}</span>
        {/* Georgia 400 display for step headers — `.display`, never
            `font-display` (Space Grotesk), the U10 drift-12 rule. */}
        <h3 className="display text-lg text-ink">{title}</h3>
      </div>
      {hint && <p className="mt-1 text-sm text-ink-soft">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  frozen,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
  frozen: boolean;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={frozen}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    </label>
  );
}

function Area({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
  maxLength,
  frozen,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  maxLength?: number;
  frozen: boolean;
}) {
  return (
    <label className="block">
      <span className={labelCls}>{label}</span>
      <textarea
        value={value}
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={frozen}
        onChange={(e) => onChange(e.target.value)}
        className={textareaCls}
      />
    </label>
  );
}

/* ─────────────── the dispatcher ─────────────── */

export type MergedFormSectionProps = {
  step: MergedFormStep;
  /** Server truth for this render — drafts seed from it, saves verify
   *  against it, and the review checklist reads ONLY it. */
  fields: MergedFlowFields;
  facts: MergedFlowFacts;
  /** `null` = the deposits read failed (fact unknown) — `stepEditableInWalk`
   *  fails closed on a locked walk, so no false group-edit affordance. */
  depositPaid: boolean | null;
  /** The composed project's door (server-loaded), for the group step's
   *  difference note. Null = no composed project. */
  projectGroupSlug: string | null;
  /** The composed business itself (2026-07-30, item 31): the project step
   *  displays its name and blurb. Null = not designed yet. */
  project: { name: string; description: string } | null;
  /** The shell's single useTransition — one pending flag for the walk. */
  pending: boolean;
  run: (task: () => Promise<void>) => void;
  /** The shell's lockDiscovered latch — {kind:"locked"} renders the ONE
   *  locked notice, never retry copy. */
  onLocked: () => void;
  go: (next: MergedStep | null) => void;
  /** Submit landed: the shell navigates to /start/review. */
  onSubmitted: () => void;
};

export function MergedFormSection(props: MergedFormSectionProps) {
  const { step, fields, facts, depositPaid, pending } = props;
  const [notice, setNotice] = useState<string | null>(null);
  const lockVerdict = mergedLockVerdict(facts);
  const editable = stepEditableInWalk(step, lockVerdict, depositPaid);
  // ONE guard for every form control on this screen: an in-flight action or
  // a read-only walk freezes the inputs (the pending-transitions learning +
  // the locked micro-spec). Navigation controls gate on `pending` alone so
  // the read-only review walk keeps moving.
  const frozen = pending || !editable;
  // The frozen BELT for the Save & continue buttons: on an EDITABLE step the
  // button tracks the full frozen guard (so a future widening of `frozen`
  // covers the save path too, not just the inputs); on a read-only step the
  // same button is PURE NAVIGATION ("Continue →" — saveThenGo's !editable
  // branch writes nothing) and must stay live so the R13 review walk can
  // move forward — there it gates on pending alone, like every
  // pure-navigation CTA in the shell.
  const saveFrozen = editable && frozen;
  const next = mergedStepNeighbour(step, "next", facts);

  /**
   * Save-on-Next. The transition's own pending flag resets when this task
   * resolves, and the try/catch guarantees it resolves even when the awaited
   * action REJECTS (network failure) — the frozen-modal learning: nothing
   * may escape and strand the walk mid-pending.
   */
  const saveThenGo = (input: unknown) => {
    if (pending) return;
    if (!editable) {
      // Read-only walk: Next is pure navigation, zero writes.
      props.go(next);
      return;
    }
    setNotice(null);
    props.run(async () => {
      try {
        const result = await saveFormStepAction(input);
        if (result.kind === "saved") {
          props.go(next);
          return;
        }
        if (result.kind === "locked") {
          props.onLocked();
          return;
        }
        setNotice(result.kind === "unauthenticated" ? SESSION_COPY : RETRY_COPY);
      } catch {
        setNotice(RETRY_COPY);
      }
    });
  };

  const submit = () => {
    if (pending) return;
    setNotice(null);
    props.run(async () => {
      try {
        const result = await submitApplicationAction({ childId: fields.id });
        if (result.kind === "submitted") {
          props.onSubmitted();
          return;
        }
        if (result.kind === "locked") {
          props.onLocked();
          return;
        }
        if (result.kind === "incomplete") {
          setNotice("A few items still need finishing before the application can go in.");
          return;
        }
        if (result.kind === "finish_build") {
          props.go(
            initialStepForFacts({
              doorConfirmed: facts.doorConfirmed,
              hasProject: facts.hasProject,
            })
          );
          return;
        }
        setNotice(result.kind === "unauthenticated" ? SESSION_COPY : RETRY_COPY);
      } catch {
        setNotice(RETRY_COPY);
      }
    });
  };

  /**
   * Child removal (the retired StepReview capability, restored): confirm()
   * then act — the quiet-destructive idiom — pending-guarded through the
   * shell's one transition. Success navigates with a FULL load
   * (window.location.assign): this child's flow URL just died, so a client
   * push into the dead route is the wrong tool. The DB delete guard is the
   * guarantee; `refused` renders the admissions off-ramp, never retry copy.
   */
  const remove = () => {
    if (pending) return;
    if (
      !window.confirm(
        `Remove ${fields.firstName.trim() || "this child"}'s application? This cannot be undone.`
      )
    ) {
      return;
    }
    setNotice(null);
    props.run(async () => {
      try {
        const result = await removeChildAction({ childId: fields.id });
        if (result.kind === "removed") {
          window.location.assign("/dashboard");
          return;
        }
        if (result.kind === "refused") {
          setNotice(
            "This application is in review or has a paid deposit. Contact admissions@the120.school to remove it."
          );
          return;
        }
        setNotice(result.kind === "unauthenticated" ? SESSION_COPY : RETRY_COPY);
      } catch {
        setNotice(RETRY_COPY);
      }
    });
  };

  const nextLabel = !editable ? "Continue →" : pending ? "Saving…" : "Save & continue →";

  switch (step) {
    case "basics":
      return (
        <BasicsSection
          fields={fields}
          frozen={frozen}
          saveFrozen={saveFrozen}
          pending={pending}
          notice={notice}
          nextLabel={nextLabel}
          onNext={saveThenGo}
          // The quiet remove control renders on the basics step only, and
          // only while the walk is NOT locked (draft vocabulary, both
          // kinds) — a locked walk's off-ramp is admissions, not a delete.
          canRemove={!lockVerdict}
          onRemove={remove}
        />
      );
    case "group":
      return (
        <GroupSection
          fields={fields}
          frozen={frozen}
          pending={pending}
          editable={editable}
          lockVerdict={lockVerdict}
          projectGroupSlug={props.projectGroupSlug}
          notice={notice}
          nextLabel={nextLabel}
          onNext={saveThenGo}
          onContinue={() => props.go(next)}
        />
      );
    case "academics":
      return (
        <AcademicsSection
          n={formStepNumber(step, facts)}
          fields={fields}
          frozen={frozen}
          saveFrozen={saveFrozen}
          pending={pending}
          notice={notice}
          nextLabel={nextLabel}
          onNext={saveThenGo}
        />
      );
    case "project":
      return (
        <ProjectSection
          n={formStepNumber(step, facts)}
          project={props.project}
          pending={pending}
          notice={notice}
          onContinue={() => props.go(next)}
        />
      );
    case "review":
      return (
        <ReviewSection
          n={formStepNumber(step, facts)}
          fields={fields}
          facts={facts}
          pending={pending}
          notice={notice}
          onJump={props.go}
          onSubmit={submit}
        />
      );
  }
}

/* ─────────────── 01 basics ─────────────── */

function BasicsSection({
  fields,
  frozen,
  saveFrozen,
  pending,
  notice,
  nextLabel,
  onNext,
  canRemove,
  onRemove,
}: {
  fields: MergedFlowFields;
  frozen: boolean;
  saveFrozen: boolean;
  pending: boolean;
  notice: string | null;
  nextLabel: string;
  onNext: (input: unknown) => void;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    firstName: fields.firstName,
    lastName: fields.lastName,
    grade: (fields.grade ?? "") as number | "",
    birthYear: fields.birthYear,
    currentSchool: fields.currentSchool,
    photo: fields.photo,
    childEmail: fields.childEmail,
    childEmailNone: fields.childEmailNone,
  }));
  const set = (patch: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...patch }));
  // A FileReader read is ASYNC: Save & continue racing an in-flight read
  // would persist the draft WITHOUT the photo the family just picked —
  // silently. `photoReading` holds the Next button until onload/onerror
  // resolves (the disabled state is the whole treatment; nothing fancy).
  const [photoReading, setPhotoReading] = useState(false);
  const onPhoto = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    setPhotoReading(true);
    reader.onload = () => {
      set({ photo: String(reader.result) });
      setPhotoReading(false);
    };
    reader.onerror = () => setPhotoReading(false);
    reader.readAsDataURL(file);
  };

  return (
    <StepCard n="01" title="Basics" hint="Who is this candidate for the 120?">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="First name"
          value={draft.firstName}
          onChange={(v) => set({ firstName: v })}
          maxLength={80}
          frozen={frozen}
        />
        <Field
          label="Last name"
          value={draft.lastName}
          onChange={(v) => set({ lastName: v })}
          maxLength={80}
          frozen={frozen}
        />
        <label className="block">
          <span className={labelCls}>Grade (Fall 2026)</span>
          <select
            value={draft.grade}
            disabled={frozen}
            onChange={(e) => {
              const grade = e.target.value ? Number(e.target.value) : ("" as const);
              // R47: birth year auto-calculates from the grade and stays
              // editable — only an EMPTY field is filled, never a typed one.
              set(
                draft.birthYear.trim() === "" && grade !== ""
                  ? { grade, birthYear: birthYearForGrade(grade) }
                  : { grade }
              );
            }}
            className={inputCls}
          >
            <option value="">Select…</option>
            {GRADES.map((g) => (
              <option key={g} value={g}>
                Grade {g}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Birth year"
          value={draft.birthYear}
          onChange={(v) => set({ birthYear: v.replace(/\D/g, "").slice(0, 4) })}
          placeholder="2016"
          frozen={frozen}
        />
        <div className="sm:col-span-2">
          <Field
            label="Current school"
            value={draft.currentSchool}
            onChange={(v) => set({ currentSchool: v })}
            placeholder="Where they go today"
            maxLength={200}
            frozen={frozen}
          />
        </div>
        {/* R48: the child's email, with "Don't have one" recording the flag
            without an address. Deliberately not a checklist item. */}
        <div className="sm:col-span-2">
          <Field
            label="Child's email (optional)"
            value={draft.childEmail}
            onChange={(v) => set(childEmailPatch({ email: v }, draft))}
            placeholder="Their own address, if they have one"
            frozen={frozen}
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={draft.childEmailNone}
              disabled={frozen}
              onChange={(e) => set(childEmailPatch({ none: e.target.checked }, draft))}
              className="h-4 w-4 accent-red"
            />
            Don&apos;t have one
          </label>
        </div>
      </div>

      <div className="mt-4">
        <span className={labelCls}>Photo (optional)</span>
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full border border-line-strong bg-paper-2 text-muted">
            {draft.photo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={draft.photo} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="font-mono text-lg">
                {(draft.firstName[0] || "?").toUpperCase()}
              </span>
            )}
          </div>
          <label className="cursor-pointer rounded-full border border-line-strong px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-ink-soft hover:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue">
            {draft.photo ? "Replace" : "Upload"}
            <input
              type="file"
              accept="image/*"
              disabled={frozen}
              className="sr-only"
              onChange={(e) => onPhoto(e.target.files?.[0])}
            />
          </label>
          {draft.photo && (
            <button
              type="button"
              disabled={frozen}
              onClick={() => set({ photo: null })}
              className={`rounded font-mono text-xs uppercase tracking-[0.1em] text-muted hover:text-red disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
            >
              Remove
            </button>
          )}
        </div>
      </div>

      {notice && (
        <p role="alert" className="mt-4 text-sm text-red">
          {notice}
        </p>
      )}
      <button
        type="button"
        disabled={pending || saveFrozen || photoReading}
        onClick={() =>
          onNext({
            step: "basics",
            childId: fields.id,
            firstName: draft.firstName,
            lastName: draft.lastName,
            grade: draft.grade === "" ? null : draft.grade,
            birthYear: draft.birthYear,
            currentSchool: draft.currentSchool,
            photo: draft.photo,
            childEmail: draft.childEmail,
            childEmailNone: draft.childEmailNone,
          })
        }
        className={nextBtnCls}
      >
        {nextLabel}
      </button>

      {/* The quiet-destructive remove (the retired StepReview's idiom):
          basics only, unlocked walks only — confirm() lives in the
          dispatcher's handler, the act is pending-guarded. */}
      {canRemove && (
        <div className="mt-8 border-t border-line pt-4">
          <button
            type="button"
            disabled={pending}
            onClick={onRemove}
            className={`rounded font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted hover:text-red disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
          >
            Remove this child
          </button>
        </div>
      )}
    </StepCard>
  );
}

/* ─────────────── 02 group ─────────────── */

function GroupSection({
  fields,
  frozen,
  pending,
  editable,
  lockVerdict,
  projectGroupSlug,
  notice,
  nextLabel,
  onNext,
  onContinue,
}: {
  fields: MergedFlowFields;
  frozen: boolean;
  pending: boolean;
  editable: boolean;
  lockVerdict: boolean;
  projectGroupSlug: string | null;
  notice: string | null;
  nextLabel: string;
  onNext: (input: unknown) => void;
  onContinue: () => void;
}) {
  // The draft is the TAP; the server fact stays `fields.groupSlug` until a
  // save lands (compare-against-server-fact — an unchanged pick navigates
  // without writing, mirroring the doors step's unchanged rule).
  const [tapped, setTapped] = useState<string | null>(null);
  const current = tapped ?? fields.groupSlug;

  // Wizard semantics (R8, decided): a group change NEVER resets the project.
  // When a composed project stands behind a DIFFERENT door than the current
  // pick, say so — in the read-only walk this is the difference note; in the
  // post-submit editable window it doubles as the inline change confirmation.
  const differsFromProject =
    projectGroupSlug !== null && current !== null && current !== projectGroupSlug;

  return (
    <StepCard
      n="02"
      title="Group"
      hint="Pick a group that makes sense for your kid. This can be changed at any time."
    >
      <div role="radiogroup" aria-label="Choose a group" className="grid gap-2 sm:grid-cols-2">
        {groups.map((g) => {
          const on = current === g.slug;
          return (
            <div
              key={g.slug}
              className={`rounded-xl border transition-colors ${
                on ? "border-red bg-red/5" : "border-line-strong bg-white"
              }`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={on}
                disabled={frozen}
                onClick={() => setTapped(g.slug)}
                className={`flex w-full items-center justify-between gap-2 rounded-t-xl p-3 text-left disabled:cursor-not-allowed ${focusRing} ${
                  on ? "" : "hover:bg-paper-2"
                }`}
              >
                <span className="min-w-0">
                  <span className="block font-display text-sm font-bold text-ink">{g.name}</span>
                  <span className="block font-mono text-[0.6rem] uppercase tracking-[0.08em] text-muted">
                    {g.category}
                  </span>
                </span>
                <span
                  aria-hidden
                  className={`flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[0.55rem] ${
                    on ? "border-red bg-red text-white" : "border-line-strong text-transparent"
                  }`}
                >
                  ✓
                </span>
              </button>
              {/* Disclosure is a sibling of the radio — reading never selects. */}
              <details className="group border-t border-line/60 px-3">
                <summary
                  className={`cursor-pointer list-none rounded py-1.5 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted hover:text-ink ${focusRing}`}
                >
                  Details{" "}
                  <span aria-hidden className="inline-block transition-transform group-open:rotate-90">
                    ›
                  </span>
                </summary>
                <div className="pb-3">
                  <p className="text-xs font-semibold leading-5 text-ink">{g.blurb}</p>
                  <p className="mt-1.5 text-xs leading-5 text-ink-soft">{g.body}</p>
                </div>
              </details>
            </div>
          );
        })}
      </div>

      {lockVerdict && editable && (
        <p className="mt-3 text-[13px] leading-5 text-ink-soft">
          The group stays editable until a seat deposit is paid.
        </p>
      )}
      {differsFromProject && (
        <p className="mt-3 rounded-xl border border-line bg-paper-2 px-4 py-3 text-[13px] leading-5 text-ink-soft">
          Your child&apos;s built business stays behind the {projectGroupSlug} door.
          Changing the group here updates the application only and never resets
          the project.
        </p>
      )}

      {/* 2026-07-30: the "Not sure which group?" / book-a-call card is
          removed (item 28). */}

      {notice && (
        <p role="alert" className="mt-4 text-sm text-red">
          {notice}
        </p>
      )}
      <button
        type="button"
        disabled={pending || current === null}
        onClick={() =>
          // An unchanged pick is pure navigation — no write, no verdict
          // (the compare-against-server-fact rule).
          current === fields.groupSlug
            ? onContinue()
            : onNext({ step: "group", childId: fields.id, slug: current })
        }
        className={nextBtnCls}
      >
        {nextLabel}
      </button>
    </StepCard>
  );
}

/* ─────────────── 03 academics (+ interests, per the save schema) ─────────────── */

const EMPTY_ENTRY: Academic = { subject: "", plan: "", goal: "" };

const isListedSubject = (s: string) =>
  ACADEMIC_SUBJECTS.includes(s as (typeof ACADEMIC_SUBJECTS)[number]);

function AcademicsSection({
  n,
  fields,
  frozen,
  saveFrozen,
  pending,
  notice,
  nextLabel,
  onNext,
}: {
  /** The per-child "0N" chip (2026-07-30: the build cohort skips group). */
  n: string;
  fields: MergedFlowFields;
  frozen: boolean;
  saveFrozen: boolean;
  pending: boolean;
  notice: string | null;
  nextLabel: string;
  onNext: (input: unknown) => void;
}) {
  // 2026-07-30 (items 29/30): Fast Math and Math are INCLUDED for every
  // builder — preselected, locked; the family picks ONE plan for the pair.
  // The other five subjects are the FULL ACADEMIC CORE: displayed in one
  // card and asked about (email to admissions + CRM note), never picked
  // here. The goal input, the add-another-subject bubble and the interests
  // input are retired.
  const [plan, setPlan] = useState<Academic["plan"]>(
    () => fields.academics.find((a) => a.plan !== "")?.plan ?? ""
  );
  const [askState, setAskState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  useEffect(() => {
    if (askState !== "sent") return;
    // The green toast dissolves after a few seconds.
    const t = setTimeout(() => setAskState("idle"), 4000);
    return () => clearTimeout(t);
  }, [askState]);

  const ask = () => {
    if (askState === "sending") return;
    setAskState("sending");
    void askFullCoreAction({ childId: fields.id })
      .then((result) => setAskState(result.kind === "sent" ? "sent" : "error"))
      .catch(() => setAskState("error"));
  };

  const corePair = ACADEMIC_SUBJECTS.slice(0, 2);
  const fullCore = ACADEMIC_SUBJECTS.slice(2);

  return (
    <StepCard
      n={n}
      title="Academics"
      hint="We help you: Choose a subject (or 2) and a project the next year."
    >
      <div className="space-y-4">
        {/* Line 1: the included pair — preselected, not editable. */}
        <div className="flex flex-wrap items-center gap-2">
          {corePair.map((s) => (
            <span
              key={s}
              aria-disabled
              className="rounded-full border border-red bg-red px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.08em] text-white"
            >
              {s} ✓
            </span>
          ))}
          <span className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
            Included for every builder
          </span>
        </div>

        {/* Line 2: the full academic core — one card, an ask not a pick. */}
        <div className="rounded-xl border border-line bg-paper-2/60 p-4">
          <p className="font-mono text-xs uppercase tracking-[0.08em] text-ink-soft">
            {fullCore.join(" • ")}
          </p>
          <button
            type="button"
            onClick={ask}
            disabled={pending || askState === "sending"}
            className={`mt-3 inline-flex h-10 items-center justify-center rounded-full border border-red bg-white px-5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-red transition-colors hover:bg-red/5 disabled:cursor-wait disabled:opacity-60 ${focusRing}`}
          >
            {askState === "sending" ? "Sending…" : "Ask about the full academic core"}
          </button>
          {askState === "sent" && (
            <p
              role="status"
              className="mt-3 rounded-xl border border-crm-green/40 bg-crm-green/10 px-4 py-2.5 text-sm font-semibold text-crm-green"
            >
              Message sent. We will reach out
            </p>
          )}
          {askState === "error" && (
            <p role="alert" className="mt-3 text-sm text-red">
              That didn&apos;t send. Give it a moment and try again.
            </p>
          )}
        </div>

        {/* The ONE plan for the pair. */}
        <div>
          <span className={labelCls}>The plan</span>
          <div role="radiogroup" aria-label="The plan" className="grid gap-2 sm:grid-cols-3">
            {ACADEMIC_PLANS.map((p) => {
              const on = plan === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={frozen}
                  onClick={() => setPlan(p.id)}
                  className={`rounded-xl border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${
                    on ? "border-red bg-red/5" : "border-line-strong bg-white hover:border-ink"
                  }`}
                >
                  <span className="font-display text-sm font-bold text-ink">{p.label}</span>
                  <p className="mt-1 text-xs leading-5 text-ink-soft">{p.blurb}</p>
                </button>
              );
            })}
          </div>
          {plan === "" && (
            <p className="mt-2 font-mono text-[0.7rem] text-red">Pick a plan for the pair.</p>
          )}
        </div>
      </div>

      {notice && (
        <p role="alert" className="mt-4 text-sm text-red">
          {notice}
        </p>
      )}
      <button
        type="button"
        disabled={pending || saveFrozen}
        onClick={() =>
          onNext({
            step: "academics",
            childId: fields.id,
            // The locked pair, each carrying the ONE plan (goal retired).
            academics: corePair.map((s) => ({ subject: s, plan, goal: "" })),
            // The interests input is retired; the stored value passes
            // through untouched.
            interests: fields.interests,
          })
        }
        className={nextBtnCls}
      >
        {nextLabel}
      </button>
    </StepCard>
  );
}

/* ─────────────── 04 project ─────────────── */

/**
 * Per-group example projects (R12b) — ported with the step. Scholars keep
 * the year-long framing (R13) and never see this block.
 */
const GROUP_PROJECT_EXAMPLES: Record<string, string[]> = {
  athletes: [
    "A season record — every meet and match logged, analyzed, and beaten.",
    "A documented training climb: from today's personal best to a named target, week by week.",
    "A training system your kid designs, follows, and demos to the network.",
  ],
  founders: [
    "A small venture with real customers, real revenue, and lessons learned.",
    "Ten customer interviews, a landing page, and a first sale.",
  ],
  makers: [
    "A short film — written, shot, edited, and premiered.",
    "An album or EP, recorded and released.",
    "An invention portfolio: prototypes built, tested, and documented.",
  ],
  givers: [
    "A neighbourhood service project — planned, run, and measured by your kid.",
    "A community campaign with a public goal and a published result.",
  ],
};

function ProjectSection({
  n,
  project,
  pending,
  notice,
  onContinue,
}: {
  /** The per-child "0N" chip (2026-07-30: the build cohort skips group). */
  n: string;
  project: { name: string; description: string } | null;
  pending: boolean;
  notice: string | null;
  onContinue: () => void;
}) {
  // 2026-07-30 (item 31): this step DISPLAYS the brainstormed business —
  // the example-projects card, the 4–8 week idea input and the portfolio
  // links input are retired. Pure navigation; nothing to save here.
  return (
    <StepCard
      n={n}
      title="Project & interests"
      hint="Thank you and your child for brainstorming a project. The details are below."
    >
      {project && (project.name.trim() !== "" || project.description.trim() !== "") ? (
        <>
          <h4 className="display text-2xl text-ink">
            {project.name.trim() || "Your company"}
          </h4>
          {project.description.trim() !== "" && (
            <p className="mt-2 text-sm leading-6 text-ink-soft">{project.description}</p>
          )}
        </>
      ) : (
        <p className="text-sm leading-6 text-ink-soft">
          Your child&apos;s business appears here once it&apos;s designed in the build steps.
        </p>
      )}

      {notice && (
        <p role="alert" className="mt-4 text-sm text-red">
          {notice}
        </p>
      )}
      <button type="button" disabled={pending} onClick={onContinue} className={nextBtnCls}>
        Continue →
      </button>
    </StepCard>
  );
}

/* ─────────────── 05 review ─────────────── */

/**
 * The jump map: `stepForChecklistLabel` with ONE local override — interests
 * saves (and renders) on the academics section in the merged flow, per the
 * Unit 5 schema split.
 */
function formStepForLabel(label: string): MergedFormStep {
  // 2026-07-30 (item 32): the First Profit row points at the project step,
  // which displays the designed business.
  if (label === "First Profit Idea #1") return "project";
  return stepForChecklistLabel(label);
}

function ReviewSection({
  n,
  fields,
  facts,
  pending,
  notice,
  onJump,
  onSubmit,
}: {
  /** The per-child "0N" chip (2026-07-30: the build cohort skips group). */
  n: string;
  fields: MergedFlowFields;
  facts: MergedFlowFacts;
  pending: boolean;
  notice: string | null;
  onJump: (step: MergedStep) => void;
  onSubmit: () => void;
}) {
  // SERVER truth only: the checklist reads the loaded row, so unsaved
  // keystrokes cannot fake completeness (the submit core applies the same
  // rule server-side — this render is its presentation).
  // 2026-07-30 (item 32): the designed business renders as its own row —
  // "First Profit Idea #1", checked off the hasProject fact.
  const items = [
    ...checklist(checklistChildForFields(fields)),
    { label: "First Profit Idea #1", done: facts.hasProject },
  ];
  const missing = items.filter((i) => !i.done);
  const complete = missing.length === 0;
  const terminal = terminalTreatment(facts);
  // The review→progress forward edge (Unit 7/8 seam): only a next-steps-
  // gated list has a neighbour past review, so this is null everywhere else.
  const next = mergedStepNeighbour("review", "next", facts);

  if (terminal === "finish_build") {
    // C1: `added → submitted` has no legal edge — the review step points at
    // the furthest build step instead of a submit button.
    return (
      <StepCard
        n={n}
        title="Review & submit"
        hint="The application submits once your child's build is finished."
      >
        <p className="text-sm leading-6 text-ink-soft">
          Your child&apos;s business build isn&apos;t finished yet. Finish the build
          first — the application picks up right where it ends.
        </p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            onJump(
              initialStepForFacts({
                doorConfirmed: facts.doorConfirmed,
                hasProject: facts.hasProject,
              })
            )
          }
          className={nextBtnCls}
        >
          Finish the build →
        </button>
      </StepCard>
    );
  }

  if (terminal !== "submit") {
    // Locked walk (unified-flow Unit 7; R9/R9a + the endings map): the
    // flow's END renders by `terminalTreatment` — one closed vocabulary, one
    // arm each, so no cohort reaches a pressable control that does nothing.
    // Every arm keeps the read-only application summary; the ending differs:
    //
    // - under_review → the review-wait screen's status vocabulary
    //   (REVIEW_SCREEN, /start/review's confirmed copy — today's copy makes
    //   no submitted-vs-in_review distinction, so neither does this) with
    //   the EXPLICIT dashboard control and NO forward control: absent, not
    //   disabled (R9a).
    // - waitlisted → the waitlist screen's vocabulary (WAITLIST_SCREEN —
    //   never a payment or reserve CTA, F7), same dashboard control, no
    //   forward.
    // - next_steps → the walk continues FORWARD into the next-steps screens
    //   (Unit 8 renders them; until then the shell's marked stub holds the
    //   step). If the gate did not append the screens (the endings map's
    //   total-coverage arm), the dashboard control renders instead — never
    //   a dead Continue.
    //
    // Back stays live at every terminal: the shell's Back slot sits outside
    // this section, so the read-only walk stays walkable backward.
    const summary = (
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`flex h-4 w-4 flex-none items-center justify-center rounded-full text-[0.6rem] ${
                i.done ? "bg-red text-white" : "border border-line-strong text-transparent"
              }`}
            >
              ✓
            </span>
            <span className={i.done ? "text-muted line-through" : "text-ink-soft"}>
              {i.label}
            </span>
          </li>
        ))}
      </ul>
    );
    const dashboardControl = (
      <Link href="/dashboard" className={dashboardLinkCls}>
        ← Back to the dashboard
      </Link>
    );
    switch (terminal) {
      case "under_review":
        return (
          <StepCard n={n} title={REVIEW_SCREEN.title} hint={REVIEW_SCREEN.kicker}>
            <p className="text-sm leading-6 text-ink-soft">{REVIEW_SCREEN.intro}</p>
            <div className="mt-5">{summary}</div>
            {dashboardControl}
          </StepCard>
        );
      case "waitlisted":
        return (
          <StepCard n={n} title={WAITLIST_SCREEN.title} hint={WAITLIST_SCREEN.kicker}>
            <p className="text-sm leading-6 text-ink-soft">{WAITLIST_SCREEN.intro}</p>
            <p className="mt-2 text-sm leading-6 text-ink-soft">{WAITLIST_SCREEN.footer}</p>
            <div className="mt-5">{summary}</div>
            {dashboardControl}
          </StepCard>
        );
      case "next_steps":
        return (
          <StepCard
            n={n}
            title="Review & submit"
            hint="This application is in. Your next steps are ahead."
          >
            {summary}
            {next !== null ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => onJump(next)}
                className={nextBtnCls}
              >
                Continue →
              </button>
            ) : (
              dashboardControl
            )}
          </StepCard>
        );
    }
  }

  return (
    <StepCard
      n={n}
      title="Review & submit"
      hint="Everything below must be checked off before the application can go in."
    >
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2 text-sm">
            <span
              aria-hidden
              className={`flex h-4 w-4 flex-none items-center justify-center rounded-full text-[0.6rem] ${
                i.done ? "bg-red text-white" : "border border-line-strong text-transparent"
              }`}
            >
              ✓
            </span>
            {i.done ? (
              <span className="text-muted line-through">{i.label}</span>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => onJump(formStepForLabel(i.label))}
                className={`rounded text-left text-ink-soft underline decoration-line-strong underline-offset-2 hover:text-red hover:decoration-red disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
              >
                {i.label} →
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={pending || !complete}
          onClick={onSubmit}
          className={`inline-flex h-12 items-center justify-center rounded-full bg-red px-6 font-mono text-xs uppercase tracking-[0.12em] text-white hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
        >
          {pending ? "Submitting…" : "Submit for review"}
        </button>
        {notice && (
          <p role="alert" className="w-full text-sm text-red">
            {notice} — your application is safe; press Submit to retry.
          </p>
        )}
        {!complete && (
          <p className="w-full font-mono text-[0.7rem] text-muted">
            Complete the application (100%) to submit for review.
          </p>
        )}
      </div>
    </StepCard>
  );
}
