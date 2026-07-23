"use client";

/**
 * The parent family dashboard (T1 Unit 15; handoff surface 13). Per-child
 * cards — position, five-segment criteria bar, the honest awaiting-review
 * count — plus the R32 reset-password affordance (the Unit 6 action's first
 * UI), the R4 co-parent invite, and a truthful settings strip.
 *
 * ALWAYS the grounded HQ register (the parent surface has no skins). The
 * handoff's digest card and the per-card "Open" button route into the review
 * queue — Unit 12's surface — so they land there, not here (no dead links).
 *
 * Every awaited action runs under try/catch/finally (the frozen-modal
 * learning) and through unwrapActionResult — the one branch for both result
 * families ({success,error} provision/reset/invite; {ok,reason} elsewhere),
 * the Unit 6 → 14 → 15 carry-forward this component finally consumes.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { PhaseKey } from "@/app/path/content/types";
import { phaseColor, phaseColorAlpha } from "@/app/path/components/system/phases";
import { Button } from "@/app/path/components/system/Button";
import { cn } from "@/app/path/components/system/cn";
import { unwrapActionResult, type UnwrappedResult } from "@/app/path/lib/now-card-rules";
import type { FounderCard as FounderCardData } from "@/app/path/lib/onboarding-rules";
import { resetStudentPasswordAction } from "@/app/path/lib/actions/provision";
import { inviteCoParentAction, resendInviteAction } from "@/app/path/lib/actions/invite";

/* Serializable card props (family-loader's FounderCardWithIds — the pure
 * FounderCard plus the ids; typed via the shared onboarding-rules type so the
 * loader, the page, and this component cannot drift). */
export type FounderCardProps = FounderCardData & {
  profileId: string;
  childId: string;
};

export type PendingInviteProps = {
  id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  expired: boolean;
};

function failureMessage(r: UnwrappedResult): string {
  if (r.ok) return "";
  return r.message ?? "Something went wrong — please try again.";
}

/* ────────────────────────────────────────────────── per-child card ──────── */

