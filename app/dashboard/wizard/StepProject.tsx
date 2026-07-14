"use client";

import { groupBySlug } from "@/app/lib/site";
import { TextArea, TextField } from "../ui";
import { StepSection, type StepProps } from "./shared";

/**
 * Per-group example projects (R12b) — concrete one-liners derived from each
 * group's site.ts `body` copy. Scholars keep the year-long framing (R13) and
 * never see this block.
 */
const GROUP_PROJECT_EXAMPLES: Record<string, string[]> = {
  athletes: [
    "A season record — every meet and match logged, analyzed, and beaten.",
    "A documented training climb: from today's personal best to a named target, week by week.",
    "A training system your kid designs, follows, and demos to the network.",
  ],
  founders: [
    "A small venture with real customers, real revenue, and lessons learned.",
    "Ten customer interviews, a landing page, and a first sale.",
  ],
  makers: [
    "A short film — written, shot, edited, and premiered.",
    "An album or EP, recorded and released.",
    "An invention portfolio: prototypes built, tested, and documented.",
  ],
  givers: [
    "A neighbourhood service project — planned, run, and measured by your kid.",
    "A community campaign with a public goal and a published result.",
  ],
};

export default function StepProject({ child, set, n }: StepProps) {
  const scholars = child.groupSlug === "scholars";
  const group = groupBySlug(child.groupSlug);
  const examples = GROUP_PROJECT_EXAMPLES[child.groupSlug];

  return (
    <StepSection
      n={n}
      title="Project & interests"
      hint={
        scholars
          ? "The kid's own words are encouraged."
          : "We'll help build projects based on your kid's interests. Enter a topic or interest area and an idea for a 4–8 week (or longer) project, working a few hours a week. We'll put together the answers from all the parents and build something amazing for you and your cohort."
      }
    >
      <div className="space-y-4">
        <TextArea
          label="What is your child into?"
          value={child.interests}
          onChange={(v) => set({ interests: v })}
          placeholder="Dinosaurs, chess, building things, marine biology…"
          rows={3}
        />

        {!scholars && group && examples && (
          <div className="rounded-xl border border-line bg-paper-2/60 p-4">
            <p className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted">
              Example projects for {group.name}
            </p>
            <ul className="mt-2 space-y-1.5">
              {examples.map((ex) => (
                <li key={ex} className="flex gap-2 text-sm leading-6 text-ink-soft">
                  <span aria-hidden className="text-red">
                    ·
                  </span>
                  {ex}
                </li>
              ))}
            </ul>
          </div>
        )}

        <TextArea
          label={scholars ? "A year-long project idea" : "A 4–8 week project idea"}
          value={child.projectPitch}
          onChange={(v) => set({ projectPitch: v })}
          placeholder={
            scholars
              ? "One super interesting thing they'd love to spend a year building, researching, or shipping."
              : "One super interesting thing they'd love to spend a few hours a week building, researching, or shipping."
          }
          rows={4}
        />
        <TextField
          label="Portfolio / achievement links (optional)"
          value={child.portfolioLinks}
          onChange={(v) => set({ portfolioLinks: v })}
          placeholder="A website, a video, a competition result…"
        />
      </div>
    </StepSection>
  );
}
