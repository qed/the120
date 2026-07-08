"use client";

import { useState } from "react";
import {
  GRADES,
  SUBJECTS,
  WORKSHOPS,
  checklist,
  childName,
  completeness,
  statusMeta,
  type Child,
} from "./data";
import { useDashboard } from "./store";
import { Label, Meter, TextArea, TextField, inputCls } from "./ui";

function Section({
  n,
  title,
  hint,
  children,
}: {
  n: string;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-white p-6 sm:p-7">
      <div className="flex items-baseline gap-3">
        <span className="font-mono text-xs text-red">{n}</span>
        <h3 className="font-display text-lg font-bold tracking-tight text-ink">{title}</h3>
      </div>
      {hint && <p className="mt-1 text-sm text-ink-soft">{hint}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export default function DossierEditor({
  child,
  onBack,
  onPreview,
}: {
  child: Child;
  onBack: () => void;
  onPreview: () => void;
}) {
  const { updateChild, submitChild, removeChild } = useDashboard();
  const [otherSubject, setOtherSubject] = useState("");
  const pct = completeness(child);
  const items = checklist(child);
  const locked = child.status !== "draft";

  const set = (patch: Partial<Child>) => updateChild(child.id, patch);

  const toggleSubject = (s: string) => {
    if (child.subjects.includes(s)) set({ subjects: child.subjects.filter((x) => x !== s) });
    else if (child.subjects.length < 2) set({ subjects: [...child.subjects, s] });
  };
  const addOther = () => {
    const v = otherSubject.trim();
    if (v && !child.subjects.includes(v) && child.subjects.length < 2) {
      set({ subjects: [...child.subjects, v] });
      setOtherSubject("");
    }
  };

  const toggleWorkshop = (id: string) =>
    set({
      workshopIds: child.workshopIds.includes(id)
        ? child.workshopIds.filter((x) => x !== id)
        : [...child.workshopIds, id],
    });

  const onPhoto = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ photo: String(reader.result) });
    reader.readAsDataURL(file);
  };

  const canSubmit = pct === 100 && !locked;

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-10">
      <button
        onClick={onBack}
        className="font-mono text-xs uppercase tracking-[0.12em] text-muted hover:text-ink"
      >
        ← All children
      </button>

      {/* Header + meter */}
      <div className="mt-4 flex flex-col gap-4 rounded-2xl border border-line bg-paper-2 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="eyebrow">Dossier</p>
          <h2 className="mt-1 font-display text-2xl font-bold tracking-tight text-ink">
            {childName(child)}
          </h2>
          <p className="mt-1 font-mono text-xs uppercase tracking-[0.1em] text-muted">
            Status · {statusMeta(child.status).label}
          </p>
        </div>
        <Meter value={pct} className="w-full sm:w-56" />
      </div>

      {locked && (
        <p className="mt-4 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-soft">
          This dossier has been submitted and is locked for review. Contact{" "}
          <span className="text-ink">admissions@the120.school</span> to make changes.
        </p>
      )}

      <fieldset disabled={locked} className="mt-6 space-y-5 disabled:opacity-70">
        {/* 1 · Basics */}
        <Section n="01" title="Basics" hint="Who is this candidate for the 120?">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="First name" value={child.firstName} onChange={(v) => set({ firstName: v })} />
            <TextField label="Last name" value={child.lastName} onChange={(v) => set({ lastName: v })} />
            <label className="block">
              <Label>Grade (Fall 2026)</Label>
              <select
                value={child.grade}
                onChange={(e) => set({ grade: e.target.value ? Number(e.target.value) : "" })}
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
            <TextField
              label="Birth year"
              value={child.birthYear}
              onChange={(v) => set({ birthYear: v.replace(/\D/g, "").slice(0, 4) })}
              placeholder="2016"
            />
            <div className="sm:col-span-2">
              <TextField
                label="Current school"
                value={child.currentSchool}
                onChange={(v) => set({ currentSchool: v })}
                placeholder="Where they go today"
              />
            </div>
          </div>

          <div className="mt-4">
            <Label>Photo (optional)</Label>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 flex-none items-center justify-center overflow-hidden rounded-full border border-line-strong bg-paper-2 text-muted">
                {child.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={child.photo} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-mono text-lg">
                    {(child.firstName[0] || "?").toUpperCase()}
                  </span>
                )}
              </div>
              <label className="cursor-pointer rounded-full border border-line-strong px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-ink-soft hover:border-ink">
                {child.photo ? "Replace" : "Upload"}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={(e) => onPhoto(e.target.files?.[0])}
                />
              </label>
              {child.photo && (
                <button
                  onClick={() => set({ photo: undefined })}
                  className="font-mono text-xs uppercase tracking-[0.1em] text-muted hover:text-red"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </Section>

        {/* 2 · Academic picks */}
        <Section
          n="02"
          title="Academic picks"
          hint="Choose 1–2 subjects to get super advanced in via TimeBack."
        >
          <div className="flex flex-wrap gap-2">
            {SUBJECTS.map((s) => {
              const on = child.subjects.includes(s);
              const disabled = !on && child.subjects.length >= 2;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSubject(s)}
                  disabled={disabled}
                  className={`rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.08em] transition-colors disabled:opacity-40 ${
                    on ? "border-red bg-red text-white" : "border-line-strong text-ink-soft hover:border-ink"
                  }`}
                >
                  {s}
                </button>
              );
            })}
          </div>

          {/* custom subject + selected chips */}
          <div className="mt-3 flex gap-2">
            <input
              value={otherSubject}
              onChange={(e) => setOtherSubject(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addOther())}
              placeholder="Other subject…"
              className={`${inputCls} h-10`}
              disabled={child.subjects.length >= 2}
            />
            <button
              type="button"
              onClick={addOther}
              disabled={child.subjects.length >= 2 || !otherSubject.trim()}
              className="flex-none rounded-xl border border-line-strong px-4 font-mono text-xs uppercase tracking-[0.1em] text-ink-soft hover:border-ink disabled:opacity-40"
            >
              Add
            </button>
          </div>
          {child.subjects.some((s) => !SUBJECTS.includes(s as (typeof SUBJECTS)[number])) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {child.subjects
                .filter((s) => !SUBJECTS.includes(s as (typeof SUBJECTS)[number]))
                .map((s) => (
                  <span
                    key={s}
                    className="flex items-center gap-1.5 rounded-full bg-red/10 px-3 py-1 font-mono text-xs text-red"
                  >
                    {s}
                    <button onClick={() => toggleSubject(s)} aria-label={`Remove ${s}`}>
                      ✕
                    </button>
                  </span>
                ))}
            </div>
          )}

          <div className="mt-5">
            <TextArea
              label="Test scores / assessments (optional)"
              value={child.testScores}
              onChange={(v) => set({ testScores: v })}
              placeholder="MAP, CCAT, recent report cards — anything you'd like to share."
              rows={3}
            />
          </div>
        </Section>

        {/* 3 · Workshops */}
        <Section
          n="03"
          title="Workshops of interest"
          hint={`Express interest — this isn't scheduling. Selected: ${child.workshopIds.length}`}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {WORKSHOPS.map((w) => {
              const on = child.workshopIds.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  onClick={() => toggleWorkshop(w.id)}
                  className={`rounded-xl border p-4 text-left transition-colors ${
                    on ? "border-red bg-red/5" : "border-line-strong bg-white hover:border-ink"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-display text-sm font-bold text-ink">{w.title}</span>
                    <span
                      className={`mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full border text-[0.55rem] ${
                        on ? "border-red bg-red text-white" : "border-line-strong text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                  </div>
                  <p className="mt-1 font-mono text-[0.65rem] uppercase tracking-[0.08em] text-muted">
                    {w.track} · Grades {w.grades} · {w.length}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-ink-soft">{w.description}</p>
                  <p className="mt-2 font-mono text-[0.65rem] text-red">{w.advisor}</p>
                </button>
              );
            })}
          </div>
        </Section>

        {/* 4 · Project & interests */}
        <Section
          n="04"
          title="Project & interests"
          hint="The kid's own words are encouraged."
        >
          <div className="space-y-4">
            <TextArea
              label="What is your child into?"
              value={child.interests}
              onChange={(v) => set({ interests: v })}
              placeholder="Dinosaurs, chess, building things, marine biology…"
              rows={3}
            />
            <TextArea
              label="A year-long project idea"
              value={child.projectPitch}
              onChange={(v) => set({ projectPitch: v })}
              placeholder="One super interesting thing they'd love to spend a year building, researching, or shipping."
              rows={4}
            />
            <TextField
              label="Portfolio / achievement links (optional)"
              value={child.portfolioLinks}
              onChange={(v) => set({ portfolioLinks: v })}
              placeholder="A website, a video, a competition result…"
            />
          </div>
        </Section>
      </fieldset>

      {/* Checklist + actions */}
      <div className="mt-6 rounded-2xl border border-line bg-white p-6">
        <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted">
          What&rsquo;s left
        </p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.map((i) => (
            <li key={i.label} className="flex items-center gap-2 text-sm">
              <span
                className={`flex h-4 w-4 flex-none items-center justify-center rounded-full text-[0.6rem] ${
                  i.done ? "bg-red text-white" : "border border-line-strong text-transparent"
                }`}
              >
                ✓
              </span>
              <span className={i.done ? "text-muted line-through" : "text-ink-soft"}>{i.label}</span>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex flex-wrap gap-3">
          <button
            onClick={onPreview}
            className="inline-flex h-12 items-center justify-center rounded-full border border-line-strong px-6 font-mono text-xs uppercase tracking-[0.12em] text-ink hover:border-ink"
          >
            Preview dossier
          </button>
          <button
            onClick={() => submitChild(child.id)}
            disabled={!canSubmit}
            className="inline-flex h-12 items-center justify-center rounded-full bg-red px-6 font-mono text-xs uppercase tracking-[0.12em] text-white hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            {locked ? "Submitted" : "Submit for review"}
          </button>
          {!canSubmit && !locked && (
            <p className="w-full font-mono text-[0.7rem] text-muted">
              Complete the dossier (100%) to submit for review.
            </p>
          )}
        </div>

        <button
          onClick={() => {
            if (confirm(`Remove ${childName(child)}'s dossier? This cannot be undone.`))
              removeChild(child.id);
          }}
          className="mt-6 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-muted hover:text-red"
        >
          Remove this child
        </button>
      </div>
    </div>
  );
}
