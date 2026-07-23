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

/** Mirrors the action's zod ceiling — larger lists go in batches. */
const BATCH_SIZE = 100;

export function MarkSeenOnMount({ eventIds }: { eventIds: string[] }) {
  const router = useRouter();
  const firedRef = useRef(false);

  useEffect(() => {
    if (firedRef.current || eventIds.length === 0) return;
    firedRef.current = true;
    void (async () => {
      try {
        for (let i = 0; i < eventIds.length; i += BATCH_SIZE) {
          await markNotificationEventsSeen({ eventIds: eventIds.slice(i, i + BATCH_SIZE) });
        }
        router.refresh();
      } catch {
        // The guard can redirect() (throws); anything else just means the
        // cursor did not advance — the replay fires again next open.
      }
    })();
  }, [eventIds, router]);

  return null;
}
