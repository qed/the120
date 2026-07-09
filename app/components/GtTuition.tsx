import Cta from "./Cta";
import JoinButton from "./JoinButton";
import SeatsDot from "./SeatsDot";

const checklist = [
  "5 hours a week of TimeBack, your academic core",
  "1–3 subjects, your choice, mastery-based",
  "Bi-weekly 30 min 1:1 with an expert Academic Advisor",
  "Everything in Membership: Tin Can, project, intensives",
  "Supports Ontario homeschool registration",
];

/** GT-Home tuition split (handoff): copy left, Full Academic Core card right. */
export default function GtTuition() {
  return (
    <section id="tuition" className="scroll-mt-24 border-t border-line bg-paper-2">
      <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 items-center gap-10 px-6 py-24 sm:px-8 lg:grid-cols-2 lg:gap-14">
        <div className="flex flex-col gap-4">
          <span className="font-mono text-xs tracking-[0.1em] text-red">TUITION</span>
          <h2 className="display text-3xl sm:text-[42px] sm:leading-[1.1]">
            Two price points. <span className="accent">One standard.</span>
          </h2>
          <p className="max-w-[520px] text-[15px] leading-[1.65] text-ink-soft">
            Membership in the 120 is $3,000 CAD a year. Scholars who want the complete academic
            core upgrade to TimeBack: the full GT program, 5 hours a week, for $15,000 all-in.
            All tuition is HST-exempt.
          </p>
          <Cta href="/tuition" variant="ghost" className="self-start px-[26px] py-[15px]">
            Compare the tiers →
          </Cta>
        </div>

        <div className="flex flex-col gap-6 rounded-[14px] border border-line bg-white p-8 shadow-[0_2px_14px_rgba(19,20,22,0.06)] sm:p-10">
          <span className="font-mono text-[11px] tracking-[0.1em] text-red">
            FULL ACADEMIC CORE · 2026–27
          </span>
          <span className="flex items-baseline gap-2.5">
            <span className="text-[54px] font-bold tracking-[-0.03em]">$15,000</span>
            <span className="font-mono text-[13px] text-muted">CAD / YEAR</span>
          </span>
          <div className="flex flex-col gap-3 border-t border-line pt-[22px]">
            {checklist.map((c) => (
              <span key={c} className="flex items-baseline gap-3">
                <span className="font-mono text-xs text-red">✓</span>
                <span className="text-[15px]">{c}</span>
              </span>
            ))}
          </div>
          <JoinButton className="w-full py-4">Join the 120</JoinButton>
          <SeatsDot className="justify-center" />
        </div>
      </div>
    </section>
  );
}
