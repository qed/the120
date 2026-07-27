/**
 * Every decision the persistent staff bar takes — ALL of it (Staff Front Door
 * Unit 3; R5, R15, R17, R22, R23, R24).
 *
 * WHY THIS FILE EXISTS. This repo runs `environment: "node"` with no jsdom, so a
 * component is renderable by CI only in the sense that it can be imported. A
 * decision written inside `StaffBar.tsx` — which application am I in, does the hub
 * link render, where does sign-out land, what does the queue chip say — is a
 * decision no test can see. So `StaffBar.tsx` composes; it does not decide. Every
 * function here is pure, exported, and covered by `__tests__/bar-rules.test.ts`.
 *
 * TAILWIND V4 IS NOT SCOPABLE. The CRM's `crm-*` tokens and First Profit's `hq-*`
 * tokens share one utility namespace, so a component serving both does a class-name
 * swap keyed on a narrowed literal — see `staffBarSkin`. `skinClass()` in
 * `app/fp/lib/skin-tokens.ts` is the pattern; it has no `crm` namespace, so this is a
 * sibling literal table rather than a call into it.
 *
 * NOTHING HERE IS ROLE-DERIVED SERVER-SIDE. `/fp/fw` navigations are cached into
 * `path-sw-fw-shell-v1`, so a cached shell that differs between a staff and a
 * non-staff visit leaks role to the next holder of a shared iPad. The bar therefore
 * receives only its application and an opaque actor id from the server; identity,
 * the hub link and every role-branched string are resolved CLIENT-side and passed
 * through the functions below.
 */

import type { FwDeviceQueueState } from "@/app/fp/lib/fw-sync-rules";

/** The guarded staff applications the bar serves. `/fp` (the family app) and the
 *  projected board are deliberately absent — R18's three exclusions. */
export const STAFF_BAR_APPLICATIONS = ["staff", "crm", "fw"] as const;

export type StaffBarApplication = (typeof STAFF_BAR_APPLICATIONS)[number];

/**
 * Who the bar says you are. Resolved client-side, persisted client-side, and keyed to
 * its own `userId` so it can never be shown over a different account.
 *
 * `email` because that is all the schema holds: the `staff` table has no name column,
 * guide accounts are minted with no name metadata, and no display-name source exists
 * anywhere in the repo (R17, verified during the brainstorm).
 */
export type StaffBarIdentity = StaffBarRoles & {
  userId: string;
  email: string;
};

/** The two role facts every branch in this file keys on, split from the identity
 *  because the sign-out destination needs ONLY these — and the server action that
 *  computes the destination has no reason to resolve an email it will not use. */
export type StaffBarRoles = {
  /** An active `staff` row plus the admin claim. */
  isStaff: boolean;
  /** Holds at least one FW `guide` grant. Also the SERVER-KNOWN half of the sign-out
   *  evidence gate — see `hasFwDeviceEvidence`, B1. */
  isFwGuide: boolean;
};

/* ══════════════════════════════════════════════ R24 — the application label ══ */

const APPLICATION_LABELS: Record<StaffBarApplication, string> = {
  staff: "Staff",
  crm: "Admissions · CRM",
  fw: "Founders Weekend",
};

/**
 * Which application you are in (R24).
 *
 * The requirement's own justification is that without it, a staff member crossing
 * CRM → hub → Founders Weekend ops sees a visually identical bar in both — so the
 * property that matters is that the three are DISTINCT, which is what the test
 * asserts. The wording matches the hub's cards (R2) so the two surfaces name the same
 * application the same way.
 */
export function staffBarApplicationLabel(application: StaffBarApplication): string {
  return APPLICATION_LABELS[application];
}

/* ══════════════════════════════════════════ R8/R9/R10/R12 — the hub link ══ */

/** The hub. Every spoke links here; spokes never link to each other (R10). */
export const STAFF_HUB_PATH = "/staff";

