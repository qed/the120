"use client";

/**
 * THE PARENT DASHBOARD — fpv03 S05 apps view (Unit U4).
 *
 * A complete rebuild. This screen replaces the old admissions/CRM dashboard for
 * 100% of families (founder decision: one cohort, no admissions split, and no
 * payment anywhere in the parent experience while we test — "free while we
 * test"). It is a LAUNCHER: per kid, the three apps an enrollment carries.
 *
 * ── WHAT LEFT WITH THE REBUILD (payment removal) ──
 * Every deposit / seats-remaining / refund-deadline / reserve / checkout /
 * path-completeness / register / Path-progress surface that used to live here is
 * gone from the UI. The server endpoints behind them (/api/checkout, the
 * checkout route's consent enforcement, cardVerdict, canReserveSeatForChild)
 * stay exported and reachable as separately-addressable endpoints; nothing here
 * references them. Signup provisions a First Profit account with no deposit gate
 * (app/start/StepAccountReady.tsx → v3ProvisionAction), so a family completes
 * for free and lands here.
 *
 * ── THE PER-KID "LOGIN" HANDOFF ──
 * The First Profit "Login" button mints a one-time, child-bound handoff code for
 * THAT child and opens firstprofit.school/auth/enter#<code> in a NEW TAB. It
 * reuses the shipped mint path (`v3MintHandoffAction`, ownership enforced in the
 * WHERE clause server-side) and the shipped new-tab discipline from the
 * account-ready screen: open the blank tab SYNCHRONOUSLY inside the click
 * handler, before any await, or a popup blocker eats it. `fallback` and `minted`
 * both carry a destination and navigate alike; a blocked tab surfaces a visible
 * manual link rather than a silent dead end.
 *
 * fpv03 U4 (merge): the credential-reset, take-page-offline, and photo-consent
 * controls now live on THIS page too — the two-page split (apps launcher +
 * separate Account Details route) collapsed into one parent dashboard. The
 * apps launcher is the top zone ("My Kids"); the per-kid management controls are
 * composed in below via <AccountDetails/> (the `#account` section the header
 * menu's "Account Details" item scrolls to). A handle-less "Login info"
 * affordance surfaces the child's username plus the "Email my parent a code"
 * recovery path.
 *
 * Mobile-first: base classes are the ~390px phone; `lg:` layers the two-column
 * label/card rows on. No em dashes in parent-facing copy.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { v3MintHandoffAction } from "@/app/start/actions";
import { useDashboard } from "./store";
import { AppHeader } from "./ui";
import SignIn from "./SignIn";
import AccountDetails from "./AccountDetails";
import type { ConsentPolicyBundle } from "./KidCredentials";
import type { ParentSiteRow } from "@/app/lib/fp/fp-public-site-rules";
import type { Child } from "./data";

/** The account menu's destinations, identical on every page now that there is
 *  ONE parent dashboard. "My Kids" is the apps launcher at the top; "Account
 *  Details" anchor-scrolls to the management section (#account) composed in
 *  below. No "Dashboard" item — this IS the dashboard. Sign out is appended by
 *  AppHeader. */
const ACCOUNT_MENU = [
  { label: "My Kids", href: "/dashboard" },
  { label: "Account Details", href: "/dashboard#account" },
];

const FP_BLURB =
  "Start a real business through 5 phases, 25 steps and 125 sub-steps. Every win builds a panel of your own custom graphic novel.";
const GAUNTLET_BLURB =
  "Cover grades 3-12 math facts (including Calculus), making them effortless so you can focus your mental energy on complex problem solving, the underlying basic calculations.";
const MATH_ACADEMY_BLURB =
  "Math Academy teaches math 2X-4X faster by adaptively diagnosing exactly what students know, filling knowledge gaps and building mastery in math from 4th grade to university.";

/** The First Profit bars mark (already shipped for the path PWA / signup). */
function FpMark() {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/path-logo.svg" alt="" aria-hidden className="h-10 w-10 flex-none" />
  );
}

/** The styled Gauntlet wordmark — no bundled asset exists, so it is text, the
 *  same treatment the signup "Includes:" tile uses. */
function GauntletWordmark() {
  return (
    <span className="text-xl font-black leading-none tracking-[0.02em]">
      <span className="text-[#2f6fd0]">THE</span>{" "}
      <span className="text-[#e8762c]">GAUNTLET</span>
    </span>
  );
}

/** The disabled "Coming soon" pill — a control that LOOKS dead, never tappable. */
function ComingSoon() {
  return (
    <span className="inline-flex min-h-[44px] flex-none items-center justify-center rounded-full bg-v3-ink/10 px-6 py-3 font-path-display text-base font-semibold text-v3-ink/40">
      Coming soon
    </span>
  );
}

