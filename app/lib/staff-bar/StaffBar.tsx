"use client";

/**
 * The persistent staff nav bar (Staff Front Door Unit 3; R5, R15, R16, R17, R22,
 * R23, R24).
 *
 * DELIBERATELY THIN, and for a mechanical reason rather than a stylistic one: this
 * repo runs `environment: "node"` with no jsdom, so a decision written here is a
 * decision CI cannot see. Which application am I in, does the hub link render, where
 * does sign-out land, what does the queue chip say, which token set do I paint in —
 * all of it lives in `bar-rules.ts` with a test. This file wires browser seams to
 * those answers and renders them.
 *
 * WHAT COMES FROM THE SERVER, AND WHY SO LITTLE. `application` and an opaque
 * `actorUserId`. Nothing else. `/fp/fw` navigations are cached into
 * `path-sw-fw-shell-v1`, and props to a client component are serialized into that
 * cached payload — so an email or a staff-ness boolean arriving as a prop would leave
 * a cached shell that differs between a staff and a non-staff visit, handing the next
 * holder of a shared iPad the previous operator's address and role. Identity is
 * fetched over a Server Action instead, which is a POST and is never in that cache.
 * `actorUserId` is a uuid that reveals no role and that `FwPwa` already passes on the
 * same surfaces.
 *
 * R23 IS THE INVARIANT TO PROTECT WHEN EDITING THIS. The bar and its sign-out render
 * unconditionally. If identity fails, is slow, or the device is offline with nothing
 * persisted, the STRING degrades — the control does not. This is now the ONLY
 * sign-out on every guarded staff surface: Unit 4 retired the FW ops header's form,
 * the per-cohort `FwSignOutButton` (deleted) and the CRM tab row's control, all of
 * which used to work independently of this read. A silent failure here therefore
 * strands a staff member on a page with no way out, with nothing else to fall back
 * to.
 *
 * THE SIGN-OUT SEQUENCE IS UNIT 1'S, unchanged. `runFwSignOut` takes the lock exactly
 * once around verdict → drain → re-verdict → atomic clear. Nothing here may acquire
 * `fw-offline-drain`: Web Locks are not reentrant and re-entry HANGS rather than
 * throwing.
 */

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { FW_ACTION_TIMEOUT_MS, withFwTimeout } from "@/app/lib/fp/fw-call";
import {
  readFwDeviceQueueState,
  reconcileFwCacheOwner,
  runFwSignOut,
  subscribeFwQueue,
} from "@/app/lib/fp/fw-sync-client";
import {
  fwResidueBeacon,
  fwSignOutOutcomeCopy,
  type FwReconcileOutcome,
  type FwSignOutOutcome,
} from "@/app/lib/fp/fw-sync-rules";
import { isNextRedirect } from "@/app/lib/fp/next-redirect";
import { loadStaffBarIdentity, sendFwResidueBeacon, signOutStaffBar } from "./actions";
import {
  parseStaffBarIdentity,
  selectStaffBarIdentity,
  staffBarQueueProbe,
  staffBarSignOutActorIsFwGuide,
  staffBarSurfaceCreatesFwResidue,
  STAFF_HUB_PATH,
  staffBarApplicationLabel,
  staffBarIdentityLabel,
  staffBarQueueChip,
  staffBarShowsHubLink,
  staffBarShowsLogoLockup,
  staffBarSkin,
  type StaffBarApplication,
  type StaffBarIdentity,
  type StaffBarQueueState,
} from "./bar-rules";
import { SEATS_TOTAL } from "@/app/lib/site";

/** Where the offline copy of the bar's identity lives. Cleared on sign-out and
 *  whenever the account changes, so a previous operator's address can never outlive
 *  their session on a shared device. */
const IDENTITY_KEY = "staffBar.identity";

