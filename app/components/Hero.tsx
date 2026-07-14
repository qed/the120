import Image from "next/image";

/**
 * Handoff hero: full-bleed photo (min 780px), vertical gradient
 * (0.18 top → transparent → 0.78 bottom), bottom-anchored Georgia headline,
 * hairline, subhead + mono network tagline. The floating nav sits above via
 * the page layout (hero pulls up behind it with a negative margin).
 */
export default function Hero() {
  return (
    <section className="relative -mt-[92px] flex min-h-[780px] flex-col justify-end overflow-hidden">
      <Image
        src="/reference/hero-science.webp"
        alt=""
        fill
        priority
        quality={95}
        sizes="100vw"
        className="-z-20 object-cover object-[72%_32%]"
      />
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "linear-gradient(rgba(19,20,22,0.18) 0%, rgba(19,20,22,0) 30%, rgba(19,20,22,0.02) 55%, rgba(19,20,22,0.78) 100%)",
        }}
      />

      <div className="px-6 pb-10 pt-44 sm:px-11">
        <h1 className="display max-w-[820px] text-4xl text-white sm:text-5xl lg:text-[68px]">
          <span className="block">Build Your Network.</span>
          <span className="accent-blush block">Top 1% academics.</span>
          <span className="block">Super Interesting Projects.</span>
          <span className="block">Ages 8&ndash;17.</span>
        </h1>
        <div className="my-[22px] h-px max-w-[820px] bg-white/45 sm:mb-[18px] sm:mt-[26px]" />
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end sm:gap-8">
          <span className="max-w-[680px] text-[17px] leading-relaxed text-white sm:text-lg">
            Athletes, founders, makers, scholars, givers: Toronto&rsquo;s most motivated and
            engaged kids, ages 8&ndash;17, building interesting lives together.
          </span>
          <span className="whitespace-nowrap font-mono text-[11px] tracking-[0.08em] text-white/85">
            FOUNDING COHORT · FALL 2026 · TORONTO
          </span>
        </div>
      </div>
    </section>
  );
}
