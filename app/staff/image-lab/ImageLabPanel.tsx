/**
 * The Lab shell's one presentational primitive: a headline + body panel
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 3).
 *
 * Every state this shell can be in — generation on, generation off, no runs, no
 * kept results, composer not built yet — is the same shape: a sentence naming the
 * state and a sentence saying what would change it. One component, so an empty
 * state cannot accidentally be rendered as a blank div, and a `tone` rather than
 * a className so the three variants stay a closed set.
 *
 * Server component, no state, no client boundary.
 */

export type ImageLabPanelTone = "neutral" | "off" | "on";

const TONES: Record<ImageLabPanelTone, string> = {
  neutral: "border-hq-border bg-hq-surface",
  // Deliberately NOT a red/error skin: an unset `IMAGE_LAB_LIVE` is the intended
  // default for every environment until someone switches a priced bench on.
  off: "border-hq-border-strong bg-hq-surface",
  on: "border-crm-blue bg-hq-surface",
};

/** Named for its file — the repo convention (`StaffBar`, `IdentityUnavailable`). */
export function ImageLabPanel({
  tone = "neutral",
  headline,
  body,
}: {
  tone?: ImageLabPanelTone;
  headline: string;
  body: string;
}) {
  return (
    <section className={`mt-6 rounded-xl border p-5 shadow-hq ${TONES[tone]}`}>
      <h3 className="font-path-display text-base text-hq-ink">{headline}</h3>
      {/* `text-pretty` + no fixed width: the long bodies here must wrap, never
          push the page into a horizontal scroll at 390px. */}
      <p className="mt-2 text-pretty text-sm leading-relaxed text-hq-ink-soft">
        {body}
      </p>
    </section>
  );
}