/**
 * Does this bar render a link back to `/staff`?
 *
 * Staff only, and never on the hub itself. R12 is the sharp edge: the hub refuses
 * non-staff with 404 semantics, so offering a guide the link would hand them a 404 —
 * and a `null` identity (the read failed, or has not answered yet) is not a licence
 * to guess, because guessing wrong on venue wifi is exactly that 404. R23 degrades
 * the identity STRING; it does not authorise degraded affordances.
 */
export function staffBarShowsHubLink(input: {
  application: StaffBarApplication;
  identity: StaffBarIdentity | null;
}): boolean {
  if (input.application === "staff") return false;
  return input.identity?.isStaff === true;
}

/* ══════════════════════════════════════════ R22 — the sign-out destination ══ */

/** The staff sign-in. Stays under `/crm` for now — the brainstorm names the
 *  retirement trigger (a third staff application, or the family app adopting the
 *  bar), not a date. */
export const STAFF_SIGN_IN_PATH = "/crm/login";
/** The GUIDE door — never `/fp/sign-in`, which is the child's door. */
export const FW_GUIDE_SIGN_IN_PATH = "/fp/fw/sign-in";

/**
 * Where sign-out lands (R22): the destination follows the ACCOUNT, not the surface.
 *
 * Staff-first for an account holding both, because a staff member who is also a guide
 * is far likelier to be mid-administration than mid-shift, and the staff door is the
 * one that can get them back to either.
 *
 * The recorded reason this requirement exists at all: a guide handing back an iPad at
 * end of shift must not be dropped on the CHILD's door, which asks for a first name
 * and tells them a parent can reset it. That is asserted across the whole input space
 * rather than in one case, because the failure is a wrong constant, not a wrong
 * branch.
 *
 * With NO identity — the read failed, or the device is offline with nothing persisted
 * — the surface is the next best fact available, and it is a fact rather than a
 * guess: you are standing on it.
 */
export function staffBarSignOutDestination(input: {
  /** Roles only — a `StaffBarIdentity` satisfies it structurally. */
  identity: StaffBarRoles | null;
  application: StaffBarApplication;
}): string {
  const { identity, application } = input;
  if (identity === null) {
    return application === "fw" ? FW_GUIDE_SIGN_IN_PATH : STAFF_SIGN_IN_PATH;
  }
  if (identity.isStaff) return STAFF_SIGN_IN_PATH;
  if (identity.isFwGuide) return FW_GUIDE_SIGN_IN_PATH;
  // Neither — an account that should not be behind a guarded layout at all. The staff
  // door, because it is the one that will tell them so.
  return STAFF_SIGN_IN_PATH;
}

/* ══════════════════════════════════════════════ R17/R23 — the identity string ══ */

/** What the bar shows when identity has not resolved. A string, deliberately: R23
 *  says the control never degrades, only this. */
const IDENTITY_UNRESOLVED = "Signed in";

export function staffBarIdentityLabel(identity: StaffBarIdentity | null): string {
  return identity?.email ?? IDENTITY_UNRESOLVED;
}

/**
 * Which identity the bar renders, given a live read that may not have answered and a
 * persisted copy that may belong to someone else.
 *
 * The persisted copy is what makes an offline cached shell still name the account
 * (the plan's specified offline behaviour, not a deferral). It is keyed to its own
 * `userId` and REFUSED when that does not match the actor this render is for — a
 * shared iPad whose previous guide's identity outlived their session must never paint
 * that guide's email over the next operator's bar. On the one device where "which
 * account am I?" is the entire question, a stale answer is worse than none.
 */
export function selectStaffBarIdentity(input: {
  live: StaffBarIdentity | null;
  persisted: StaffBarIdentity | null;
  actorUserId: string;
}): StaffBarIdentity | null {
  if (input.live !== null) return input.live;
  if (input.persisted !== null && input.persisted.userId === input.actorUserId) {
    return input.persisted;
  }
  return null;
}

/* ═══════════════════ what the bar may tell the FW device layer about the actor ══ */

