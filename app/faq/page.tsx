import type { Metadata } from "next";
import Nav from "@/app/components/Nav";
import Footer from "@/app/components/Footer";
import CtaBand from "@/app/components/CtaBand";

export const metadata: Metadata = {
  title: "FAQ — The 120",
  description: "Questions, answered: membership, the groups, the Tin Can, tuition, and admissions.",
};

// Copy from the design handoff FAQ, with pricing/gating answers aligned to the
// confirmed five-groups direction.
const faqs = [
  {
    q: "What happens after I create an account?",
    a: "You build your child's dossier in the dashboard — their group, their interests, a project pitch in their own words, and any scores you want to share — then submit it for review. If it's a fit, you're invited to a call with our team.",
  },
  {
    q: "Does my child leave their current school?",
    a: "No. Membership is 3–5 hours a week, alongside any school — public gifted stream, private, or homeschool. For families who want to go all-in, the Full Academic Core replaces school entirely; that conversation happens on your call.",
  },
  {
    q: "What is the Tin Can?",
    a: "A screen-free Wi-Fi landline for kids — voice only, no apps, no feeds. Only parent-approved contacts can call. Every member's Tin Can ships with The 120 Address Book: the whole network, one call away. Device and service are included in membership.",
  },
  {
    q: "How do the five groups work?",
    a: "The 120 is 120 kids across five groups: the Athletes, the Founders, the Makers, the Scholars, and the Givers. Your child joins the group that fits their thing. Each group qualifies its members its own way; the Scholars' assessment is run by GT.",
  },
  {
    q: "What does it cost, and in what currency?",
    a: "$3,000 CAD a year for Membership — the network, the project, the Tin Can, all four intensives, and math acceleration through Math Academy. The Full Academic Core, with 5 hours a week of TimeBack for 1 to 3 subjects, is $15,000. Prices in CAD; HST-exempt.",
  },
  {
    q: "What if the 120 seats are full?",
    a: "You join the waitlist and we invite you to the next assessment window. Seats open only when a member leaves — the 120 stays 120.",
  },
  {
    q: "Is this a school?",
    a: "No — The 120 is a selective network and Ontario learning centre. Members keep their school. The Full Academic Core tier supports Ontario homeschooling families with a complete academic core.",
  },
  {
    q: "What counts as a project?",
    a: "Anything real, sustained, and shippable: a season record, a novel, an app, a research study, a business, a robot, a documentary, a service program. The bar is that it's genuinely theirs and it ships by June — demoed live at the intensives along the way.",
  },
  {
    q: "What's the right age?",
    a: "Grades 3–8. Seats are roughly balanced across grades, so a strong Grade 3 candidate isn't competing with Grade 8 applicants.",
  },
  {
    q: "Are the intensives mandatory?",
    a: "No — optional but strongly encouraged. We recommend at least one per year: it's where Tin Can friendships become real ones. All four weekends are in Toronto — a drive, not a flight, for most Ontario families.",
  },
  {
    q: "What if my child is shy?",
    a: "They arrive already knowing people — their cohort has been talking on Tin Cans and meeting virtually all quarter. Team activities are designed for belonging, not performance. Shy kids tend to leave the weekend loudest.",
  },
  {
    q: "Do Canadian universities recognize SAT and AP results?",
    a: "Yes — SAT and AP are the international gold standard, recognized by U of T, Waterloo, McGill, and universities worldwide. For Scholars accelerating with GT, they're objective, external proof of mastery years early.",
  },
  {
    q: "When is the Toronto campus coming?",
    a: "A dedicated campus for the 120 is planned, following the blueprint of GT School's Georgetown hub. Until then, intensives run at a Toronto venue shared with member families — members hear first.",
  },
  {
    q: "We're outside Toronto. Can we still join?",
    a: "Yes — the weekly rhythm is virtual, so anywhere in Ontario works. The four intensive weekends are in Toronto; most member families drive in. Farther afield? Book a call and we'll talk it through.",
  },
  {
    q: "How is my family's information handled?",
    a: "Dossiers contain children's personal information, so we treat them as sensitive: collected only as needed for admissions, access-controlled, and covered by our privacy policy. Uploads like report cards are never shared outside the admissions team.",
  },
];

export default function FaqPage() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        <div className="mx-auto flex w-full max-w-[860px] flex-col gap-6 px-6 pb-6 pt-[84px] sm:px-8">
          <span className="font-mono text-xs tracking-[0.1em] text-red">FAQ</span>
          <h1 className="display text-4xl sm:text-[56px] sm:leading-[1.06]">
            Questions, <span className="accent">answered</span>
          </h1>
        </div>

        <div className="mx-auto w-full max-w-[860px] px-6 pb-24 sm:px-8">
          <div className="divide-y divide-line border-y border-line">
            {faqs.map((f, i) => (
              <details key={f.q} className="group py-5" open={i === 0}>
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[17px] font-semibold text-ink transition-colors hover:text-red">
                  {f.q}
                  <span className="font-mono text-xl text-red transition-transform group-open:rotate-45">
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-[720px] text-[15px] leading-[1.65] text-ink-soft">{f.a}</p>
              </details>
            ))}
          </div>
        </div>

        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
