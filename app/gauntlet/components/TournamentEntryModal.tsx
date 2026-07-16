"use client";

import { useState } from "react";
import type { TournamentState } from "@/app/lib/tournament";
import { normalizeHandle, submitTournamentEntry } from "../game/tournamentEntry";

/**
 * GPF-5 — the gate. Captures handle + prize band + parent email + CASL consent
 * (+ optional ambassador code for attribution, GPF-7). Guest-friendly: no
 * account required. On submit, writes a pending entry and triggers the double
 * opt-in email. Mirrors the LeaderboardPanel modal idiom (z-40 / #0d1322 card).
 */
export default function TournamentEntryModal({
  tournament,
  defaultHandle,
  onClose,
  onHandleSet,
}: {
  tournament: TournamentState;
  defaultHandle: string;
  onClose: () => void;
  onHandleSet?: (h: string) => void;
}) {
  const [handle, setHandle] = useState(defaultHandle);
  const [band, setBand] = useState(tournament.bands[0]?.id ?? "b36");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [emailPending, setEmailPending] = useState(false);

  const submit = async () => {
    setError(null);
    setState("busy");
    const res = await submitTournamentEntry({
      handle,
      prizeBand: band,
      parentEmail: email,
      consent,
      referralCode: code,
      heardAbout: code ? `Ambassador ${code}` : undefined,
    });
    if (!res.ok) {
      setError(res.error ?? "Something went wrong.");
      setState("idle");
      return;
    }
    onHandleSet?.(normalizeHandle(handle));
    setEmailPending(Boolean(res.emailPending));
    setState("done");
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl border border-white/15 bg-[#0d1322] p-6 text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-2xl font-bold">Enter the Summer Tournament</h3>
            <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.08em] text-white/45">
              {tournament.windowLabel} · Three bands · Real prizes
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full px-2 text-white/50 hover:text-white">
            ✕
          </button>
        </div>

        {state === "done" ? (
          <div className="py-6 text-center">
            <p className="text-4xl">📬</p>
            <p className="mt-3 font-semibold">Almost there — check the parent inbox.</p>
            <p className="mt-2 text-sm text-white/65">
              {emailPending
                ? "Your entry is saved. The confirmation email is on its way — your score counts once a parent confirms."
                : "We emailed the parent a confirm link. Your score joins the board the moment they click it."}
            </p>
            <button
              onClick={onClose}
              className="mt-6 rounded-xl bg-red px-5 py-2.5 font-mono text-[13px] uppercase tracking-[0.04em] hover:bg-red-dark"
            >
              Keep playing
            </button>
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/50">
                Your handle (not your real name — that&rsquo;s the rule)
              </span>
              <input
                value={handle}
                onChange={(e) => setHandle(normalizeHandle(e.target.value))}
                placeholder="RAIDER-X"
                className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 font-mono text-sm text-white placeholder:text-white/30 focus:border-amber-400 focus:outline-none"
              />
            </label>

            <div>
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/50">Grade band</span>
              <div className="mt-1.5 flex gap-2">
                {tournament.bands.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setBand(b.id)}
                    className={`flex-1 rounded-lg border px-2 py-2 font-mono text-[12px] transition-all ${
                      band === b.id
                        ? "border-amber-400 bg-amber-400/20 text-amber-200"
                        : "border-white/20 text-white/55 hover:border-white/50"
                    }`}
                  >
                    {b.short}
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/50">
                A parent&rsquo;s email (they get your standings — and they have to say yes)
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="parent@email.com"
                className="mt-1.5 w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/30 focus:border-amber-400 focus:outline-none"
              />
            </label>

            <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-snug text-white/75">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-red"
              />
              <span>
                <em>Parent consent:</em> Email me my child&rsquo;s tournament standings and news from
                The 120. Unsubscribe anytime.
              </span>
            </label>

            <label className="block">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">
                Ambassador code (optional)
              </span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="AMB-NAME"
                className="mt-1.5 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 font-mono text-xs text-white placeholder:text-white/25 focus:border-white/40 focus:outline-none"
              />
            </label>

            {error && <p className="text-[13px] text-red-300">{error}</p>}

            <button
              onClick={submit}
              disabled={state === "busy"}
              className="w-full rounded-xl bg-red px-5 py-3 font-mono text-[13px] uppercase tracking-[0.04em] transition-all hover:bg-red-dark disabled:opacity-50"
            >
              {state === "busy" ? "Locking it in…" : "Lock it in"}
            </button>
            <p className="text-center font-mono text-[10px] uppercase tracking-[0.08em] text-white/35">
              Winners are verified · handles never real names
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