/**
 * Report an outcome that left work on this device (Unit 5), or do nothing.
 *
 * MODULE-LEVEL, not a closure in the component body, for a mundane but load-bearing
 * reason: one caller is inside the reconcile `useEffect`, and a body-level function
 * would either join that effect's dependency array — re-running a destructive
 * handover reconcile whenever an unrelated render produced a new identity — or need a
 * ref to dodge it. Neither is worth it for a function that reads nothing but its
 * arguments.
 *
 * The DECISION of whether there is anything to report is `fwResidueBeacon`'s, which is
 * pure and tested; `null` means silence. This wrapper is only the dispatch, and it
 * cannot throw into its caller: `void` plus a `.catch` means a beacon that fails on
 * venue wifi never becomes a sign-out that fails.
 */
function dispatchFwResidueBeacon(
  outcome: FwSignOutOutcome | FwReconcileOutcome,
  actorUserId: string,
  application: StaffBarApplication
) {
  const payload = fwResidueBeacon({ outcome, actorUserId, application });
  if (payload === null) return;
  void sendFwResidueBeacon({
    schemaVersion: 1,
    outcome: payload.outcome,
    queueRemaining: payload.queueRemaining,
    application: payload.application,
    // The CLAIM — who this device observed the outcome for. The server logs it
    // beside its own authenticated read of who SENT the beacon; they differ exactly
    // when a handover races the POST, and carrying both is what makes that race a
    // visible log fact rather than a silent misattribution (frontend-races review).
    claimedActorUserId: payload.actorUserId,
    deviceId: readFwDeviceId(),
  }).catch((e) => console.error("[staff-bar] residue beacon failed:", e));
}

/** Where this browser's random beacon identity lives. Localstorage, not IDB — the
 *  evidence gate's "never CREATE the queue db" rule does not extend to a plain key. */
const DEVICE_ID_KEY = "fw.deviceId";

/**
 * A stable random identifier for THIS browser profile, minted on first use.
 *
 * It exists because the beacon's question is "WHICH iPad is holding work", and an
 * account id cannot answer it — one guide signs into several devices across a
 * weekend. Random uuid, no hardware fact, meaningless outside this app's own logs.
 * On storage failure (private mode) every beacon reports a fresh id, which reads at
 * the desk as "an unpersistable device" — itself useful information.
 */
function readFwDeviceId(): string {
  try {
    const existing = window.localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const minted = crypto.randomUUID();
    window.localStorage.setItem(DEVICE_ID_KEY, minted);
    return minted;
  } catch {
    return crypto.randomUUID();
  }
}

/**
 * The bar's own height, published to CSS so the sticky headers BELOW it can stack
 * under it instead of being covered by it (Unit 4).
 *
 * Two `position: sticky` elements that both resolve to `top: 0` do not stack — the
 * one with the higher z-index simply paints over the other, and `/fp/fw/ops` and
 * every per-cohort surface have a sticky working header of their own. The offset
 * cannot be a constant: this bar wraps at narrow widths and grows a second line
 * whenever it has a queue chip or an error message to show, all of which happen on
 * the 375px shared iPad rather than in spite of it.
 *
 * Measured rather than declared, and cleared on unmount so a layout without a bar
 * inherits nothing. Consumers read `var(--staff-bar-h, 0px)`, so the fallback is
 * exactly today's behaviour — which is also the plan's named rollback for this slice
 * (unmount the bar from `/fp/fw` alone and the guide headers are unchanged).
 */
const BAR_HEIGHT_PROPERTY = "--staff-bar-h";

/** Which bar element currently owns `--staff-bar-h`. Module scope because the
 *  property it guards is document scope — see the cleanup below. */
let barOwner: HTMLElement | null = null;

/**
 * The persisted identity as an external store.
 *
 * `useSyncExternalStore` rather than an effect, for one reason that is not style:
 * localStorage cannot be read during render (the server has none), so a `useState`
 * initializer would hydrate to a different string than the server sent. This hook is
 * the supported shape for exactly that — `getServerSnapshot` answers on the server
 * and through hydration, the client snapshot lands after. The parse is memoized on
 * the raw string because `getSnapshot` must return a stable reference or React
 * re-renders forever.
 */
