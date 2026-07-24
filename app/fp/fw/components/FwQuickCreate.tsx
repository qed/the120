"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/fp/components/system/Button";
import { Icon } from "@/app/fp/components/system/Icon";
import { BANDS } from "@/app/fp/content/types";
import type { Band } from "@/app/fp/content/types";
import { lookupFwStudentMatch, quickCreateFwStudent } from "@/app/fp/lib/actions/fw-student";
import type { FwMatchVerdict } from "@/app/fp/lib/fw-match-rules";
import { FW_BAND_LABEL } from "@/app/fp/lib/fw-nav-rules";
import type { FwQuickCreateActionResult } from "@/app/fp/lib/fw-student-core";

/**
 * Quick-create (FW Unit 4; FW-R7, Decision 13, PROPOSED-1, gaps G6/G10) — three
 * fields and an attestation, fast enough to do with a kid standing there.
 *
 * Four properties this component exists to hold, each of which is a decision the
 * plan made rather than an interaction choice:
 *
 *   1. THE ATTESTATION BLOCKS SUBMIT and is persisted. The checkbox disables the
 *      button; the action's schema refuses anything but a literal `true`; the
 *      core re-checks; the column records who said it. Four layers, because it
 *      is the only record that a family saw the program notice.
 *
 *   2. PROPOSED-1 RUNS BEFORE THE MINT. A same-cohort match offers to OPEN that
 *      student rather than create a second one — the child is standing here, and
 *      a duplicate would split their record and burn a permanent name-derived
 *      address. A cross-cohort match shows a "confirm with staff" signal with no
 *      detail, because a Boston guide has no business learning a Hamptons
 *      child's band. "New student" stays available under every verdict.
 *
 *   3. RETRY-IN-PLACE ON A FAILED LEG. `runFwQuickCreate` hands back
 *      `retryProfileId`; this form re-submits with it, so the retry FINISHES
 *      this child instead of minting a second one. That is what stops a guide
 *      being handed a tap-dead tree (Decision 13).
 *
 *   4. try/catch/FINALLY on the submitting flag. A Server Action can REJECT
 *      rather than return a result, and on venue wifi that is the likely shape
 *      (docs/solutions/ui-bugs/server-action-rejection-no-try-finally-freezes-
 *      capture-modal-2026-07-20.md). A stuck flag is a dead iPad in front of a
 *      queue.
 */

const inputCls =
  "h-14 w-full rounded-xl border border-hq-border bg-hq-canvas px-4 font-path-body text-base text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10";

/** One message per failure the guide can act on. Everything the action can
 *  return has a line here — an unmapped reason would render as silence at the
 *  exact moment a guide needs to know what to do next. */
function failureMessage(result: Extract<FwQuickCreateActionResult, { ok: false }>): string {
  switch (result.reason) {
    case "notice_not_attested":
      return "Tick the notice box first.";
    case "invalid_name":
      return "That name can't be used as-is — retype it in plain letters.";
    case "cohort_not_found":
    case "cohort_not_fw":
    case "forbidden":
      return "You can't add students to this weekend. Find The 120 staff.";
    case "no_session":
      return "Your session ended. Sign in again.";
    case "invalid_input":
      return "Check the fields and try again.";
    case "address_exhausted":
      return "Too many students share this name. Find The 120 staff.";
    case "identity_mismatch":
    case "not_fw_profile":
    case "profile_not_found":
    case "account_missing":
      return "Something doesn't line up with an existing record. Find The 120 staff.";
    case "no_current_program_version":
      return "The program content isn't ready. Find The 120 staff.";
    case "membership_failed":
      return "The account was created but they aren't on this weekend's roster yet. Tap Finish to complete it.";
    case "materialization_failed":
    case "legs_unverified":
      return "The account was created but their task list isn't ready yet. Tap Finish to complete it.";
    case "unavailable":
      return "That didn't go through. Try again.";
  }
}

