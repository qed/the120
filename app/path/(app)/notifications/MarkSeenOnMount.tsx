"use client";

/**
 * The feed page's cursor stamp (T1 Unit 16). Reading the feed IS seeing the
 * moments, so landing here retires every unseen event — via a Server Action
 * on mount, never a render-time mutation (pages must not mutate on GET; a
 * prefetched or scanner-fetched render must not consume a child's replay).
 *
 * After the stamp lands, one router.refresh() lets the shell badge and the
 * "new" markers settle to the stamped truth. A failed stamp self-heals: the
 * events simply replay on next open.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { markNotificationEventsSeen } from "@/app/path/lib/actions/notifications";
import { MAX_SEEN_IDS_PER_CALL } from "@/app/path/lib/celebration-tier1-rules";

export function MarkSeenOnMount({ eventIds }: { eventIds: string[] }) {
  const router = useRouter();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current || eventIds.length === 0) return;
    firedRef.current = true;
    void (async () => {
      // Best-effort across batches: one batch's typed refusal or throw must
      // not strand the ones after it (ce-review — the action fails CLOSED
      // with {ok:false} rather than throwing, so both paths are checked).
      let stampedAny = false;
      for (let i = 0; i < eventIds.length; i += MAX_SEEN_IDS_PER_CALL) {
        const chunk = eventIds.slice(i, i + MAX_SEEN_IDS_PER_CALL);
        try {
          const result = await markNotificationEventsSeen({ eventIds: chunk });
          if (result.ok) stampedAny = true;
          else console.warn(`[path/notifications] seen stamp refused (${result.reason}) for ${chunk.length} events`);
        } catch {
          // The guard can redirect() (throws); anything else just means this
          // chunk's cursor did not advance — it replays next open.
        }
      }
      // Refresh only when something actually stamped — the badge and "new"
      // markers settle to the stamped truth; a fully-failed pass changes
      // nothing worth re-rendering for.
      if (stampedAny) router.refresh();
    })();
  }, [eventIds, router]);

  return null;
}