/**
 * The `actorIsFwGuide` the SIGN-OUT evidence gate is given (B1's client half).
 *
 * Two properties, both load-bearing, both tested — and both were written inline in
 * `StaffBar.tsx` in the first draft of this unit, where five reviewers pointed out
 * that flipping them left the entire suite green. That is the previous unit's
 * headline finding recurring inside the unit meant to apply it, so they live here now.
 *
 *   1. **Fail CLOSED on an unresolved actor.** Not knowing whether this account is a
 *      guide must never read as "it is not", because the act being authorised
 *      destroys a queue.
 *   2. **Takes the LIVE read only, never the persisted copy.** A cached identity can
 *      predate a mid-event guide grant — a real ops move when staffing runs short —
 *      and a stale `isFwGuide: false` would then be trusted as fact and hand the gate
 *      straight back to the storage heuristic B1 exists to stop relying on. The
 *      persisted record is for DISPLAY; it is not evidence.
 */
export function staffBarSignOutActorIsFwGuide(live: StaffBarRoles | null): boolean {
  return live?.isFwGuide ?? true;
}

/**
 * Whether — and how — the bar may look at the FW queue to render its chip.
 *
 * THE ASYMMETRY THIS EXISTS TO ENFORCE. Sign-out fails closed because under-checking
 * destroys data. The queue chip is a BADGE: under-checking costs nobody anything, and
 * over-checking costs something real. Reading the queue means opening the database,
 * and `openFwDb()` CREATES it — so reusing sign-out's fail-closed `true` here would
 * conjure an FW queue database on an admissions staffer's browser on the first render
 * of a bar they will never use it from. Worse, it is self-perpetuating: nothing in
 * this repo ever deletes that database, so `fwQueueDbExists()` answers `true` for that
 * origin forever after, permanently retiring the zero-cost path the gate was built to
 * take. Five reviewers traced this independently.
 *
 * So: no live identity, no probe. The chip simply does not render for the moment it
 * takes the Server Action to answer.
 */
export type StaffBarQueueProbe =
  | { probe: false }
  | { probe: true; actorIsFwGuide: boolean };

export function staffBarQueueProbe(live: StaffBarRoles | null): StaffBarQueueProbe {
  if (live === null) return { probe: false };
  return { probe: true, actorIsFwGuide: live.isFwGuide };
}

/**
 * Does this surface CREATE FW residue, and may it therefore claim `fw.cacheOwner`?
 *
 * Only `/fp/fw` writes a roster cache or an authenticated app shell. Claiming the key
 * from `/crm` would mark a browser that has never run Founders Weekend as holding FW
 * residue — and that key is an input to `hasFwDeviceEvidence`'s legacy branch, so the
 * bar would be manufacturing the evidence it later trusts.
 */
export function staffBarSurfaceCreatesFwResidue(application: StaffBarApplication): boolean {
  return application === "fw";
}

/**
 * Narrow the untrusted `application` a Server Action receives.
 *
 * Server Actions are POST-addressable independently of the component that calls them,
 * so this value is attacker-controlled. It reaches `staffBarSignOutDestination`, which
 * maps only to hard-coded literals — but that is a property of THAT function, and this
 * one is what stops the union widening. Defaults to the hub, which gates hardest on
 * the way back in.
 *
 * Narrows the value to `string` and widens the ARRAY, following
 * `narrowFwBand`'s idiom in `fw-provision-rules.ts` — never `includes(value as T)`,
 * which asserts the answer before the check has run.
 */
export function narrowStaffBarApplication(value: unknown): StaffBarApplication {
  return typeof value === "string" &&
    (STAFF_BAR_APPLICATIONS as readonly string[]).includes(value)
    ? (value as StaffBarApplication)
    : "staff";
}

/**
 * Narrow a persisted record back to an identity, or `null`.
 *
 * localStorage is writable by anything running on the origin and survives deploys, so
 * this is untrusted input and every field is checked. A half-read record would give
 * `isStaff: undefined` — falsy, therefore quietly correct today and quietly wrong the
 * first time a branch flips.
 *
 * NO `schemaVersion`, DELIBERATELY, unlike its persisted siblings `FwQueueEntry` and
 * `FwRosterCache`. Those are versioned because they carry WORK that must survive a
 * mid-weekend redeploy — an unrecognised shape has to be quarantined and shown to a
 * human, never dropped. This record carries a cached email and two booleans, all of
 * which the live Server Action re-resolves within a second of mount. A shape this
 * function rejects is simply re-fetched, so the strict all-fields-or-null parse IS
 * the version gate, and adding a second one would imply a migration obligation that
 * does not exist.
 */
