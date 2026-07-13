"use client";

/**
 * Library grid (plan Unit 7; brief §9/§11): item cards — mono type tag,
 * title, concern chip, body preview, helpfulness thumbs, send count, SEND —
 * with type + concern filter chips above. Opens the SendComposer; when the
 * page was reached via the drawer's SEND FROM LIBRARY (`?family={id}`), a
 * banner names the pre-selected family and every composer opens on them.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CONCERN_LABELS,
  CONCERNS,
  type Concern,
} from "@/app/crm/lib/constants";
import {
  LIBRARY_ITEM_TYPES,
  LIBRARY_TYPE_LABELS,
  type LibraryItemType,
} from "@/app/crm/lib/library-rules";
import type { ComposerFamily, LibraryItem } from "@/app/crm/lib/queries";
import { rateHelpfulness } from "@/app/crm/lib/actions/library";
import { useToast } from "@/app/crm/components/Toast";
import { BTN_PRIMARY, Chip } from "@/app/crm/components/pipeline/atoms";
import SendComposer from "./SendComposer";

const concernLabel = (slug: string): string =>
  CONCERN_LABELS[slug as Concern] ?? slug;

function ItemCard({
  item,
  onSend,
  onRate,
  rating,
}: {
  item: LibraryItem;
  onSend: () => void;
  onRate: (delta: 1 | -1) => void;
  rating: boolean;
}) {
  return (
    <article className="flex flex-col rounded-[12px] border border-crm-line bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-crm-ink px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.08em] text-white">
          {LIBRARY_TYPE_LABELS[item.type as LibraryItemType] ??
            item.type.toUpperCase()}
        </span>
        {item.concern && (
          <span className="rounded-full border border-crm-line2 bg-crm-card px-2 py-[3px] font-mono text-[9px] uppercase tracking-[0.06em] text-crm-muted">
            {concernLabel(item.concern)}
          </span>
        )}
      </div>

      <h3 className="mt-2.5 font-mono text-[11.5px] uppercase leading-snug tracking-[0.06em] text-crm-ink">
        {item.title}
      </h3>
      <p className="mt-2 line-clamp-3 flex-1 text-[12.5px] leading-relaxed text-crm-muted">
        {item.body}
      </p>
      {item.url && (
        <p className="mt-2 font-mono text-[10px] tracking-[0.04em] text-crm-blue">
          {item.url}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2 border-t border-crm-line pt-3">
        <span
          className="font-mono text-[10.5px] text-crm-ink"
          title="Helpfulness — feeds suggestion ranking"
        >
          👍 {item.helpfulness}
        </span>
        <button
          type="button"
          onClick={() => onRate(1)}
          disabled={rating}
          aria-label={`Mark "${item.title}" helpful`}
          className="cursor-pointer rounded-full border border-crm-line2 px-1.5 py-0.5 font-mono text-[10px] text-crm-muted hover:border-crm-green hover:text-crm-green disabled:cursor-not-allowed disabled:opacity-50"
        >
          +1
        </button>
        <button
          type="button"
          onClick={() => onRate(-1)}
          disabled={rating || item.helpfulness === 0}
          aria-label={`Mark "${item.title}" less helpful`}
          className="cursor-pointer rounded-full border border-crm-line2 px-1.5 py-0.5 font-mono text-[10px] text-crm-muted hover:border-crm-red hover:text-crm-red disabled:cursor-not-allowed disabled:opacity-50"
        >
          −1
        </button>
        <span className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.08em] text-crm-faint">
          Sent ×{item.sendCount}
        </span>
        <button type="button" onClick={onSend} className={BTN_PRIMARY}>
          Send
        </button>
      </div>
    </article>
  );
}

export default function LibraryGrid({
  items,
  families,
  initialFamilyId,
}: {
  items: LibraryItem[];
  families: ComposerFamily[];
  initialFamilyId?: string;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [concernFilter, setConcernFilter] = useState<string | null>(null);
  const [composerItem, setComposerItem] = useState<LibraryItem | null>(null);
  const [ratingId, setRatingId] = useState<string | null>(null);

  const preselected = useMemo(
    () =>
      initialFamilyId
        ? (families.find((f) => f.id === initialFamilyId) ?? null)
        : null,
    [families, initialFamilyId]
  );

  // Only offer concern chips that actually have items.
  const presentConcerns = useMemo(() => {
    const present = new Set(items.map((i) => i.concern).filter(Boolean));
    return CONCERNS.filter((c) => present.has(c));
  }, [items]);

  const filtered = useMemo(
    () =>
      items.filter(
        (i) =>
          (!typeFilter || i.type === typeFilter) &&
          (!concernFilter || i.concern === concernFilter)
      ),
    [items, typeFilter, concernFilter]
  );

  const handleRate = async (item: LibraryItem, delta: 1 | -1) => {
    setRatingId(item.id);
    const result = await rateHelpfulness({ itemId: item.id, delta });
    setRatingId(null);
    if (result.success) {
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to record the rating.");
    }
  };

  return (
    <div className="px-5 py-6 sm:px-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
            {items.length === 1 ? "1 ITEM" : `${items.length} ITEMS`}
          </p>
          <h1 className="mt-1 font-serif text-[28px] font-normal tracking-[-0.01em] text-crm-ink">
            Library
          </h1>
        </div>
      </div>

      {preselected && (
        <div className="mt-4 flex flex-wrap items-center gap-2.5 rounded-[12px] border border-crm-blue/30 bg-white px-3.5 py-2.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-crm-blue">
            Sending to {preselected.name} — pick an item
          </span>
          <button
            type="button"
            onClick={() => router.push("/crm/library")}
            className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.08em] text-crm-muted hover:text-crm-ink"
          >
            Clear
          </button>
        </div>
      )}

      {items.length === 0 ? (
        /* Library-empty state (brief §11 voice) */
        <div className="flex flex-col items-center px-6 py-24 text-center">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-red">
            Library
          </p>
          <h2 className="mt-3 font-serif text-[28px] font-normal tracking-[-0.01em] text-crm-ink">
            The answers live here — the seeds arrive with the migration.
          </h2>
        </div>
      ) : (
        <>
          {/* Filter chips: type row + concern row */}
          <div className="mt-5 space-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip active={!typeFilter} onClick={() => setTypeFilter(null)}>
                All types
              </Chip>
              {LIBRARY_ITEM_TYPES.map((t) => (
                <Chip
                  key={t}
                  active={typeFilter === t}
                  onClick={() => setTypeFilter(typeFilter === t ? null : t)}
                >
                  {LIBRARY_TYPE_LABELS[t]} ·{" "}
                  {items.filter((i) => i.type === t).length}
                </Chip>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <Chip
                active={!concernFilter}
                onClick={() => setConcernFilter(null)}
              >
                All concerns
              </Chip>
              {presentConcerns.map((c) => (
                <Chip
                  key={c}
                  active={concernFilter === c}
                  onClick={() =>
                    setConcernFilter(concernFilter === c ? null : c)
                  }
                >
                  {CONCERN_LABELS[c]}
                </Chip>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <div className="mt-8 py-16 text-center">
              <p className="font-serif text-[16px] italic text-crm-muted">
                No items match these filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setTypeFilter(null);
                  setConcernFilter(null);
                }}
                className="mt-3 cursor-pointer font-mono text-[10px] uppercase tracking-[0.08em] text-crm-blue hover:underline"
              >
                Clear filters
              </button>
            </div>
          ) : (
            <div className="mt-4 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((item) => (
                <ItemCard
                  key={item.id}
                  item={item}
                  rating={ratingId === item.id}
                  onRate={(delta) => handleRate(item, delta)}
                  onSend={() => setComposerItem(item)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {composerItem && (
        <SendComposer
          item={composerItem}
          families={families}
          initialFamilyId={initialFamilyId}
          onClose={() => setComposerItem(null)}
        />
      )}
    </div>
  );
}
