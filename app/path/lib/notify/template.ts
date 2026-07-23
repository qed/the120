/**
 * The Path notification email templates (T1 Unit 12). PLAIN module — no
 * `server-only`, no `"use server"` — so the cron route, the inline send path,
 * and any tsx script render the exact same email.
 *
 * Security posture (two distinct defenses, applied where each belongs):
 *   * HTML injection — EVERY user-supplied value (student names are
 *     parent-entered roster text; task titles are curriculum text, escaped
 *     anyway as defense in depth) runs through the tested `escapeHtml` in the
 *     `html` part ONLY. The `text` part renders literally in mail clients, so
 *     escaping it would show entities to human readers.
 *     (docs/solutions/security-issues/admissions-notification-email-html-
 *     injection-…-2026-07-14.md)
 *   * SMTP header injection — the subject strips newlines and truncates.
 *     Header-stripping ≠ HTML-escaping; both are applied, each in its context.
 *   * NO state-changing links. The only URL in any Path notification is the
 *     auth-gated review-queue page — a plain navigation GET that mutates
 *     nothing, so scanner prefetch (Safe Links, Proofpoint) is harmless.
 *     Verification itself happens in-app via a Server Action POST.
 *     (docs/solutions/security-issues/state-changing-email-links-mutate-on-
 *     get-…-2026-07-16.md — kept satisfied structurally: nothing to prefetch.)
 *
 * Params arrive from a jsonb column, so every read narrows defensively — a
 * missing value renders a neutral fallback, never the string "undefined".
 */

import { escapeHtml } from "@/app/crm/lib/library-rules";
import type { SendKind } from "./notify-rules";

export const REVIEW_QUEUE_URL = "https://the120.school/path/review";

export type RenderedEmail = { subject: string; html: string; text: string };

/** Narrow an unknown jsonb param to a non-empty string, else the fallback. */
function str(params: Record<string, unknown>, key: string, fallback: string): string {
  const v = params[key];
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : fallback;
}

function num(params: Record<string, unknown>, key: string): number | null {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Subject-line defense: newlines stripped (SMTP header injection), truncated. */
function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").slice(0, 80);
}

/** "80 hours" reads worse than "3 days" once the wait is long. */
function waitLabel(hours: number): string {
  return hours > 48 ? `${Math.floor(hours / 24)} days` : `${hours} hours`;
}

const FOOTER_TEXT = "— The Path · The 120";

function shell(bodyHtml: string): string {
  return `<div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1a2233; max-width: 540px;">
${bodyHtml}
  <p style="margin: 24px 0 0; font-size: 12px; color: #8a93a6;">${FOOTER_TEXT}</p>
</div>`;
}

/** The one link every Path notification carries — a navigation GET, no token,
 *  no side effect; the page itself is auth-gated. */
function reviewButtonHtml(label: string): string {
  return `<p style="margin: 20px 0;">
    <a href="${REVIEW_QUEUE_URL}" style="display: inline-block; background: #1a2233; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">${escapeHtml(label)}</a>
  </p>`;
}

function renderSubmitted(params: Record<string, unknown>): RenderedEmail {
  const name = str(params, "studentFirstName", "Your founder");
  const taskId = str(params, "taskId", "");
  const title = str(params, "taskTitle", "a task");
  const doneWhen = str(params, "doneWhen", "");

  const subject = headerSafe(`${name} submitted ${taskId ? `task ${taskId}` : "a task"} — ready for your review`);
  const taskLine = taskId ? `Task ${taskId} · ${title}` : title;

  const html = shell(`
  <p style="margin: 0 0 16px;"><strong>${escapeHtml(name)}</strong> just submitted evidence for review.</p>
  <p style="margin: 0 0 6px; font-weight: 600;">${escapeHtml(taskLine)}</p>
  ${doneWhen ? `<p style="margin: 0 0 16px; color: #4a5468;"><em>Done when:</em> ${escapeHtml(doneWhen)}</p>` : ""}
  ${reviewButtonHtml("Open the review queue")}
  <p style="margin: 0; font-size: 13px; color: #8a93a6;">You'll verify against the Done-when line — their work is waiting for your eyes.</p>`);

  const text = [
    `${name} just submitted evidence for review.`,
    ``,
    taskLine,
    doneWhen ? `Done when: ${doneWhen}` : "",
    ``,
    `Open the review queue: ${REVIEW_QUEUE_URL}`,
    ``,
    FOOTER_TEXT,
  ]
    .filter((line, i, arr) => !(line === "" && arr[i - 1] === ""))
    .join("\n");

  return { subject, html, text };
}

function renderStallNudge(params: Record<string, unknown>): RenderedEmail {
  const name = str(params, "studentFirstName", "Your founder");
  const taskId = str(params, "taskId", "");
  const title = str(params, "taskTitle", "a task");
  const hours = num(params, "waitingHours") ?? 0;
  const wait = waitLabel(hours);

  const subject = headerSafe(`${name} has been waiting ${wait} for a review`);
  const taskLine = taskId ? `Task ${taskId} · ${title}` : title;

  const html = shell(`
  <p style="margin: 0 0 16px;"><strong>${escapeHtml(name)}</strong> submitted work ${escapeHtml(wait)} ago and it's still waiting for a review.</p>
  <p style="margin: 0 0 16px; font-weight: 600;">${escapeHtml(taskLine)}</p>
  ${reviewButtonHtml("Review it now")}
  <p style="margin: 0; font-size: 13px; color: #8a93a6;">A young founder learns fastest when the feedback loop is short.</p>`);

  const text = [
    `${name} submitted work ${wait} ago and it's still waiting for a review.`,
    ``,
    taskLine,
    ``,
    `Review it now: ${REVIEW_QUEUE_URL}`,
    ``,
    FOOTER_TEXT,
  ].join("\n");

  return { subject, html, text };
}

/** Render one send row's email from its kind + jsonb params. */
export function renderSendEmail(kind: SendKind, params: Record<string, unknown>): RenderedEmail {
  switch (kind) {
    case "submitted":
      return renderSubmitted(params);
    case "stall_nudge":
      return renderStallNudge(params);
  }
}
