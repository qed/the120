"use client";

/**
 * Step 5 — provisioning and the account-ready screen.
 *
 * ── PROVISIONING HAPPENS HERE, ONCE, AND RETRIES ARE THE SAME CALL ──
 * The mint runs on arrival (there is nothing left to ask), and every retry
 * re-invokes with the SAME draft — which means the SAME attempt id, which is
 * `createChild`'s idempotent-replay key. A retry after a lost response therefore
 * recovers the existing child instead of minting a second one. The server
 * re-reads the username from the child record on that path, because a replay
 * does not return one.
 *
 * THE PASSWORD IS SHOWN ONCE AND STORED NOWHERE. On the replay path it is
 * genuinely unrecoverable (it was never persisted, by design), so the screen
 * says so rather than inventing one — and, since review FIX 8, points at a
 * HUMAN rather than at plan Unit 8's dashboard reset, which has not shipped.
 * Promising a self-service recovery that does not exist strands the family
 * twice: once on the lost password, once on the empty dashboard.
 *
 * ── "KEEP BUILDING" IMPLEMENTS BOTH ENDINGS ──
 *   below `sm`  → SAME TAB. No popup juggling on a phone, where a second tab is
 *                 a tab the parent has to find again.
 *   `sm` and up → a NEW TAB, opened SYNCHRONOUSLY in the click handler BEFORE
 *                 any `await`. This ordering is the whole trick: a `window.open`
 *                 after an await has lost the user-gesture context and every
 *                 popup blocker eats it. The tab is opened blank, the mint is
 *                 awaited, and only then is the tab navigated.
 *                 `win === null` means the blocker won anyway — that case gets a
 *                 VISIBLE manual link, never a silent dead end.
 * Unit 5 replaces the mint's body; this component's two endings do not change.
 *
 * ── THE MINT MUST NOT OUTLIVE THE COMPONENT (review FIX 5) ──
 * The mint runs in a detached `void (async () => …)()`, so it keeps resolving
 * after this screen is gone. On the mobile ending it finished with an
 * UNCONDITIONAL `window.location.assign(destination)` — meaning a parent who
 * tapped the always-present "Parent dashboard" link (or pressed Back) while the
 * mint was in flight got yanked to firstprofit.school anyway: stale async work
 * overriding a LATER, EXPLICIT user intent. Every resolution point in that IIFE
 * now checks `mounted.current` first — before the same-tab assign and before any
 * setState. The `sm`+ path keeps its behaviour exactly (the sync open still
 * happens before any await); on unmount its already-opened tab is closed rather
 * than left blank.
 */

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { v3MintHandoffAction, v3ProvisionAction } from "./actions";
import { V3Button, V3ComicCover, V3Notice, V3TextButton } from "./v3-ui";

type Provisioned = { childId: string; username: string; password: string; firstName: string };

type MintState = "idle" | "minting" | "blocked";

