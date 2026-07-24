"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/path/components/system/Button";
import { linkStudentAction, lookupMatchAction } from "@/app/path/lib/actions/fw-ops";
import type { FwMatchResolutionEntry } from "@/app/path/lib/fw-ops-core";

/**
 * Staff cross-cohort match resolution (FW Unit 5b; PROPOSED-1, accepted).
 *
 * The guide's quick-create shows a MINIMAL cross-cohort signal — a count, no
 * detail — because a Boston guide has no business learning a Hamptons child's
 * band or dates on a typed name. Staff, already authorized across cohorts, see
 * the FULL detail here: every existing student of that name, their band, and the
 * weekends they belong to. Then they either link an existing student into this
 * weekend or confirm the child is genuinely new (which is just quick-create).
 *
 * The lookup is a Server Action, not a page param, so the free-text name never
 * renders a candidate list to a session that is not staff. ONE busy state,
 * try/catch/FINALLY throughout.
 */

type Lookup =
  | { kind: "idle" }
  | { kind: "invalid_name" }
  | { kind: "matches"; entries: FwMatchResolutionEntry[]; firstName: string; lastName: string };

export default function FwMatchResolver({ cohortId }: { cohortId: string }) {
  const router = useRouter();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  /** "lookup", a profileId being linked, or null. */
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [result, setResult] = useState<Lookup>({ kind: "idle" });
  const anyBusy = busy !== null;

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (anyBusy || firstName.trim().length === 0 || lastName.trim().length === 0) return;
    setBusy("lookup");
    setError(null);
    setNotice(null);
    try {
      const res = await lookupMatchAction({
        cohortId,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
      if (!res.success) {
        setError(res.error);
        return;
      }
      if (res.kind === "invalid_name") {
        setResult({ kind: "invalid_name" });
        return;
      }
      setResult({
        kind: "matches",
        entries: res.entries,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
      });
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const handleLink = async (profileId: string) => {
    if (anyBusy) return;
    setBusy(profileId);
    setError(null);
    setNotice(null);
    try {
      const res = await linkStudentAction({ cohortId, studentId: profileId });
      if (res.success) {
        setNotice(
          res.alreadyMember
            ? "That student is already in this weekend."
            : "Linked into this weekend — their record is already filled in."
        );
        router.refresh();
        return;
      }
      setError(res.error);
    } catch {
      setError("That didn't go through. Try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mt-3">
      <form
        onSubmit={handleLookup}
        className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq"
      >
        <div className="flex flex-wrap gap-3">
          <label className="min-w-[8rem] flex-1" htmlFor="fw-match-first">
            <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
              First name
            </span>
            <input
              id="fw-match-first"
              type="text"
              className="h-12 w-full rounded-xl border border-hq-border bg-hq-canvas px-3 font-path-body text-base text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Maya"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
          <label className="min-w-[8rem] flex-1" htmlFor="fw-match-last">
            <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
              Last name
            </span>
            <input
              id="fw-match-last"
              type="text"
              className="h-12 w-full rounded-xl border border-hq-border bg-hq-canvas px-3 font-path-body text-base text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Chen"
              autoComplete="off"
              spellCheck={false}
              required
            />
          </label>
        </div>
        <div className="mt-3">
          <Button
            type="submit"
            skin="hq"
            size="md"
            disabled={anyBusy || firstName.trim().length === 0 || lastName.trim().length === 0}
          >
            {busy === "lookup" ? "Looking up…" : "Look up"}
          </Button>
        </div>
      </form>

      {result.kind === "invalid_name" && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          That name can&apos;t be looked up — check the spelling and try again.
        </p>
      )}

      {result.kind === "matches" && result.entries.length === 0 && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-hq-border bg-hq-sunken p-3 font-path-body text-sm leading-5 text-hq-ink-soft"
        >
          No existing student named {result.firstName} {result.lastName}. This is a new student —
          the guide can create them from the check-in surface.
        </p>
      )}

      {result.kind === "matches" && result.entries.length > 0 && (
        <ul className="mt-4 space-y-3">
          {result.entries.map((entry) => {
            const rowBusy = busy === entry.profileId;
            const where =
              entry.memberships.length > 0
                ? entry.memberships.map((m) => m.slug).join(", ")
                : "no weekends yet";
            return (
              <li
                key={entry.profileId}
                className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-path-body text-sm font-medium text-hq-ink">
                    {entry.firstName} {entry.lastName}
                  </p>
                  <span className="inline-flex items-center rounded-full border border-hq-border bg-hq-sunken px-2.5 py-0.5 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-soft">
                    {entry.band}
                  </span>
                </div>
                <p className="mt-1.5 font-path-body text-sm leading-5 text-hq-ink-soft">
                  In: {where}
                </p>
                <div className="mt-3">
                  {entry.inActiveCohort ? (
                    <span className="inline-flex items-center rounded-full border border-verified/40 bg-verified/10 px-2.5 py-0.5 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink">
                      Already in this weekend
                    </span>
                  ) : (
                    <Button
                      type="button"
                      skin="hq"
                      variant="secondary"
                      size="md"
                      onClick={() => handleLink(entry.profileId)}
                      disabled={anyBusy}
                    >
                      {rowBusy ? "Linking…" : "Link into this weekend"}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

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
