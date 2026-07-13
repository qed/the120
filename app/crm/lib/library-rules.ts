/**
 * Pure decision logic + Zod schemas for the library send actions (plan
 * Unit 7). No I/O and no next/supabase imports — everything here is
 * unit-testable (`actions-library.test.ts`); `actions/library.ts` imports
 * these and adds the guarded mutations around them (alphahub canon, same
 * split as `families-rules.ts`).
 */

import { z } from "zod";
import { isConcern, type Concern } from "./constants";

/* ------------------------------------------------------------ item types */

/** Library item types (brief §9). Kept in the DB CHECK too (tiny stable set). */
export const LIBRARY_ITEM_TYPES = ["faq", "talking", "data", "asset"] as const;

export type LibraryItemType = (typeof LIBRARY_ITEM_TYPES)[number];

export const LIBRARY_TYPE_LABELS: Record<LibraryItemType, string> = {
  faq: "FAQ",
  talking: "TALKING",
  data: "DATA",
  asset: "ASSET",
};

/* ---------------------------------------------------------------- schemas */

export const sendFromLibrarySchema = z.object({
  familyId: z.uuid(),
  itemId: z.uuid(),
  subject: z.string().trim().min(1, "Subject is required.").max(200),
  body: z.string().trim().min(1, "Write the message first.").max(10_000),
});

export const markSentElsewhereSchema = z.object({
  familyId: z.uuid(),
  itemId: z.uuid(),
  /** e.g. "texted the tuition math" — lands in the audit metadata. */
  note: z.string().trim().max(500).optional(),
});

export const rateHelpfulnessSchema = z.object({
  itemId: z.uuid(),
  delta: z.union([z.literal(1), z.literal(-1)]),
});

/* -------------------------------------------------------------- send gate */

export type SendChannel = "email" | "other";

export type SendGateVerdict = "ok" | "no-email" | "no-consent";

/** The consent + address fields the gate reads (effective identity — for
 *  parent-linked families the caller resolves email from the parents row
 *  per Decision 4 before gating). */
export interface SendGateFamily {
  email: string | null;
  consent_given: boolean;
  consent_revoked_at: string | null;
}

/**
 * The CASL send gate (brief §9, Decision 9) — server-side law; the composer
 * UI is convenience. Consent is checked FIRST and for EVERY channel: a
 * revocation blocks even while `consent_given` is still true (history is
 * kept, `consent_revoked_at` gates), and "mark as sent elsewhere" is gated
 * identically because CASL covers texts too (flow gap 15). Email presence
 * matters only for the email channel (flow gap 13).
 */
export function sendGate(
  family: SendGateFamily,
  channel: SendChannel = "email"
): SendGateVerdict {
  if (!family.consent_given || family.consent_revoked_at) return "no-consent";
  if (channel === "email" && !family.email?.trim()) return "no-email";
  return "ok";
}

/* --------------------------------------------------------------- prefill */

/** First word of the family display name; "there" when unnamed. */
export function familyFirstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "there";
}

/**
 * Composer prefill (brief §9): subject from the item title, body from the
 * item body wrapped in a light greeting/sign-off. The `{first_name}` token
 * — usable in seed bodies — personalizes everywhere it appears. Everything
 * stays editable in the composer.
 */
export function composePrefill(
  item: { title: string; body: string },
  family: { name: string }
): { subject: string; body: string } {
  const first = familyFirstName(family.name);
  const body =
    `Hi {first_name},\n\n${item.body}\n\nWarmly,\nThe 120 Admissions`.replaceAll(
      "{first_name}",
      first
    );
  return { subject: item.title, body };
}

/* ------------------------------------------------------------ email body */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch]);
}

/**
 * Plain composer text → simple paragraph HTML (escaped; blank lines split
 * paragraphs, single newlines become <br />). The CASL footer is appended
 * by `sendCrmEmail`, not here.
 */
export function bodyToHtml(body: string): string {
  return body
    .split(/\n{2,}/)
    .map((para) => escapeHtml(para).replaceAll("\n", "<br />"))
    .map(
      (para) =>
        `<p style="font-size:14px;line-height:1.65;color:#131416;margin:0 0 14px">${para}</p>`
    )
    .join("");
}

/* ------------------------------------------------------------ helpfulness */

/**
 * Helpfulness thumbs (brief §9): score moves by ±1 and clamps at 0 — it
 * feeds suggestion ranking (`helpfulness*2 + send_count`), which must never
 * go negative-weighted.
 */
export function helpfulnessApply(current: number, delta: number): number {
  return Math.max(0, current + delta);
}

/* --------------------------------------------------------- sent concerns */

/**
 * The set of concerns a family has already been sent an answer for —
 * co-pilot rule 5's input and the "unaddressed concern" definition used by
 * needs-attention (brief §7). Sends whose item is unknown, or whose item
 * carries no/unknown concern, are skipped — never thrown on.
 */
export function sentConcernsFrom(
  sends: { item_id: string }[],
  items: { id: string; concern: string | null }[]
): Set<Concern> {
  const concernByItem = new Map(items.map((i) => [i.id, i.concern]));
  const sent = new Set<Concern>();
  for (const send of sends) {
    const concern = concernByItem.get(send.item_id);
    if (concern && isConcern(concern)) sent.add(concern);
  }
  return sent;
}
