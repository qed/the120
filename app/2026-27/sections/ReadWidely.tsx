"use client";

import { useRef, useState } from "react";
import { COPY, bookTracks } from "../data";
import type { Audience } from "../cta-source";

/* PaceSimulator pill vocabulary — reused verbatim for the grade-track tabs.
   Active reads as an ink fill (the handoff's §04 tab treatment); inactive is
   the shared line-strong / ink-soft pill. */
const TAB_BASE =
  "rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.08em] transition-colors";
const TAB_ACTIVE = "border-ink bg-ink text-white";
const TAB_INACTIVE = "border-line-strong text-ink-soft hover:border-ink";

/**
 * 04 · Read Widely (white band) — APG Tabs.
 *
 * Three grade-track tabs (Grades 3–5 / 6–8 / 9–12), each a panel of five
 * path-phase groups (SELL…SCALE) × four bone book cards. Default track = 0
 * (Grades 3–5). Book titles are single-voice (they never change with the
 * audience toggle); only the kicker/intro and the writing-habit strip below are
 * audience-varied via COPY.
 *
 * Keyboard (WAI-ARIA APG, automatic activation): Left/Right cycle the tabs and
 * swap the visible panel; Home/End jump to the first/last track. Roving
 * tabindex keeps exactly one tab in the page tab sequence; each tabpanel is
 * itself focusable (tabindex 0) since its book cards are non-interactive.
 */
export default function ReadWidely({ audience }: { audience: Audience }) {
  const t = COPY[audience];
  const [active, setActive] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const activateTab = (i: number) => {
    setActive(i);
    tabRefs.current[i]?.focus();
  };

  const onTabKeyDown = (e: React.KeyboardEvent, i: number) => {
    let next = i;
    switch (e.key) {
      case "ArrowRight":
        next = (i + 1) % bookTracks.length;
        break;
      case "ArrowLeft":
        next = (i - 1 + bookTracks.length) % bookTracks.length;
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = bookTracks.length - 1;
        break;
      default:
        return;
    }
    e.preventDefault();
    activateTab(next);
  };

  return (
    <section id="books" className="scroll-mt-[152px] bg-white">
      <div className="mx-auto w-full max-w-[1240px] px-6 py-14 sm:px-11 sm:py-[88px]">
        <p className="eyebrow">{t.booksKicker}</p>
        <h2 className="display mt-3.5 text-4xl text-ink sm:text-[44px]">
          Twenty books. <span className="accent">Three tracks.</span>
        </h2>
        <p className="mt-4 max-w-[720px] text-[17px] leading-relaxed text-ink-soft">
          {t.booksIntro}
        </p>

        {/* Grade-track tabs */}
        <div
          role="tablist"
          aria-label="Book tracks by grade"
          className="mt-9 flex flex-wrap gap-2"
        >
          {bookTracks.map((track, i) => {
            const selected = i === active;
            return (
              <button
                key={track.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`booktab-${track.id}`}
                aria-selected={selected}
                aria-controls={`bookpanel-${track.id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActive(i)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className={`${TAB_BASE} ${selected ? TAB_ACTIVE : TAB_INACTIVE}`}
              >
                {track.label}
              </button>
            );
          })}
        </div>

        {/* One panel per track — five path-phase groups × four book cards */}
        {bookTracks.map((track, i) => {
          const selected = i === active;
          return (
            <div
              key={track.id}
              role="tabpanel"
              id={`bookpanel-${track.id}`}
              aria-labelledby={`booktab-${track.id}`}
              hidden={!selected}
              tabIndex={0}
              className="mt-8 grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-5"
            >
              {track.groups.map((group) => (
                <div key={group.step} className="flex flex-col">
                  <p className="font-mono text-[11px] uppercase tracking-[0.09em] text-red">
                    {group.step}
                  </p>
                  <div className="mt-3 flex flex-col gap-2.5">
                    {group.books.map((book) => (
                      <div
                        key={`${book.title}-${book.author}`}
                        className="rounded-xl border border-line bg-paper p-3.5"
                      >
                        <div className="text-[16px] font-semibold leading-snug text-ink">
                          {book.title}
                        </div>
                        <div className="mt-1 text-sm text-muted">{book.author}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          );
        })}

        {/* Writing-habit strip (audience-varied copy) */}
        <div className="mt-10 rounded-2xl border border-line bg-paper p-6 sm:p-8">
          <p className="eyebrow">{t.writingKicker}</p>
          <p className="mt-3 text-[17px] leading-relaxed text-ink-soft">{t.writingBody}</p>
        </div>
      </div>
    </section>
  );
}
