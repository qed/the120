"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/app/path/components/system/Button";
import { provisionGuideAction, reissueGuideInviteAction } from "@/app/path/lib/actions/fw-guide";
import { revokeGuideGrantAction } from "@/app/path/lib/actions/fw-ops";
import type { FwGuideCredentialStatus, FwOpsGuide } from "@/app/path/lib/fw-ops-core";

/**
 * The guide roster for one weekend (FW Unit 5; FW-R4, Decision 12).
 *
 * Four affordances, and they are the ones the pre-event checklist is made of:
 * add a guide, see whether each has actually claimed their link, re-issue a dead
 * one, and revoke access.
 *
 * ── The credential column IS the "all guides claimed" checklist line
 *
 * Decision 12's arithmetic: invites live 14 days and are issued per event, so a
 * guide invited for Boston can meet Hamptons with a dead link. "Invited" and
 * "Claimed" are different facts and the difference only bites on a Friday
 * morning — which is why this shows the state rather than just a list of names.
 *
 * ── Revoke is destructive, so it confirms and says exactly what it does
 *
 * Not an offboarding: the account, the password, and the other weekend's grant
 * all survive. Staff need to know that before they click, because the
 * alternative reading ("this deletes the guide") is the one that stops someone
 * revoking a person who genuinely should not be checking children in.
 *
 * try/catch/FINALLY on every submitting flag.
 */

const CREDENTIAL: Record<FwGuideCredentialStatus, { label: string; cls: string }> = {
  claimed: {
    label: "Signed in",
    cls: "border-verified/40 bg-verified/10 text-hq-ink",
  },
  invited: {
    label: "Link sent",
    cls: "border-hq-border bg-hq-sunken text-hq-ink-soft",
  },
  expired: {
    label: "Link expired",
    cls: "border-not-yet/40 bg-not-yet/10 text-hq-ink",
  },
  no_invite: {
    label: "No link",
    cls: "border-not-yet/40 bg-not-yet/10 text-hq-ink",
  },
};

