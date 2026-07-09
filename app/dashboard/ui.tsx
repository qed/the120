"use client";

import Link from "next/link";
import Wordmark from "@/app/components/Wordmark";
import { STATUS_FLOW, statusIndex, type SeatStatus } from "./data";
import { useDashboard } from "./store";

/* ---------- completeness meter ---------- */

export function Meter({ value, className = "" }: { value: number; className?: string }) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">
        <span>Dossier</span>
        <span className={value === 100 ? "text-red" : "text-ink-soft"}>{value}% complete</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-line-strong">
        <div
          className="h-full rounded-full bg-red transition-[width] duration-500"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}

/* ---------- seat status stepper ---------- */

export function StatusStepper({ status }: { status: SeatStatus }) {
  const current = statusIndex(status);
  return (
    <ol className="flex flex-wrap gap-x-2 gap-y-3">
      {STATUS_FLOW.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={s.id} className="flex items-center gap-2">
            <span
              className={`flex h-6 w-6 flex-none items-center justify-center rounded-full font-mono text-[0.65rem] ${
                active
                  ? "bg-red text-white"
                  : done
                    ? "bg-ink text-white"
                    : "bg-line text-muted"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span
              className={`font-mono text-[0.65rem] uppercase tracking-[0.1em] ${
                active ? "text-ink" : "text-muted"
              }`}
            >
              {s.label}
            </span>
            {i < STATUS_FLOW.length - 1 && <span className="text-line-strong">·</span>}
          </li>
        );
      })}
    </ol>
  );
}

/* ---------- dashboard header ---------- */

export function DashHeader() {
  const { parent, signOut } = useDashboard();
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
        <Link href="/" aria-label="The 120 home">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-4">
          {parent && (
            <span className="hidden font-mono text-xs uppercase tracking-[0.1em] text-ink-soft sm:inline">
              {parent.firstName} {parent.lastName}
            </span>
          )}
          <Link
            href="/"
            onClick={signOut}
            className="font-mono text-xs uppercase tracking-[0.12em] text-muted transition-colors hover:text-red"
          >
            Sign out
          </Link>
        </div>
      </div>
    </header>
  );
}

/* ---------- form primitives ---------- */

export function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">
      {children}
    </span>
  );
}

export const inputCls =
  "h-11 w-full rounded-xl border border-line-strong bg-white px-3.5 text-sm text-ink outline-none transition-colors placeholder:text-muted focus:border-red";

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  maxLength?: number;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={inputCls}
      />
    </label>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows = 4,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea
        value={value}
        rows={rows}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full resize-y rounded-xl border border-line-strong bg-white px-3.5 py-3 text-sm leading-6 text-ink outline-none transition-colors placeholder:text-muted focus:border-red"
      />
    </label>
  );
}
