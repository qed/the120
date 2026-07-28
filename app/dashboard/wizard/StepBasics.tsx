"use client";

import { GRADES } from "../data";
import { Label, TextField, inputCls } from "../ui";
import { birthYearForGrade, childEmailPatch } from "../wizard-rules";
import { StepSection, focusRing, type StepProps } from "./shared";

export default function StepBasics({ child, set, n }: StepProps) {
  const onPhoto = (file?: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => set({ photo: String(reader.result) });
    reader.readAsDataURL(file);
  };

  return (
    <StepSection n={n} title="Basics" hint="Who is this candidate for the 120?">
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="First name" value={child.firstName} onChange={(v) => set({ firstName: v })} />
        <TextField label="Last name" value={child.lastName} onChange={(v) => set({ lastName: v })} />
        <label className="block">
          <Label>Grade (Fall 2026)</Label>
          <select
            value={child.grade}
            onChange={(e) => {
              const grade = e.target.value ? Number(e.target.value) : "";
              // R47: birth year auto-calculates from the grade and stays
              // editable — only an EMPTY field is filled, never a typed one.
              set(
                child.birthYear.trim() === "" && grade !== ""
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
        {/* R48: the child's email, with "Don't have one" recording the flag
            without an address. Deliberately not a checklist item. */}
        <div className="sm:col-span-2">
          <TextField
            label="Child's email (optional)"
            value={child.childEmail}
            onChange={(v) => set(childEmailPatch({ email: v }, child))}
            placeholder="Their own address, if they have one"
          />
          <label className="mt-2 flex items-center gap-2 text-sm text-ink-soft">
            <input
              type="checkbox"
              checked={child.childEmailNone}
              onChange={(e) => set(childEmailPatch({ none: e.target.checked }, child))}
              className="h-4 w-4 accent-red"
            />
            Don&apos;t have one
          </label>
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
              <span className="font-mono text-lg">{(child.firstName[0] || "?").toUpperCase()}</span>
            )}
          </div>
          <label
            className={`cursor-pointer rounded-full border border-line-strong px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-ink-soft hover:border-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue`}
          >
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
              type="button"
              onClick={() => set({ photo: undefined })}
              className={`rounded font-mono text-xs uppercase tracking-[0.1em] text-muted hover:text-red ${focusRing}`}
            >
              Remove
            </button>
          )}
        </div>
      </div>
    </StepSection>
  );
}
