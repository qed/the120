/**
 * GPF-5/7 — shared tournament-entry validation + the client submit call.
 * Pure and env-free (no server imports) so both the client modal and the
 * server route validate identically.
 */

export const PRIZE_BAND_IDS = ["b36", "b78", "b912"] as const;
export type EntryBand = (typeof PRIZE_BAND_IDS)[number];

export interface EntryPayload {
  handle: string;
  prizeBand: string;
  parentEmail: string;
  consent: boolean;
  referralCode?: string;
  heardAbout?: string;
}

/** Kid-safe handle rule — matches the in-game handle: A–Z/0–9/dash, 3–12 chars. */
export function normalizeHandle(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .slice(0, 12);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns an error string, or null if the payload is valid. */
export function validateEntry(p: EntryPayload): string | null {
  const handle = normalizeHandle(p.handle || "");
  if (handle.length < 3) return "Pick a handle (3–12 letters, numbers or dashes).";
  if (!PRIZE_BAND_IDS.includes(p.prizeBand as EntryBand)) return "Choose your grade band.";
  if (!EMAIL_RE.test((p.parentEmail || "").trim())) return "Enter a parent's email address.";
  if (!p.consent) return "A parent needs to check the consent box.";
  return null;
}

export interface EntryResult {
  ok: boolean;
  /** True when the entry landed but email delivery is pending/failed. */
  emailPending?: boolean;
  error?: string;
}

/** POST the entry to the gate. Never throws — network errors resolve to {ok:false}. */
export async function submitTournamentEntry(p: EntryPayload): Promise<EntryResult> {
  const err = validateEntry(p);
  if (err) return { ok: false, error: err };
  try {
    const res = await fetch("/api/gauntlet/tournament/enter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...p, handle: normalizeHandle(p.handle) }),
    });
    const data = (await res.json().catch(() => ({}))) as EntryResult;
    if (!res.ok) return { ok: false, error: data.error || "Could not enter — try again." };
    return { ok: true, emailPending: data.emailPending };
  } catch {
    return { ok: false, error: "Network error — try again." };
  }
}
