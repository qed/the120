import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { FW_CALL_TIMEOUT_MS, fwRead, withFwTimeout } from "@/app/fp/lib/fw-call";
import { IdentityUnavailableError } from "@/app/lib/identity-unavailable";
import { resolveStaffAccess, type SessionRead } from "./access";

/** The signed-in staff identity every CRM page/action works with. */
export type StaffSession = { staffId: string; email: string };

/**
 * Authoritative staff gate (plan Decision 8) — called by every `/crm` server
 * component and action. The proxy's JWT check is only the cheap outer fence;
 * this verifies the session user AND the `staff` row (`is_active`) via the
 * service-role client, so its verdict never depends on RLS policy shape.
 *
 * Unauthenticated → redirect to /crm/login.
 * Non-staff / inactive → redirect to /crm/staff-only (renders as a 404 —
 * rewrite semantics aren't available inside a server component).
 *
 * REQUEST-MEMOIZED with React's `cache()`.
 *
 * NOTE the shape differs from this repo's two existing memoized loaders, and
 * the difference is deliberate rather than an oversight. `loadFwSessionRead`
 * (`fw-auth.ts`) and `loadFamilyContextCached` (`family-loader.ts`) both
 * memoize a NON-throwing loader and leave the redirecting wrapper
 * (`requireFwSession`) uncached. This memoizes the throwing gate itself,
 * matching the DAL example in Next's own authentication guide
 * (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`), because
 * wrapping in place gives all ~40 existing call sites the benefit without
 * touching any of them — where the split would need a new exported loader and
 * a rewrite of every caller for identical savings.
 *
 * Layouts and the pages inside them both gate — deliberately, because Next 16
 * layouts do not re-render on soft navigation, so a page leaning on its layout
 * alone would be gated only on the render that mounted it. That doubles a
 * `getUser()` round trip plus a `staff` PK lookup on every full render, and
 * Staff Front Door Units 3 and 4 mount staff-dependent chrome across three
 * more layouts — four gates deep on venue wifi (plan Unit 2, trap 12).
 *
 * Zero arguments, so the memo key is the empty argument list: one verdict per
 * request, full stop. Memoizing a gate that THROWS is intentional too — the
 * `redirect()` digest is replayed to every later caller in the request, which
 * is the same answer they would have paid a round trip to be told. Nothing in
 * app code writes the `staff` table (only `scripts/seed-staff.ts`, out of
 * request scope), so no mutation can make the memoized verdict stale.
 */
