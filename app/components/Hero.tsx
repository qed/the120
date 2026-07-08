import Image from "next/image";
import Cta from "./Cta";
import JoinButton from "./JoinButton";
import SeatsRemaining from "./SeatsRemaining";

const facts = ["Grades 3–8", "3–5 hrs / week", "Toronto & GTA", "Founding cohort · Fall 2026"];

export default function Hero() {
  return (
    <section className="relative isolate flex min-h-[92vh] flex-col justify-end overflow-hidden">
      {/* Full-bleed background photograph */}
      <Image
        src="/reference/hero-science.webp"
        alt=""
        fill
        priority
        quality={95}
        sizes="100vw"
        className="-z-20 object-cover object-[72%_32%]"
      />
      {/* Legibility scrims — dark on the LEFT where the copy sits (over the blackboard),
          fading right so the kids stay clear. Plus a light top scrim for the nav. */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/92 via-ink/60 to-ink/10" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-1/2 bg-gradient-to-t from-ink/70 to-transparent" />
      <div className="absolute inset-x-0 top-0 -z-10 h-32 bg-gradient-to-b from-ink/75 via-ink/25 to-transparent" />

      <div className="mx-auto w-full max-w-6xl px-6 pb-14 pt-32 text-white sm:pb-20">
        <div className="max-w-3xl">
          <p className="font-mono text-xs uppercase tracking-[0.18em] text-white/80">
            A selective network · Only 120 seats
          </p>

          <h1 className="mt-5 font-display text-4xl font-bold leading-[1.03] tracking-tight sm:text-5xl lg:text-[4.25rem]">
            Come join the network.
            <br />
            Come join the 120.
          </h1>

          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/90">
            A city-wide tribe of Toronto&rsquo;s 120 best and brightest, grades 3&ndash;8. Every
            member joins the network, ships one year-long project, and gets super advanced in one
            subject &mdash; in just 3&ndash;5 hours a week, alongside their current school.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <JoinButton className="h-14 px-8 text-sm">Join the 120</JoinButton>
            <Cta href="#call" variant="ghostLight" className="h-14 px-8 text-sm">
              Book a call
            </Cta>
            <a
              href="#network"
              className="font-mono text-xs uppercase tracking-[0.14em] text-white/80 underline-offset-4 hover:text-white hover:underline"
            >
              Watch the mission ↓
            </a>
          </div>

          <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2">
            {facts.map((f) => (
              <li key={f} className="font-mono text-xs uppercase tracking-[0.12em] text-white/70">
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Scarcity meter, frosted over the photo */}
        <div className="mt-10">
          <SeatsRemaining tone="onDark" />
        </div>
      </div>
    </section>
  );
}
