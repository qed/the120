import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { assertNoAuthMailToFwStudent, isFwStudentAddress } from "../fw-provision-rules";

/**
 * The no-auth-mail invariant, made mechanical.
 *
 * FW student addresses are name-derived on a REAL, deliverable domain
 * (`maya.chen.fw@the120.school`) because FW-D2 makes the address a future
 * contact channel for the family. That makes them guessable, and it makes any
 * Supabase Auth call that mails a recipient a way to put mail in a minor's
 * inbox — or, if the recipient can read it, to reset a password-less account
 * and sign in as that child.
 *
 * `assertNoAuthMailToFwStudent` is the server-side guard. On its own it proves
 * nothing: a guard with no callers is well-tested dead code, and that is exactly
 * what it was when this test was written. This file is the enforcement half.
 * It fails when a NEW mail-capable call appears anywhere in `app/` that is not
 * on the reviewed allowlist below — so the next person to add one has to either
 * route it through the guard or consciously record why they did not.
 *
 * It also pins the gap the guard structurally cannot close, so nobody reads the
 * plan's "mechanism-enforced" language as more than it is.
 */

const APP_DIR = path.resolve(process.cwd(), "app");

/** Supabase Auth surfaces that cause an email to be sent to a recipient. */
const MAIL_CAPABLE = /\b(resetPasswordForEmail|inviteUserByEmail|generateLink|signInWithOtp|reauthenticate)\s*\(/;

/**
 * Reviewed call sites, with the reason each is not routed through the guard.
 *
 * ⚠️ Adding a line here is a security decision, not a formality. The two entries
 * below are CLIENT-SIDE: they call Supabase from the browser with the public
 * anon key, so no server-side function is in the request path and no TypeScript
 * guard can intercept them. They are currently inert only because
 * `*.fw@the120.school` has no catch-all — mail addressed there bounces into
 * nothing. Arming that catch-all (which FW-D2 contemplates) makes them live, and
 * closing them then requires a Server Action or a project-level Supabase Auth
 * send-email hook. Tracked in the plan's Operational Notes.
 */
const REVIEWED_CALL_SITES: readonly { file: string; why: string }[] = [
  {
    file: "app/dashboard/SignIn.tsx",
    why: "client-side parent password reset; browser→Supabase, no server hop exists to guard",
  },
  {
    file: "app/crm/login/LoginForm.tsx",
    why: "client-side staff password reset; browser→Supabase, no server hop exists to guard",
  },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry) && !/__tests__/.test(full)) out.push(full);
  }
  return out;
}

/** Repo-relative, forward-slashed, so assertions read the same on any OS. */
function relative(full: string): string {
  return path.relative(process.cwd(), full).split(path.sep).join("/");
}

describe("no-auth-mail invariant — enforcement, not intention", () => {
  const files = walk(APP_DIR);

  it("every mail-capable Supabase Auth call in app/ is either guarded or on the reviewed list", () => {
    const reviewed = new Set(REVIEWED_CALL_SITES.map((s) => s.file));
    const unreviewed: string[] = [];

    for (const full of files) {
      const source = readFileSync(full, "utf8");
      if (!MAIL_CAPABLE.test(source)) continue;
      const rel = relative(full);
      if (reviewed.has(rel)) continue;
      // A new call site is fine — as long as it passes the recipient through
      // the guard in the same file.
      if (source.includes("assertNoAuthMailToFwStudent")) continue;
      unreviewed.push(rel);
    }

    expect(
      unreviewed,
      `These files send Supabase Auth mail without calling assertNoAuthMailToFwStudent. ` +
        `Route the recipient through the guard, or add the file to REVIEWED_CALL_SITES with a reason. ` +
        `FW addresses are guessable and belong to children.`
    ).toEqual([]);
  });

  it("the reviewed call sites still exist and still look the way the review assumed", () => {
    // If one of these is deleted or refactored server-side, this test fails and
    // the allowlist entry — which exists only because the call is unreachable
    // from server code — has to be re-justified or removed.
    for (const site of REVIEWED_CALL_SITES) {
      const source = readFileSync(path.resolve(process.cwd(), site.file), "utf8");
      expect(MAIL_CAPABLE.test(source), `${site.file} no longer sends auth mail`).toBe(true);
      expect(
        source.includes("supabaseBrowser("),
        `${site.file} no longer calls Supabase from the browser — it may now be guardable server-side, ` +
          `so remove it from REVIEWED_CALL_SITES and route the recipient through assertNoAuthMailToFwStudent`
      ).toBe(true);
    }
  });

  it("no server-side code sends mail to an address it built with the FW email builder", () => {
    // The inverse direction: a file that imports the FW address builder AND
    // sends mail is the shape that puts a real child's address into a mailer.
    const offenders = files.filter((full) => {
      const source = readFileSync(full, "utf8");
      return (
        MAIL_CAPABLE.test(source) &&
        /fwEmailForLocalPart|buildFwLocalBase|pickFwLocalPart|buildFwTombstoneEmail/.test(source) &&
        !source.includes("assertNoAuthMailToFwStudent")
      );
    });
    expect(offenders.map(relative)).toEqual([]);
  });

  it("the guard refuses every FW-namespace address shape it must", () => {
    for (const address of [
      "maya.chen.fw@the120.school",
      "maya.chen2.fw@the120.school",
      "MAYA.CHEN.FW@THE120.SCHOOL",
      "removed-3f2504e0-4f89-11d3-9a0c-0305e82c3301.fw@the120.school",
    ]) {
      expect(isFwStudentAddress(address), address).toBe(true);
      expect(() => assertNoAuthMailToFwStudent(address, "test"), address).toThrow();
    }
  });

  it("the guard refuses a blank recipient — 'no address' must not read as 'safe to send'", () => {
    // provisionFwStudent's resume path once returned email: "" on success; a
    // caller passing that through would have sailed past a namespace-only check.
    expect(() => assertNoAuthMailToFwStudent("", "test")).toThrow(/blank recipient/);
    expect(() => assertNoAuthMailToFwStudent("   ", "test")).toThrow(/blank recipient/);
  });

  it("the guard does not block legitimate recipients", () => {
    for (const address of ["parent@gmail.com", "peter@the120.school", "staff@the120.school"]) {
      expect(() => assertNoAuthMailToFwStudent(address, "test"), address).not.toThrow();
    }
  });
});
