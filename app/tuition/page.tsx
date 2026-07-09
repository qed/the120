import type { Metadata } from "next";
import Nav from "@/app/components/Nav";
import Footer from "@/app/components/Footer";
import CtaBand from "@/app/components/CtaBand";
import Cta from "@/app/components/Cta";
import JoinButton from "@/app/components/JoinButton";
import SeatsDot from "@/app/components/SeatsDot";
import { BOOKING_URL } from "@/app/lib/site";
import { getSeatsRemaining } from "@/app/lib/seats";

export const metadata: Metadata = {
  title: "Tuition — The 120",
  description:
    "Two price points, one network. $3,000 CAD a year for Membership, or $15,000 for the Full Academic Core with TimeBack.",
};

const membership = [
  "Tin Can device + service, The 120 Address Book",
  "One year-long project with real mentorship",
  "Math acceleration through Math Academy",
  "All four Toronto intensives",
  "Virtual cohorts + community events",
];

const fullcore = [
  "Everything in Membership, plus:",
  "5 hours a week of TimeBack, your academic core",
  "1–3 subjects, your choice",
  "Bi-weekly 30 min 1:1 with an expert Academic Advisor",
  "Academics via Alpha Anywhere or GT Anywhere, by group",
  "Supports Ontario homeschool registration",
];

const finePrint = [
  {
    title: "No add-ons, no surprises",
    body: "The Tin Can device and service, all mentorship, the platform, and all four intensives are in the price. Prices in CAD; HST-exempt education services.",
  },
  {
    title: "Admission first",
    body: "Tuition applies only after your child qualifies: dossier review, then the qualifying assessment. No payment until a seat is offered.",
  },
  {
    title: "The network stays 120",
    body: "Seats are capped. If the 120 is full, you join the waitlist for the next assessment window.",
  },
];

export default async function TuitionPage() {
  const seatsRemaining = await getSeatsRemaining();
  return (
    <>
      <Nav />
      <main className="flex-1">
        {/* Hero */}
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-6 px-6 pb-14 pt-[84px] sm:px-8">
          <span className="font-mono text-xs tracking-[0.1em] text-red">TUITION</span>
          <h1 className="display max-w-[800px] text-4xl sm:text-[60px] sm:leading-[1.06]">
            Two price points. <span className="accent">One network.</span>
          </h1>
          <p className="max-w-[640px] text-lg leading-relaxed text-ink-soft">
            $3,000 CAD a year for Membership, with math acceleration through Math Academy. Or
            $15,000 for the Full Academic Core: 5 hours a week of TimeBack for 1 to 3 subjects
            of your choice.
          </p>
        </div>

        {/* Two tiers */}
        <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 items-start gap-7 px-6 pb-24 sm:px-8 lg:grid-cols-2">
          {/* Membership (blue) */}
          <div className="flex flex-col gap-6 rounded-[14px] bg-blue p-8 sm:p-10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-mono text-[11px] tracking-[0.1em] text-blush">
                MEMBERSHIP · THE CORE PRODUCT
              </span>
              <span className="rounded-full bg-paper px-2.5 py-[5px] font-mono text-[10px] tracking-[0.08em] text-ink">
                MOST FAMILIES
              </span>
            </div>
            <span className="flex items-baseline gap-2.5">
              <span className="text-[54px] font-bold tracking-[-0.03em] text-paper">$3,000</span>
              <span className="font-mono text-[13px] text-muted">CAD / YEAR</span>
            </span>
            <span className="text-[15px] leading-relaxed text-muted">
              3&ndash;5 hours a week, alongside any school. Everything the network offers, with
              math acceleration through Math Academy. No TimeBack academics.
            </span>
            <div className="flex flex-col gap-3 border-t border-white/25 pt-[22px]">
              {membership.map((m) => (
                <span key={m} className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-blush">✓</span>
                  <span className="text-[15px] text-paper">{m}</span>
                </span>
              ))}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Cta href={BOOKING_URL} variant="white" className="py-4">
                Book a call
              </Cta>
              <JoinButton className="py-4">Join the 120</JoinButton>
            </div>
            <SeatsDot tone="onDark" className="justify-center" remaining={seatsRemaining} />
          </div>

          {/* Full Academic Core (white) */}
          <div className="flex flex-col gap-6 rounded-[14px] border border-line bg-white p-8 sm:p-10">
            <span className="font-mono text-[11px] tracking-[0.1em] text-muted">
              FULL ACADEMIC CORE · ALL-IN
            </span>
            <span className="flex items-baseline gap-2.5">
              <span className="text-[54px] font-bold tracking-[-0.03em]">$15,000</span>
              <span className="font-mono text-[13px] text-muted">CAD / YEAR</span>
            </span>
            <span className="text-[15px] leading-relaxed text-ink-soft">
              The complete academic core: 5 hours a week of TimeBack for 1 to 3 subjects, your
              choice. Academics through Alpha Anywhere or GT Anywhere, depending on your group.
            </span>
            <div className="flex flex-col gap-3 border-t border-line pt-[22px]">
              {fullcore.map((f) => (
                <span key={f} className="flex items-baseline gap-3">
                  <span className="font-mono text-xs text-red">✓</span>
                  <span className="text-[15px]">{f}</span>
                </span>
              ))}
            </div>
            <Cta href="/gt" variant="ghost" className="py-[15px]">
              See the full program
            </Cta>
            <span className="text-center text-[13px] text-muted">
              Offered on your call. Book a Call to talk it through.
            </span>
          </div>
        </div>

        {/* Fine print */}
        <div className="border-t border-line bg-white">
          <div className="mx-auto grid w-full max-w-[1240px] grid-cols-1 gap-10 px-6 py-16 sm:px-8 md:grid-cols-3">
            {finePrint.map((f) => (
              <div key={f.title} className="flex flex-col gap-2">
                <span className="text-[17px] font-semibold">{f.title}</span>
                <span className="text-sm leading-relaxed text-ink-soft">{f.body}</span>
              </div>
            ))}
          </div>
        </div>

        <CtaBand
          headline="Claim your child's seat for"
          accent="Fall 2026"
          subline="Grades 3–8 · Toronto · All five groups enrolling"
        />
      </main>
      <Footer />
    </>
  );
}
