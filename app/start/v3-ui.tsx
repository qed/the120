"use client";

/**
 * The v3 flow's shared chrome — the brand header with its step meter, the pill
 * button, and the comic cover frame. Ported from the design prototype
 * (artifacts/New Login Flow Aug 2026/src/components) to this repo's Tailwind 4
 * tokens (`v3-*`, see app/globals.css) and `motion/react` (NOT framer-motion —
 * this repo ships `motion`).
 *
 * MOBILE IS A CONSTRUCTION RULE HERE, not a later pass: base classes are the
 * phone (~390px), `sm:`/`lg:` layer the wider registers on. Nothing carries a
 * fixed pixel width, every control clears 44px of touch target, and the header's
 * step meter drops its label under `sm` so the row cannot wrap or overflow.
 */

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import type { V3Step } from "@/app/lib/v3-signup/flow-rules";

/* ------------------------------------------------------------ step order */

/**
 * The flow's five URL steps, in walking order. Lives HERE (not in V3Flow) so
 * step screens like StepParent can size their progress kickers off the real
 * step count without importing V3Flow — which imports them back (a cycle whose
 * TDZ would bite any module-scope reader of this array).
 */
export const STEP_ORDER: readonly V3Step[] = ["parent", "kid", "cover", "story", "ready"];

/* ------------------------------------------------------------ logo lockup */

/**
 * The one First Profit lockup: the bars mark (/path-logo.svg, already shipped
 * for the path PWA) beside the wordmark. The brand header and the "Includes:"
 * tile both render THIS so the two lockups cannot drift apart.
 * eslint-disable on the img: a tiny inline mark from /public needs no
 * optimizer hop.
 */
