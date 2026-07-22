"use client";

/**
 * The evidence review list (T1 Unit 10) — the student's captured items and the
 * parent's review surface. PRESENTATIONAL: it renders from props the route
 * resolves (the route provides each item's signed-download URL from the STORED
 * row, reused until near expiry — never minted per render, which triples CDN
 * cost). No data fetching, no Supabase client → env-less-build safe.
 *
 * The plan's load-bearing distinctions, each rendered:
 *   * a REDACTED item is a tombstone ("removed"), never the media — its object and
 *     poster are already deleted and its URL nulled.
 *   * a VIDEO always has a poster frame, so the list renders even when the clip is
 *     unplayable on the viewer's browser.
 *   * an item that landed AFTER verification (Unit 11 offline sync) is flagged
 *     quietly to the reviewer — never invisible (R6), never a re-celebration.
 *   * a zero-row LOG still renders (headers + empty state); no log at all renders
 *     nothing (LogTable / describeLogTable own that distinction).
 * Captions are free text — rendered through React's default escaping.
 */

import type { Band } from "@/app/path/content/types";
import { isSafeHttpUrl, type EvidenceKind } from "@/app/path/lib/evidence-rules";
import { LogTable } from "./LogTable";

export type EvidenceItemView = {
  id: string;
  kind: EvidenceKind;
  /** Signed-download URL for the main object (from the stored row). Null for
   *  log/link/redacted. */
  url: string | null;
  /** Signed-download URL for a video's poster frame. */
  posterUrl: string | null;
  contentType: string | null;
  caption: string | null;
  linkUrl: string | null;
  /** kind='log' rows, for the read-only render. */
  logRows: Record<string, unknown>[];
  redactedAt: string | null;
  addedAfterVerification: boolean;
};

export function EvidenceList({
  studentId,
  taskId,
  band,
  items,
}: {
  studentId: string;
  taskId: string;
  band: Band;
  items: readonly EvidenceItemView[];
}) {
  if (items.length === 0) {
    return (
      <div data-path-evidence-list data-empty>
        <p>No evidence yet.</p>
      </div>
    );
  }

  return (
    <ul data-path-evidence-list>
      {items.map((item) => (
        <li key={item.id} data-evidence-kind={item.kind}>
          {item.redactedAt ? (
            <p data-redacted>This item was removed.</p>
          ) : (
            <EvidenceBody studentId={studentId} taskId={taskId} band={band} item={item} />
          )}
          {item.caption && !item.redactedAt && <figcaption>{item.caption}</figcaption>}
          {item.addedAfterVerification && !item.redactedAt && (
            <p data-added-after-verification>Added after this task was verified.</p>
          )}
        </li>
      ))}
    </ul>
  );
}

function EvidenceBody({
  studentId,
  taskId,
  band,
  item,
}: {
  studentId: string;
  taskId: string;
  band: Band;
  item: EvidenceItemView;
}) {
  switch (item.kind) {
    case "photo":
      return item.url ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed URL, not a static asset
        <img src={item.url} alt={item.caption ?? "Captured photo"} loading="lazy" />
      ) : null;

    case "video":
      return item.url ? (
        <video controls preload="none" poster={item.posterUrl ?? undefined}>
          <source src={item.url} type={item.contentType ?? "video/mp4"} />
        </video>
      ) : item.posterUrl ? (
        // The clip is gone but the poster survives — still show something.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.posterUrl} alt={item.caption ?? "Video poster"} loading="lazy" />
      ) : null;

    case "audio":
      return item.url ? <audio controls preload="none" src={item.url} /> : null;

    case "document":
      return item.url ? (
        <a href={item.url} target="_blank" rel="noopener noreferrer">
          {item.caption ?? "Open document"}
        </a>
      ) : null;

    case "link":
      // Defense in depth: only render an http(s) link as an anchor (the write path
      // already refuses other schemes) so a stored javascript:/data: URL is inert.
      return item.linkUrl && isSafeHttpUrl(item.linkUrl) ? (
        <a href={item.linkUrl} target="_blank" rel="noopener noreferrer">
          {item.caption ?? item.linkUrl}
        </a>
      ) : null;

    case "log":
      return (
        <LogTable
          studentId={studentId}
          taskId={taskId}
          band={band}
          evidenceId={item.id}
          initialRows={item.logRows}
          readOnly
        />
      );

    default:
      return null;
  }
}