export default function FwQuickCreate({
  cohortId,
  onCancel,
}: {
  cohortId: string;
  onCancel: () => void;
}) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [band, setBand] = useState<Band | "">("");
  const [attested, setAttested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<FwMatchVerdict | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  /** Set by a failed leg. Its presence turns Create into Finish, and every
   *  submit from then on completes THIS child. */
  const [retryProfileId, setRetryProfileId] = useState<string | null>(null);

  const nameReady = firstName.trim().length > 0 && lastName.trim().length > 0;
  const canSubmit = nameReady && band !== "" && attested && !busy;

  /**
   * PROPOSED-1's lookup, on leaving a name field. Never blocking: a failed
   * lookup is reported and the guide creates anyway.
   *
   * SEQUENCED. The lookup fires on the blur of both fields, so a guide who
   * corrects a typo and blurs again has two requests in flight — and on venue
   * wifi, whose latency is exactly the variable expected to misbehave, the
   * stale one can resolve last and overwrite the fresh verdict. The guide would
   * then be reading a duplicate-match card (or a reassuring "no match") that
   * describes a name they are no longer typing, which is precisely the mistake
   * PROPOSED-1 exists to prevent (correctness + julik reviews).
   *
   * A monotonic counter is enough: only the newest request may write.
   */
  const lookupSeq = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const runLookup = async () => {
    if (!nameReady) return;
    const seq = ++lookupSeq.current;
    const isCurrent = () => mounted.current && seq === lookupSeq.current;
    setLookupFailed(false);
    try {
      const res = await lookupFwStudentMatch({ cohortId, firstName, lastName });
      if (!isCurrent()) return;
      if (res.ok) setVerdict(res.verdict);
      else {
        setVerdict(null);
        setLookupFailed(true);
      }
    } catch {
      if (!isCurrent()) return;
      setVerdict(null);
      setLookupFailed(true);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await quickCreateFwStudent({
        cohortId,
        firstName,
        lastName,
        band,
        noticeAttested: attested,
        ...(retryProfileId ? { existingProfileId: retryProfileId } : {}),
      });
      if (res.ok) {
        // Every leg verified — only now is it safe to route into the tree.
        router.push(`/fp/fw/cohort/${cohortId}/student/${res.studentId}`);
        router.refresh();
        return; // finally still clears busy
      }
      setError(failureMessage(res));
      // Keep the handle so the next submit finishes this child rather than
      // minting a second account with a suffixed permanent address.
      if (res.retryProfileId) setRetryProfileId(res.retryProfileId);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block" htmlFor="fw-first">
          <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            First name
          </span>
          <input
            id="fw-first"
            className={inputCls}
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            onBlur={runLookup}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <label className="block" htmlFor="fw-last">
          <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Last name
          </span>
          <input
            id="fw-last"
            className={inputCls}
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            onBlur={runLookup}
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
      </div>

      <fieldset className="mt-4">
        <legend className="mb-1.5 font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
          Grade band
        </legend>
        {/* No default selection: a band is stamped onto the record and picks
            which per-band instruction line a guide reads aloud. */}
        <div className="flex flex-wrap gap-2">
          {BANDS.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={band === b}
              onClick={() => setBand(b)}
              className={`min-h-[48px] rounded-xl border px-4 font-path-body text-sm font-medium transition-colors ${
                band === b
                  ? "border-hq-ink bg-hq-ink text-white"
                  : "border-hq-border bg-hq-canvas text-hq-ink active:bg-hq-sunken"
              }`}
            >
              {FW_BAND_LABEL[b]}
            </button>
          ))}
        </div>
      </fieldset>

      <FwMatchNotice
        verdict={verdict}
        lookupFailed={lookupFailed}
        cohortId={cohortId}
        onOpen={() => onCancel()}
      />

      <label className="mt-4 flex items-start gap-3" htmlFor="fw-attest">
        <input
          id="fw-attest"
          type="checkbox"
          checked={attested}
          onChange={(e) => setAttested(e.target.checked)}
          className="mt-1 h-6 w-6 shrink-0 rounded border-hq-border-strong accent-hq-ink"
        />
        <span className="font-path-body text-sm leading-6 text-hq-ink">
          Their family has seen The 120 program notice.
        </span>
      </label>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          {error}
        </p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <Button type="submit" skin="hq" size="lg" disabled={!canSubmit} className="flex-1">
          {busy
            ? retryProfileId
              ? "Finishing…"
              : "Creating…"
            : retryProfileId
              ? "Finish"
              : "Create and open"}
        </Button>
        <Button type="button" skin="hq" variant="secondary" size="lg" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

/**
 * PROPOSED-1's two confirm shapes, and the gap between them is the privacy
 * decision: same-cohort gets the full card (band included, so a guide can settle
 * identity with the child in front of them); cross-cohort gets a count and
 * nothing else. The verdict type carries no band or id on the cross-cohort arm,
 * so this component could not leak one if it tried.
 */
function FwMatchNotice({
  verdict,
  lookupFailed,
  cohortId,
  onOpen,
}: {
  verdict: FwMatchVerdict | null;
  lookupFailed: boolean;
  cohortId: string;
  onOpen: () => void;
}) {
  if (lookupFailed) {
    return (
      <p className="mt-4 rounded-lg border border-hq-border bg-hq-sunken p-3 font-path-body text-sm leading-5 text-hq-ink-soft">
        We couldn&apos;t check whether they already have a record. You can still add them — tell
        staff afterwards so they can merge if needed.
      </p>
    );
  }
  if (!verdict) return null;

  if (verdict.kind === "invalid_name") {
    return (
      <p className="mt-4 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink">
        That name can&apos;t be used as-is — retype it in plain letters.
      </p>
    );
  }

  if (verdict.kind === "same_cohort") {
    return (
      <div className="mt-4 rounded-lg border border-verified/40 bg-verified/10 p-3">
        <p className="font-path-body text-sm leading-5 text-hq-ink">
          {verdict.matches.length === 1
            ? "Someone with this name is already on this weekend's roster."
            : `${verdict.matches.length} students with this name are already on this weekend's roster.`}{" "}
          Open them instead of creating a second record.
        </p>
        <ul className="mt-2 space-y-2">
          {verdict.matches.map((m) =>
            m.source === "import_exception" ? (
              // A pending IMPORT EXCEPTION, not a real student yet — its id is the
              // exception row, not a profile, so there is nothing to "Open" (that
              // link would 404). Staff resolve it on the ops page; the guide's job
              // is just to NOT mint a duplicate (security review).
              <li
                key={m.profileId}
                className="rounded-lg border border-hq-border bg-hq-surface px-3 py-2 font-path-body text-sm leading-5 text-hq-ink"
              >
                Pending staff review — {FW_BAND_LABEL[m.band]}. Check with The 120 staff before
                adding them.
              </li>
            ) : (
              <li key={m.profileId}>
                <a
                  href={`/fp/fw/cohort/${cohortId}/student/${m.profileId}`}
                  onClick={onOpen}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-hq-border bg-hq-surface px-3 font-path-body text-sm font-medium text-hq-ink"
                >
                  <Icon name="arrow-right" size={16} />
                  Open — {FW_BAND_LABEL[m.band]}
                </a>
              </li>
            )
          )}
        </ul>
      </div>
    );
  }

  if (verdict.kind === "cross_cohort") {
    return (
      <p className="mt-4 rounded-lg border border-hq-border bg-hq-sunken p-3 font-path-body text-sm leading-5 text-hq-ink-soft">
        {verdict.count === 1
          ? "A student with this name has a record from another weekend."
          : `${verdict.count} students with this name have records from other weekends.`}{" "}
          Check with The 120 staff before adding them — or add them now and tell staff.
      </p>
    );
  }

  return null;
}
