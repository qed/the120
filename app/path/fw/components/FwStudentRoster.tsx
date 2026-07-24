"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/path/components/system/Button";
import { anonymizeStudentAction } from "@/app/path/lib/actions/fw-ops";
import type { FwOpsStudent } from "@/app/path/lib/fw-ops-core";
import { fwAnonymizeConfirmMatches } from "@/app/path/lib/fw-ops-rules";

/**
 * The cohort's students, and the anonymize (deletion) action (FW Unit 5b;
 * Decision 10, gap G8).
 *
 * ── Anonymize is IRREVERSIBLE, so the confirm is a TYPED confirm
 *
 * The house rule (CLAUDE.md): a destructive UI action confirms before acting and
 * the copy says exactly what will happen — and for an irreversible one, the
 * confirm is typed. Staff must type the child's OWN NAME, which is the strongest
 * guard against removing the wrong student. The submit button gates on the SAME
 * pure fold the server verifies with (`fwAnonymizeConfirmMatches`), so the
 * client gate and the server authority can never disagree (an accented name the
 * server would accept no longer leaves the button stuck disabled).
 *
 * ── A "removal incomplete" state is resumable, not a dead end
 *
 * `anonymized` (name tombstoned) and `anonymizeComplete` (the audit row exists,
 * i.e. the whole sequence finished) are DISTINCT. A run whose auth-email rename
 * failed mid-way leaves `anonymized: true, anonymizeComplete: false` — a state
 * the core is built to resume. This surface shows a "Finish removing" affordance
 * for it (a one-click resume; the confirm was already given on the first attempt)
 * rather than rendering "Removed" with no way forward.
 *
 * ── The open-reject warning is surfaced BEFORE the click
 *
 * Anonymizing a student who still has unresolved replay rejects orphans them.
 * The count shows in the confirm panel so staff can resolve them first — a
 * warning, not a block.
 *
 * ── ONE busy state, try/catch/FINALLY — the FwGuideRoster shape.
 */