export function FPLogoLockup({ variant = "header" }: { variant?: "header" | "tile" }) {
  const text =
    variant === "header"
      ? "text-sm font-bold uppercase tracking-[0.08em] text-v3-ink"
      : "font-path-display text-lg font-black leading-none text-v3-ink";
  return (
    <span className={`flex items-center ${variant === "header" ? "gap-2.5" : "gap-1.5"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/path-logo.svg" alt="" aria-hidden className="h-6 w-6 flex-none" />
      <span className={text}>First Profit</span>
    </span>
  );
}

/* ------------------------------------------------------------ brand header */

export function V3BrandHeader({
  step,
  totalSteps,
  stepLabel,
  end,
}: {
  step: number;
  totalSteps: number;
  stepLabel: string;
  /** fpv03 (Unit 2): optional right-side slot. When given it REPLACES the
   *  header's step meter — the reskinned screens carry their own in-content
   *  progress kicker (V3StepKicker), so the bar shows the account chip instead.
   *  Steps that do not pass it keep the meter exactly as before. */
  end?: ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 w-full border-b border-v3-ink/10 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-4 py-3 sm:px-5 sm:py-3.5">
        {/* fpv03 U2 amendment: the 120 → First Profit connection, restored.
            The 120 chip and the arrow are the pre-U2 header's exact treatment
            (git: the head of this file at U2's parent commit); what changed is
            that the arrow now points at the shared FPLogoLockup instead of a
            forked bars-and-wordmark copy, and the pair is visible at every
            width — at 390px the row still clears the step meter/end slot
            because the lockup carries no fixed widths. */}
        <span className="flex h-7 w-7 flex-none items-center justify-center rounded bg-v3-one20 font-path-mono text-[11px] font-bold text-white">
          120
        </span>
        <span aria-hidden className="flex-none text-v3-ink/25">
          →
        </span>
        <FPLogoLockup variant="header" />

        <div className="ml-auto flex min-w-0 items-center gap-2 sm:gap-3">
          {end ?? (
            <>
              {/* The label is the first thing to go on a phone: the dot meter
                  and its aria-label still carry the whole progress story. */}
              <span className="v3-label hidden truncate text-v3-stone sm:inline">
                Step {step} of {totalSteps} · {stepLabel}
              </span>
              <span className="v3-label text-v3-stone sm:hidden">
                {step}/{totalSteps}
              </span>
              <div
                className="flex flex-none gap-1"
                role="progressbar"
                aria-valuenow={step}
                aria-valuemin={1}
                aria-valuemax={totalSteps}
                aria-label={`Onboarding progress: step ${step} of ${totalSteps}, ${stepLabel}`}
              >
                {Array.from({ length: totalSteps }).map((_, i) => (
                  <span
                    key={i}
                    className={`h-1.5 w-4 rounded-full transition-colors sm:w-6 ${
                      i < step ? "bg-v3-profit" : "bg-v3-ink/10"
                    }`}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

/* --------------------------------------------------------- in-content meter */

/**
 * fpv03 (Unit 2): the "STEP 1 OF 3 · YOUR DETAILS" kicker with segment pills
 * that opens each reskinned screen. Purely presentational — the mock's macro
 * count (3) is independent of the flow's five URL steps, so callers pass their
 * own numbers.
 */
export function V3StepKicker({
  current,
  total,
  label,
}: {
  current: number;
  total: number;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="v3-label text-v3-stone">
        Step {current} of {total} · {label}
      </span>
      <span aria-hidden className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <span
            key={i}
            className={`h-1.5 w-7 rounded-full ${i < current ? "bg-v3-profit" : "bg-v3-ink/10"}`}
          />
        ))}
      </span>
    </div>
  );
}

/* --------------------------------------------------------- includes tiles */

/**
 * fpv03 (Unit 2): the "Includes:" row — the three apps an enrollment carries,
 * as small white tiles. Purely presentational. THE GAUNTLET is a styled text
 * wordmark (no bundled asset exists for it); the other two are shipped marks.
 * Exported alongside V3IncludesTiles so the U3/U4 screens reuse the same set.
 */
export const INCLUDES_TILES: ReadonlyArray<{
  key: string;
  art: ReactNode;
  subcopy: string;
}> = [
  {
    key: "gauntlet",
    art: (
      <span className="text-lg font-black leading-none tracking-[0.04em]">
        <span className="text-[#2f6fd0]">THE</span>
        <span className="text-[#e8762c]">GAUNTLET</span>
      </span>
    ),
    subcopy: "Gr 3-12 math facts",
  },
  {
    key: "math-academy",
    art: (
      // eslint-disable-next-line @next/next/no-img-element
      <img src="/math-academy-long-logo.jpg" alt="Math Academy" className="h-7 w-auto" />
    ),
    subcopy: "Learn math 2X-4X faster",
  },
  {
    key: "first-profit",
    art: <FPLogoLockup variant="tile" />,
    subcopy: "Start a real business",
  },
];

/** The tile row itself, parameterized so later units can carry a different or
 *  reordered set without forking the layout. */
export function V3IncludesTiles({
  tiles,
}: {
  tiles: ReadonlyArray<{ key: string; art: ReactNode; subcopy: string }>;
}) {
  return (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {tiles.map((tile) => (
        <div
          key={tile.key}
          className="flex min-h-[92px] flex-col items-center justify-center gap-2 rounded-2xl border border-v3-ink/10 bg-white px-4 py-4 text-center shadow-v3-card"
        >
          {tile.art}
          <span className="v3-label text-v3-stone">{tile.subcopy}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ button */

type ButtonVariant = "profit" | "ghost" | "ink";

// The lifted/offset-shadow treatment is deliberately rolled out on `profit`
// only for now; `ghost` and `ink` pick up theirs when their screens' fpv03
// units land.
const BUTTON_STYLES: Record<ButtonVariant, string> = {
  // fpv03: the green pill wears a hard offset shadow and lifts on hover. The
  // shadow drops with the disabled state so a dead button also LOOKS flat.
  profit:
    "bg-v3-profit text-white shadow-[0_4px_0_0_#0f4227] hover:-translate-y-0.5 hover:bg-v3-profit-dark active:translate-y-0 focus-visible:outline-v3-profit disabled:bg-v3-ink/15 disabled:text-v3-ink/40 disabled:shadow-none disabled:hover:translate-y-0",
  ghost:
    "bg-transparent text-v3-ink ring-1 ring-inset ring-v3-ink/20 hover:bg-v3-ink/5 focus-visible:outline-v3-ink",
  ink: "bg-v3-ink text-white hover:bg-v3-ink/85 focus-visible:outline-v3-ink disabled:opacity-40",
};

export function V3Button({
  variant = "profit",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      {...props}
      // min-h-[44px] + the full-width-under-sm default is the tap-target rule,
      // not decoration: a pill that only fits its text is a 32px target on a
      // phone.
      className={`inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-full px-6 py-3 font-path-display text-base font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed sm:w-auto ${BUTTON_STYLES[variant]} ${className}`}
    />
  );
}

/** The small text control (upload / use another photo / skip). Still a 44px
 *  target: it is padded, not bare text. */
export function V3TextButton({
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`v3-label inline-flex min-h-[44px] items-center px-1 text-v3-stone underline underline-offset-4 transition-colors hover:text-v3-ink disabled:opacity-40 ${className}`}
    />
  );
}

/* -------------------------------------------------------------- form field */

export function V3Field({
  id,
  label,
  hint,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="v3-label block text-v3-stone">
        {label}
      </label>
      {hint && <p className="mt-1 text-sm text-v3-stone">{hint}</p>}
      {children}
    </div>
  );
}

/** One input treatment across every step. `w-full` everywhere — a fixed-width
 *  input is the classic 390px overflow. */
export const V3_INPUT_CLASSES =
  "mt-2 w-full rounded-2xl border border-v3-ink/10 bg-white px-4 py-3 font-path-display text-lg text-v3-ink shadow-v3-card outline-none transition-colors placeholder:text-v3-ink/25 focus:border-v3-profit";

export const V3_TEXTAREA_CLASSES =
  "mt-3 w-full resize-y rounded-2xl border border-v3-ink/10 bg-white px-4 py-3 text-[15px] leading-relaxed text-v3-ink shadow-v3-card outline-none transition-colors placeholder:text-v3-ink/25 focus:border-v3-profit";

/* -------------------------------------------------------------- the notice */

export function V3Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={`mt-4 text-sm leading-relaxed ${tone === "error" ? "font-medium text-v3-one20" : "text-v3-stone"}`}
    >
      {children}
    </p>
  );
}

/* -------------------------------------------------------------- the cover */

/**
 * The comic cover frame: illustration in a paper frame, sticky note, caption.
 *
 * NO IMAGE SOURCE IS BUNDLED. The prototype ships a stock intro illustration and
 * a pre-rendered "personalized" cover; this port renders a CSS placeholder plate
 * until Unit 4's generator supplies a real URL, so nothing on screen implies a
 * cover exists that does not. When `imageUrl` arrives the plate is replaced by
 * the picture with explicit dimensions and an object-fit, and a broken URL falls
 * back to the plate rather than a broken-image glyph.
 */
export function V3ComicCover({
  age,
  imageUrl,
  title,
  caption,
  onImageError,
}: {
  age: string | number;
  imageUrl?: string | null;
  title?: string;
  caption?: string;
  onImageError?: () => void;
}) {
  const reduced = useReducedMotion();
  return (
    <motion.figure
      initial={reduced ? false : { opacity: 0, y: 14, rotate: -0.6 }}
      animate={{ opacity: 1, y: 0, rotate: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="relative mx-auto w-full max-w-xl rounded-[3px] bg-[#FDFBF5] p-3 shadow-v3-frame ring-1 ring-v3-ink/10 sm:p-4"
    >
      <div className="relative overflow-hidden rounded-[2px] ring-1 ring-v3-ink/10">
        {imageUrl ? (
          /* A plain <img>, not next/image: the cover is a RUNTIME blob URL from
             our own store on a host next.config does not (and should not)
             allowlist, so the optimizer has nothing to pre-size and would only
             add a proxy hop in front of a minor's picture. Explicit aspect ratio
             + object-fit keep the layout stable without it, and onError falls
             back to the plate. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt="A graphic-novel illustration of your kid at their workbench."
            onError={onImageError}
            className="block aspect-[4/3] w-full object-cover"
          />
        ) : (
          <div
            aria-hidden
            className="flex aspect-[4/3] w-full items-center justify-center bg-gradient-to-br from-v3-paper via-v3-cream to-v3-paper"
          >
            <span className="v3-label px-6 text-center text-v3-stone">
              Their cover is drawn here
            </span>
          </div>
        )}

        {title && (
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-v3-ink/85 via-v3-ink/55 to-transparent px-4 pt-14 pb-4 sm:px-5">
            <p className="font-path-display text-2xl leading-none font-black text-white drop-shadow-sm sm:text-4xl">
              {title}
            </p>
          </div>
        )}
      </div>

      <span className="absolute -top-4 -right-2 rotate-[7deg] rounded-[2px] bg-v3-sun px-3 py-1.5 font-path-display text-base leading-none font-bold text-v3-ink shadow-[0_6px_14px_-6px_rgba(27,24,21,0.6)] sm:-right-5 sm:text-xl">
        Founder, age {age || "9"}
      </span>

      {caption && (
        <figcaption className="px-1 pt-3 pb-1 font-path-display text-base italic text-v3-ink/70 sm:text-lg">
          {caption}
        </figcaption>
      )}
    </motion.figure>
  );
}
