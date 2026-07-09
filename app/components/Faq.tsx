const faqs = [
  {
    q: "Does my child leave their current school?",
    a: "No. Membership is 3–5 hours a week alongside school — it's what school can't give them. A complete academic program exists for families who want to go all-in, offered on a call.",
  },
  {
    q: "What happens after I create an account?",
    a: "You build a dossier for each child in your dashboard and submit it for review. If it's a fit, you're invited to a qualifying assessment and a call — then, if a seat is offered, your child becomes a member of the 120.",
  },
  {
    q: "What is the Tin Can?",
    a: "A screen-free Wi-Fi landline that only connects approved contacts. The 120 Address Book links every member — a bat phone to the network, with no feeds and no screens.",
  },
  {
    q: "Is this a school?",
    a: "The 120 is a learning centre and a network, not an accredited school. The Full Program tier supports Ontario homeschooling families who want the complete academic core.",
  },
  {
    q: "What if the 120 seats are full?",
    a: "You join the waitlist and are first in line for the next assessment window.",
  },
];

export default function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-b border-line bg-paper-2">
      <div className="mx-auto w-full max-w-3xl px-6 py-20 lg:py-24">
        <p className="eyebrow">Questions</p>
        <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
          The details that matter.
        </h2>

        <div className="mt-10 divide-y divide-line border-y border-line">
          {faqs.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-semibold tracking-tight text-ink transition-colors hover:text-red">
                {f.q}
                <span className="font-mono text-xl text-red transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-ink-soft">{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
