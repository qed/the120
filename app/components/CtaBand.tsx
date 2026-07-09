import Cta from "./Cta";
import JoinButton from "./JoinButton";

/** Handoff CTA band: centered serif on brand red, white JOIN + bordered BOOK pair. */
export default function CtaBand({
  headline,
  accent,
  subline = "Founding cohort · Fall 2026 · Grades 3–8 · Toronto",
}: {
  headline?: string;
  accent?: string;
  subline?: string;
}) {
  return (
    <section
      id="join"
      className="flex scroll-mt-24 flex-col items-center gap-7 bg-red px-6 py-[88px] text-center sm:px-11"
    >
      <h2 className="display max-w-[800px] text-3xl text-white sm:text-[52px] sm:leading-[1.1]">
        {headline ?? "Come join the network."}{" "}
        <span className="italic">{accent ?? "Come join the 120."}</span>
      </h2>
      <span className="text-[17px] text-white/85">{subline}</span>
      <div className="flex flex-wrap items-center justify-center gap-[18px]">
        <JoinButton variant="white" className="px-[30px] py-4 text-sm">
          Join the 120
        </JoinButton>
        <Cta href="#call" variant="ghostLight" className="px-7 py-[14.5px] text-sm">
          Book a call
        </Cta>
      </div>
    </section>
  );
}
