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
 * persisted, the STRING degrades — the control does not. R16 RETIRES the per-subtree
 * sign-outs that today work independently of that read (Unit 4 does the retiring;
 * `FwSignOutButton` is still mounted as of this unit), so once they are gone a silent
 * failure here would strand a staff member on a page with no way out.
 *
 * THE SIGN-OUT SEQUENCE IS UNIT 1'S, unchanged. `runFwSignOut` takes the lock exactly
 * once around verdict → drain → re-verdict → atomic clear. Nothing here may acquire
 * `fw-offline-drain`: Web Locks are not reentrant and re-entry HANGS rather than
 * throwing.
 */

import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  readFwDeviceQueueState,
  reconcileFwCacheOwner,
  runFwSignOut,
  subscribeFwQueue,
} from "@/app/fp/lib/fw-sync-client";
import { fwSignOutOutcomeCopy } from "@/app/fp/lib/fw-sync-rules";
import { isNextRedirect } from "@/app/fp/lib/next-redirect";
import { loadStaffBarIdentity, signOutStaffBar } from "./actions";
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
  staffBarSignOutSurface,
  staffBarSkin,
  type StaffBarApplication,
  type StaffBarIdentity,
  type StaffBarQueueState,
} from "./bar-rules";

/** Where the offline copy of the bar's identity lives. Cleared on sign-out and
 *  whenever the account changes, so a previous operator's address can never outlive
 *  their session on a shared device. */
const IDENTITY_KEY = "staffBar.identity";

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
}: {
  application: StaffBarApplication;
  /** The signed-in user id. Opaque, role-free, and the scope every queue decision
   *  needs before identity has resolved. */
  actorUserId: string;
}) {
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
  // ⚠️ UNIT 4 REMOVES `FwPwa`'s COPY OF THIS EFFECT when it mounts the bar in
  // `app/fp/fw/(app)/layout.tsx`. Until then FwPwa still owns it there and the bar is
  // not mounted, so exactly one reconcile runs. Running both would race two
  // reconciles on one localStorage key.
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
        setMessage(fwSignOutOutcomeCopy(outcome, staffBarSignOutSurface(application)));
        if (probeActorIsFwGuide !== null) {
          setQueue(
            await readFwDeviceQueueState({ actorUserId, actorIsFwGuide: probeActorIsFwGuide })
          );
        }
        return;
      }
      // Reaching here means the local residue is already GONE — clearing it is what
      // earned the `sign_out` outcome, not a consequence of it.
      cleared = true;
      // The account's own copy of its identity goes with the session, or the next
      // operator's bar opens showing the last one's address.
      writePersistedIdentity(null);
      await signOutStaffBar(application); // redirects
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
    <header className={`sticky top-0 z-30 print:hidden ${skin.bar}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-2.5 sm:px-7">
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