export default function FwStudentRoster({
  cohortId,
  students,
}: {
  cohortId: string;
  students: FwOpsStudent[];
}) {
  const router = useRouter();
  /** The student id whose anonymize is running, or null. */
  const [busy, setBusy] = useState<string | null>(null);
  /** The student id whose confirm panel is open, or null. */
  const [confirming, setConfirming] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const anyBusy = busy !== null;

  /** Open exactly one confirm, clearing any typed text and stale messages. */
  const beginConfirm = (studentId: string | null) => {
    setConfirming(studentId);
    setTyped("");
    setError(null);
    setNotice(null);
  };

  /** Run the anonymize/resume for one student. `confirmName` is the typed name on
   *  a first removal; on a resume it is the (tombstoned) display name, which the
   *  core ignores because the name is already tombstoned. */
  const runAnonymize = async (student: FwOpsStudent, confirmName: string) => {
    if (anyBusy) return;
    setBusy(student.studentId);
    setError(null);
    setNotice(null);
    try {
      const res = await anonymizeStudentAction({ cohortId, studentId: student.studentId, confirmName });
      if (res.success) {
        setConfirming(null);
        setTyped("");
        setNotice(
          [
            res.alreadyAnonymized ? "That student was already removed." : "Student removed.",
            res.audited ? "" : "⚠ The audit record didn't save — tell an engineer.",
            res.openRejects > 0
              ? `⚠ ${res.openRejects} unresolved replay reject${res.openRejects === 1 ? "" : "s"} still point at them — resolve those above.`
              : "",
          ]
            .filter(Boolean)
            .join(" ")
        );
        router.refresh();
        return; // finally clears the flag
      }
      setError(res.error);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  if (students.length === 0) {
    return (
      <p className="mt-3 rounded-xl border border-hq-border bg-hq-sunken p-4 font-path-body text-sm leading-6 text-hq-ink-soft">
        No students in this weekend yet.
      </p>
    );
  }

  return (
    <div className="mt-3">
      <ul className="space-y-3">
        {students.map((student) => {
          const rowBusy = busy === student.studentId;
          const open = confirming === student.studentId;
          const canSubmit = fwAnonymizeConfirmMatches(typed, student.firstName, student.lastName);
          const incomplete = student.anonymized && !student.anonymizeComplete;
          return (
            <li
              key={student.studentId}
              className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <p className="font-path-body text-sm font-medium text-hq-ink">
                  {student.anonymized
                    ? "Removed student"
                    : `${student.firstName} ${student.lastName}`}
                </p>
                <div className="flex items-center gap-2">
                  {student.openRejects > 0 && !student.anonymized && (
                    <span className="inline-flex items-center rounded-full border border-not-yet/40 bg-not-yet/10 px-2.5 py-0.5 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink">
                      {student.openRejects} reject{student.openRejects === 1 ? "" : "s"}
                    </span>
                  )}
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-path-mono text-[11px] uppercase tracking-[0.1em] ${
                      incomplete
                        ? "border-not-yet/40 bg-not-yet/10 text-hq-ink"
                        : "border-hq-border bg-hq-sunken text-hq-ink-soft"
                    }`}
                  >
                    {incomplete ? "Removal incomplete" : student.anonymized ? "Removed" : student.band}
                  </span>
                </div>
              </div>

              {/* Active student: the typed-confirm removal flow. */}
              {!student.anonymized && open && (
                <div className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3">
                  <p role="alert" className="font-path-body text-sm leading-5 text-hq-ink">
                    This erases <strong>{student.firstName} {student.lastName}</strong>&apos;s name
                    from their record and retires their address permanently. It cannot be undone.
                    {student.openRejects > 0 && (
                      <>
                        {" "}
                        <strong>
                          {student.openRejects} unresolved replay reject
                          {student.openRejects === 1 ? "" : "s"}
                        </strong>{" "}
                        still point at this student — resolve those first.
                      </>
                    )}
                  </p>
                  <label className="mt-3 block" htmlFor={`confirm-${student.studentId}`}>
                    <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
                      Type the student&apos;s name to confirm
                    </span>
                    <input
                      id={`confirm-${student.studentId}`}
                      type="text"
                      className="h-12 w-full rounded-xl border border-hq-border bg-hq-canvas px-3 font-path-body text-base text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      placeholder={`${student.firstName} ${student.lastName}`}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      skin="hq"
                      variant="secondary"
                      size="md"
                      onClick={() => runAnonymize(student, typed)}
                      disabled={anyBusy || !canSubmit}
                    >
                      {rowBusy ? "Removing…" : "Remove this student"}
                    </Button>
                    <Button
                      type="button"
                      skin="hq"
                      variant="secondary"
                      size="md"
                      onClick={() => beginConfirm(null)}
                      disabled={anyBusy}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              {!student.anonymized && !open && (
                <div className="mt-3">
                  <Button
                    type="button"
                    skin="hq"
                    variant="secondary"
                    size="md"
                    onClick={() => beginConfirm(student.studentId)}
                    disabled={anyBusy}
                  >
                    Remove
                  </Button>
                </div>
              )}

              {/* Removal that stalled part-way: resume it. No re-typed confirm —
                  it was given on the first attempt; the name is already gone. */}
              {incomplete && (
                <div className="mt-3">
                  <p className="mb-2 font-path-body text-xs leading-5 text-hq-ink-soft">
                    This removal didn&apos;t finish — the record is partly retired. Finish it to
                    complete the removal.
                  </p>
                  <Button
                    type="button"
                    skin="hq"
                    variant="secondary"
                    size="md"
                    onClick={() =>
                      runAnonymize(student, `${student.firstName} ${student.lastName}`)
                    }
                    disabled={anyBusy}
                  >
                    {rowBusy ? "Finishing…" : "Finish removing"}
                  </Button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {notice && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-verified/40 bg-verified/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          {notice}
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          {error}
        </p>
      )}
    </div>
  );
}
