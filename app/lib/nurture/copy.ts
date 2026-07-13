/**
 * GTM-1: nurture email copy — one template per sequence step, each with
 * exactly ONE call to action (GTM plan §5: "every email ends with one CTA:
 * book the call or finish the dossier"). Voice matches welcome email #1
 * (app/api/welcome/route.ts). Public facts (intensive dates) come from
 * app/lib/site.ts — the single source of truth — never hardcoded here.
 */

import { BOOKING_URL, intensives } from "@/app/lib/site";
import type { NurtureTemplate } from "./rules";

export type NurtureEmail = { subject: string; html: string; text: string };

type Params = { firstName: string; childFirstName?: string };

const DASHBOARD_URL = "https://the120.school/dashboard";
const SITE_URL = "https://the120.school";

const greeting = (firstName: string) => (firstName ? `Hi ${firstName},` : "Hi,");

/** Shared letterhead layout — mirrors the welcome email's inline styling. */
function layout(bodyHtml: string, cta: { label: string; url: string }): string {
  return `
<div style="font-family: Georgia, 'Times New Roman', serif; color: #16233b; max-width: 560px; margin: 0 auto; padding: 32px 24px; line-height: 1.6;">
  <p style="font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: #5a6b8a; margin: 0 0 24px;">The 120</p>
  ${bodyHtml}
  <p style="margin: 24px 0;">
    <a href="${cta.url}" style="background: #16233b; color: #ffffff; text-decoration: none; padding: 12px 22px; font-size: 15px;">${cta.label}</a>
  </p>
  <p style="margin: 24px 0 0;">— Peter Kuperman<br/>Founder, The 120</p>
</div>`;
}

const p = (html: string) => `<p style="margin: 0 0 16px;">${html}</p>`;