let cachedRaw: string | null = null;
let cachedIdentity: StaffBarIdentity | null = null;
const identityListeners = new Set<() => void>();

function readPersistedIdentity(): StaffBarIdentity | null {
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(IDENTITY_KEY);
  } catch {
    // A THROW is not "no record", and conflating them breaks the one contract
    // `useSyncExternalStore` imposes: `getSnapshot` must be referentially stable
    // across calls. React calls it more than once per render pass to check for
    // tearing, so under an intermittently-denying storage policy the alternating
    // real-value/null answers would loop or thrash the bar. Keep what we last read.
    return cachedIdentity;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedIdentity = null;
    if (raw !== null) {
      try {
        cachedIdentity = parseStaffBarIdentity(JSON.parse(raw));
      } catch {
        cachedIdentity = null; // not JSON — a record we will not trust
      }
    }
  }
  return cachedIdentity;
}

function subscribePersistedIdentity(listener: () => void): () => void {
  identityListeners.add(listener);
  return () => identityListeners.delete(listener);
}

function writePersistedIdentity(identity: StaffBarIdentity | null): void {
  try {
    if (identity === null) window.localStorage.removeItem(IDENTITY_KEY);
    else window.localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
  } catch {
    /* nothing to persist; the bar still works from the live read */
  }
  for (const listener of [...identityListeners]) listener();
}