export function parseStaffBarIdentity(raw: unknown): StaffBarIdentity | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.userId !== "string" || r.userId.length === 0) return null;
  if (typeof r.email !== "string" || r.email.length === 0) return null;
  if (typeof r.isStaff !== "boolean" || typeof r.isFwGuide !== "boolean") return null;
  return { userId: r.userId, email: r.email, isStaff: r.isStaff, isFwGuide: r.isFwGuide };
}

/* ══════════════════════════════════════════════════ R24 — the queue chip ══ */

/**
 * What this device is holding, as the bar needs to say it.
 *
 * An ALIAS, not a parallel shape: it is folded from the same
 * `classifyFwSignOutQueue` partition the sign-out verdict and the destructive clear
 * read, so the chip can never say "nothing queued" on a device whose sign-out is
 * about to refuse. A second hand-written count is precisely the defect Unit 1 shipped
 * to kill. `null` at the call site means the evidence gate declined to look at all —
 * which renders as no chip, not an empty one, because "I did not look" is not "there
 * is nothing here".
 */
export type StaffBarQueueState = FwDeviceQueueState;

export type StaffBarQueueChip = {
  /** `attention` is the loud one; `queued` is informational. */
  tone: "queued" | "attention";
  text: string;
};

/**
 * The queue chip (R24), and the one piece of bar copy with a correctness constraint
 * rather than a taste constraint.
 *
 * THE CONSTRAINT: `FwPwa` — the drain engine and its foreground signals — mounts only
 * inside `/fp/fw`. On `/staff` and `/crm` nothing is draining, so copy saying the
 * captures will send by themselves is a lie whose ending is a guide walking away from
 * a device holding unsent check-ins. Off Founders Weekend the copy therefore names
 * the surface that can actually resolve it. This is also what closes the gap Unit 1
 * left open: its `needs_attention` refusal says "dismiss them in the banner", and
 * that banner renders on `/fp/fw` only.
 *
 * PRECEDENCE mirrors `decideFwSignOut`'s, and for the same reason — every state must
 * name something the operator can act on from where they are standing:
 *   1. foreign — no drain, reconnect or re-auth by THIS account can resolve it.
 *   2. expired session — a queue that cannot send until someone signs in again.
 *   3. attention — a human must dismiss these before any clear is allowed.
 *   4. queued — the ordinary case, split on connectivity and on surface.
 */
export function staffBarQueueChip(input: {
  application: StaffBarApplication;
  state: StaffBarQueueState | null;
}): StaffBarQueueChip | null {
  const { application, state } = input;
  if (state === null) return null;
  const onFw = application === "fw";

  if (state.foreignCount > 0) {
    const n = state.foreignCount;
    return {
      tone: "attention",
      text: `${n} check-in${plural(n)} on this device belong to another account. That guide has to sign in here before ${them(n)} can be sent.`,
    };
  }
  if (state.authRequired && state.queuedCount > 0) {
    const n = state.queuedCount;
    return {
      tone: "attention",
      text: `${n} check-in${plural(n)} couldn't be sent — your session expired. Sign in again to send ${them(n)}.`,
    };
  }
  if (state.attentionCount > 0) {
    const n = state.attentionCount;
    return {
      tone: "attention",
      text: onFw
        ? `${n} saved check-in${plural(n)} need${n === 1 ? "s" : ""} attention. Dismiss ${them(n)} in the banner below.`
        : `${n} saved check-in${plural(n)} need${n === 1 ? "s" : ""} attention. Open Founders Weekend to deal with ${them(n)}.`,
    };
  }
  if (state.queuedCount > 0) {
    const n = state.queuedCount;
    if (!onFw) {
      return {
        tone: "queued",
        text: `${n} check-in${plural(n)} saved on this device. Open Founders Weekend to send ${them(n)}.`,
      };
    }
    return {
      tone: "queued",
      text: state.online
        ? `Sending ${n} check-in${plural(n)}…`
        : `${n} check-in${plural(n)} saved offline. Stay signed in — they send when you're back online.`,
    };
  }
  return null;
}

