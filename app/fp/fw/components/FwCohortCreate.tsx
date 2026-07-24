"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/fp/components/system/Button";
import { createFwCohortAction } from "@/app/fp/lib/actions/fw-ops";
import { FW_EVENT_TIME_ZONES } from "@/app/fp/lib/fw-ops-rules";

/**
 * The cohort-creation form (FW Unit 5; FW-R23, Decision 4).
 *
 * THE TIMEZONE FIELD IS NOT OPTIONAL AND HAS NO DEFAULT, and that is the same
 * argument Decision 3 makes about the cohort switcher: a default is a value
 * somebody will fail to notice, and this one silently moves when a projected
 * board expires. Five cities across three zones means the browser's own zone is
 * wrong more often than it is right — so the form asks, every time.
 *
 * try/catch/FINALLY on the submitting flag, per docs/solutions/ui-bugs/
 * server-action-rejection-no-try-finally-freezes-capture-modal-2026-07-20.md: a
 * Server Action can REJECT rather than return a result, and a stuck flag leaves
 * staff unable to retry.
 */

const inputCls =
  "h-12 w-full rounded-xl border border-hq-border bg-hq-canvas px-3 font-path-body text-base text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10";
const labelCls =
  "mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted";

export default function FwCohortCreate() {
  const router = useRouter();
  const [slug, setSlug] = useState("");
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("17:00");
  const [timeZone, setTimeZone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  const canSubmit =
    slug.trim().length > 0 &&
    startDate.length > 0 &&
    startTime.length > 0 &&
    endDate.length > 0 &&
    endTime.length > 0 &&
    timeZone.length > 0 &&
    !busy;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setCreated(null);
    try {
      const res = await createFwCohortAction({
        slug,
        startDate,
        startTime,
        endDate,
        endTime,
        timeZone,
      });
      if (res.success) {
        // The NORMALIZED slug is shown back, because it is what guides will read
        // in their header and it may not be exactly what was typed
        // ("Boston 2026 08" → boston-2026-08). A silent transformation of a
        // unique key is a key staff cannot search for later.
        setCreated(res.slug);
        setSlug("");
        setStartDate("");
        setEndDate("");
        router.refresh();
        return; // finally still clears busy
      }
      setError(res.error);
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
      <label className="block" htmlFor="fw-cohort-slug">
        <span className={labelCls}>Name</span>
        <input
          id="fw-cohort-slug"
          className={inputCls}
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="boston-2026-08"
          autoComplete="off"
          spellCheck={false}
          required
        />
      </label>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block" htmlFor="fw-cohort-start-date">
          <span className={labelCls}>Starts</span>
          <input
            id="fw-cohort-start-date"
            type="date"
            className={inputCls}
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
        </label>
        <label className="block" htmlFor="fw-cohort-start-time">
          <span className={labelCls}>at</span>
          <input
            id="fw-cohort-start-time"
            type="time"
            className={inputCls}
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            required
          />
        </label>
        <label className="block" htmlFor="fw-cohort-end-date">
          <span className={labelCls}>Ends</span>
          <input
            id="fw-cohort-end-date"
            type="date"
            className={inputCls}
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </label>
        <label className="block" htmlFor="fw-cohort-end-time">
          <span className={labelCls}>at</span>
          <input
            id="fw-cohort-end-time"
            type="time"
            className={inputCls}
            value={endTime}
            onChange={(e) => setEndTime(e.target.value)}
            required
          />
        </label>
      </div>

      <label className="mt-4 block" htmlFor="fw-cohort-tz">
        <span className={labelCls}>The host city&apos;s clock</span>
        <select
          id="fw-cohort-tz"
          className={inputCls}
          value={timeZone}
          onChange={(e) => setTimeZone(e.target.value)}
          required
        >
          {/* No default. The dates above mean nothing without this, and a
              pre-selected zone is one nobody re-reads. */}
          <option value="">Pick one…</option>
          {FW_EVENT_TIME_ZONES.map((z) => (
            <option key={z.id} value={z.id}>
              {z.label}
            </option>
          ))}
        </select>
      </label>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          {error}
        </p>
      )}
      {created && (
        <p
          role="status"
          className="mt-3 rounded-lg border border-verified/40 bg-verified/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          Created <strong>{created}</strong>. Open it to add guides and mint the board link.
        </p>
      )}

      <div className="mt-4">
        <Button type="submit" skin="hq" size="lg" disabled={!canSubmit}>
          {busy ? "Creating…" : "Create weekend"}
        </Button>
      </div>
    </form>
  );
}
