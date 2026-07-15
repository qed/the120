"use client";

/**
 * Ambassador console (GTM-4) — the registry form + per-code tally in one
 * client island so "claim owner" on an unregistered signup code can pre-fill
 * the form. Data is computed server-side (`computeAmbassadorReport`); this
 * component only edits the registry and refreshes. Design: brief §8/§11 tokens,
 * matching the dashboard's Source & ambassador tally.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/app/crm/components/Toast";
import {
  registerAmbassadorCode,
  removeAmbassadorCode,
} from "@/app/crm/lib/actions/ambassadors";
import type { AmbassadorReport } from "@/app/crm/lib/ambassadors";

const INPUT =
  "w-full rounded-[10px] border border-crm-line2 bg-white px-3 py-2 font-mono text-[12px] uppercase tracking-[0.04em] text-crm-ink placeholder:text-crm-faint focus:border-crm-blue focus:outline-none disabled:opacity-50";
const LABEL =
  "mb-1 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-muted";
const BTN_PRIMARY =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] bg-crm-red px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export default function AmbassadorConsole({
  report,
}: {
  report: AmbassadorReport;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const { rows, totals, unregisteredCount } = report;

  const [code, setCode] = useState("");
  const [owner, setOwner] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const res = await registerAmbassadorCode({ code, ownerName: owner, note });
    setSaving(false);
    if (!res.success) {
      setError(res.error ?? "Something went wrong.");
      return;
    }
    toast("success", `Saved ${code.trim().toUpperCase()}`);
    setCode("");
    setOwner("");
    setNote("");
    router.refresh();
  };

  const remove = async (target: string) => {
    setBusyCode(target);
    const res = await removeAmbassadorCode({ code: target });
    setBusyCode(null);
    if (!res.success) {
      toast("error", res.error ?? "Failed to remove the code.");
      return;
    }
    toast("info", `Removed ${target}`);
    router.refresh();
  };

  // "Claim" an unregistered signup code → pre-fill the form for an owner.
  const claim = (target: string) => {
    setCode(target);
    setOwner("");
    setError(null);
    if (typeof window !== "undefined") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Totals strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Codes issued" value={totals.codes} />
        <Stat label="Leads" value={totals.leads} />
        <Stat label="Accounts" value={totals.accounts} />
        <Stat label="Deposits" value={totals.deposits} />
      </div>

      {/* Register / update a code */}
      <section className="rounded-[12px] border border-crm-line bg-crm-card p-5 sm:p-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
          Register an issued code
        </p>
        <form
          onSubmit={register}
          className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)_auto] sm:items-end"
        >
          <div>
            <label className={LABEL} htmlFor="amb-code">
              Code
            </label>
            <input
              id="amb-code"
              className={INPUT}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="AMB-NAME"
              maxLength={24}
              autoComplete="off"
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="amb-owner">
              Owner
            </label>
            <input
              id="amb-owner"
              className={`${INPUT} normal-case tracking-normal`}
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="Ambassador name"
              maxLength={80}
              autoComplete="off"
            />
          </div>
          <button type="submit" className={BTN_PRIMARY} disabled={saving}>
            {saving ? "Saving…" : "Save code"}
          </button>
        </form>
        <div className="mt-3">
          <label className={LABEL} htmlFor="amb-note">
            Note (optional)
          </label>
          <input
            id="amb-note"
            className={`${INPUT} normal-case tracking-normal`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Grade 7 · UTS circle"
            maxLength={200}
            autoComplete="off"
          />
        </div>
        {error && (
          <p className="mt-3 font-mono text-[11px] text-crm-red">{error}</p>
        )}
        <p className="mt-3 text-[11.5px] leading-5 text-crm-muted">
          Registering a code lists it here from day one — before its first
          signup — and names its owner. Re-saving a code corrects its owner or
          note.
        </p>
      </section>

      {/* Per-code tally */}
      <section className="rounded-[12px] border border-crm-line bg-crm-card">
        <div className="flex items-center justify-between border-b border-crm-line px-5 py-4 sm:px-6">
          <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
            Signups by referral code
          </p>
          {unregisteredCount > 0 && (
            <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-crm-red">
              {unregisteredCount} unclaimed
            </span>
          )}
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-6 text-[12.5px] text-crm-muted sm:px-6">
            No codes yet — register your first issued code above, or one appears
            here the moment a family signs up with a referral code.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-crm-line font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-faint">
                  <th className="px-5 py-2 font-normal sm:px-6">Code</th>
                  <th className="px-3 py-2 font-normal">Owner</th>
                  <th className="px-3 py-2 text-right font-normal">Leads</th>
                  <th className="px-3 py-2 text-right font-normal">Accts</th>
                  <th className="px-3 py-2 text-right font-normal">Deps</th>
                  <th className="px-5 py-2 text-right font-normal sm:px-6" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.code}
                    className="border-b border-crm-line last:border-b-0"
                  >
                    <td className="px-5 py-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-crm-ink sm:px-6">
                      {r.code}
                    </td>
                    <td className="px-3 py-2.5 text-[12px] text-crm-ink">
                      {r.registered ? (
                        r.ownerName || (
                          <span className="text-crm-faint">—</span>
                        )
                      ) : (
                        <span className="font-mono text-[9.5px] uppercase tracking-[0.08em] text-crm-red">
                          Unclaimed
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[11px] text-crm-ink">
                      {r.leads}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[11px] text-crm-muted">
                      {r.accounts}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-[11px] text-crm-ink">
                      {r.deposits}
                    </td>
                    <td className="px-5 py-2.5 text-right sm:px-6">
                      {r.registered ? (
                        <button
                          type="button"
                          onClick={() => remove(r.code)}
                          disabled={busyCode === r.code}
                          className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.08em] text-crm-faint transition-colors hover:text-crm-red disabled:opacity-50"
                        >
                          {busyCode === r.code ? "…" : "Remove"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => claim(r.code)}
                          className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.08em] text-crm-blue transition-opacity hover:opacity-80"
                        >
                          Claim
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[12px] border border-crm-line bg-crm-card px-4 py-3">
      <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-faint">
        {label}
      </p>
      <p className="mt-1 font-mono text-[20px] text-crm-ink">{value}</p>
    </div>
  );
}
