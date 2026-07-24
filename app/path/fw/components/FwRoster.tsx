"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/app/path/components/system/Icon";
import FwQuickCreate from "./FwQuickCreate";
import type { FwRosterEntry } from "@/app/path/lib/fw-loader";
import {
  fwDuplicateNameStudentIds,
  searchFwRoster,
  FW_BAND_LABEL,
} from "@/app/path/lib/fw-nav-rules";

/**
 * The cohort roster (FW Unit 4; FW-R14, gaps G21/G22) — the first screen of the
 * minute loop.
 *
 * Search is CLIENT-SIDE over the whole roster, which is what makes the loop
 * instant and what makes it survive Unit 8's outage: the list is already in
 * memory, and the ranking, typo tolerance, and duplicate flagging are all pure
 * decisions in `fw-nav-rules.ts` with their own tests. Nothing in this component
 * decides anything — it renders what those functions return, which is the only
 * way any of it is inspectable in a repo with no jsdom.
 *
 * The band chip appears ONLY on names that collide (G22). Showing it on every
 * row would bury the signal on the two rows that need it, which is the case
 * where a check-in otherwise lands on the wrong permanent record.
 */
export default function FwRoster({
  cohortId,
  students,
}: {
  cohortId: string;
  students: readonly FwRosterEntry[];
}) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  const duplicates = useMemo(() => fwDuplicateNameStudentIds(students), [students]);
  const results = useMemo(() => searchFwRoster(students, query), [students, query]);

  return (
    <div>
      <div className="flex items-center gap-3">
        <label className="relative flex-1" htmlFor="fw-roster-search">
          <span className="sr-only">Find a student</span>
          <input
            id="fw-roster-search"
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a student…"
            className="h-14 w-full rounded-xl border border-hq-border bg-hq-surface px-4 font-path-body text-base text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10"
          />
        </label>
        <button
          type="button"
          onClick={() => setCreating((v) => !v)}
          aria-expanded={creating}
          className="inline-flex h-14 min-w-[56px] items-center justify-center gap-2 rounded-xl border border-hq-border-strong bg-hq-surface px-4 font-path-body text-sm font-medium text-hq-ink shadow-hq active:bg-hq-sunken"
        >
          <Icon name={creating ? "x" : "plus"} size={20} />
          <span className="hidden sm:inline">{creating ? "Close" : "New student"}</span>
        </button>
      </div>

      {creating && (
        <div className="mt-4">
          <FwQuickCreate cohortId={cohortId} onCancel={() => setCreating(false)} />
        </div>
      )}

      {results.length === 0 ? (
        <p className="mt-6 font-path-body text-sm leading-6 text-hq-ink-soft">
          {students.length === 0
            ? "Nobody is on this weekend's roster yet. Staff import the roster before doors; use New student for walk-ins."
            : `No one on the roster matches “${query.trim()}”. Check the spelling, or add them with New student.`}
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {results.map((student) => {
            const { resume } = student;
            return (
              <li key={student.studentId}>
                <Link
                  href={`/path/fw/cohort/${cohortId}/student/${student.studentId}`}
                  className="flex min-h-[64px] items-center justify-between gap-3 rounded-xl border border-hq-border bg-hq-surface px-4 py-3 shadow-hq transition-colors active:bg-hq-sunken"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-path-display text-lg font-semibold text-hq-ink">
                      {student.firstName} {student.lastName}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                      {duplicates.has(student.studentId) && (
                        <span className="rounded-full bg-hq-sunken px-2 py-0.5 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-soft">
                          {FW_BAND_LABEL[student.band]}
                        </span>
                      )}
                      {/* The resume chip (G21). Absent entirely for a student
                          nobody has tapped — a first-timer's row reads as a
                          name, not as a score of zero. */}
                      {resume.furthestTaskId && (
                        <span className="font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-muted">
                          {resume.verified} checked
                          {resume.notYet > 0 && ` · ${resume.notYet} not yet`} · up to{" "}
                          {resume.furthestTaskId}
                        </span>
                      )}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={22} className="shrink-0 text-hq-ink-muted" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
