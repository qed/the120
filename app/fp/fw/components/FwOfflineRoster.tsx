"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Band } from "@/app/fp/content/types";
import { Icon } from "@/app/fp/components/system/Icon";
import { readUsableFwRoster } from "@/app/fp/lib/fw-sync-client";
import type { FwCachedRosterStudent } from "@/app/fp/lib/fw-sync-rules";
import {
  fwDuplicateNameStudentIds,
  searchFwRoster,
  FW_BAND_LABEL,
  type FwRosterStudent,
} from "@/app/fp/lib/fw-nav-rules";

/**
 * The OFFLINE roster fallback (FW Unit 9 — the Decision-15 consumer wiring).
 *
 * Rendered on the roster page's read-failure branch. The server could not load the
 * roster — most often because the device is offline (venue wifi dropped) or a read
 * timed out. This reads the IndexedDB roster cache the online render seeded
 * (`readUsableFwRoster`, built and version-tested in Unit 8 but not wired to a
 * consumer until now) and lets the guide NAVIGATE the ≤90 cached names: each links
 * to the student page, which the service worker serves if it was visited online.
 *
 * Deliberately read-only. Nothing here writes — check-ins still queue on the
 * student/task pages, and quick-create offline is the written procedure (Decision
 * 13), not a form. Search is the SAME `searchFwRoster` / duplicate-flagging the
 * online roster uses (`FwCachedRosterStudent` is exactly `FwRosterStudent`), so the
 * guide's muscle memory and the duplicate-name tiebreaker survive the outage.
 *
 * When there is no usable cache — the weekend's first load was already offline,
 * private mode, or a schema-version bump — it shows the plain "couldn't load"
 * message, the same honest fallback the server branch showed before.
 */

const EMPTY_CACHED: readonly FwCachedRosterStudent[] = [];

type LoadState =
  | { phase: "loading" }
  | { phase: "cache"; students: FwCachedRosterStudent[] }
  | { phase: "none" };

export function FwOfflineRoster({ cohortId }: { cohortId: string }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [query, setQuery] = useState("");

  useEffect(() => {
    let live = true;
    void readUsableFwRoster(cohortId).then((cache) => {
      if (!live) return;
      setState(
        cache && cache.students.length > 0
          ? { phase: "cache", students: cache.students }
          : { phase: "none" }
      );
    });
    return () => {
      live = false;
    };
  }, [cohortId]);

  const cached = state.phase === "cache" ? state.students : EMPTY_CACHED;
  // The search/duplicate helpers are typed over `FwRosterStudent` (band: Band); the
  // cached band is `string` and unused by their name-based logic, so coerce only for
  // them. The band actually DISPLAYED comes from the raw cache below, never this
  // coercion — so a drifted band can never surface a wrong-but-plausible chip.
  const searchable = useMemo<FwRosterStudent[]>(() => cached.map(toSearchable), [cached]);
  const rawBandById = useMemo(() => new Map(cached.map((s) => [s.studentId, s.band])), [cached]);
  const duplicates = useMemo(() => fwDuplicateNameStudentIds(searchable), [searchable]);
  const results = useMemo(() => searchFwRoster(searchable, query), [searchable, query]);

  if (state.phase === "loading") {
    return <p className="font-path-body text-sm leading-6 text-hq-ink-soft">Loading the roster…</p>;
  }

  if (state.phase === "none") {
    return (
      <p
        role="alert"
        className="rounded-xl border border-not-yet/40 bg-not-yet/10 p-4 font-path-body text-sm leading-6 text-hq-ink"
      >
        We couldn&apos;t load the roster just now. Reload the page — if it keeps happening, tell The
        120 staff.
      </p>
    );
  }

  return (
    <div>
      <p
        role="status"
        className="mb-4 rounded-xl border border-hq-border bg-hq-sunken p-3 font-path-body text-sm leading-6 text-hq-ink-soft"
      >
        You&apos;re offline. Showing the roster this device last loaded — check-ins you make will
        sync when you&apos;re back online.
      </p>

      <label className="relative block" htmlFor="fw-offline-roster-search">
        <span className="sr-only">Find a student</span>
        <input
          id="fw-offline-roster-search"
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

      {results.length === 0 ? (
        <p className="mt-6 font-path-body text-sm leading-6 text-hq-ink-soft">
          No one on the cached roster matches “{query.trim()}”.
        </p>
      ) : (
        <ul className="mt-4 space-y-2">
          {results.map((student) => {
            // The band chip's ONLY job is disambiguating two colliding names (G22's
            // tiebreaker) — the one case an offline check-in could land on the wrong
            // permanent record. Read the RAW cached band and render the chip only when it
            // is a recognized band: a drifted/unknown value shows NO chip rather than a
            // plausible-wrong one, so the disambiguator never lies on the surface built to
            // prevent a mis-check-in.
            const bandLabel = bandLabelFor(rawBandById.get(student.studentId));
            return (
              <li key={student.studentId}>
                <Link
                  href={`/fp/fw/cohort/${cohortId}/student/${student.studentId}`}
                  className="flex min-h-[64px] items-center justify-between gap-3 rounded-xl border border-hq-border bg-hq-surface px-4 py-3 shadow-hq transition-colors active:bg-hq-sunken"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-path-display text-lg font-semibold text-hq-ink">
                      {student.firstName} {student.lastName}
                    </span>
                    {duplicates.has(student.studentId) && bandLabel !== null && (
                      <span className="mt-0.5 inline-block rounded-full bg-hq-sunken px-2 py-0.5 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-soft">
                        {bandLabel}
                      </span>
                    )}
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

const FW_BAND_KEYS = new Set<string>(Object.keys(FW_BAND_LABEL));

/**
 * The label for a cached band string, or null if it is not a recognized band. Used for
 * the duplicate-name chip: a null return omits the chip rather than fabricating a
 * default (the "surface the drift, don't guess" posture the whole chip exists to serve).
 */
function bandLabelFor(band: string | undefined): string | null {
  return band !== undefined && FW_BAND_KEYS.has(band) ? FW_BAND_LABEL[band as Band] : null;
}

/**
 * Project a cached student into the `FwRosterStudent` shape the search/duplicate helpers
 * are typed over. Their logic keys on NAME, not band, so the band here is only to satisfy
 * the type — it is never displayed (the chip reads the raw cached band via `bandLabelFor`).
 * A non-Band value coerces to `"g6_8"` purely so the type holds; the value is inert.
 */
function toSearchable(s: FwCachedRosterStudent): FwRosterStudent {
  const band: Band = FW_BAND_KEYS.has(s.band) ? (s.band as Band) : "g6_8";
  return { studentId: s.studentId, firstName: s.firstName, lastName: s.lastName, band };
}
