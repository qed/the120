import React, { useState } from 'react';
import { CompassIcon, PaletteIcon } from 'lucide-react';
import {
  PHASES,
  phaseColor,
  Button,
  StatusChip,
  ProgressMeter,
  SkinToggle,
  Crest,
  Seal,
  ReviewPanel,
  WisdomCard,
  MarginNote,
  PhaseSealCelebration,
  HQTaskCard,
  PhaseRow,
  TrailStep,
  type Skin,
  type TaskState } from
'./components';
import { Section } from './components/showcase/Section';
import {
  NOW_TASK,
  SUBMITTED_TASK,
  NOT_YET_TASK,
  VERIFIED_TASK,
  LIVE_TASK,
  REVIEW_EVIDENCE,
  WISDOM_QUOTE,
  WISDOM_ORIGINAL,
  MONTAGE } from
'./components/showcase/sampleData';

const TASK_STATES: TaskState[] = [
'locked',
'available',
'in_progress',
'submitted',
'not_yet',
'verified'];


const TRAIL_STEPS: {label: string;state: TaskState;}[] = [
{ label: 'Pick the product', state: 'verified' },
{ label: 'Write the one-liner', state: 'verified' },
{ label: 'Record the pitch', state: 'submitted' },
{ label: 'Ask until one yes', state: 'available' },
{ label: 'Deliver & thank', state: 'locked' }];


