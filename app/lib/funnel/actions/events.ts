"use server";

/**
 * Client-triggered texture events (funnel U16): faq_opened and
 * share_card_created. The EMIT stays server-side (R56); these actions are
 * the bridge for interactions only the client can see. Session-gated so an
 * anonymous crafted POST cannot pump the stream, and the payload is a
 * fixed vocabulary — no client-supplied strings reach storage beyond an
 * id-checked childId.
 */

import { supabaseServer } from "@/app/lib/supabase/server";
import { emitFunnelEvent } from "@/app/lib/funnel/events";
import { FAQ_OPEN_EVENT } from "@/app/lib/funnel/reveal-rules";

const FAQ_INDEXES = [0, 1, 2, 3] as const;

/** A childId is attributed only when the CALLER's RLS session can read it —
 *  the service-role enricher would otherwise decorate events with another
 *  family's tuple (reviewer). */
async function ownedChildId(
  supabase: Awaited<ReturnType<typeof supabaseServer>>,
  raw: unknown
): Promise<string | null> {
  if (typeof raw !== "string") return null;
  const { data } = await supabase.from("children").select("id").eq("id", raw).maybeSingle();
  return data ? String(data.id) : null;
}

export async function emitFaqOpenedAction(input: unknown): Promise<void> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const i = input as { childId?: unknown; row?: unknown };
  const row = typeof i.row === "number" && (FAQ_INDEXES as readonly number[]).includes(i.row) ? i.row : null;
  void emitFunnelEvent(
    "faq_opened",
    { parentId: user.id, childId: await ownedChildId(supabase, i.childId) },
    { seam: FAQ_OPEN_EVENT, ...(row === null ? {} : { row }) }
  );
}

export async function emitShareCardAction(input: unknown): Promise<void> {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;
  const i = input as { childId?: unknown };
  void emitFunnelEvent("share_card_created", {
    parentId: user.id,
    childId: await ownedChildId(supabase, i.childId),
  });
}
