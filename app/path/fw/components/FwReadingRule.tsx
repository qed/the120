"use client";

import { useSyncExternalStore } from "react";
import { Icon } from "@/app/path/components/system/Icon";
import {
  readFwPref,
  serverFwPref,
  subscribeFwPrefs,
  writeFwPref,
  FW_PREF_UNKNOWN,
  FW_READING_RULE,
  FW_READING_RULE_DISMISSED_KEY,
} from "@/app/path/lib/fw-device";

/**
 * The FW reading rule banner (FW-R15, Decision 14).
 *
 * The done-when lines were written for home study. Several of them are literally
 * unsatisfiable at a Founders Weekend — 1.2.3 wants a parent playing the buyer,
 * 1.2.5 wants a photo in the Founder File — and FW has neither parents in the
 * loop nor evidence capture. Stated once, every guide reads them the same way;
 * unstated, every guide improvises privately and the Not-yet data starts
 * measuring clause inapplicability instead of task difficulty, which is the one
 * thing FW-D4 needs it not to do.
 *
 * PER-DEVICE, DISMISSIBLE, AND RE-OPENABLE (Decision 14). Dismissible because a
 * guide who has read it should not be paying for it in vertical space on every
 * student for two days; re-openable because the moment they need it is the
 * moment a done-when line surprises them, which is hours after they dismissed
 * it. The dismissal IS the state — there is no separate session copy that could
 * disagree with what is stored.
 *
 * Renders nothing until the stored preference is known, so a guide who dismissed
 * it this morning never sees it flash back on a navigation.
 */
export default function FwReadingRule() {
  const stored = useSyncExternalStore(
    subscribeFwPrefs,
    () => readFwPref(FW_READING_RULE_DISMISSED_KEY),
    serverFwPref
  );

  if (stored === FW_PREF_UNKNOWN) return null;

  if (stored === "1") {
    return (
      <button
        type="button"
        onClick={() => writeFwPref(FW_READING_RULE_DISMISSED_KEY, null)}
        className="inline-flex min-h-[44px] items-center gap-1.5 font-path-body text-sm text-hq-ink-soft underline underline-offset-2 hover:text-hq-ink"
      >
        <Icon name="file-text" size={16} />
        {FW_READING_RULE.title}
      </button>
    );
  }

  return (
    <aside className="rounded-xl border border-hq-border bg-hq-sunken p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
          {FW_READING_RULE.title}
        </p>
        <button
          type="button"
          onClick={() => writeFwPref(FW_READING_RULE_DISMISSED_KEY, "1")}
          aria-label="Dismiss the reading rule"
          className="-m-2 inline-flex h-11 w-11 shrink-0 items-center justify-center text-hq-ink-muted hover:text-hq-ink"
        >
          <Icon name="x" size={18} />
        </button>
      </div>
      <ul className="mt-2 space-y-1">
        {FW_READING_RULE.clauses.map((clause) => (
          <li key={clause} className="font-path-body text-sm leading-6 text-hq-ink">
            {clause}
          </li>
        ))}
      </ul>
    </aside>
  );
}
