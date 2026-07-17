"use client";

import { useEffect, useState } from "react";

/**
 * A3 — game-rendered number pad for touch play. The OS keyboard is the worst
 * part of mobile play (covers half the arena, no minus key on many numeric
 * keyboards — the engine contract's touch-minus gap). On coarse-pointer
 * devices the input box becomes a display and this pad does the typing,
 * feeding the same onType → auto-submit path as the keyboard.
 */

/** True on touch-primary devices (phones/tablets); false on mouse/trackpad. */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const update = () => setCoarse(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return coarse;
}

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3", "±", "0", "⌫"] as const;

export default function NumberPad({
  value,
  onInput,
  disabled,
  accent = "#22d3ee",
}: {
  value: string;
  onInput: (v: string) => void;
  disabled?: boolean;
  accent?: string;
}) {
  const press = (k: (typeof KEYS)[number]) => {
    if (disabled) return;
    if (k === "⌫") onInput(value.slice(0, -1));
    else if (k === "±") onInput(value.startsWith("-") ? value.slice(1) : `-${value}`);
    else onInput(value + k);
  };

  return (
    <div className="mt-2 grid grid-cols-3 gap-1.5">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          // pointerdown, not click: answers land the moment the finger does
          onPointerDown={(e) => {
            e.preventDefault();
            press(k);
          }}
          disabled={disabled}
          aria-label={k === "⌫" ? "Delete" : k === "±" ? "Plus or minus" : k}
          className={`h-11 touch-manipulation select-none rounded-xl border font-mono text-xl font-bold text-white transition-colors disabled:opacity-40 sm:h-14 ${
            k === "±" || k === "⌫"
              ? "border-white/15 bg-white/5 active:bg-white/20"
              : "border-white/20 bg-white/10 active:bg-white/30"
          }`}
          style={{ WebkitTapHighlightColor: "transparent" }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <span style={k === "±" ? { color: accent } : undefined}>{k}</span>
        </button>
      ))}
    </div>
  );
}