function FounderCard({ card }: { card: FounderCardProps }) {
  const [resetOpen, setResetOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // The Open button beside the reset form makes navigating away mid-reset
  // likely; without this guard the resolving action's setState lands on an
  // unmounted card (silent no-op — the ReviewPanel/TaskSurface idiom).
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // card.phase.key is the literal PhaseKey union end to end (Unit 15 review:
  // no widening, no unchecked cast back).
  const phaseKey: PhaseKey = card.phase?.key ?? "SELL";
  const accent = phaseColor(phaseKey);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = unwrapActionResult(
        await resetStudentPasswordAction({ profileId: card.profileId, newPassword: password })
      );
      if (!mountedRef.current) return;
      if (result.ok) {
        setNote({ kind: "ok", text: `${card.firstName}'s password is set — they sign in with it now.` });
        setPassword("");
        setResetOpen(false);
      } else {
        setNote({ kind: "error", text: failureMessage(result) });
      }
    } catch {
      if (mountedRef.current) {
        setNote({ kind: "error", text: "Something went wrong — please try again." });
      }
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-hq-border bg-hq-canvas p-4 shadow-hq">
      <div className="flex items-center gap-3">
        <span
          className="flex h-[42px] w-[42px] flex-shrink-0 items-center justify-center rounded-full font-path-display text-[17px] font-semibold text-white"
          style={{ backgroundColor: accent }}
          aria-hidden
        >
          {card.firstName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-path-body text-[15px] font-semibold text-hq-ink">{card.firstName}</div>
          <div className="text-[11px] text-hq-ink-muted">
            {[card.gradeLabel, card.skinLabel].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div className="text-right">
          <div className="font-path-mono text-[18px] font-semibold leading-none text-hq-ink">
            {card.verifiedTotal}
            <span className="text-[12px] text-hq-ink-muted">/{card.totalTasks}</span>
          </div>
          <div className="mt-0.5 text-[10.5px] text-hq-ink-muted">verified</div>
        </div>
      </div>

      {card.stranded ? (
        <p className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-xs leading-5 text-hq-ink">
          {card.firstName}&apos;s Path is still being set up — check back soon, or contact The 120 if
          this persists.
        </p>
      ) : (
        <>
          {card.phase && (
            <div className="mt-3 flex items-baseline gap-1.5 font-path-body text-[12.5px]">
              <span className="font-path-mono font-semibold" style={{ color: accent }}>
                {card.phase.num}
              </span>
              <span className="font-semibold text-hq-ink">{card.phase.label}</span>
              {card.criterionLine && (
                <span className="truncate text-hq-ink-soft">· {card.criterionLine}</span>
              )}
            </div>
          )}

          {/* Five-segment criteria bar (handoff surface 13). */}
          <div className="mt-2 flex gap-1" aria-hidden>
            {card.segments.map((seg, i) => (
              <span
                key={i}
                className={cn("h-[7px] flex-1 rounded-[3px]", seg === "ahead" && "bg-hq-border")}
                style={
                  seg === "done"
                    ? { backgroundColor: accent }
                    : seg === "current"
                      ? { backgroundColor: phaseColorAlpha(phaseKey, 0.45) }
                      : undefined
                }
              />
            ))}
          </div>

          <div className="mt-3 flex items-center justify-between gap-3">
            <span
              className={cn(
                "flex items-center gap-1.5 font-path-body text-[12px] font-medium",
                card.awaitingCount > 0 ? "text-awaiting" : "text-hq-ink-muted"
              )}
            >
              <span
                className={cn(
                  "h-[7px] w-[7px] rounded-full",
                  card.awaitingCount > 0 ? "bg-awaiting" : "bg-hq-border"
                )}
                aria-hidden
              />
              {card.awaitingCount} awaiting your review
            </span>
            {/* The handoff's per-card "Open" — routes into Unit 12's queue. */}
            {card.awaitingCount > 0 && (
              <Link
                href="/path/review"
                className="rounded-lg bg-hq-ink px-3 py-1.5 font-path-body text-[12px] font-semibold text-white shadow-hq hover:bg-hq-ink/90"
              >
                Open
              </Link>
            )}
            <button
              type="button"
              disabled={busy}
              className="rounded-lg border border-hq-border bg-hq-sunken px-3 py-1.5 font-path-body text-[12px] font-semibold text-hq-ink hover:bg-hq-canvas disabled:opacity-50"
              onClick={() => {
                // Never collapse the form under an in-flight reset — a failure
                // note with the form hidden strands the retry (races review).
                if (busy) return;
                setResetOpen((v) => !v);
                setNote(null);
              }}
            >
              Reset password
            </button>
          </div>
        </>
      )}

      {resetOpen && (
        <form className="mt-3 flex items-start gap-2" onSubmit={handleReset}>
          <label className="flex-1" htmlFor={`reset-${card.profileId}`}>
            <span className="sr-only">New password for {card.firstName}</span>
            <input
              id={`reset-${card.profileId}`}
              type="text"
              className="h-10 w-full rounded-lg border border-hq-border bg-hq-surface px-3 font-path-body text-sm text-hq-ink outline-none placeholder:text-hq-ink-muted focus:border-hq-border-strong"
              placeholder="New password — a few unrelated words"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="off"
              required
            />
          </label>
          <Button type="submit" skin="hq" size="md" disabled={busy}>
            {busy ? "Setting…" : "Set"}
          </Button>
        </form>
      )}

      {note && (
        <p
          role={note.kind === "error" ? "alert" : "status"}
          className={cn(
            "mt-3 rounded-lg border p-3 font-path-body text-xs leading-5 text-hq-ink",
            note.kind === "error" ? "border-not-yet/40 bg-not-yet/10" : "border-verified/40 bg-verified/10"
          )}
        >
          {note.text}
        </p>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────── invite section ─────── */

function InviteSection({
  familyId,
  parentCount,
  invites,
}: {
  familyId: string;
  parentCount: number;
  invites: readonly PendingInviteProps[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const full = parentCount >= 2;

  const run = async (fn: () => Promise<{ success: boolean; error?: string }>, okText: string) => {
    if (busy) return;
    setBusy(true);
    setNote(null);
    try {
      const result = unwrapActionResult(await fn());
      if (result.ok) {
        setNote({ kind: "ok", text: okText });
        setEmail("");
      } else {
        setNote({ kind: "error", text: failureMessage(result) });
      }
      // Refresh on BOTH branches: a partial failure ("created but the email
      // didn't send") leaves a real pending row whose Resend button only
      // exists after a refresh (reliability review).
      router.refresh();
    } catch {
      setNote({ kind: "error", text: "Something went wrong — please try again." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-8">
      <h2 className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
        Parents · {parentCount}/2
      </h2>
      {full ? (
        <p className="mt-2 font-path-body text-xs leading-5 text-hq-ink-soft">
          Both parent seats are taken — either of you can review and verify.
        </p>
      ) : (
        <form
          className="mt-2 flex items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void run(
              () => inviteCoParentAction({ familyId, email }),
              "Invite sent — it's valid for 7 days."
            );
          }}
        >
          <label className="flex-1" htmlFor="invite-email">
            <span className="sr-only">Co-parent email</span>
            <input
              id="invite-email"
              type="email"
              className="h-10 w-full rounded-lg border border-hq-border bg-hq-canvas px-3 font-path-body text-sm text-hq-ink outline-none placeholder:text-hq-ink-muted focus:border-hq-border-strong"
              placeholder="Invite a co-parent by email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <Button type="submit" skin="hq" size="md" disabled={busy}>
            {busy ? "Sending…" : "Send invite"}
          </Button>
        </form>
      )}

      {invites.length > 0 && (
        <ul className="mt-3 space-y-2">
          {invites.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-hq-border bg-hq-canvas px-3 py-2"
            >
              <span className="min-w-0 truncate font-path-body text-xs text-hq-ink">
                {inv.email}
                <span className={cn("ml-2", inv.expired ? "text-not-yet" : "text-hq-ink-muted")}>
                  {inv.expired ? "expired" : "pending"}
                </span>
              </span>
              <button
                type="button"
                disabled={busy}
                className="font-path-body text-[12px] font-semibold text-hq-ink underline-offset-2 hover:underline"
                onClick={() =>
                  void run(
                    () => resendInviteAction({ inviteId: inv.id }),
                    "Invite re-sent with a fresh link."
                  )
                }
              >
                Resend
              </button>
            </li>
          ))}
        </ul>
      )}

      {note && (
        <p
          role={note.kind === "error" ? "alert" : "status"}
          className={cn(
            "mt-3 rounded-lg border p-3 font-path-body text-xs leading-5 text-hq-ink",
            note.kind === "error" ? "border-not-yet/40 bg-not-yet/10" : "border-verified/40 bg-verified/10"
          )}
        >
          {note.text}
        </p>
      )}
    </section>
  );
}

/* ──────────────────────────────────────────────────────── dashboard ─────── */

export function FamilyDashboard({
  familyLabel,
  familyId,
  cards,
  parentCount,
  invites,
  hasLinkable,
}: {
  familyLabel: string;
  familyId: string;
  cards: readonly FounderCardProps[];
  parentCount: number;
  invites: readonly PendingInviteProps[];
  /** Whether onboarding still has roster children to link (the Add CTA hint). */
  hasLinkable: boolean;
}) {
  return (
    <div className="pb-6">
      <header className="pt-4">
        <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-phase-grow">
          One subscription · every founder
        </p>
        <h1 className="mt-1 font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
          {familyLabel}
        </h1>
      </header>

      <section className="mt-6">
        <div className="flex items-center justify-between">
          <h2 className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
            Your founders · {cards.length}
          </h2>
          <Link
            href="/path/onboarding"
            className="font-path-body text-[12px] font-semibold text-hq-ink underline-offset-2 hover:underline"
          >
            {hasLinkable ? "Add a founder" : "Add another founder"}
          </Link>
        </div>

        {cards.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-hq-border bg-hq-canvas p-8 text-center shadow-hq">
            <h3 className="font-path-display text-xl font-semibold text-hq-ink">No founders yet</h3>
            <p className="mx-auto mt-2 max-w-sm font-path-body text-sm leading-6 text-hq-ink-soft">
              One app, two skins. 125 real things done in the real world — each verified by a real
              adult, celebrated like it matters.
            </p>
            <div className="mt-5 flex justify-center">
              <Link
                href="/path/onboarding"
                className="inline-flex h-12 items-center justify-center rounded-xl bg-hq-ink px-6 font-path-body text-sm font-semibold text-white transition-all hover:opacity-90 active:translate-y-px"
              >
                Set up your family
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-3 space-y-3">
            {cards.map((card) => (
              <FounderCard key={card.profileId} card={card} />
            ))}
          </div>
        )}
      </section>

      <InviteSection familyId={familyId} parentCount={parentCount} invites={invites} />

      {/* The handoff's settings strip, kept truthful for T1: notifications
          arrive with Unit 12, the math gate with T3, and evidence is private
          by construction (Unit 9's signed-URL storage). */}
      <section className="mt-8 flex gap-2">
        {[
          { label: "Notifications", value: "Arriving soon" },
          { label: "Math gate", value: "Off" },
          { label: "Evidence", value: "Private" },
        ].map((tile) => (
          <div key={tile.label} className="flex-1 rounded-xl border border-hq-border bg-hq-canvas px-3 py-2.5">
            <div className="text-[10px] uppercase tracking-[0.1em] text-hq-ink-muted">{tile.label}</div>
            <div className="mt-0.5 font-path-body text-[12px] font-semibold text-hq-ink">{tile.value}</div>
          </div>
        ))}
      </section>
    </div>
  );
}
