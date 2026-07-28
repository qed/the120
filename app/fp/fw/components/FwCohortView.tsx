"use client";

import { useState } from "react";
import FwQuickCreate from "./FwQuickCreate";
import FwStudentSidebar from "./FwStudentSidebar";
import type { FwRosterEntry } from "@/app/fp/lib/fw-loader";
import type { FwUnfinishedStudent } from "@/app/fp/lib/fw-nav-rules";

/**
 * The two-pane cohort view (ops-guide redesign Unit 7; R18, R23) — student
 * sidebar + content pane, the client owner of the ONE piece of shared state the
 * two need: whether the pane hosts quick-create, and for WHICH half-created
 * child.
 *
 * THE PANE ON THIS PAGE hosts quick-create and an idle hint, nothing else — a
 * tapped student navigates to the student PAGE (its own route; Unit 8 redesigns
 * it). The pane is the seam Unit 8 inherits: the sidebar already marks
 * `aria-current` off the pathname, so mounting it on the student page needs no
 * new state.
 *
 * FINISH-SETUP ARRIVES AS URL STATE, not client state (?finish=<profileId> —
 * the banner above this view is server markup whose "Finish setup" is a Link).
 * The server page resolves the param against the unfinished list and passes the
 * matched target here as an INITIAL-state seed, keying this component on the
 * profile id — so a different "Finish setup" tap remounts the view rather than
 * leaking a stale retry handle into a fresh create (the retired FwRoster's
 * invariant, kept). A URL also survives a reload on venue wifi, which client state never
 * did. `FwQuickCreate` itself stays keyed on the profile id for the same
 * reason, one level down.
 *
 * TOGGLING + — either way — LEAVES finish-setup mode: a fresh "New student"
 * must never inherit a half-created child's handle.
 */
export default function FwCohortView({
  cohortId,
  students,
  resume = null,
}: {
  cohortId: string;
  students: readonly FwRosterEntry[];
  /** The ?finish= target, already resolved server-side against the unfinished
   *  list (an unmatched or stale param arrives as null and is ignored). */
  resume?: FwUnfinishedStudent | null;
}) {
  const [creating, setCreating] = useState(resume !== null);
  const [resumeTarget, setResumeTarget] = useState<FwUnfinishedStudent | null>(resume);

  const close = () => {
    setCreating(false);
    setResumeTarget(null);
  };

  return (
    <div className="lg:flex lg:items-start lg:gap-6">
      <FwStudentSidebar
        cohortId={cohortId}
        students={students}
        creating={creating}
        onToggleCreate={() => {
          setCreating((v) => !v);
          setResumeTarget(null);
        }}
      />

      {/* The idle pane hides below lg — on a narrow screen the sidebar IS the
          page (see FwStudentSidebar's docblock), and a hint under ninety names
          would be scroll noise. It appears there only when it has the form. */}
      <section
        aria-label="Student pane"
        className={
          creating
            ? "mt-4 min-w-0 flex-1 lg:mt-0"
            : "mt-4 hidden min-w-0 flex-1 lg:mt-0 lg:block"
        }
      >
        {creating ? (
          <FwQuickCreate
            key={resumeTarget?.profileId ?? "new"}
            cohortId={cohortId}
            resume={resumeTarget}
            onCancel={close}
          />
        ) : (
          <p className="rounded-xl border border-hq-border bg-hq-surface p-5 font-path-body text-sm leading-6 text-hq-ink-soft shadow-hq">
            Tap a student to open their check-in view, or add a walk-in with New student.
          </p>
        )}
      </section>
    </div>
  );
}
