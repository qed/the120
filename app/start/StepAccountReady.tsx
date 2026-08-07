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
 * ── "KEEP BUILDING" OPENS A NEW TAB — ON EVERY DEVICE (Unit 5 review, FIX 1) ──
 * A NEW TAB, opened SYNCHRONOUSLY in the click handler BEFORE any `await`. That
 * ordering is the whole trick: a `window.open` after an await has lost the
 * user-gesture context and every popup blocker eats it. The tab is opened blank,
 * the mint is awaited, and only then is the tab navigated. `win === null` means
 * the blocker won anyway — that case gets a VISIBLE manual link, never a silent
 * dead end.
 *
 * ⚠ THIS SCREEN IS THE ONLY PLACE THE PASSWORD EXISTS, AND THAT IS WHY THE TAB
 * IS NEW. The handoff deliberately never un-burns a consumed code
 * (app/api/fp/handoff/handoff-core.ts states the reasoning), and one of its
 * three legs is "the family is standing on the account-ready screen holding the
 * username and password we just showed them, so signing in by hand is a real
 * way in". Until this review the plan's MOBILE ending was `window.location
 * .assign(destination)` — which LEAVES the120.school entirely, BEFORE the
 * exchange has even run on the other origin. A transient exchange failure then
 * left a phone family with a burned code, no password on screen, and no way
 * back: pressing Back remounts this component, which re-provisions down the
 * idempotent-replay path and — by design — shows "Already set on an earlier
 * try" INSTEAD of the password. The original tab surviving is not a desktop
 * nicety; it is the recovery path the whole design leans on. So both
 * breakpoints now take the same ending, and the popup-blocked manual link is
 * the phone's safety net exactly as it is the desktop's.
 *
 * (The cost the plan wanted to avoid — a second tab a parent has to find again
 * on a phone — is real, and it is the right trade: a tab in the switcher is an
 * inconvenience, an unrecoverable account is not.)
 *
 * ⚠ NO `noopener,noreferrer` IN THE FEATURE STRING. Per the HTML spec
 * `window.open` returns NULL whenever `noopener` is requested — so the handle
 * this ending needs was always null, and EVERY family was silently taking the
 * "your browser blocked the new tab" manual-link path. The destination is
 * first-party (firstprofit.school), so reverse-tabnabbing is not the threat it
 * is for third-party links; `win.opener` is nulled directly instead, which
 * gives the same hygiene AND a usable handle.
 *
 * ── THE MINT MUST NOT OUTLIVE THE COMPONENT (Unit 3 review, FIX 5) ──
 * The mint runs in a detached `void (async () => …)()`, so it keeps resolving
 * after this screen is gone. Every resolution point in that IIFE checks
 * `mounted.current` first, before any setState; on unmount the already-opened
 * tab is closed rather than left blank. (The hazard that guard was written for —
 * a stale `window.location.assign` yanking a parent who had already tapped
 * "Parent dashboard" — no longer exists at all now that this screen's tab never
 * navigates.)
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
    // ⚠ SYNCHRONOUS OPEN, BEFORE ANY AWAIT, ON EVERY DEVICE (review FIX 1).
    // Moving this below the await is the bug the module header exists to
    // prevent; making it conditional on a breakpoint is the OTHER bug the
    // module header exists to prevent — THIS tab is the family's only copy of
    // the password, so it must survive the handoff whatever the screen width.
    const win = window.open("", "_blank");
    // Same hygiene `noopener` would have bought, without null-ing the handle we
    // need (see the module header). Guarded: a browser may refuse the write.
    try {
      if (win) win.opener = null;
    } catch {
      // Nothing to do — the destination is first-party either way.
    }
    setMintState("minting");
    void (async () => {
      const result = await v3MintHandoffAction({ childId: account?.childId ?? null });
      // ⚠ THE GUARD (Unit 3 review, FIX 5). If this screen is gone the parent
      // has already chosen somewhere else to be; the only thing left to do is
      // not leave a blank popup behind.
      if (!mounted.current) {
        win?.close();
        return;
      }
      if (result.kind === "failed") {
        win?.close();
        setMintState("idle");
        setFailure({ message: "We could not open First Profit just now. Try again.", retryable: true });
        return;
      }
      // `minted` and `fallback` are both working endings and navigate alike: a
      // fallback destination is the plain sign-in page, and the credentials to
      // use on it are on this screen — which is still here.
      if (win) {
        win.location.href = result.destination;
        setMintState("idle");
        return;
      }
      // The popup blocker won. Never a silent dead end: show the link.
      setManualUrl(result.destination);
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