export function renderNurtureEmail(template: NurtureTemplate, params: Params): NurtureEmail {
  const hi = greeting(params.firstName);
  const child = params.childFirstName;

  switch (template) {
    case "account-dossier-nudge":
      return {
        subject: "15 minutes finishes the dossier",
        text: [
          hi,
          "",
          "Quick nudge: your child's dossier is the application, and most families finish it in one sitting — about 15 minutes. Their interests, a project pitch, the workshops they'd pick. That's it.",
          "",
          "Once it's submitted, we review it and invite you to a qualifying assessment and a call.",
          "",
          `Finish the dossier: ${DASHBOARD_URL}`,
        ].join("\n"),
        html: layout(
          p(hi) +
            p(
              "Quick nudge: <strong>your child's dossier is the application</strong>, and most families finish it in one sitting — about 15 minutes. Their interests, a project pitch, the workshops they'd pick. That's it."
            ) +
            p("Once it's submitted, we review it and invite you to a qualifying assessment and a call."),
          { label: "Finish the dossier", url: DASHBOARD_URL }
        ),
      };

    case "account-founder-story":
      return {
        subject: "Why I'm building The 120",
        text: [
          hi,
          "",
          "I taught math to thousands of kids over fifteen years, and the pattern never changed: the ones who took off weren't the ones with the most talent — they were the ones surrounded by other kids taking real swings at real things.",
          "",
          "That's The 120. Not a school, not a camp — 120 kids in five groups (athletes, founders, makers, scholars, givers), each doing a year-long project that's actually theirs, presented to the whole network at the Toronto intensives.",
          "",
          "If you want to hear how it works for your kid specifically, I take every intro call myself.",
          "",
          `Book 20 minutes with me: ${BOOKING_URL}`,
        ].join("\n"),
        html: layout(
          p(hi) +
            p(
              "I taught math to thousands of kids over fifteen years, and the pattern never changed: the ones who took off weren't the ones with the most talent — they were the ones surrounded by other kids taking real swings at real things."
            ) +
            p(
              "That's The 120. Not a school, not a camp — 120 kids in five groups (athletes, founders, makers, scholars, givers), each doing a year-long project that's actually theirs, presented to the whole network at the Toronto intensives."
            ) +
            p("If you want to hear how it works for your kid specifically, I take every intro call myself."),
          { label: "Book 20 minutes with me", url: BOOKING_URL }
        ),
      };

    case "account-book-call":
      return {
        subject: "20 minutes, whenever suits you",
        text: [
          hi,
          "",
          "You created an account a little over a week ago — which usually means the idea stuck, and something practical is in the way. That's exactly what the intro call is for: your kid, your questions, no pitch deck.",
          "",
          "I take every one of these calls myself, and 20 minutes is genuinely all it takes.",
          "",
          `Pick a time: ${BOOKING_URL}`,
        ].join("\n"),
        html: layout(
          p(hi) +
            p(
              "You created an account a little over a week ago — which usually means the idea stuck, and something practical is in the way. That's exactly what the intro call is for: your kid, your questions, no pitch deck."
            ) +
            p("I take every one of these calls myself, and 20 minutes is genuinely all it takes."),
          { label: "Pick a time", url: BOOKING_URL }
        ),
      };

    case "deposit-welcome":
      return {
        subject: "Welcome to the Founding 120",
        text: [
          hi,
          "",
          "Your seat is reserved — your family is one of the founding 120. Thank you for the trust; it means a great deal.",
          "",
          "What happens next: we finish the review of your child's dossier, match them into their group, and you'll hear from me directly about the first intensive. Your deposit stays fully refundable until September 30, 2026.",
          "",
          `Your dashboard: ${DASHBOARD_URL}`,
        ].join("\n"),
        html: layout(
          p(hi) +
            p(
              "Your seat is reserved — <strong>your family is one of the founding 120.</strong> Thank you for the trust; it means a great deal."
            ) +
            p(
              "What happens next: we finish the review of your child's dossier, match them into their group, and you'll hear from me directly about the first intensive. Your deposit stays fully refundable until September&nbsp;30,&nbsp;2026."
            ),
          { label: "Your dashboard", url: DASHBOARD_URL }
        ),
      };

    case "deposit-intensive": {
      const fall = intensives[0];
      return {
        subject: `${fall.label}: ${fall.date} — what to expect`,
        text: [
          hi,
          "",
          `Mark the calendar: the ${fall.label} runs ${fall.date}, in Toronto. It's the first time the whole network is in one room — all five groups, every kid presenting where their year-long project stands.`,
          "",
          "It's also where your child meets the other kids taking real swings at real things. Details (venue, schedule, what to bring) come by email as we get closer.",
          "",
          `See the year's intensives: ${SITE_URL}/#how`,
        ].join("\n"),
        html: layout(
          p(hi) +
            p(
              `Mark the calendar: the <strong>${fall.label}</strong> runs <strong>${fall.date}</strong>, in Toronto. It's the first time the whole network is in one room — all five groups, every kid presenting where their year-long project stands.`
            ) +
            p(
              "It's also where your child meets the other kids taking real swings at real things. Details (venue, schedule, what to bring) come by email as we get closer."
            ),
          { label: "See the year's intensives", url: `${SITE_URL}/#how` }
        ),
      };
    }

    case "deposit-referral":
      return {
        subject: "Know one more family?",
        text: [
          hi,
          "",
          "A small ask. The 120 fills by word of mouth — families like yours telling one other family whose kid would thrive here. The best kids in the network arrive exactly this way.",
          "",
          "If someone comes to mind — a teammate's parents, a classmate's, a cousin — just forward them the site. That's the whole ask.",
          "",
          `Share the site: ${SITE_URL}`,
        ].join("\n"),
        html: layout(
          p(hi) +
            p(
              "A small ask. The 120 fills by word of mouth — families like yours telling one other family whose kid would thrive here. The best kids in the network arrive exactly this way."
            ) +
            p(
              "If someone comes to mind — a teammate's parents, a classmate's, a cousin — just forward them the site. That's the whole ask."
            ),
          { label: "Share the site", url: SITE_URL }
        ),
      };

    case "stall-nudge": {
      const kid = child ?? "your child";
      return {
        subject: child ? `${child}'s dossier is one step from done` : "The dossier is one step from done",
        text: [
          hi,
          "",
          `You're nearly there — ${kid}'s dossier is almost complete, and it's been sitting a few days. One short sitting finishes it, and submitting is what starts the review.`,
          "",
          "Nothing is lost; everything you've entered is saved right where you left it.",
          "",
          `Finish and submit: ${DASHBOARD_URL}`,
        ].join("\n"),
        html: layout(
          p(hi) +
            p(
              `You're nearly there — <strong>${kid}'s dossier is almost complete</strong>, and it's been sitting a few days. One short sitting finishes it, and submitting is what starts the review.`
            ) +
            p("Nothing is lost; everything you've entered is saved right where you left it."),
          { label: "Finish and submit", url: DASHBOARD_URL }
        ),
      };
    }
  }
}
