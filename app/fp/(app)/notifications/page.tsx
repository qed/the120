import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requirePathUser } from "@/app/fp/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveParentFamily } from "@/app/fp/lib/family-loader";
import { resolveStudentSelf } from "@/app/fp/lib/journey-loader";
import { loadNotificationFeed } from "@/app/fp/lib/notifications-loader";
import type { FeedItem } from "@/app/fp/lib/celebration-tier1-rules";
import { Icon, type IconName } from "@/app/fp/components/system/Icon";
import { cn } from "@/app/fp/components/system/cn";
import { MarkSeenOnMount } from "./MarkSeenOnMount";

/**
 * /fp/notifications — the R27 in-app surface (T1 Unit 16): the guaranteed
 * channel an under-13 student with no inbox has. Unit 12 stored the events;
 * this page is their reader.
 *
 *   - Ordered by the SOURCE moment (occurred_at coalesced to created_at) —
 *     never created_at alone; a cron-backfilled row carries heal-time
 *     created_at.
 *   - The register resolves at READ time from the student's current skin —
 *     nothing rendered is ever stored (a Trail-queued Not Yet reads as HQ
 *     after a toggle).
 *   - Superseded events render PAST-TENSE with the correction inline —
 *     history intact, no re-celebration, nothing deleted.
 *   - Landing here stamps every unseen event seen (MarkSeenOnMount — a
 *     Server Action, never a mutation on GET).
 *
 * Auth runs FIRST in the body (never only in the layout). A parent hitting
 * this URL goes to their dashboard (their channels are email + the review
 * queue); any other non-student session is a 404 (mirrors /fp/review).
 */

export const metadata: Metadata = {
  title: "Notifications — First Profit",
  robots: { index: false, follow: false },
};

const TONE_ICON: Record<FeedItem["tone"], IconName> = {
  celebrate: "stamp",
  amber: "circle-dot",
  info: "clock",
  past: "stamp",
  skipped: "circle-dashed",
};

function toneColor(tone: FeedItem["tone"], trail: boolean): string {
  switch (tone) {
    case "celebrate":
      return trail ? "text-wax" : "text-verified";
    case "amber":
      return "text-not-yet";
    case "info":
      return "text-awaiting";
    case "past":
    case "skipped":
      return trail ? "text-trail-ink-soft" : "text-hq-ink-muted";
  }
}

function whenLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(ms));
}

export default async function PathNotificationsPage() {
  const { userId, grants } = await requirePathUser();

  const db = supabaseAdmin();
  const self = await resolveStudentSelf(db, grants);
  if (!self) {
    const family = await resolveParentFamily({ userId, grants });
    if (family) redirect("/fp");
    notFound();
  }

  const trail = self.skin === "trail";
  const feed = await loadNotificationFeed(db, self.ctx, self.skin);

  const ink = trail ? "text-trail-ink" : "text-hq-ink";
  const inkSoft = trail ? "text-trail-ink-soft" : "text-hq-ink-soft";
  const surface = trail ? "border-trail-mist bg-trail-surface" : "border-hq-border bg-hq-surface";

  return (
    <div className="flex flex-col gap-4">
      <MarkSeenOnMount eventIds={feed.unseenIds} />

      <header>
        <h1 className={cn("font-path-display text-[22px] font-semibold", ink)}>
          {trail ? "Your news" : "Notifications"}
        </h1>
        <p className={cn("mt-1 font-path-body text-[13px]", inkSoft)}>
          {trail
            ? "Every stamp, every note from your grown-ups — the trail keeps them all."
            : "Every verification, note, and review — kept in order."}
        </p>
      </header>

      {feed.items.length === 0 && (
        <div className={cn("rounded-xl border p-6 text-center", surface)}>
          <p className={cn("font-path-body text-[14px]", ink)}>
            {trail ? "Nothing here yet — your first stamp will land right here." : "Nothing yet."}
          </p>
          <p className={cn("mt-1 font-path-body text-[12.5px]", inkSoft)}>
            {trail
              ? "Finish a step and ask a grown-up to take a look."
              : "Submit a task — the verification lands here the moment it happens."}
          </p>
        </div>
      )}

      <ol className="flex flex-col gap-3">
        {feed.items.map((item) => {
          const muted = item.tone === "past" || item.tone === "skipped";
          const body = (
            <article
              className={cn(
                "relative rounded-[14px] border px-4 py-3.5 transition-colors",
                surface,
                muted && "opacity-80",
                item.href && (trail ? "hover:bg-trail-canvas" : "hover:bg-hq-sunken")
              )}
            >
              {item.unseen && (
                <span
                  className="absolute right-3 top-3 h-2 w-2 rounded-full bg-awaiting"
                  aria-label={trail ? "New" : "Unseen"}
                />
              )}
              <div className="flex gap-3">
                <span className={cn("mt-0.5 flex-shrink-0", toneColor(item.tone, trail))} aria-hidden>
                  <Icon name={TONE_ICON[item.tone]} size={20} strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <span
                      className={cn(
                        "font-path-body text-[10.5px] font-bold uppercase tracking-[0.05em]",
                        item.tone === "celebrate" ? "text-verified" : toneColor(item.tone, trail)
                      )}
                    >
                      {item.eyebrow}
                    </span>
                    <span className={cn("font-path-mono text-[10.5px]", inkSoft)}>{whenLabel(item.whenIso)}</span>
                  </div>
                  <h2 className={cn("mt-0.5 font-path-display text-[15.5px] font-semibold leading-snug", ink)}>
                    {item.headline}
                  </h2>
                  {item.note && (
                    <p
                      className={cn(
                        "mt-2 rounded-lg px-3 py-2 font-path-body text-[12.5px] italic leading-relaxed",
                        item.tone === "celebrate" || item.tone === "past" ? "bg-verified/8" : "bg-not-yet/8",
                        ink
                      )}
                    >
                      &ldquo;{item.note}&rdquo;
                    </p>
                  )}
                  {item.body && <p className={cn("mt-1.5 font-path-body text-[12.5px] leading-snug", inkSoft)}>{item.body}</p>}
                  {item.correction && (
                    <p className={cn("mt-1.5 font-path-body text-[12px] italic leading-snug", inkSoft)}>
                      {item.correction}
                    </p>
                  )}
                </div>
              </div>
            </article>
          );
          return (
            <li key={item.eventId}>
              {item.href ? (
                <Link href={item.href} className="block">
                  {body}
                </Link>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