export function App() {
  const [skin, setSkin] = useState<Skin>('hq');
  const [fav, setFav] = useState(false);

  return (
    <div className="min-h-full w-full bg-hq-surface text-hq-ink">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-hq-border bg-hq-surface/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-hq-ink text-white">
              <CompassIcon className="h-5 w-5" />
            </span>
            <div>
              <h1 className="font-display text-lg font-semibold leading-none text-hq-ink">
                The Path
              </h1>
              <p className="text-xs text-hq-ink-muted">Design System</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-hq-ink-muted sm:inline">Preview skin</span>
            <SkinToggle value={skin} onChange={setSkin} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-24">
        {/* Intro */}
        <div className="py-14">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-hq-sunken px-3 py-1 text-xs font-medium text-hq-ink-soft">
            <PaletteIcon className="h-3.5 w-3.5" /> One engine · two skins
          </span>
          <h2 className="mt-4 max-w-2xl font-display text-4xl font-semibold leading-tight text-hq-ink">
            The game is the real business. The app keeps score.
          </h2>
          <p className="mt-3 max-w-2xl text-hq-ink-soft">
            Every component renders in two finishes — <strong>Trail</strong>, the illustrated journey
            game, and <strong>HQ</strong>, the founder dashboard. Mechanics never change; only pixels
            and words do. Flip the toggle above to preview either skin.
          </p>
        </div>

        {/* Phase palette */}
        <Section
          id="phases"
          title="The five phases"
          intro="The spine of the whole system. Each phase carries one accent color, constant across both skins, used everywhere progress is shown.">
          
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {PHASES.map((p) =>
            <div
              key={p.key}
              className="rounded-xl border border-hq-border bg-hq-canvas p-4 shadow-hq">
              
                <div
                className="mb-3 h-14 w-full rounded-lg"
                style={{ backgroundColor: phaseColor(p.key) }} />
              
                <div className="font-mono text-xs text-hq-ink-muted">0{p.index}</div>
                <div className="text-sm font-semibold text-hq-ink">{p.name}</div>
                <div className="mt-0.5 text-xs text-hq-ink-muted">{p.territory}</div>
              </div>
            )}
          </div>
        </Section>

        {/* Progress */}
        <Section
          id="progress"
          title="Progress — the credential"
          intro="No XP, no daily-login rewards. The only score is verified tasks out of 125. The meter fills phase-by-phase in each phase's color.">
          
          <div className="rounded-xl border border-hq-border bg-hq-canvas p-6 shadow-hq">
            <ProgressMeter value={37} />
          </div>
        </Section>

        {/* Verification states */}
        <Section
          id="states"
          title="Task states & verification"
          intro="Verification is sacred. A declined task is never “failed” — it is Not Yet, in warm amber, never red.">
          
          <div className="flex flex-wrap gap-2">
            {TASK_STATES.map((s) =>
            <StatusChip key={s} state={s} />
            )}
          </div>
        </Section>

        {/* Crests & seals */}
        <Section
          id="crests"
          title="Crests & Seals — one lineage, two finishes"
          intro="Criterion crests and phase seals share the same heraldic artwork so nothing feels lost when toggling. Trail renders them illustrated and full-color; HQ renders them as clean monochrome marks.">
          
          <div className="grid gap-6 sm:grid-cols-2">
            <div className="rounded-xl border border-hq-border bg-hq-canvas p-6 shadow-hq">
              <h3 className="mb-4 text-sm font-semibold text-hq-ink-soft">Criterion crests</h3>
              <div className="flex flex-wrap items-end gap-4">
                <Crest phase="sell" criterion="1.3" skin={skin} />
                <Crest phase="build" criterion="2.1" skin={skin} />
                <Crest phase="validate" criterion="3.2" skin={skin} />
                <Crest phase="grow" criterion="4.5" skin={skin} locked />
              </div>
            </div>
            <div className="rounded-xl border border-hq-border bg-hq-canvas p-6 shadow-hq">
              <h3 className="mb-4 text-sm font-semibold text-hq-ink-soft">Phase seals</h3>
              <div className="flex flex-wrap items-end gap-5">
                <Seal phase="sell" skin={skin} size={80} sealed date="Mar 2026" />
                <Seal phase="build" skin={skin} size={80} sealed={false} />
              </div>
            </div>
          </div>
        </Section>

        {/* The task, two skins */}
        <Section
          id="task"
          title="The current task — both skins"
          intro="The same task in both renderings. HQ shows a spec sheet; Trail shows the step on the illustrated trail, with the current step glowing, a satchel shimmering under review, and a wax-stamp footprint when verified.">
          
          <div className="grid gap-6 lg:grid-cols-2">
            <div>
              <span className="mb-3 block text-xs font-semibold uppercase tracking-wide text-hq-ink-muted">
                HQ · spec card
              </span>
              <HQTaskCard task={NOW_TASK} now onOpen={() => {}} />
            </div>
            <div>
              <span className="mb-3 block text-xs font-semibold uppercase tracking-wide text-hq-ink-muted">
                Trail · the landmark trail
              </span>
              <div className="rounded-2xl border-2 border-trail-ink/10 bg-trail-canvas p-6 shadow-trail">
                <p className="mb-4 font-display text-sm text-trail-ink-soft">
                  Criterion 1.2 — Make a real sale
                </p>
                <div className="flex flex-wrap items-start justify-between gap-y-4">
                  {TRAIL_STEPS.map((s, i) =>
                  <TrailStep
                    key={i}
                    index={i + 1}
                    state={s.state}
                    phase="sell"
                    label={s.label} />

                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            <HQTaskCard task={SUBMITTED_TASK} />
            <HQTaskCard task={NOT_YET_TASK} />
            <HQTaskCard task={LIVE_TASK} />
          </div>
        </Section>

        {/* Review */}
        <Section
          id="review"
          title="The review — evidence against the bar"
          intro="The parent's split view: evidence on one side, the Done-when line and band bar on the other. One tap to verify; Not Yet requires a note. Built to make verifying easier than doing the work.">
          
          <ReviewPanel
            taskId={VERIFIED_TASK.id}
            title={VERIFIED_TASK.title}
            doneWhen={VERIFIED_TASK.doneWhen}
            bandVariant="Grades 3–5: a parent may stand beside them, but cannot make the ask."
            phase="sell"
            evidence={REVIEW_EVIDENCE}
            reviewer="Dad" />
          
        </Section>

        {/* Wisdom */}
        <Section
          id="wisdom"
          title="The Almanac — wisdom, two ways"
          intro="Contextual doses of entrepreneurial wisdom, collected forever. Trail files illustrated cards into the satchel's card book; HQ slides in typographic margin notes that collect into the Almanac.">
          
          <div className="grid items-start gap-8 lg:grid-cols-2">
            <div className="flex justify-center rounded-xl border border-hq-border bg-hq-sunken p-8">
              <WisdomCard
                entry={WISDOM_ORIGINAL}
                favorited={fav}
                onFavorite={() => setFav((v) => !v)} />
              
            </div>
            <div className="rounded-xl border border-hq-border bg-hq-canvas p-8 shadow-hq">
              <MarginNote entry={WISDOM_QUOTE} />
            </div>
          </div>
        </Section>

        {/* Ledger */}
        <Section
          id="ledger"
          title="HQ progress ledger"
          intro="Home in HQ: five phase rows, each showing its five criteria as segments, with review banners and seal marks. Sequential phases stay dimmed until the prior seals.">
          
          <div className="space-y-3">
            <PhaseRow phase="sell" criteriaCleared={5} tasksVerified={25} status="sealed" sealedDate="Mar 12, 2026" />
            <PhaseRow phase="build" criteriaCleared={3} tasksVerified={16} status="active" />
            <PhaseRow phase="validate" criteriaCleared={0} tasksVerified={0} status="review" reviewer="Mum" />
            <PhaseRow phase="grow" criteriaCleared={0} tasksVerified={0} status="locked" />
            <PhaseRow phase="scale" criteriaCleared={0} tasksVerified={0} status="locked" />
          </div>
        </Section>

        {/* Celebration */}
        <Section
          id="celebration"
          title="Tier 3 — a phase sealed"
          intro="The big moment, shared in structure by both skins: the seal presses, a montage of the phase's own real evidence, the numbers it produced, and a prompt to celebrate offline.">
          
          <PhaseSealCelebration
            phase="sell"
            skin={skin}
            montage={MONTAGE}
            stats={[
            { value: '25', label: 'outreach' },
            { value: '9', label: 'conversations' },
            { value: '2', label: 'yeses' }]
            }
            onCelebrate={() => {}}
            onContinue={() => {}} />
          
        </Section>

        {/* Buttons */}
        <Section
          id="buttons"
          title="Actions"
          intro="The shared action primitive. HQ is crisp and squared; Trail is rounder and warmer. Both preview with the toggle.">
          
          <div className="flex flex-wrap items-center gap-3">
            <Button skin={skin}>Submit evidence</Button>
            <Button skin={skin} variant="secondary">
              Run readiness check
            </Button>
            <Button skin={skin} variant="ghost">
              Withdraw
            </Button>
            <Button skin={skin} disabled>
              Locked
            </Button>
          </div>
        </Section>
      </main>
    </div>);

}