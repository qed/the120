"use client";

/**
 * Family dashboard — the children's PUBLIC SITE strip (real-public-site plan,
 * Unit 2; R21/R22): each child's firstprofit.school/<handle> status and the
 * parent's one-action take-offline / put-back-online control, driving the
 * setFpSitePublished Server Action (the R21 email's "manage it from your
 * family dashboard" link lands here). Rendered only when at least one child
 * has claimed a handle.
 *
 * States mirror the shared deriveSiteStatus ladder: published → live link +
 * "Take offline"; offline (parent takedown) → "Put back online"; offline with
 * operatorLocked → taken down by The 120, no parent control (a republish
 * cannot clear the lock, so no button is offered); claimed → not published
 * yet, no control. NOTE: putting a page back online means the child's page is
 * visible again immediately; the child's own republish flow (not this button)
 * is what re-sends the R21 email.
 */

import { useState, useTransition } from "react";
import { setFpSitePublished } from "@/app/fp/lib/actions/fp-site";
import type { SiteStatus } from "@/app/fp/lib/fp-public-site-rules";

export type FamilySiteRow = {
  childId: string;
  firstName: string;
  handle: string;
  status: SiteStatus;
  operatorLocked: boolean;
};

function statusLabel(row: FamilySiteRow): string {
  if (row.operatorLocked) return "Taken down by The 120 — contact us with questions";
  if (row.status === "published") return "Live — anyone with the link can see it";
  if (row.status === "offline") return "Offline — only you can put it back";
  return "Not published yet";
}

export function FamilySites({ sites }: { sites: FamilySiteRow[] }) {
  const [rows, setRows] = useState(sites);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) return null;

  const toggle = (row: FamilySiteRow, published: boolean): void => {
    setError(null);
    startTransition(async () => {
      const result = await setFpSitePublished({ childId: row.childId, published });
      if (!result.ok) {
        setError("That didn't work — please try again in a moment.");
        return;
      }
      setRows((prev) =>
        prev.map((r) =>
          r.childId === row.childId
            ? { ...r, status: result.site.status, operatorLocked: result.site.operatorLocked }
            : r
        )
      );
    });
  };

  return (
    <section className="mt-8">
      <h2 className="font-path-display text-lg font-semibold tracking-tight text-hq-ink">
        Public sites
      </h2>
      <p className="mt-2 font-path-body text-xs leading-5 text-hq-ink-soft">
        Each founder&apos;s public page shows their first name, their headline, and a one-line
        description of their idea. You can take a page offline any time.
      </p>
      {error ? (
        <p className="mt-2 font-path-body text-xs leading-5 text-not-yet" role="alert">
          {error}
        </p>
      ) : null}
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li
            key={row.childId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-hq-border bg-hq-canvas p-4 shadow-hq"
          >
            <div className="min-w-0">
              <div className="font-path-body text-[15px] font-semibold text-hq-ink">
                {row.firstName}
              </div>
              {row.status === "published" ? (
                <a
                  href={`https://firstprofit.school/${row.handle}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-path-body text-xs text-hq-ink underline underline-offset-2"
                >
                  firstprofit.school/{row.handle}
                </a>
              ) : (
                <span className="font-path-body text-xs text-hq-ink-muted">
                  firstprofit.school/{row.handle}
                </span>
              )}
              <div className="mt-0.5 font-path-body text-[11px] text-hq-ink-muted">
                {statusLabel(row)}
              </div>
            </div>
            {!row.operatorLocked && row.status === "published" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(row, false)}
                className="rounded-lg border border-hq-border px-3 py-2 font-path-body text-xs font-semibold text-hq-ink disabled:opacity-50"
              >
                Take offline
              </button>
            ) : null}
            {!row.operatorLocked && row.status === "offline" ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => toggle(row, true)}
                className="rounded-lg border border-hq-border px-3 py-2 font-path-body text-xs font-semibold text-hq-ink disabled:opacity-50"
              >
                Put back online
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
