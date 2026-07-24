"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { Icon } from "@/app/path/components/system/Icon";
import {
  readFwPref,
  serverFwPref,
  subscribeFwPrefs,
  FW_ACTIVE_COHORT_KEY,
  FW_PREF_UNKNOWN,
  type FwCohortMemory,
} from "@/app/path/lib/fw-device";

/**
 * The cohort switcher's pick screen (FW Unit 4, Decision 3).
 *
 * THERE IS NO DEFAULT, and that absence is the feature. A guide working two
 * weekends — or a staff member who ran Boston and is now at Hamptons — makes an
 * explicit pick at session start, because the cohort they pick is the cohort
 * every tap for the rest of the shift is stamped with. A pre-selected "most
 * likely" cohort would turn one moment of inattention into a permanent, silent
 * mis-stamp on a child's record in an append-only log.
 *
 * "Persists per device" is served WITHOUT becoming a default: this device's last
 * pick is LABELLED, not chosen. The label is genuinely useful (a shared iPad
 * that has been on the Boston table all morning says so) and costs nothing,
 * because a tap is still required.
 *
 * Single-cohort sessions never reach this screen at all — the page redirects
 * past it, which is what "hidden for single-cohort sessions" means.
 */
export default function FwCohortPicker({
  cohorts,
}: {
  cohorts: readonly { id: string; slug: string }[];
}) {
  const stored = useSyncExternalStore(
    subscribeFwPrefs,
    () => readFwPref(FW_ACTIVE_COHORT_KEY),
    serverFwPref
  );

  let lastUsed: string | null = null;
  if (stored !== FW_PREF_UNKNOWN && stored !== null) {
    try {
      const parsed: FwCohortMemory | null = JSON.parse(stored);
      lastUsed = typeof parsed?.id === "string" ? parsed.id : null;
    } catch {
      // A corrupt value costs a label, nothing more.
      lastUsed = null;
    }
  }

  return (
    <ul className="mt-5 space-y-3">
      {cohorts.map((cohort) => (
        <li key={cohort.id}>
          <Link
            href={`/path/fw/cohort/${cohort.id}`}
            className="flex min-h-[64px] items-center justify-between gap-3 rounded-xl border border-hq-border bg-hq-surface px-5 py-4 shadow-hq transition-colors hover:border-hq-border-strong active:bg-hq-sunken"
          >
            <span>
              <span className="block font-path-display text-lg font-semibold text-hq-ink">
                {cohort.slug}
              </span>
              {lastUsed === cohort.id && (
                <span className="mt-0.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
                  Last used on this iPad
                </span>
              )}
            </span>
            <Icon name="chevron-right" size={22} className="shrink-0 text-hq-ink-muted" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
