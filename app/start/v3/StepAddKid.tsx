"use client";

/**
 * Step 2 — the kid: full name, age, and the per-kid CONSENT RE-AFFIRMATION.
 *
 * ── WHY CONSENT IS ASKED AGAIN HERE ──
 * `consentGate` binds ONE active consent to ONE child per attempt (a partial
 * unique index). Step 1's checkbox is the account-terms affirmation; the legal,
 * versioned, bound-to-rendered-text consent RECORD is per kid, so the
 * add-another-kid loop re-enters here and captures it again. The full policy
 * text is shown (not linked): the record snapshots what was rendered, and a
 * consent to text nobody displayed is not consent.
 *
 * ── THE DUPLICATE-KID GUARD ──
 * The server matches the typed first+last name (case-insensitively) against the
 * parent's existing CHILDREN and their live DRAFTS. A hit does not silently mint
 * `maya2`; it returns the match and this screen asks. "Resume" walks back into
 * the flow for the kid who already exists; "This is a different child" re-submits
 * with the explicit override — the only way past.
 */

import { useState, useTransition } from "react";
import { v3AddKidAction, v3EditKidAction } from "./actions";
import type { ExistingKid } from "@/app/lib/v3-signup/flow-rules";
import { KID_MAX_AGE, KID_MIN_AGE } from "@/app/lib/v3-signup/flow-rules";
import { V3Button, V3Field, V3Notice, V3TextButton, V3_INPUT_CLASSES } from "./v3-ui";

export function StepAddKid({
  consentPolicy,
  draftId,
  initialFullName,
  initialAge,
  onAdded,
  onResumeExisting,
}: {
  consentPolicy: { version: string; hash: string; text: string };
  /** Present when the family is BACK on this step correcting their own draft.
   *  An edit re-uses the draft (and its attempt + consent); it never mints a
   *  second one, because a typo fix is not a new child. */
  draftId: string | null;
  initialFullName: string;
  initialAge: string;
  onAdded: (draftId: string) => void;
  onResumeExisting: (kid: ExistingKid) => void;
}) {
  const [fullName, setFullName] = useState(initialFullName);
  const [age, setAge] = useState(initialAge);
  const [accepted, setAccepted] = useState(draftId !== null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<ExistingKid | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (differentChild: boolean) => {
    setNotice(null);
    startTransition(async () => {
      const result = draftId
        ? await v3EditKidAction({ draftId, fullName: fullName.trim(), age: age.trim() })
        : await v3AddKidAction({
            fullName: fullName.trim(),
            age: age.trim(),
            consentVersion: consentPolicy.version,
            consentHash: consentPolicy.hash,
            ...(differentChild ? { differentChild: true as const } : {}),
          });
      switch (result.kind) {
        case "added":
          setDuplicate(null);
          onAdded(result.draftId);
          return;
        case "duplicate":
          setDuplicate(result.kid);
          return;
        case "invalid":
          setNotice(result.message);
          return;
        case "capped":
          setNotice(
            "You have a lot of sign-ups on the go already. Finish one of them, or talk to us and we will sort it out."
          );
          return;
        case "consent_refused":
          setNotice(
            "The consent notice was updated while this page was open. Reload the page and tick the box again."
          );
          return;
        default:
          setNotice("That didn't save just now. Give it a second and try again.");
      }
    });
  };

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (!draftId && !accepted) {
      setNotice("Please tick the consent box so we can create your kid's account.");
      return;
    }
    submit(false);
  };

  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <p className="v3-label text-v3-one20">Welcome from The 120</p>
      <h1 className="mt-3 font-path-display text-4xl leading-[1.05] font-black text-v3-ink sm:text-5xl">
        Add your kid, and their story starts.
      </h1>
      <p className="mt-4 max-w-md text-base leading-relaxed text-v3-stone">
        First Profit turns starting a real, tiny business into a guided graphic novel. It begins
        with one page &mdash; theirs.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        <V3Field id="v3-kid-name" label="Kid's full name">
          <input
            id="v3-kid-name"
            type="text"
            autoComplete="off"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Remi Newal"
            className={V3_INPUT_CLASSES}
          />
        </V3Field>

        <V3Field id="v3-kid-age" label="Age">
          <input
            id="v3-kid-age"
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={age}
            onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))}
            placeholder="9"
            // Bounded so the field reads as a two-digit box, but `max-w-[8rem]`
            // never exceeds the column at 390px.
            className={`${V3_INPUT_CLASSES} max-w-[8rem]`}
          />
          <p className="mt-1 text-sm text-v3-stone">
            Between {KID_MIN_AGE} and {KID_MAX_AGE}.
          </p>
        </V3Field>

        {!draftId && (
          <div className="rounded-2xl border border-v3-ink/10 bg-white/70 p-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)}
                className="mt-1 h-5 w-5 flex-none accent-v3-profit"
              />
              <span className="text-sm leading-relaxed text-v3-stone">
                I am this child&rsquo;s parent or guardian and I give consent for First Profit to
                create their account, to draw their comic cover from a photo we upload, and to
                store their answers and cover on their profile.
              </span>
            </label>
            <button
              type="button"
              onClick={() => setPolicyOpen((o) => !o)}
              className="v3-label mt-2 inline-flex min-h-[44px] items-center text-v3-profit underline underline-offset-4"
              aria-expanded={policyOpen}
              aria-controls="v3-consent-text"
            >
              {policyOpen ? "Hide the full notice" : "Read the full notice"}
            </button>
            {/* The RENDERED text: the consent record binds to this, and the
                payload echoes its version + hash. */}
            <div
              id="v3-consent-text"
              hidden={!policyOpen}
              className="mt-2 max-h-64 overflow-y-auto rounded-xl bg-v3-paper/60 p-3 text-[13px] leading-relaxed text-v3-stone"
            >
              <p>{consentPolicy.text}</p>
              <p className="v3-label mt-3 text-v3-stone/70">Version {consentPolicy.version}</p>
            </div>
          </div>
        )}

        {duplicate && (
          <div
            role="alertdialog"
            aria-labelledby="v3-dup-title"
            className="rounded-2xl border border-v3-sun bg-v3-sun/15 p-4"
          >
            <p id="v3-dup-title" className="font-path-display text-lg font-semibold text-v3-ink">
              You already have a {duplicate.firstName} {duplicate.lastName}.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-v3-stone">
              {duplicate.kind === "child"
                ? "That kid already has an account. Pick up where they left off, or tell us this is someone else."
                : "There is already a sign-up in progress for that name. Carry on with it, or tell us this is someone else."}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <V3Button
                type="button"
                onClick={() => onResumeExisting(duplicate)}
                disabled={pending}
              >
                Resume {duplicate.firstName}
              </V3Button>
              <V3Button
                type="button"
                variant="ghost"
                onClick={() => submit(true)}
                disabled={pending}
              >
                This is a different child
              </V3Button>
            </div>
          </div>
        )}

        {notice && <V3Notice tone="error">{notice}</V3Notice>}

        <V3Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Start their journey"}
        </V3Button>
        {draftId && (
          <V3TextButton type="button" onClick={() => onAdded(draftId)} disabled={pending}>
            Keep what I had
          </V3TextButton>
        )}
      </form>
    </section>
  );
}