export function StepAccountReady({
  draftId,
  firstName,
  age,
  onBack,
}: {
  draftId: string;
  firstName: string;
  age: number | null;
  onBack: () => void;
}) {
  const [account, setAccount] = useState<Provisioned | null>(null);
  const [failure, setFailure] = useState<{ message: string; retryable: boolean } | null>(null);
  const [copied, setCopied] = useState(false);
  const [mintState, setMintState] = useState<MintState>("idle");
  const [manualUrl, setManualUrl] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const started = useRef(false);
  /** Cleared on unmount. Read before every navigation and every setState the
   *  detached mint performs — see the module header (review FIX 5). */
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const provision = useCallback(() => {
    setFailure(null);
    startTransition(async () => {
      const result = await v3ProvisionAction({ draftId });
      switch (result.kind) {
        case "provisioned":
          setAccount({
            childId: result.childId,
            username: result.username,
            password: result.password,
            firstName: result.firstName,
          });
          return;
        case "retryable":
          setFailure({
            message: "We could not finish creating the account just now. Nothing was lost — try again.",
            retryable: true,
          });
          return;
        case "refused":
          setFailure({
            message:
              result.reason === "too_many"
                ? "This account already has the maximum number of kids. Talk to us if one should make room."
                : result.reason === "consent_required"
                  ? "We need the consent step again before we can create the account. Go back a step and tick the box."
                  : result.reason === "weak_password"
                    ? "We could not build a safe password from those answers. Go back and change one answer, then try again."
                    : "We could not create the account with those details. Go back a step and check them.",
            retryable: false,
          });
          return;
        default:
          setFailure({
            message: "That didn't work just now. Give it a second and try again.",
            retryable: true,
          });
      }
    });
  }, [draftId]);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    provision();
  }, [provision]);

  const copy = async () => {
    if (!account) return;
    try {
      await navigator.clipboard?.writeText(`${account.username} / ${account.password}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // A clipboard refusal is not worth an error state — the credentials are
      // on screen and selectable.
    }
  };

  const keepBuilding = () => {
    if (mintState === "minting") return;
    // The breakpoint decision is made HERE, synchronously, from the same
    // matchMedia the layout uses. `sm` is 640px in Tailwind's default scale,
    // which this repo does not override.
    const wide =
      typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches;
    // ⚠ SYNCHRONOUS OPEN, BEFORE ANY AWAIT. Moving this below the await is the
    // bug the comment at the top of this file exists to prevent.
    const win = wide ? window.open("", "_blank", "noopener,noreferrer") : null;
    setMintState("minting");
    void (async () => {
      const result = await v3MintHandoffAction({ childId: account?.childId ?? null });
      // ⚠ THE GUARD, CHECKED FIRST AND AGAIN BEFORE THE ASSIGN (review FIX 5).
      // If this screen is gone the parent has already chosen somewhere else to
      // be; the only thing left to do is not leave a blank popup behind.
      if (!mounted.current) {
        win?.close();
        return;
      }
      const destination =
        result.kind === "failed" ? null : result.destination;
      if (!destination) {
        win?.close();
        setMintState("idle");
        setFailure({ message: "We could not open First Profit just now. Try again.", retryable: true });
        return;
      }
      if (!wide) {
        // Re-checked immediately before the navigation itself: this is the one
        // line that can override a later, explicit user intent.
        if (!mounted.current) return;
        window.location.assign(destination);
        return;
      }
      if (win) {
        win.location.href = destination;
        setMintState("idle");
        return;
      }
      // The popup blocker won. Never a silent dead end: show the link.
      setManualUrl(destination);
      setMintState("blocked");
    })();
  };

  if (!account) {
    return (
      <section className="mx-auto w-full max-w-xl px-5 py-16 text-center">
        <p className="v3-label text-v3-profit">Almost there</p>
        <h1 className="mt-3 font-path-display text-3xl leading-[1.1] font-black text-v3-ink">
          {failure ? "That didn't finish." : `Creating ${firstName}'s account…`}
        </h1>
        {failure ? (
          <>
            <V3Notice tone="error">{failure.message}</V3Notice>
            <div className="mt-6 flex flex-col items-center gap-3">
              {failure.retryable && (
                <V3Button onClick={provision} disabled={pending}>
                  {pending ? "Trying again…" : "Try again"}
                </V3Button>
              )}
              <V3TextButton type="button" onClick={onBack} disabled={pending}>
                Back
              </V3TextButton>
            </div>
          </>
        ) : (
          <p className="mt-4 text-base leading-relaxed text-v3-stone">
            Setting up their journal, their first page, and their login.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="mx-auto w-full max-w-5xl px-5 py-10 sm:py-16">
      <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-12">
        <div className="min-w-0">
          <p className="v3-label text-v3-profit">Intro page + Page 1 · Done</p>
          <h1 className="mt-3 font-path-display text-3xl leading-[1.1] font-black text-v3-ink sm:text-[40px]">
            {account.firstName}&rsquo;s journey has its first two pages.
          </h1>
          <p className="mt-4 text-base leading-relaxed text-v3-stone">
            Behind the scenes we also created an account, so {account.firstName} can keep building.
          </p>

          <div className="mt-8 rounded-2xl border border-v3-ink/10 bg-white p-5 sm:p-6">
            <h2 className="v3-label text-v3-stone">Their new login</h2>
            <dl className="mt-4 space-y-3">
              <div>
                <dt className="v3-label text-v3-stone">Username</dt>
                {/* break-all, not truncate: a family has to be able to READ and
                    retype this, and a dotted handle can be long. */}
                {/* ⚠ UNIT 8 SEAM (review FIX 8). Plan Unit 8 builds the
                    dashboard's per-kid "view username / set new password". Until
                    it ships, app/dashboard has NO credential UI at all, so copy
                    that says "from your dashboard" sends a family to a page that
                    cannot help them. Both fallbacks below therefore point at a
                    human. When Unit 8 lands, replace them with the dashboard
                    link — and nothing else here changes. */}
                <dd className="font-path-mono text-[15px] break-all text-v3-ink">
                  {account.username || (
                    <span className="font-path-display text-v3-stone italic">
                      We could not read it back. Email us at admissions@the120.school and we will send it
                      to you.
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="v3-label text-v3-stone">Password</dt>
                <dd className="font-path-mono text-[15px] break-all text-v3-ink">
                  {account.password || (
                    <span className="font-path-display text-v3-stone italic">
                      Already set on an earlier try, and we only ever show it once. Email us at
                      admissions@the120.school and we will set a new one for {account.firstName}.
                    </span>
                  )}
                </dd>
              </div>
            </dl>
            {account.username && account.password && (
              <>
                <V3TextButton type="button" onClick={copy}>
                  {copied ? "Copied" : "Copy login"}
                </V3TextButton>
                <p className="mt-1 text-sm leading-relaxed text-v3-stone">
                  Write this down. It is the only time we show the password.
                </p>
              </>
            )}
          </div>

          <div className="mt-8 space-y-3">
            <V3Button onClick={keepBuilding} disabled={mintState === "minting"}>
              {mintState === "minting" ? "Opening…" : `Keep building ${account.firstName}'s journey`}
            </V3Button>
            <p className="v3-label text-v3-stone">Takes you to the First Profit app</p>
            {mintState === "blocked" && manualUrl && (
              <p className="text-sm leading-relaxed text-v3-stone">
                Your browser blocked the new tab.{" "}
                <a
                  href={manualUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-v3-profit underline underline-offset-4"
                >
                  Open First Profit
                </a>
              </p>
            )}
            <Link
              href="/dashboard"
              className="v3-label inline-flex min-h-[44px] items-center text-v3-stone underline underline-offset-4 hover:text-v3-ink"
            >
              Parent dashboard
            </Link>
          </div>
        </div>

        <div className="lg:pl-4">
          <V3ComicCover
            age={age ?? ""}
            title={`Meet ${account.firstName}`}
            caption={`${account.firstName}'s First Profit Journey — page 1 of many.`}
          />
        </div>
      </div>
    </section>
  );
}
