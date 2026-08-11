import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * THE ONE LIST OF THE DASHBOARD'S CLIENT SURFACES.
 *
 * Seven test files used to hand-build their own concatenation of "every client
 * surface of the dashboard" and then re-derive an invariant over it (no em
 * dash, no payment/deposit strings, no client-side funnel emit, no register
 * skins, no fabricated policy acceptance). Seven hand-lists means seven places
 * to remember on the day a route is added — and the failure is SILENT, because
 * a sweep over the files that ARE listed still passes. That already happened
 * once: `KidAccount.tsx` was carved out of `KidPortal.tsx` and went un-swept
 * for a review cycle (see the comment it left behind in
 * funnel-dashboard-cards.test.ts).
 *
 * So the list lives here once, and `dashboard-surface-registry.test.ts`
 * (app/dashboard/__tests__/) globs the tree and reddens if a client surface
 * exists on disk that this file does not name. The remembering is taken out —
 * the same move `vitest-include-coverage.test.ts` makes for test-file globs.
 *
 * ── DEFINITION ────────────────────────────────────────────────────────────
 * A "dashboard client surface" is a `.ts`/`.tsx` file under `app/dashboard`,
 * outside `__tests__`, whose source OPENS with the `"use client"` directive.
 * That is the precise thing the registry test globs for. `.ts` is swept as
 * well as `.tsx` deliberately: nothing stops a client module from being a
 * plain `.ts`, and a definition with that hole would be a tripwire with a hole.
 * Server pages (`page.tsx`, `layout.tsx`) and pure modules (`data.ts`,
 * `wizard-rules.ts`) are NOT surfaces; tests that pin those read them by name.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** `app/lib/__tests__/helpers` → the repo root. */
export const REPO_ROOT = path.resolve(HERE, "../../../..");

/** The shared file reader every consumer used to redeclare. */
export const readRepoFile = (rel: string): string =>
  readFileSync(path.resolve(REPO_ROOT, rel), "utf8");

/**
 * Every client surface, by name. Named keys rather than a bare array so a
 * consumer that legitimately pins ONE file (apps-launcher-pins) can spell it
 * from the same source of truth instead of retyping a path that a route move
 * would silently break.
 */
export const SURFACE = {
  parentDashboard: "app/dashboard/ParentDashboard.tsx",
  firstProfitCard: "app/dashboard/FirstProfitCard.tsx",
  kidPortal: "app/dashboard/kids/[id]/KidPortal.tsx",
  kidRouteShell: "app/dashboard/kids/[id]/KidRouteShell.tsx",
  kidAccount: "app/dashboard/kids/[id]/account/KidAccount.tsx",
  kidCredentials: "app/dashboard/KidCredentials.tsx",
  kidSite: "app/dashboard/KidSite.tsx",
  signIn: "app/dashboard/SignIn.tsx",
  store: "app/dashboard/store.tsx",
  ui: "app/dashboard/ui.tsx",
} as const;

/** THE CANONICAL LIST. The registry test keeps it equal to what is on disk. */
export const DASHBOARD_CLIENT_SURFACES: readonly string[] = Object.values(SURFACE);

/**
 * Client surfaces the copy/payment/telemetry sweeps do NOT cover.
 *
 * ⚠ THIS SET EXISTS TO RECORD THE STATUS QUO HONESTLY, NOT TO BLESS IT.
 * Before this module, the seven consumers each swept exactly five files; these
 * five were simply never in any of those hand-lists. Consolidation preserved
 * the scope byte-for-byte rather than widening it, because widening a sweep
 * turns a latent violation into a red build — a real finding, but one that
 * belongs in its own change where it can be read, not buried in a refactor.
 *
 * Each entry needs a reason. Deleting an entry is the deliberate widening.
 *
 *  - kidCredentials / kidSite: the per-kid PARENT controls, mounted by
 *    KidAccount. They are arguably part of the swept surface and the omission
 *    looks incidental rather than principled — flagged for a follow-up that can
 *    own whatever it turns red.
 *  - signIn: the signed-OUT surface. It is not a dashboard view a signed-in
 *    parent ever sees, and it legitimately talks about accounts and resets.
 *  - store: the Supabase data layer, not a rendering surface. It names tables
 *    and columns (including payment-adjacent ones), so string sweeps written
 *    for rendered copy do not mean the same thing here. Tests that care about
 *    the store read it by name (`SURFACE.store`).
 *  - ui: the shared chrome. Pinned by name where it matters (the ONE
 *    ACCOUNT_MENU definition), not swept as a kid/parent content surface.
 */
export const SWEEP_EXEMPT: readonly string[] = [
  SURFACE.kidCredentials,
  SURFACE.kidSite,
  SURFACE.signIn,
  SURFACE.store,
  SURFACE.ui,
];

/**
 * THE SWEEP SET: every client surface that is not explicitly exempt.
 *
 * Derived by SUBTRACTION, which is the whole point — a client surface added
 * tomorrow lands in the sweeps automatically (and loudly, if it violates one),
 * instead of quietly sitting outside every invariant until someone notices.
 */
export const DASHBOARD_SWEEP_SURFACES: readonly string[] =
  DASHBOARD_CLIENT_SURFACES.filter((f) => !SWEEP_EXEMPT.includes(f));

/**
 * The sweep set MINUS the parent's kid list.
 *
 * Narrower on purpose: funnel-live-surface-pins asserts the chrome of the
 * PER-KID apps launcher (`AppHeader`, `max-w-5xl`, the three app rows). Those
 * are positive pins about what a kid's page renders, and `/dashboard` — a white
 * directory of kid cards — is a different screen that renders none of them.
 * Including it would not strengthen the pin, it would change what the pin means.
 */
export const PER_KID_SWEEP_SURFACES: readonly string[] =
  DASHBOARD_SWEEP_SURFACES.filter((f) => f !== SURFACE.parentDashboard);

/**
 * Concatenate a surface list into one blob, in list order.
 *
 * Joined with no separator, exactly as the hand-rolled `read(a) + read(b) + …`
 * expressions it replaces did — every consumer asserts with
 * `toContain`/`not.toContain` or a global regex, so this is byte-identical
 * input, not merely equivalent input.
 */
export const readSurfaces = (list: readonly string[]): string =>
  list.map(readRepoFile).join("");