export default function FwGuideRoster({
  cohortId,
  guides,
}: {
  cohortId: string;
  guides: FwOpsGuide[];
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The user id of whichever row is mid-action — one at a time, so a slow
   *  response cannot leave two rows both claiming to be working. */
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [confirmingRevoke, setConfirmingRevoke] = useState<string | null>(null);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (email.trim().length === 0 || adding) return;
    setAdding(true);
    setAddError(null);
    setNotice(null);
    try {
      const res = await provisionGuideAction({ email: email.trim(), cohortId });
      if (res.success) {
        setEmail("");
        setNotice(
          [
            res.created ? `Created ${res.email}.` : `Added ${res.email} to this weekend.`,
            res.invited
              ? "They can set a password from the link in their inbox."
              : "The invite email did NOT send — use Re-send below.",
            res.audited ? "" : "⚠ The audit record didn't save — tell an engineer.",
          ]
            .filter(Boolean)
            .join(" ")
        );
        router.refresh();
        return; // finally still clears the flag
      }
      setAddError(res.error);
    } catch {
      setAddError("That didn't go through. Try again.");
    } finally {
      setAdding(false);
    }
  };

  const handleReissue = async (userId: string) => {
    setBusyRow(userId);
    setAddError(null);
    setNotice(null);
    try {
      const res = await reissueGuideInviteAction({ userId });
      if (res.success) {
        setNotice("A fresh link is on its way. Their old link no longer works.");
        router.refresh();
        return;
      }
      setAddError(res.error);
    } catch {
      setAddError("That didn't go through. Try again.");
    } finally {
      setBusyRow(null);
    }
  };

  const handleRevoke = async (userId: string) => {
    setBusyRow(userId);
    setAddError(null);
    setNotice(null);
    setConfirmingRevoke(null);
    try {
      const res = await revokeGuideGrantAction({ cohortId, userId });
      if (res.success) {
        setNotice(
          res.audited
            ? "Access removed. Their next tap on this weekend will be refused."
            : "Access removed — but the audit record didn't save. Tell an engineer."
        );
        router.refresh();
        return;
      }
      setAddError(res.error);
    } catch {
      setAddError("That didn't go through. Try again.");
    } finally {
      setBusyRow(null);
    }
  };

  return (
    <div className="mt-3">
      {guides.length === 0 ? (
        <p className="rounded-xl border border-hq-border bg-hq-sunken p-4 font-path-body text-sm leading-6 text-hq-ink-soft">
          No guides on this weekend yet. Add them below — each gets an email with a link to
          set their own password.
        </p>
      ) : (
        <ul className="space-y-3">
          {guides.map((guide) => {
            const chip = CREDENTIAL[guide.credential];
            const rowBusy = busyRow === guide.userId;
            return (
              <li
                key={guide.userId}
                className="rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <p className="font-path-body text-sm font-medium text-hq-ink">
                    {/* A guide with no readable address still has to be
                        revocable — a guide staff cannot see is a guide staff
                        cannot remove. */}
                    {guide.email ?? `Unnamed guide (${guide.userId})`}
                  </p>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-path-mono text-[11px] uppercase tracking-[0.1em] ${chip.cls}`}
                  >
                    {chip.label}
                  </span>
                </div>

                {confirmingRevoke === guide.userId && (
                  <p
                    role="alert"
                    className="mt-3 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
                  >
                    This removes their check-in power for <strong>this weekend only</strong>.
                    Their account, their password, and any other weekend they guide are
                    untouched. It takes effect on their very next tap.
                  </p>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    skin="hq"
                    variant="secondary"
                    size="md"
                    onClick={() => handleReissue(guide.userId)}
                    disabled={rowBusy || busyRow !== null}
                  >
                    {rowBusy ? "Working…" : "Re-send link"}
                  </Button>

                  {confirmingRevoke === guide.userId ? (
                    <>
                      <Button
                        type="button"
                        skin="hq"
                        variant="secondary"
                        size="md"
                        onClick={() => handleRevoke(guide.userId)}
                        disabled={rowBusy || busyRow !== null}
                      >
                        Yes — remove access
                      </Button>
                      <Button
                        type="button"
                        skin="hq"
                        variant="secondary"
                        size="md"
                        onClick={() => setConfirmingRevoke(null)}
                        disabled={busyRow !== null}
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      skin="hq"
                      variant="secondary"
                      size="md"
                      onClick={() => setConfirmingRevoke(guide.userId)}
                      disabled={busyRow !== null}
                    >
                      Remove access
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {notice && (
        <p
          role="status"
          className="mt-4 rounded-lg border border-verified/40 bg-verified/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          {notice}
        </p>
      )}
      {addError && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-5 text-hq-ink"
        >
          {addError}
        </p>
      )}

      <form
        onSubmit={handleAdd}
        className="mt-5 rounded-xl border border-hq-border bg-hq-surface p-4 shadow-hq"
      >
        <label className="block" htmlFor="fw-guide-email">
          <span className="mb-1.5 block font-path-mono text-[11px] uppercase tracking-[0.12em] text-hq-ink-muted">
            Add a guide
          </span>
          <input
            id="fw-guide-email"
            type="email"
            className="h-12 w-full rounded-xl border border-hq-border bg-hq-canvas px-3 font-path-body text-base text-hq-ink outline-none transition-colors placeholder:text-hq-ink-muted focus:border-hq-border-strong focus:ring-2 focus:ring-hq-ink/10"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="guide@example.com"
            autoComplete="off"
            spellCheck={false}
            required
          />
        </label>
        <p className="mt-2 font-path-body text-xs leading-5 text-hq-ink-soft">
          Their own address, not a student one. Adding a guide who already works another
          weekend just adds this weekend — it never touches the password they already set.
        </p>
        <div className="mt-3">
          <Button
            type="submit"
            skin="hq"
            size="lg"
            disabled={adding || email.trim().length === 0}
          >
            {adding ? "Adding…" : "Add guide"}
          </Button>
        </div>
      </form>
    </div>
  );
}
