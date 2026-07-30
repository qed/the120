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

import { useState } from "react";
import Link from "next/link";
import { saveFormStepAction, submitApplicationAction } from "@/app/lib/funnel/actions/form-steps";
import { REVIEW_SCREEN, WAITLIST_SCREEN } from "@/app/lib/funnel/offer-rules";
import {
  checklistChildForFields,
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
import { BOOKING_URL, groupBySlug, groups } from "@/app/lib/site";

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
  depositPaid: boolean;
  /** The composed project's door (server-loaded), for the group step's
   *  difference note. Null = no composed project. */
  projectGroupSlug: string | null;
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

  const nextLabel = !editable ? "Continue →" : pending ? "Saving…" : "Save & continue →";

  switch (step) {
    case "basics":
      return (
        <BasicsSection
          fields={fields}
          frozen={frozen}
          pending={pending}
          notice={notice}
          nextLabel={nextLabel}
          onNext={saveThenGo}
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
          fields={fields}
          frozen={frozen}
          pending={pending}
          notice={notice}
          nextLabel={nextLabel}
          onNext={saveThenGo}
        />
      );
    case "project":
      return (
        <ProjectSection
          fields={fields}
          frozen={frozen}
          pending={pending}
          notice={notice}
          nextLabel={nextLabel}
          onNext={saveThenGo}
        />
      );
    case "review":
      return (
        <ReviewSection
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
  pending,
  notice,
  nextLabel,
  onNext,
}: {
  fields: MergedFlowFields;
  frozen: boolean;
  pending: boolean;
  notice: string | null;
  nextLabel: string;
  onNext: (input: unknown) => void;
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
  const onPhoto = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ photo: String(reader.result) });
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
        disabled={pending}
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

      {/* Undecided affordance (R17) */}
      <div className="mt-5 rounded-xl border border-dashed border-line-strong bg-paper-2 p-4">
        <p className="font-display text-sm font-bold text-ink">Not sure which group?</p>
        <p className="mt-1 text-sm leading-6 text-ink-soft">
          Most families pick where the kid&rsquo;s energy already lives — our staff confirm the
          fit at the review call, and the choice stays editable until a deposit is paid.
        </p>
        <a
          href={BOOKING_URL}
          className={`mt-2 inline-block rounded font-mono text-xs uppercase tracking-[0.12em] text-blue hover:text-red ${focusRing}`}
        >
          Book a 20-minute call →
        </a>
      </div>

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
  fields,
  frozen,
  pending,
  notice,
  nextLabel,
  onNext,
}: {
  fields: MergedFlowFields;
  frozen: boolean;
  pending: boolean;
  notice: string | null;
  nextLabel: string;
  onNext: (input: unknown) => void;
}) {
  // Legacy prefill (R14 old-shape drafts), IN-MEMORY: subjects seed the
  // entries draft; the persisted `subjects` column is not writable through
  // the per-step schema and retires with the store (Unit 9).
  const [entries, setEntries] = useState<Academic[]>(() =>
    fields.academics.length > 0
      ? fields.academics
      : fields.subjects.length > 0
        ? fields.subjects.slice(0, 2).map((s) => ({ subject: s, plan: "", goal: "" }))
        : [EMPTY_ENTRY]
  );
  const [interests, setInterests] = useState(fields.interests);

  const updateEntry = (i: number, patch: Partial<Academic>) =>
    setEntries((es) => es.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const addEntry = () => setEntries((es) => [...es, EMPTY_ENTRY]);
  const removeEntry = (i: number) => setEntries((es) => es.filter((_, j) => j !== i));

  return (
    <StepCard
      n="03"
      title="Academics"
      hint="We help you: Choose a subject (or 2) and a project the next year."
    >
      <div className="space-y-5">
        {entries.map((entry, i) => (
          <div key={i} className="rounded-xl border border-line bg-paper-2/60 p-4">
            <div className="flex items-center justify-between">
              <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">
                Subject {i + 1} of 2
              </p>
              {entries.length > 1 && (
                <button
                  type="button"
                  disabled={frozen}
                  onClick={() => removeEntry(i)}
                  aria-label={`Remove subject ${i + 1}`}
                  className={`rounded font-mono text-xs text-muted hover:text-red disabled:cursor-not-allowed disabled:opacity-40 ${focusRing}`}
                >
                  ✕
                </button>
              )}
            </div>

            {/* Subject pills in two rows (R4): math/science first, language
                second — ACADEMIC_SUBJECTS is ordered to match. */}
            <div className="mt-3 space-y-2">
              {[ACADEMIC_SUBJECTS.slice(0, 3), ACADEMIC_SUBJECTS.slice(3)].map((row, r) => (
                <div key={r} className="flex flex-wrap gap-2">
                  {row.map((s) => {
                    const on = entry.subject === s;
                    return (
                      <button
                        key={s}
                        type="button"
                        disabled={frozen}
                        onClick={() => updateEntry(i, { subject: on ? "" : s })}
                        aria-pressed={on}
                        className={`rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.08em] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${focusRing} ${
                          on
                            ? "border-red bg-red text-white"
                            : "border-line-strong text-ink-soft hover:border-ink"
                        }`}
                      >
                        {s}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <input
              value={isListedSubject(entry.subject) ? "" : entry.subject}
              disabled={frozen}
              onChange={(e) => updateEntry(i, { subject: e.target.value })}
              placeholder="Other subject…"
              maxLength={120}
              aria-label={`Other subject for entry ${i + 1}`}
              className={`${inputCls} mt-3 h-10`}
            />

            {/* Plan cards — single-select within the entry */}
            <div className="mt-4">
              <span className={labelCls}>The plan</span>
              <div
                role="radiogroup"
                aria-label={`Plan for subject ${i + 1}`}
                className="grid gap-2 sm:grid-cols-3"
              >
                {ACADEMIC_PLANS.map((p) => {
                  const on = entry.plan === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={frozen}
                      onClick={() => updateEntry(i, { plan: p.id })}
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
              {entry.subject.trim() !== "" && entry.plan === "" && (
                <p className="mt-2 font-mono text-[0.7rem] text-red">
                  Pick a plan to round out this subject.
                </p>
              )}
            </div>

            <div className="mt-4">
              <Area
                label="What do you want to accomplish with this Academic Project (optional)"
                value={entry.goal}
                onChange={(v) => updateEntry(i, { goal: v })}
                placeholder="Where should this subject be a year from now?"
                rows={2}
                maxLength={500}
                frozen={frozen}
              />
            </div>
          </div>
        ))}

        {entries.length < 2 && (
          <button
            type="button"
            disabled={frozen || entries[0].subject.trim() === ""}
            onClick={addEntry}
            className={`rounded-full border border-dashed border-line-strong px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-ink-soft hover:border-ink disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-line-strong ${focusRing}`}
          >
            + Add another subject
          </button>
        )}

        <Area
          label="What is your child into?"
          value={interests}
          onChange={setInterests}
          placeholder="Dinosaurs, chess, building things, marine biology…"
          rows={3}
          maxLength={2000}
          frozen={frozen}
        />
      </div>

      {notice && (
        <p role="alert" className="mt-4 text-sm text-red">
          {notice}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          onNext({
            step: "academics",
            childId: fields.id,
            academics: entries.filter(
              (e) => e.subject.trim() !== "" || e.plan !== "" || e.goal.trim() !== ""
            ),
            interests,
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
  fields,
  frozen,
  pending,
  notice,
  nextLabel,
  onNext,
}: {
  fields: MergedFlowFields;
  frozen: boolean;
  pending: boolean;
  notice: string | null;
  nextLabel: string;
  onNext: (input: unknown) => void;
}) {
  const [pitch, setPitch] = useState(fields.projectPitch);
  const [links, setLinks] = useState(fields.portfolioLinks);
  const slug = fields.groupSlug ?? "";
  const scholars = slug === "scholars";
  const group = groupBySlug(slug);
  const examples = GROUP_PROJECT_EXAMPLES[slug];

  return (
    <StepCard
      n="04"
      title="Project & interests"
      hint={
        scholars
          ? "The kid's own words are encouraged."
          : "We'll help build projects based on your kid's interests. Enter a topic or interest area and an idea for a 4–8 week (or longer) project, working a few hours a week. We'll put together the answers from all the parents and build something amazing for you and your cohort."
      }
    >
      <div className="space-y-4">
        {!scholars && group && examples && (
          <div className="rounded-xl border border-line bg-paper-2/60 p-4">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">
              Example projects for {group.name}
            </p>
            <ul className="mt-2 space-y-1.5">
              {examples.map((ex) => (
                <li key={ex} className="flex gap-2 text-sm leading-6 text-ink-soft">
                  <span aria-hidden className="text-red">
                    ·
                  </span>
                  {ex}
                </li>
              ))}
            </ul>
          </div>
        )}

        <Area
          label={scholars ? "A year-long project idea" : "A 4–8 week project idea"}
          value={pitch}
          onChange={setPitch}
          placeholder={
            scholars
              ? "One super interesting thing they'd love to spend a year building, researching, or shipping."
              : "One super interesting thing they'd love to spend a few hours a week building, researching, or shipping."
          }
          rows={4}
          maxLength={4000}
          frozen={frozen}
        />
        <Field
          label="Portfolio / achievement links (optional)"
          value={links}
          onChange={setLinks}
          placeholder="A website, a video, a competition result…"
          maxLength={2000}
          frozen={frozen}
        />
      </div>

      {notice && (
        <p role="alert" className="mt-4 text-sm text-red">
          {notice}
        </p>
      )}
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          onNext({
            step: "project",
            childId: fields.id,
            projectPitch: pitch,
            portfolioLinks: links,
          })
        }
        className={nextBtnCls}
      >
        {nextLabel}
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
  if (label === "The kid's interests") return "academics";
  return stepForChecklistLabel(label);
}

function ReviewSection({
  fields,
  facts,
  pending,
  notice,
  onJump,
  onSubmit,
}: {
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
  const items = checklist(checklistChildForFields(fields));
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
        n="05"
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
          <StepCard n="05" title={REVIEW_SCREEN.title} hint={REVIEW_SCREEN.kicker}>
            <p className="text-sm leading-6 text-ink-soft">{REVIEW_SCREEN.intro}</p>
            <div className="mt-5">{summary}</div>
            {dashboardControl}
          </StepCard>
        );
      case "waitlisted":
        return (
          <StepCard n="05" title={WAITLIST_SCREEN.title} hint={WAITLIST_SCREEN.kicker}>
            <p className="text-sm leading-6 text-ink-soft">{WAITLIST_SCREEN.intro}</p>
            <p className="mt-2 text-sm leading-6 text-ink-soft">{WAITLIST_SCREEN.footer}</p>
            <div className="mt-5">{summary}</div>
            {dashboardControl}
          </StepCard>
        );
      case "next_steps":
        return (
          <StepCard
            n="05"
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
      n="05"
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
