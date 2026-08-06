"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "@/app/fp/fw/components/system/Icon";
import type { FwRosterEntry } from "@/app/lib/fp/fw-loader";
import {
  fwDuplicateNameStudentIds,
  fwSidebarNames,
  searchFwRoster,
  FW_BAND_LABEL,
} from "@/app/lib/fp/fw-nav-rules";

/**
 * The student sidebar (ops-guide redesign Unit 7; R18, R23) — the left pane of
 * the two-pane cohort view. PathShell's aside is the visual precedent: ~236px
 * rail, `aria-current` on the active student, scrollable list.
 *
 * NOTHING HERE DECIDES ANYTHING (the retired FwRoster's charter, inherited): display
 * names, the collision rule, ordering, search ranking, and duplicate flagging
 * are all pure functions in `fw-nav-rules.ts` with their own tests; this
 * component renders what they return.
 *
 * SEARCH SURVIVES THE REDESIGN. Client-side over the whole roster, the same
 * `searchFwRoster` the retired FwRoster used — the list is already in memory,
 * which is what keeps the minute-loop instant and outage-proof. An empty query
 * shows the full roster in `fwSidebarNames` order (which agrees with an
 * empty-query search by construction — both sort fold-first/last/id).
 *
 * THE BAND CHIP appears ONLY on rows whose names collide (G22, inherited):
 * showing it everywhere would bury the signal on the two rows where a check-in
 * could land on the wrong permanent record. The resume chip (G21) survives too,
 * compacted for rail width, and is absent entirely for an untapped student — a
 * first-timer's row reads as a name, not a score of zero.
 *
 * NARROW WIDTHS (the 375px contract): single-column collapse, NOT a drawer.
 * Below `lg` the sidebar IS the page body — search + "New student" row on top,
 * the full name list beneath — so "tap a name" stays ONE interaction (a drawer
 * would cost an opening tap per leg of the R23 loop). When quick-create opens
 * on a narrow screen the LIST hides (`creating` prop) so the form sits directly
 * under the search row instead of below ninety names; Cancel restores the list.
 * On `lg`+ the list always stays: the form renders in the content pane beside it.
 *
 * The + affordance renders twice — a compact button in the search row (narrow
 * only) and a full-width row at the aside's foot (`lg` only). Two BUTTONS, one
 * handler; the FORM is never duplicated (the PathShell docblock records why a
 * twice-rendered subtree with ids is a defect).
 */
export default function FwStudentSidebar({
  cohortId,
  students,
  creating,
  onToggleCreate,
}: {
  cohortId: string;
  students: readonly FwRosterEntry[];
  /** Whether the content pane currently hosts quick-create — mirrored here for
   *  `aria-expanded` on both + buttons and the narrow-width list collapse. */
  creating: boolean;
  onToggleCreate: () => void;
}) {
  const pathname = usePathname();
  const [query, setQuery] = useState("");

  const named = useMemo(() => fwSidebarNames(students), [students]);
  const labelById = useMemo(
    () => new Map(named.map((n) => [n.student.studentId, n.label])),
    [named]
  );
  const duplicates = useMemo(() => fwDuplicateNameStudentIds(students), [students]);

  // Empty query → sidebar order (alphabetical, the rule's); a typed query →
  // search ranking (relevance, the rule's). Both lists render the same
  // collision-safe labels via labelById.
  const q = query.trim();
  const visible = useMemo(
    () => (q.length === 0 ? named.map((n) => n.student) : searchFwRoster(students, query)),
    [named, students, q, query]
  );

  const plusButtonCls =
    "inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border border-hq-border-strong bg-hq-surface px-4 font-path-body text-sm font-medium text-hq-ink shadow-hq active:bg-hq-sunken";

  return (
    <aside
      aria-label="Students"
      className="min-w-0 lg:w-[236px] lg:shrink-0"
    >
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1" htmlFor="fw-sidebar-search">
          <span className="sr-only">Find a student</span>
          <input
            id="fw-sidebar-search"
            type="search"
            inputMode="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a student…"
            className="h-12 w-full rounded-xl border border-hq-border bg-hq-surface px-3 font-path-body text-sm text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10"
          />
        </label>
        {/* Narrow-width + (see docblock: two buttons, one form). */}
        <button
          type="button"
          onClick={onToggleCreate}
          aria-expanded={creating}
          className={`${plusButtonCls} h-12 min-w-[48px] lg:hidden`}
        >
          <Icon name={creating ? "x" : "plus"} size={20} />
          <span className="sr-only">{creating ? "Close" : "New student"}</span>
        </button>
      </div>

      {students.length === 0 ? (
        <p className="mt-4 font-path-body text-sm leading-6 text-hq-ink-soft">
          Nobody is on this weekend&apos;s roster yet. Staff import the roster before doors; use New
          student for walk-ins.
        </p>
      ) : visible.length === 0 ? (
        <p className="mt-4 font-path-body text-sm leading-6 text-hq-ink-soft">
          No one on the roster matches &ldquo;{q}&rdquo;. Check the spelling, or add them with New
          student.
        </p>
      ) : (
        <nav aria-label="Roster" className={creating ? "hidden lg:block" : undefined}>
          <ul className="mt-3 space-y-1 lg:max-h-[calc(100dvh-18rem)] lg:overflow-y-auto lg:pr-1">
            {visible.map((student) => {
              const href = `/fp/fw/cohort/${cohortId}/student/${student.studentId}`;
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={student.studentId}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={
                      active
                        ? "flex min-h-[48px] items-center justify-between gap-2 rounded-lg bg-hq-sunken px-3 py-2 shadow-hq"
                        : "flex min-h-[48px] items-center justify-between gap-2 rounded-lg px-3 py-2 transition-colors hover:bg-hq-sunken active:bg-hq-sunken"
                    }
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-path-body text-[15px] font-medium text-hq-ink">
                        {labelById.get(student.studentId) ??
                          `${student.firstName} ${student.lastName}`}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        {duplicates.has(student.studentId) && (
                          <span className="mt-0.5 rounded-full bg-hq-sunken px-1.5 py-0.5 font-path-mono text-[10px] uppercase tracking-[0.1em] text-hq-ink-soft">
                            {FW_BAND_LABEL[student.band]}
                          </span>
                        )}
                        {student.resume.furthestTaskId && (
                          <span className="mt-0.5 truncate font-path-mono text-[10px] uppercase tracking-[0.08em] text-hq-ink-muted">
                            {student.resume.verified} ✓ · up to {student.resume.furthestTaskId}
                          </span>
                        )}
                      </span>
                    </span>
                    <Icon name="chevron-right" size={18} className="shrink-0 text-hq-ink-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {/* The + row at the aside's foot (R23's quick-create home on lg). */}
      <button
        type="button"
        onClick={onToggleCreate}
        aria-expanded={creating}
        className={`${plusButtonCls} mt-3 hidden w-full lg:inline-flex`}
      >
        <Icon name={creating ? "x" : "plus"} size={20} />
        {creating ? "Close" : "New student"}
      </button>
    </aside>
  );
}
