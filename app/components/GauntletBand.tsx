import Cta from "./Cta";
import { resolveTournamentState } from "@/app/lib/tournament";

/**
 * GPF-2 — Homepage Gauntlet section. Sits after How-It-Works, before the
 * parent-stories testimonials (see app/page.tsx). The hero still sells
 * Membership first (Guardrail #5); this is the proof-of-rigor beat + the free
 * kid entry point. The tournament line + CTAs are state-driven from
 * app/lib/tournament.ts, so a phase flip changes only this block's line/CTA.
 */
export default function GauntletBand() {
  const t = resolveTournamentState();

  return (
    <section className="border-y border-line bg-paper">
      <div className="mx-auto grid w-full max-w-[1240px] gap-12 px-6 py-20 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:py-24">
        {/* Copy + CTAs */}
        <div className="max-w-xl">
          <p className="font-mono text-xs tracking-[0.1em] text-red">
            THE GAUNTLET — FREE FOR EVERYONE
          </p>
          <h2 className="display mt-4 text-3xl sm:text-[42px] sm:leading-[1.1]">
            Fast math, disguised as a <span className="accent">boss battle.</span>
          </h2>
          <p className="mt-5 text-[15px] leading-relaxed text-ink-soft">
            The Gauntlet is The 120&rsquo;s free FastMath trainer for grades 3&ndash;8. Every
            correct answer strikes the boss &mdash; speed and streaks hit harder. Master a fact by
            answering it in under 3 seconds, twice in a row, and watch the mastery map fill in. No
            downloads, no ads, free to play.
          </p>

          {t.home.line && (
            <p className="mt-6 rounded-xl border border-line-strong/60 bg-white px-4 py-3 text-[14px] font-medium leading-snug text-ink">
              {t.home.line}
            </p>
          )}

          <div className="mt-7 flex flex-wrap gap-3">
            {t.home.ctas.map((cta) => (
              <Cta
                key={cta.label}
                href={cta.href}
                variant={cta.primary ? "primary" : "ghost"}
                className="px-[26px] py-[15px]"
              >
                {cta.label}
              </Cta>
            ))}
          </div>
        </div>

        {/* Visual: the kid hook (boss) + the parent proof (mastery heatmap) in one frame. */}
        <GauntletVisual />
      </div>
    </section>
  );
}

/** Stylized arena: a boss glyph beside a My-Facts mastery heatmap — the kid
 *  hook and the parent proof together, rendered in CSS so it carries no asset
 *  dependency. Swap for real boss art + a heatmap screenshot when available. */
function GauntletVisual() {
  // A small deterministic mastery grid: 2 = mastered, 1 = learning, 0 = unseen.
  const grid = [
    [2, 2, 2, 1, 0],
    [2, 2, 1, 1, 0],
    [2, 1, 2, 0, 1],
    [2, 2, 1, 0, 0],
  ];
  const cell = ["bg-white/10", "bg-amber-400/70", "bg-emerald-400/80"];

  return (
    <div className="relative overflow-hidden rounded-3xl border border-line bg-[#0a0f1a] p-7 text-white shadow-[0_30px_60px_-40px_rgba(19,20,22,0.55)]">
      <div className="flex items-center justify-between gap-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
            The boss
          </p>
          <div className="mt-3 flex h-24 w-24 items-center justify-center rounded-2xl bg-gradient-to-br from-red/80 to-[#3a1020] text-5xl">
            👹
          </div>
          <div className="mt-3 h-1.5 w-24 overflow-hidden rounded-full bg-white/15">
            <div className="h-full w-2/3 rounded-full bg-red" />
          </div>
          <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-white/40">
            Boss HP
          </p>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/50">
            My facts
          </p>
          <div className="mt-3 grid grid-cols-5 gap-1.5">
            {grid.flat().map((v, i) => (
              <span key={i} className={`h-5 w-5 rounded-[5px] ${cell[v]}`} />
            ))}
          </div>
          <div className="mt-3 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.1em] text-white/45">
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-emerald-400/80" /> Mastered
            </span>
            <span className="flex items-center gap-1">
              <span className="h-2.5 w-2.5 rounded-[3px] bg-amber-400/70" /> Learning
            </span>
          </div>
        </div>
      </div>
      <p className="mt-6 border-t border-white/10 pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-white/45">
        Speed and accuracy your child can see
      </p>
    </div>
  );
}
