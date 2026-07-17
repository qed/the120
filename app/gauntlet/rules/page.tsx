import type { Metadata } from "next";
import Nav from "@/app/components/Nav";
import Footer from "@/app/components/Footer";
import CtaBand from "@/app/components/CtaBand";
import Cta from "@/app/components/Cta";
import { resolveTournamentState } from "@/app/lib/tournament";
import { intensives } from "@/app/lib/site";

export const metadata: Metadata = {
  title: "Summer Tournament Rules — The Gauntlet — The 120",
  description:
    "How The Gauntlet's Summer Tournament works: the window, the three grade bands, the prizes, and how kids' data is handled.",
};

// Per-request so tournament facts reflect the live phase (GPF-4/8).
export const dynamic = "force-dynamic";

/**
 * GPF-6 — the rules page is the single source of truth for tournament facts
 * (Guardrail #6). Window, bands, prizes all read from app/lib/tournament.ts.
 * Parent-first, plain language; verification stated up front as fairness.
 */
export default function TournamentRulesPage() {
  const t = resolveTournamentState();
  const fall = intensives.find((i) => i.label === "Fall Intensive");

  return (
    <>
      <Nav />
      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-4 px-6 pb-6 pt-[84px] sm:px-8">
          <span className="font-mono text-xs tracking-[0.1em] text-red">THE GAUNTLET · SUMMER TOURNAMENT</span>
          <h1 className="display text-4xl sm:text-[52px] sm:leading-[1.06]">
            The rules, <span className="accent">plainly</span>
          </h1>
          <p className="max-w-[680px] text-[15px] leading-relaxed text-ink-soft">
            The Gauntlet is free to play, always. The Summer Tournament is the one moment we ask a
            parent to say yes — so a kid&rsquo;s score can count and go on the leaderboard. Here&rsquo;s
            exactly how it works and what we collect.
          </p>
        </div>

        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-8 px-6 pb-16 pt-8 sm:px-8">
          <Section title="When">
            <p>
              The tournament runs <strong>Monday Aug 3 &rarr; Sunday Aug 23, {t.year}</strong>. The
              leaderboard resets when it opens; play now and you&rsquo;re ready on day one.
            </p>
          </Section>

          <Section title="Three grade bands">
            <p>Every entrant competes in one band, each with its own prize pool:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {t.bands.map((b) => (
                <li key={b.id} className="rounded-full border border-line-strong px-4 py-1.5 font-mono text-[13px] text-ink">
                  {b.label}
                </li>
              ))}
            </ul>
          </Section>

          <Section title="Prizes">
            <ul className="space-y-1.5">
              {t.prizes.map((p) => (
                <li key={p.place} className="flex items-baseline gap-3">
                  <span className="font-mono text-sm text-red">{p.place}</span>
                  <span>
                    <strong>{p.amount}</strong> in each of the three bands
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-3">
              Every winner also earns a <strong>named spot on the permanent Founding Leaderboard</strong> —
              names go up once and stay up. Members of The 120 get priority for stage time to demo their
              projects at the {fall ? `Fall Intensive (${fall.date})` : "Fall Intensive"} or a similar event.
            </p>
          </Section>

          <Section title="Handles — never real names">
            <p>
              Every player picks a handle. It must <strong>never be a real name</strong> — that&rsquo;s the
              rule, and handles are word-filtered. The leaderboard shows handles only.
            </p>
          </Section>

          <Section title="Winners are verified">
            <p>
              Because there&rsquo;s real prize money, top players verify their standing by{" "}
              <strong>re-answering a sample of their mastered facts</strong> &mdash; live, under the same
              3-second speed bar they mastered them at. Mastery you can show again on the spot keeps the
              board fair for every kid who earns their spot honestly.
            </p>
          </Section>

          <Section title="Weekly boss themes">
            <p>Each week spotlights a boss and a skill focus:</p>
            <ul className="mt-2 space-y-1">
              <li>Week 1 (Aug 3&ndash;9) — Clank&rsquo;s Multiplication Melee</li>
              <li>Week 2 (Aug 10&ndash;16) — Magmar&rsquo;s Fraction Forge</li>
              <li>Week 3 (Aug 17&ndash;23) — Vex&rsquo;s Final Reckoning</li>
            </ul>
          </Section>

          <Section title="How parents get standings">
            <p>
              When you enter, your child picks a handle and band, and a parent gives an email plus a
              one-time OK (a confirm link). After you confirm, you&rsquo;ll get a short weekly email with
              your child&rsquo;s band standing and the facts they mastered that week. Unsubscribe anytime.
            </p>
          </Section>

          <Section title="What we collect, and why (PIPEDA)">
            <p>
              We collect only what the tournament needs: the <strong>handle</strong>, the{" "}
              <strong>grade band</strong>, and a <strong>parent email</strong> for standings and consent.
              No real names, nothing else. You can unsubscribe or ask us to remove an entry at any time by
              replying to any email.
            </p>
            <p className="mt-3">
              <strong>How long we keep it:</strong> entries that a parent never confirms are deleted
              after the tournament closes; confirmed entries are kept only through the season (for
              standings and prizes) and then removed. Ask us to delete yours sooner by replying to any
              email &mdash; we&rsquo;ll remove the parent email and attribution and keep nothing but what a
              prize payout legally requires.
            </p>
          </Section>

          <div className="flex flex-wrap gap-3 pt-2">
            <Cta href="/gauntlet" variant="primary" className="px-[26px] py-[15px]">
              {t.isLive ? "Play & enter" : "Play free"}
            </Cta>
            <Cta href="/" variant="ghost" className="px-[26px] py-[15px]">
              What is The 120? &rarr;
            </Cta>
          </div>
        </div>

        <CtaBand />
      </main>
      <Footer />
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-line pt-6">
      <h2 className="font-mono text-xs uppercase tracking-[0.12em] text-red">{title}</h2>
      <div className="mt-3 max-w-[720px] text-[15px] leading-[1.65] text-ink-soft [&_strong]:text-ink">
        {children}
      </div>
    </section>
  );
}
