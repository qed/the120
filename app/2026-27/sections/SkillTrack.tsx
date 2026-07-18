import { COPY } from "../data";
import type { Audience } from "../cta-source";

/** Fifteen tracked skills, three pillars (single-voice, fixed names). */
const PILLARS: { label: string; skills: string[] }[] = [
  {
    label: "LIFE",
    skills: [
      "Integrity & Humility",
      "Courage & Discipline",
      "Agency & Ambition",
      "Communication",
      "Leadership & Social Intelligence",
    ],
  },
  {
    label: "ENTREPRENEURSHIP",
    skills: [
      "Selling",
      "Building",
      "Rapid Iteration",
      "Financial Thinking",
      "Knowing Your Domain",
    ],
  },
  {
    label: "AI",
    skills: [
      "AI as Thinking Partner",
      "AI-Augmented Building",
      "AI Tool Literacy",
      "Agents & Automation",
      "AI Judgment & Ethics",
    ],
  },
];

/**
 * 07 · The Skill Track (bone band). Three pillar columns of five mono-numbered
 * skills, then a four-card level strip (Level 4 flagged red — "the bar").
 */
export default function SkillTrack({ audience }: { audience: Audience }) {
  const t = COPY[audience];

  const levels = [
    { level: "LEVEL 1", title: "STARTING", desc: t.lvl1desc },
    { level: "LEVEL 2", title: "PRACTICING", desc: t.lvl2desc },
    { level: "LEVEL 3", title: "SOLID", desc: t.lvl3desc },
    { level: "LEVEL 4", title: "COULD TEACH IT", desc: t.lvl4desc, top: true },
  ];

  return (
    <section id="skills" className="scroll-mt-[152px] bg-paper">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.skillsKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          Fifteen skills. <span className="accent">Tracked all year.</span>
        </h2>
        <p className="mt-4 max-w-[640px] text-[17px] leading-relaxed text-ink-soft">
          {t.skillsIntro}
        </p>

        <div className="mt-11 grid grid-cols-1 gap-9 md:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div key={pillar.label} className="border-t-2 border-ink pt-[18px]">
              <div className="mb-4 font-mono text-xs tracking-[0.1em] text-red">{pillar.label}</div>
              <div className="flex flex-col gap-3">
                {pillar.skills.map((skill, i) => (
                  <div key={skill} className="flex gap-3">
                    <span className="font-mono text-xs text-muted">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="text-[16px] text-ink">{skill}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {levels.map((lvl) => (
            <div
              key={lvl.level}
              className={`flex flex-col gap-2 rounded-[14px] bg-white p-[22px] ${
                lvl.top ? "border border-red" : ""
              }`}
            >
              <span className={`font-mono text-xs ${lvl.top ? "text-red" : "text-muted"}`}>
                {lvl.level}
              </span>
              <span
                className={`font-mono text-[15px] font-semibold tracking-[0.06em] ${
                  lvl.top ? "text-red" : "text-ink"
                }`}
              >
                {lvl.title}
              </span>
              <span className="text-sm leading-relaxed text-ink-soft">{lvl.desc}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