/** One app row: left label (its own column from `lg` up), then the card. */
function AppRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-[13rem_1fr] lg:items-center lg:gap-8">
      <h3 className="font-path-display text-xl font-black leading-tight text-v3-ink lg:text-2xl">
        {label}
      </h3>
      <div className="rounded-3xl border border-v3-ink/10 bg-white p-5 shadow-[0_2px_0_0_rgb(27_24_21_/_0.06)] sm:p-6">
        {children}
      </div>
    </div>
  );
}

export default function DashboardApp({
  consentPolicy,
  photoConsentChildIds = null,
  fpSites = null,
}: {
  /** The consent policy + hash, computed server-side and threaded down for the
   *  merged-in management controls (KidCredentials). Absent = the consent
   *  affordance does not render. */
  consentPolicy?: ConsentPolicyBundle;
  /** Child ids whose photo-consent gate is OPEN; null = the read failed. */
  photoConsentChildIds?: string[] | null;
  /** Each child's public page + state, parent-scoped; null = the read failed. */
  fpSites?: ParentSiteRow[] | null;
}) {
  const { ready, session, children } = useDashboard();

  // Per-child login state: which child's tab is opening, and any popup-blocked
  // manual link / error to surface beside that child's card.
  const [loggingIn, setLoggingIn] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState<{ id: string; url: string } | null>(null);
  const [loginError, setLoginError] = useState<{ id: string; message: string } | null>(null);
  const [infoOpen, setInfoOpen] = useState<string | null>(null);

  // Cleared on unmount. Read before every setState and every navigation the
  // detached mint performs — the same guard StepAccountReady.tsx ships (Unit 3
  // review, FIX 5): the mint keeps resolving after this screen is gone, and a
  // setState on an unmounted tree (or a navigate of a tab the parent already
  // left) is the bug that guard exists to prevent.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Auth gate: signed out always shows the SignIn swap (client-side), exactly as
  // before — the server gate computed "render" for a session-less request too.
  if (ready && !session) return <SignIn />;

  const login = (childId: string) => {
    if (loggingIn) return;
    // ⚠ SYNCHRONOUS OPEN, BEFORE ANY AWAIT (the shipped account-ready rule): a
    // window.open after an await has lost the user-gesture context and every
    // popup blocker eats it.
    // ⚠ NO `noopener` IN THE FEATURE STRING: window.open returns NULL whenever
    // noopener is requested, which would null the handle this mint keeps and
    // force EVERY family onto the manual-link path (the shipped documented bug).
    // The destination is first-party, so win.opener is nulled directly instead.
    const win = window.open("", "_blank");
    try {
      if (win) win.opener = null;
    } catch {
      // First-party destination either way; nothing to do.
    }
    setLoggingIn(childId);
    setManualUrl(null);
    setLoginError(null);
    void (async () => {
      const result = await v3MintHandoffAction({ childId });
      // ⚠ THE UNMOUNT GUARD (ported from StepAccountReady, review FIX 5). If this
      // screen is gone the parent has chosen somewhere else to be; the only
      // thing left to do is not leave a blank popup behind, and never setState.
      if (!mounted.current) {
        win?.close();
        return;
      }
      if (result.kind === "failed") {
        win?.close();
        setLoggingIn(null);
        setLoginError({
          id: childId,
          message: "We could not open First Profit just now. Try again.",
        });
        return;
      }
      // `minted` and `fallback` both carry a working destination.
      if (win) {
        win.location.href = result.destination;
        setLoggingIn(null);
        return;
      }
      // The popup blocker won: surface the link rather than a silent dead end.
      // Made observable (per the noopener learning): a silent fallback once hid
      // that EVERY family was taking this path.
      console.warn("[dashboard] new tab blocked; surfacing the manual handoff link");
      setManualUrl({ id: childId, url: result.destination });
      setLoggingIn(null);
    })();
  };

  const firstProfitCard = (c: Child) => {
    const opening = loggingIn === c.id;
    // The SAME null signal the Login-info panel shows below ("Not set up yet"):
    // a kid with no FP account has no handoff to mint. Rendering an enabled
    // Login for them burns a real single-use code and lands on a not_child error.
    const notSetUp = c.fpUsername == null;
    const info = infoOpen === c.id;
    const manual = manualUrl?.id === c.id ? manualUrl.url : null;
    const error = loginError?.id === c.id ? loginError.message : null;
    return (
      <div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex min-w-0 gap-4">
            <FpMark />
            <div className="min-w-0">
              <p className="font-path-display text-xl font-black leading-none text-v3-ink">
                First Profit
              </p>
              <p className="mt-2 text-sm leading-relaxed text-v3-stone">{FP_BLURB}</p>
            </div>
          </div>
          <div className="flex flex-none flex-col items-stretch gap-2 sm:items-end">
            <button
              type="button"
              onClick={() => login(c.id)}
              disabled={opening || notSetUp}
              title={notSetUp ? "This kid does not have a First Profit account yet." : undefined}
              className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-v3-profit px-8 py-3 font-path-display text-base font-semibold text-white shadow-[0_4px_0_0_#0f4227] transition hover:-translate-y-0.5 hover:bg-v3-profit-dark active:translate-y-0 disabled:cursor-not-allowed disabled:bg-v3-ink/15 disabled:text-v3-ink/40 disabled:shadow-none disabled:hover:translate-y-0"
            >
              {notSetUp ? "Not set up yet" : opening ? "Opening..." : "Login"}
            </button>
            <button
              type="button"
              onClick={() => setInfoOpen(info ? null : c.id)}
              aria-expanded={info}
              className="v3-label inline-flex min-h-[44px] items-center justify-center text-v3-stone underline underline-offset-4 transition-colors hover:text-v3-ink"
            >
              Login info
            </button>
          </div>
        </div>

        {info && (
          <div className="mt-4 rounded-2xl border border-v3-ink/10 bg-v3-cream/60 p-4">
            <p className="v3-label text-v3-stone">Username</p>
            {/* break-all: an email-shaped handle must wrap inside a 390px card
                rather than push the page sideways. */}
            <p className="mt-1 break-all font-path-mono text-sm text-v3-ink">
              {c.fpUsername ?? "Not set up yet"}
            </p>
            <p className="mt-3 text-sm leading-relaxed text-v3-stone">
              Your kid signs in with this username. Forgot the password? On the login page they
              can also use &ldquo;Email my parent a code&rdquo; and we will send you a one-time
              code.
            </p>
          </div>
        )}

        {manual && (
          <p className="mt-3 text-sm leading-relaxed text-v3-stone">
            Your browser blocked the new tab.{" "}
            <a
              href={manual}
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold text-v3-profit underline underline-offset-4"
            >
              Open First Profit
            </a>
          </p>
        )}
        {error && (
          <p className="mt-3 text-sm leading-relaxed font-medium text-v3-one20" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  };

  const kidSection = (c: Child) => (
    <section key={c.id} className="mt-10 first:mt-0">
      <h2 className="font-path-display text-4xl font-black leading-none tracking-tight text-v3-ink sm:text-5xl">
        {(c.firstName || "Your kid")}&rsquo;s Dashboard
      </h2>
      <div className="mt-6 space-y-6">
        <AppRow label="Build a real Business">{firstProfitCard(c)}</AppRow>

        <AppRow label="Fast Math">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <GauntletWordmark />
              <p className="mt-3 text-sm leading-relaxed text-v3-stone">{GAUNTLET_BLURB}</p>
            </div>
            <ComingSoon />
          </div>
        </AppRow>

        <AppRow label="Math">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/math-academy-long-logo.jpg"
                alt="Math Academy"
                className="h-10 w-auto flex-none"
              />
              <p className="text-sm leading-relaxed text-v3-stone">{MATH_ACADEMY_BLURB}</p>
            </div>
            <ComingSoon />
          </div>
        </AppRow>
      </div>
    </section>
  );

  return (
    <div className="v3-grain min-h-screen bg-v3-cream text-v3-ink">
      <AppHeader items={ACCOUNT_MENU} />

      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-12">
        {!ready ? (
          <p className="v3-label text-v3-stone">Loading your dashboard...</p>
        ) : children.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-v3-ink/20 bg-white p-10 text-center">
            <h1 className="font-path-display text-3xl font-black text-v3-ink">
              Welcome{"."}
            </h1>
            <p className="mt-3 text-base leading-relaxed text-v3-stone">
              Add your first kid to get started.
            </p>
            <Link
              href="/start?step=kid"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full bg-v3-profit px-8 py-3 font-path-display text-base font-semibold text-white shadow-[0_4px_0_0_#0f4227] transition hover:-translate-y-0.5 hover:bg-v3-profit-dark"
            >
              Add a kid
            </Link>
          </div>
        ) : (
          <>
            {children.map(kidSection)}

            {/* Add-a-kid affordance, always reachable now that this is the one
                parent home (not only the empty-family state). */}
            <div className="mt-10 rounded-3xl border border-dashed border-v3-ink/20 bg-white/60 p-6 text-center">
              <p className="text-base leading-relaxed text-v3-stone">
                Have another kid to set up?
              </p>
              <Link
                href="/start?step=kid"
                className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-full bg-v3-profit px-8 py-3 font-path-display text-base font-semibold text-white shadow-[0_4px_0_0_#0f4227] transition hover:-translate-y-0.5 hover:bg-v3-profit-dark"
              >
                Add a kid
              </Link>
            </div>
          </>
        )}

        {/* The per-kid management controls (password reset, take-page-offline,
            photo consent), composed in as the #account section the header menu's
            "Account Details" item scrolls to. Mounted UNCONDITIONALLY for a
            signed-in parent — below the apps launcher in BOTH the zero-kid and
            has-kids states — so the #account anchor always exists and the menu
            link always resolves. AccountDetails owns its own !ready / zero-kid
            copy; the signed-out swap to SignIn above still gates it. Reused
            verbatim with its shipped props. */}
        <AccountDetails
          consentPolicy={consentPolicy}
          photoConsentChildIds={photoConsentChildIds}
          fpSites={fpSites}
        />
      </main>
    </div>
  );
}