export const requireStaff = cache(async function requireStaff(): Promise<StaffSession> {
  const supabase = await supabaseServer();

  // BOUNDED + throw-guarded (Staff Front Door Unit 5, B5). Neither call here had any
  // timeout or AbortSignal: nothing in the Supabase client sets a fetch timeout and no
  // route configures `maxDuration`, so a stalled round trip held the front door to
  // every staff tool open for the whole serverless budget.
  //
  // Unit 4 made that quantifiably worse rather than theoretically so. `StaffBar` mounts
  // in three guarded layouts and calls `loadStaffBarIdentity` on every fresh mount, in
  // a SEPARATE request that this `cache()` cannot span — so `/staff` and `/crm` now pay
  // an unbounded `getUser()` round trip that never happened on those surfaces before,
  // and `/fp/fw` pays it twice per view.
  let userRaced;
  try {
    userRaced = await withFwTimeout(supabase.auth.getUser(), "staff gate getUser", FW_CALL_TIMEOUT_MS);
  } catch (e) {
    console.error("[crm/auth] getUser threw:", e);
    userRaced = null;
  }
  if (userRaced?.timedOut) {
    // Logged where the timeout is minted; the throw far below is generic (its
    // message is replaced client-side anyway), so this line is what lets on-call
    // grep "timed out" apart from "revoked" — the whole point of B5.
    console.error("[crm/auth] getUser timed out — session unreadable");
  }
  // ONE derivation of "did the read answer", consumed twice — the review found the
  // condition written out twice, which is the two-predicates-that-must-agree shape
  // this repo's Unit 1 exists to kill, one size smaller. A narrowed const rather
  // than a boolean, because a boolean cannot carry the narrowing to the compiler.
  const answered = userRaced !== null && !userRaced.timedOut ? userRaced : null;
  const user = answered === null ? null : answered.value.data.user;
  const sessionRead: SessionRead =
    answered === null ? "unreadable" : user ? { user: { app_metadata: user.app_metadata } } : null;

  // One indexed PK lookup; skipped entirely when there's no readable session.
  // Through `fwRead`, the repo's single definition of "bounded and guarded against a
  // throw" for a Supabase read — the FW prefix names where it lives, not who may use
  // it, and a second hand-rolled race here would be the drift that helper exists to
  // prevent.
  const staffQuery = user
    ? await fwRead(
        () =>
          supabaseAdmin()
            .from("staff")
            .select("id, email, is_active")
            .eq("id", user.id)
            .maybeSingle(),
        `staff row for ${user.id}`
      )
    : null;

  // A failed query and a genuinely absent row USED TO both arrive here as null and
  // both fail closed to `forbidden` → a 404, so an active staff member hitting a
  // transient fault was told their account does not exist. They are now distinct:
  // `"unreadable"` reaches `unavailable` and a retryable boundary. Still logged, so
  // on-call can tell revocation apart from a blip.
  if (staffQuery?.error) {
    console.error(
      `[crm/auth] staff row lookup failed for ${user!.id}: ${staffQuery.error.message}`
    );
  }
  // Carries `email` — which `resolveStaffAccess` does not need but this function's
  // OWN return does. The non-null branch is structurally assignable to
  // `StaffRowLike`, so the pure decision table takes it as-is and the final return
  // reads `.email` off a value the compiler has actually narrowed, instead of the
  // `as { email: string }` cast the first draft smuggled in (typescript review).
  type StaffRowRead = { id: string; email: string; is_active: boolean } | null | "unreadable";
  const staffRow: StaffRowRead = staffQuery === null
    ? null
    : staffQuery.error
      ? "unreadable"
      : staffQuery.data;

  const verdict = resolveStaffAccess({ session: sessionRead, staffRow });

  if (verdict === "login") redirect("/crm/login");
  if (verdict === "forbidden") {
    // The genuine refusal is logged so it is distinguishable FROM LOGS ALONE from
    // the unavailable throw below — B5's stated purpose, previously true only in
    // which page the user happened to see (agent-native review). Server-side only.
    console.error(
      `[crm/auth] staff gate refused${user ? ` ${user.id}` : ""}: ` +
        (user === null ? "no admin claim path" : staffRow === null ? "no staff row" : "row inactive or claim absent")
    );
    redirect("/crm/staff-only");
  }
  // THROWS rather than redirecting, and the difference is the whole of B5. A redirect
  // is an answer about the account; this is the admission that there was no answer.
  // The nearest `error.tsx` catches it and offers a retry — which is the only control
  // that can succeed here — while rendering none of the guarded subtree.
  //
  // ⚠️ WHERE IT IS CAUGHT IS NOT UNIFORM, and the boundaries were placed knowing it.
  // Next's `error.js` wraps a segment's children but NOT the `layout.js` in its own
  // segment. `app/crm/(app)/layout.tsx` gates, and `app/crm/error.tsx` sits a segment
  // ABOVE it, so that one is caught locally. `app/staff/layout.tsx` gates in the same
  // segment as `app/staff/error.tsx`, so ITS throw bubbles past it to the root
  // `app/error.tsx`. Both render a retry; only the amount of surrounding chrome
  // differs. Verified against
  // node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md.
  if (verdict === "unavailable") {
    throw new IdentityUnavailableError("requireStaff", "session or staff row unreadable");
  }

  // `verdict === "ok"` implies all three below by `resolveStaffAccess`'s table; the
  // guard makes the compiler prove it rather than an `!` asserting it, and if a
  // future edit to the table breaks the implication this throws the retryable error
  // rather than rendering with a hole (typescript review).
  if (user === null || staffRow === null || staffRow === "unreadable") {
    throw new IdentityUnavailableError("requireStaff", "ok verdict without a resolved user or staff row");
  }
  return { staffId: user.id, email: staffRow.email };
});