const plural = (n: number) => (n === 1 ? "" : "s");
const them = (n: number) => (n === 1 ? "it" : "them");

/* ══════════════════════════════════════════════════════════ the two skins ══ */

/**
 * One slot per style the bar paints. Both tables carry all of them, and the test
 * asserts the key sets match — a namespace that quietly lost a slot would render a
 * bar with an undefined class string rather than failing.
 */
export type StaffBarSkin = {
  bar: string;
  label: string;
  link: string;
  email: string;
  signOut: string;
  chipQueued: string;
  chipAttention: string;
  message: string;
};

/**
 * The class-name swap (`docs/solutions/best-practices/tailwind-v4-theme-not-scopable-…`).
 *
 * Tailwind v4's theme is not scopable: `crm-*` and `hq-*` are two token sets sharing
 * ONE utility namespace, so nothing but this literal table keeps a CRM bar from
 * rendering in Path colours. The table is keyed on a narrowed literal so an
 * unhandled application is a compile error, and the test asserts each namespace is
 * exclusive — a leaked `hq-` class in the CRM row is invisible to a type checker and
 * obvious to that assertion.
 *
 * `/staff` currently takes the HQ set, matching the layout Unit 2 shipped. Unit 11
 * decides the hub's final visual language and may move it to the CRM set — which is a
 * one-line change to this table plus one line in the test, by design.
 */
const STAFF_BAR_SKINS: Record<"crm" | "hq", StaffBarSkin> = {
  crm: {
    bar: "border-b border-crm-line bg-crm-card text-crm-ink",
    label: "font-mono text-[11px] tracking-[0.12em] text-crm-muted",
    link: "text-crm-muted hover:text-crm-ink focus-visible:outline-crm-blue",
    email: "font-mono text-[10.5px] text-crm-faint",
    signOut: "text-crm-muted hover:text-crm-red focus-visible:outline-crm-blue",
    chipQueued: "bg-crm-blush text-crm-ink",
    chipAttention: "bg-crm-red text-crm-card",
    message: "text-crm-red",
  },
  hq: {
    bar: "border-b border-hq-border bg-hq-canvas/95 text-hq-ink backdrop-blur",
    label: "font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted",
    link: "text-hq-ink-soft hover:text-hq-ink focus-visible:outline-hq-ink",
    email: "font-path-mono text-[11px] text-hq-ink-muted",
    signOut: "text-hq-ink-soft hover:text-hq-ink focus-visible:outline-hq-ink",
    chipQueued: "bg-hq-surface text-hq-ink-soft",
    chipAttention: "bg-not-yet text-hq-canvas",
    message: "text-not-yet",
  },
};

const APPLICATION_SKINS: Record<StaffBarApplication, "crm" | "hq"> = {
  crm: "crm",
  staff: "hq",
  fw: "hq",
};

export function staffBarSkin(application: StaffBarApplication): StaffBarSkin {
  return STAFF_BAR_SKINS[APPLICATION_SKINS[application]];
}

/* ═══════════════════════════════════ which sign-out refusal copy applies ══ */

/*
 * `staffBarSignOutSurface` USED TO LIVE HERE, and Unit 5 deleted it rather than
 * leaving it unused.
 *
 * It answered "which variant of `fwSignOutRefusalCopy` may this surface show", and
 * exactly one refusal ever varied: `needs_attention`, whose off-`/fp/fw` sentence sent
 * the reader to open Founders Weekend and dismiss a record there. That refusal no
 * longer exists — a quarantined record does not refuse anyone's sign-out (Peter,
 * 2026-07-27; see `countFwSignOutBlockers`) — so every remaining sentence is identical
 * on all three surfaces and the helper had one caller passing a value nothing read.
 *
 * Recorded because the deletion is the visible half of a decision whose reasoning is
 * three files away, and because a reader finding `fwSignOutOutcomeCopy` called with
 * one argument should be able to learn here that the second was removed on purpose.
 */
