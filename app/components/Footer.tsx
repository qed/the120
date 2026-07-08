import Wordmark from "./Wordmark";

const pressLogos = ["Forbes", "The Wall Street Journal", "TechCrunch", "Fox Business"];

export default function Footer() {
  return (
    <footer className="bg-ink text-paper">
      <div className="mx-auto w-full max-w-6xl px-6 py-16">
        {/* Press strip — GT network press (brief §9) */}
        <div className="flex flex-wrap items-center gap-x-10 gap-y-4 border-b border-white/10 pb-10">
          <span className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted">
            As seen in
          </span>
          {pressLogos.map((p) => (
            <span key={p} className="font-serif text-lg text-white/70">
              {p}
            </span>
          ))}
        </div>

        <div className="grid gap-10 py-12 md:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <Wordmark className="[&_.text-ink]:text-white [&_.text-muted]:text-white/50" />
            <p className="mt-5 max-w-sm text-sm leading-6 text-muted">
              A selective network of Toronto&rsquo;s 120 best and brightest students, grades
              3&ndash;8. Part of the 2 Hour Learning network.
            </p>
          </div>

          <div>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted">
              Explore
            </p>
            <ul className="mt-4 space-y-2 text-sm text-white/80">
              <li><a className="hover:text-white" href="#network">The Network</a></li>
              <li><a className="hover:text-white" href="#project">The Project</a></li>
              <li><a className="hover:text-white" href="#subject">The Subject</a></li>
              <li><a className="hover:text-white" href="#tuition">Tuition</a></li>
              <li><a className="hover:text-white" href="#faq">FAQ</a></li>
            </ul>
          </div>

          <div>
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.18em] text-muted">
              Get in touch
            </p>
            <ul className="mt-4 space-y-2 text-sm text-white/80">
              <li><a className="hover:text-white" href="#join">Join the 120</a></li>
              <li><a className="hover:text-white" href="#call">Book a call</a></li>
              <li><a className="hover:text-white" href="mailto:admissions@the120.school">admissions@the120.school</a></li>
            </ul>
          </div>
        </div>

        {/* Compliance line — brief §14: learning centre, not an accredited school; CAD; Canadian spelling */}
        <div className="border-t border-white/10 pt-8 text-xs leading-6 text-muted">
          <p>
            The 120 (GT Toronto) is an official licensed partner of GT School / 2 Hour Learning. The
            120 is a learning centre and network operating in Ontario — not an accredited school.
            Network outcomes are attributed to the GT School / 2 Hour Learning network and are not
            claimed as The 120&rsquo;s own results. Tuition is shown in Canadian dollars (CAD). Tin
            Can is a trademark of Tin Can Untechnologies, Inc.
          </p>
          <p className="mt-4">© 2026 The 120 · GT Toronto. All rights reserved.</p>
        </div>
      </div>
    </footer>
  );
}