export function StaffBar({
  application,
  actorUserId,
  seatsRemaining,
}: {
  application: StaffBarApplication;
  /** The signed-in user id. Opaque, role-free, and the scope every queue decision
   *  needs before identity has resolved. */
  actorUserId: string;
  /** Item 60: the ONE-row backend nav's seats line (/staff and /crm). A
   *  public programme count, never identity or role (the cached-payload
   *  rule), and absent on /fp/fw. */
  seatsRemaining?: number;
}) {
  const barRef = useRef<HTMLElement | null>(null);
  const [live, setLive] = useState<StaffBarIdentity | null>(null);
  const [queue, setQueue] = useState<StaffBarQueueState | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const persisted = useSyncExternalStore(
    subscribePersistedIdentity,
    readPersistedIdentity,
    () => null
  );

  const identity = selectStaffBarIdentity({ live, persisted, actorUserId });
  const skin = staffBarSkin(application);

  // BOTH of these are pure, exported and tested in `bar-rules.ts`, and neither may
  // move back inline. They were written here in this unit's first draft, and five
  // reviewers independently found that flipping either one left the whole suite
  // green — the previous unit's headline finding, recurring inside the unit meant to
  // apply it. They also differ, deliberately: the sign-out gate fails CLOSED on an
  // unresolved actor because under-checking destroys a queue, while the chip declines
  // to look at all, because reading the queue CREATES the database and a badge is not
  // worth that. Both take `live` — never the persisted copy, which can predate a
  // mid-event guide grant.
  const signOutActorIsFwGuide = staffBarSignOutActorIsFwGuide(live);
  const probe = staffBarQueueProbe(live);
  /** The probe's answer flattened to one scalar, so the effect below has a dependency
   *  a linter can statically check. `null` = declined to look. */
  const probeActorIsFwGuide = probe.probe ? probe.actorIsFwGuide : null;
  // A chip is rendered only from a queue we actually looked at. Declining to look
  // must read as "no chip", never as "the queue is empty".
  const chip = staffBarQueueChip({ application, state: probe.probe ? queue : null });

  // ── publish the bar's height for the sticky headers below it ────────────────
  // A ResizeObserver rather than a one-shot measurement: the bar changes height when
  // the queue chip appears, when a message renders, and when a narrow viewport wraps
  // it — and a stale offset leaves a gap or a covered header rather than failing
  // loudly. No decision here, so nothing to extract: this is a measurement.
  //
  // useLAYOUTEffect, deliberately. `useEffect` runs after the browser has painted, so
  // every mount — hydration, and every remount from crossing route groups — would
  // paint one frame with the previous bar's height or the 0px fallback, and the
  // headers below (`sticky top-[var(--staff-bar-h,0px)]`) would flash underneath this
  // one. On `/fp/fw/cohort/X` the thing that flashes is the weekend name, which is
  // wrong-stamp prevention, so those frames are not cosmetic. A synchronous
  // `getBoundingClientRect()` read plus an inline style write is exactly the case
  // this hook exists for.
  useLayoutEffect(() => {
    const node = barRef.current;
    if (node === null || typeof ResizeObserver === "undefined") return;
    const publish = () => {
      document.documentElement.style.setProperty(
        BAR_HEIGHT_PROPERTY,
        `${node.getBoundingClientRect().height}px`
      );
      // Claim ownership of the shared property in the same breath as setting it, so
      // the cleanup below can tell "I am still the bar" from "someone else took over".
      barOwner = node;
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => {
      observer.disconnect();
      // ONLY if no other bar has since claimed it. The property lives on
      // `document.documentElement`, so it is shared global state, and a blind
      // `removeProperty` here would blank the value an incoming bar had just set if a
      // future routing change ever mounts one before this one unmounts. React's
      // destroy-before-create ordering makes that impossible within a single commit
      // today — but that is a scheduling property of the current route shape (and of
      // there being no `loading.tsx` between these trees), not an invariant this
      // component controls, and the failure it would cause (every header below jumping
      // under the bar) is silent.
      //
      // UNVERIFIABLE BY CI, said plainly: there is no DOM here, so mutating this guard
      // to `if (true)` reddens nothing. It belongs to the on-device dry run.
      if (barOwner === node) {
        barOwner = null;
        document.documentElement.style.removeProperty(BAR_HEIGHT_PROPERTY);
      }
    };
  }, []);

  // ── identity: persisted first (offline), authoritative when it lands ─────────
  useEffect(() => {
    let cancelled = false;
    void loadStaffBarIdentity()
      .then((result) => {
        if (cancelled || !result.ok) return;
        setLive(result.identity);
        writePersistedIdentity(result.identity);
      })
      .catch((e) => console.error("[staff-bar] identity read failed:", e));
    return () => {
      cancelled = true;
    };
  }, [actorUserId]);

  // ── the handover reconcile (B2) ─────────────────────────────────────────────
  // A device that changed hands without a sign-out still holds the prior account's
  // roster cache and authed app shell. This clears them, DRAINS before it touches the
  // queue, and preserves any capture it cannot ship. `surfaceCreatesResidue` is true
  // only on `/fp/fw`: writing the owner key from `/crm` would mark a browser that has
  // never run Founders Weekend as holding FW residue, which is an input the sign-out
  // evidence gate reads.
  //
  // Keyed on the SERVER-supplied `actorUserId`, not on the resolved identity, so a
  // slow or failed identity read cannot delay clearing a prior guide's cached roster.
  //
  // THIS IS THE ONLY RECONCILE OWNER, on every surface. `FwPwa` used to carry a copy
  // for `/fp/fw`; Unit 4 deleted it in the same change that mounted the bar there,
  // because running both would race two reconciles on one localStorage key.
  // `bar-wiring.test.ts` counts the owners in that subtree and reddens at zero or two.
  useEffect(() => {
    // The bar's own persisted identity is residue too: it is an email address, and it
    // must not outlive the account it names on a device that changed hands.
    if (readPersistedIdentity()?.userId !== actorUserId) writePersistedIdentity(null);
    let cancelled = false;
    void reconcileFwCacheOwner({
      actorUserId,
      surfaceCreatesResidue: staffBarSurfaceCreatesFwResidue(application),
    })
      .then((outcome) => {
        // THE RESOLVED VALUE IS THE POINT. `runFwCacheOwnerReconcile` returns a typed
        // outcome precisely so a failed clear stops being invisible — that is half of
        // B2. `clear_failed` and `queue_preserved` are RESOLVED values, not
        // rejections, so a bare `.catch()` drops exactly the outcomes the unit exists
        // to surface, and this is the automatic path that runs far more often than
        // the sign-out button.
        // THE BEACON IS NOT GATED ON `cancelled` (Unit 5). `cancelled` means this bar
        // unmounted — a navigation — and says nothing about the device, which is still
        // holding whatever the reconcile preserved. Skipping the report on unmount
        // would drop exactly the fast-navigation cases, and this is the automatic path
        // that runs far more often than the sign-out button.
        dispatchFwResidueBeacon(outcome, actorUserId, application);
        if (cancelled || outcome.kind !== "clear_failed") return;
        console.error("[staff-bar] handover clear failed; residue may remain on this device");
        setMessage(
          "This device may still hold the previous account's Founders Weekend data. Reload before handing it over, and tell The 120 staff if this keeps showing."
        );
      })
      .catch((e) => console.error("[staff-bar] cache-owner reconcile failed:", e));
    return () => {
      cancelled = true;
    };
  }, [actorUserId, application]);

  // ── the queue chip ──────────────────────────────────────────────────────────
  useEffect(() => {
    // `null` means the probe declined — no identity yet, so nothing may open the
    // database. Reported by rendering no chip (see `chip` above), NOT by clearing
    // state here: a setState in an effect body is a cascading render, and "not looked
    // at" is already expressible without one.
    if (probeActorIsFwGuide === null) return;
    let cancelled = false;
    const refresh = () => {
      void readFwDeviceQueueState({
        actorUserId,
        actorIsFwGuide: probeActorIsFwGuide,
      }).then((next) => {
        if (!cancelled) setQueue(next);
      });
    };
    refresh();
    const unsubscribe = subscribeFwQueue(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [actorUserId, probeActorIsFwGuide]);

  // ── sign-out ────────────────────────────────────────────────────────────────
  // A REF, not the `busy` state. State is only true after React commits, so two taps
  // dispatched inside one frame — an ordinary double-tap on an iPad — can both read
  // `busy === false` and start two overlapping sequences. The drain lock serializes
  // them so nothing corrupts, but the second is a redundant round trip on venue wifi
  // and its late `setMessage` can flash a stale string over the first one's result.
  const inFlight = useRef(false);

  const onSignOut = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setMessage(null);
    let cleared = false;
    try {
      const outcome = await runFwSignOut({
        actorUserId,
        actorIsFwGuide: signOutActorIsFwGuide,
      });
      if (outcome.kind !== "sign_out") {
        dispatchFwResidueBeacon(outcome, actorUserId, application);
        setMessage(fwSignOutOutcomeCopy(outcome));
        if (probeActorIsFwGuide !== null) {
          setQueue(
            await readFwDeviceQueueState({ actorUserId, actorIsFwGuide: probeActorIsFwGuide })
          );
        }
        return;
      }
      // Reaching here means the local residue is already GONE — clearing it is what
      // earned the `sign_out` outcome, not a consequence of it.
      //
      // THE SUCCESS PATH REPORTS THROUGH THE SIGN-OUT ACTION ITSELF (Unit 6,
      // Peter; mechanism revised in review). An orderly sign-out over a departed
      // guide's preserved captures was the one residue-leaving path with no
      // off-device report. A fire-and-forget dispatch here RACED auth.signOut() —
      // two independent requests — and when the sign-out won, the beacon
      // authenticated against a dead session and was dropped, silently, on exactly
      // this path. So the payload rides the sign-out request and is written
      // server-side BEFORE the session ends: same request, no race. Null when
      // there is nothing to report (the ordinary clean sign-out).
      cleared = true;
      // The account's own copy of its identity goes with the session, or the next
      // operator's bar opens showing the last one's address.
      writePersistedIdentity(null);
      // BOUNDED CLIENT-SIDE (Unit 5, reliability review). The server half is
      // deliberately unbounded — giving up server-side would hand back a redirect
      // while the session lived — but this AWAIT is a fetch on venue wifi, and
      // unbounded it leaves the button on "Checking…" forever with a reload as the
      // only escape: the exact failure shape the rest of this unit removes. A
      // timeout here does NOT claim the sign-out failed (it may still land); the
      // copy says exactly that. The action ends in redirect(), whose digest arrives
      // as a rejection and is re-thrown below unchanged.
      const residuePayload = fwResidueBeacon({ outcome, actorUserId, application });
      const raced = await withFwTimeout(
        signOutStaffBar(
          application,
          residuePayload === null
            ? null
            : {
                schemaVersion: 1,
                outcome: residuePayload.outcome,
                queueRemaining: residuePayload.queueRemaining,
                application: residuePayload.application,
                claimedActorUserId: residuePayload.actorUserId,
                deviceId: readFwDeviceId(),
              }
        ), // redirects
        "sign-out action",
        FW_ACTION_TIMEOUT_MS
      );
      if (raced.timedOut) {
        setMessage(
          "Still trying to end the session — this device looks connected but the network is slow. " +
            "Don't hand the device over yet; if this message stays, reload this page to check whether you are signed out."
        );
        return;
      }
    } catch (e) {
      // `signOutStaffBar` ends in `redirect()`, which Next implements by THROWING a
      // digest. Swallowing it here would report a successful sign-out as a failure —
      // the exact defect `FwSignOutButton` still carries and Unit 4 retires.
      if (isNextRedirect(e)) throw e;
      console.error("[staff-bar] sign-out failed:", e);
      setMessage(
        cleared
          ? // The local clear already ran. Nothing is LOST — it only runs once the
            // queue is verifiably drained — but the offline roster and shell caches
            // are gone while the session is still alive, and saying "try again" alone
            // would imply the device is unchanged.
            "Your check-ins sent and this device was cleared, but ending the session failed — you're still signed in. Try again."
          : "Couldn't sign out just now. Try again."
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    // print:hidden — staff chrome never belongs on a printed dossier.
    <header ref={barRef} className={`sticky top-0 z-30 print:hidden ${skin.bar}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-2.5 sm:px-7">
        {/* Item 60: the 120 lockup opens the row on /staff and /crm — always
            a link to the hub. The rule (not an inline branch) says who. */}
        {staffBarShowsLogoLockup(application) && (
          <Link href={STAFF_HUB_PATH} className="flex items-center gap-2.5">
            <span className="bg-white px-2 py-[5px] text-[15px] font-bold leading-none tracking-[-0.04em] text-crm-blue">
              120
            </span>
            <span className="whitespace-nowrap text-[15px] font-bold tracking-[-0.02em] text-crm-card">
              The 120
            </span>
          </Link>
        )}
        <span className={skin.label}>{staffBarApplicationLabel(application)}</span>

        {staffBarShowsHubLink({ application, identity }) && (
          <Link
            href={STAFF_HUB_PATH}
            className={`min-h-[44px] inline-flex items-center text-sm underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 ${skin.link}`}
          >
            Staff home
          </Link>
        )}

        {chip && (
          <span
            role="status"
            className={`rounded-full px-2.5 py-1 text-[11px] leading-4 ${
              chip.tone === "attention" ? skin.chipAttention : skin.chipQueued
            }`}
          >
            {chip.text}
          </span>
        )}

        <span className="ml-auto flex items-center gap-3 pl-4">
          {seatsRemaining !== undefined && (
            <span className="whitespace-nowrap font-mono text-[10.5px] tracking-[0.06em] text-white/75">
              {SEATS_TOTAL - seatsRemaining} SEATS FILLED · {seatsRemaining} REMAIN
            </span>
          )}
          <span className={skin.email}>{staffBarIdentityLabel(identity)}</span>
          {/* R23: rendered unconditionally. Never gated on `identity`. */}
          <button
            type="button"
            onClick={() => void onSignOut()}
            disabled={busy}
            className={`min-h-[44px] cursor-pointer text-sm underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60 ${skin.signOut}`}
          >
            {busy ? "Checking…" : "Sign out"}
          </button>
        </span>
      </div>

      {message && (
        <p role="status" className={`px-5 pb-2.5 text-xs leading-4 sm:px-7 ${skin.message}`}>
          {message}
        </p>
      )}
    </header>
  );
}
