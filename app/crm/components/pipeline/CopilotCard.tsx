"use client";

/**
 * Conversation Co-pilot card (plan Unit 8; brief §7 — styled as the PROJECT
 * PITCH card): #0300ED bg, radius 12, blush mono kicker with a pulsing red
 * dot (motion-safe only — respects prefers-reduced-motion), deterministic
 * Georgia-italic summary in #F7F6F3, white next-move pill, up to three
 * suggested-item mini-cards routing into the library composer. Everything is
 * server-computed (`FamilyDetail.copilot`); this component only renders.
 * R33: with no concerns AND no signals it shows the insufficient-data state
 * — no pill, no items.
 */

import { useRouter } from "next/navigation";
import type { CopilotPayload } from "@/app/crm/lib/queries";
import { LIBRARY_TYPE_LABELS, type LibraryItemType } from "@/app/crm/lib/library-rules";

export default function CopilotCard({
  copilot,
  familyId,
}: {
  copilot: CopilotPayload;
  familyId: string;
}) {
  const router = useRouter();

  return (
    <section
      aria-label="Conversation co-pilot"
      className="rounded-[12px] bg-crm-blue p-5"
    >
      <p className="flex items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-blush">
        <span
          aria-hidden
          className="h-2 w-2 flex-none rounded-full bg-crm-red motion-safe:animate-pulse"
        />
        Conversation co-pilot
      </p>

      {!copilot.hasData ? (
        /* R33 — insufficient data (brief §11 brand voice) */
        <p className="mt-3 font-serif text-[16px] italic leading-relaxed text-[#F7F6F3]">
          New family — set concerns and signals to get a next move.
        </p>
      ) : (
        <>
          <p className="mt-3 font-serif text-[16px] italic leading-relaxed text-[#F7F6F3]">
            {copilot.summary}
          </p>

          {/* Next-move pill: white bg, ink mono text (brief §7) */}
          <p className="mt-3.5">
            <span className="inline-block rounded-full bg-white px-3 py-1.5 font-mono text-[10px] uppercase leading-relaxed tracking-[0.06em] text-crm-ink">
              {copilot.nextMove}
            </span>
          </p>

          {copilot.suggestedItems.length > 0 && (
            <div className="mt-4">
              <p className="font-mono text-[9px] uppercase tracking-[0.12em] text-crm-blush/80">
                Suggested from the library
              </p>
              <ul className="mt-2 space-y-1.5">
                {copilot.suggestedItems.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() =>
                        router.push(`/crm/library?family=${familyId}`)
                      }
                      className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-[10px] border border-white/20 bg-white/10 px-3 py-2 text-left transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
                    >
                      <span className="min-w-0 truncate text-[12.5px] text-[#F7F6F3]">
                        {item.title}
                      </span>
                      <span className="flex-none rounded-full bg-crm-blush px-2 py-[2px] font-mono text-[8.5px] tracking-[0.08em] text-crm-ink">
                        {LIBRARY_TYPE_LABELS[item.type as LibraryItemType] ??
                          item.type.toUpperCase()}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
