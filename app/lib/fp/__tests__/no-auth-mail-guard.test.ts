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
const MAIL_CAPABLE =
  /\b(resetPasswordForEmail|inviteUserByEmail|generateLink|signInWithOtp|reauthenticate|signUp)\s*\(/;

/** Any of the guard's entry points satisfies the scan. */
const GUARD_CALL = /\b(assertNoAuthMailToFwStudent|assertAuthMailAllowed|authMailVerdict)\s*\(/;

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
const REVIEWED_CALL_SITES: readonly {
  file: string;
  why: string;
  /** The property that keeps this exemption honest. If it stops holding,
   *  the reason above no longer describes the code and the entry must be
   *  re-justified or removed. */
  mustContain: RegExp;
}[] = [
  // The two client-side reset forms are GONE from this list (funnel U15 /
  // W12). They were exempt only because "no server hop exists to guard",
  // and that reason expired when they moved behind Server Actions.
  {
    file: "app/lib/auth/actions/reset.ts",
    why:
      "the Supabase call lives in this file's DEPS CLOSURE, not on the request path: " +
      "requestPasswordReset (app/lib/auth/reset-core.ts) runs the recipient through " +
      "authMailVerdict and returns before deps.sendReset is ever invoked. The ordering " +
      "is pinned mechanically by 'the reset core runs every recipient through the guard " +
      "before Supabase' below, and by the deps-injected tests in " +
      "app/lib/__tests__/auth-mail-guard.test.ts which prove a refused address reaches " +
      "no mailer.",
    mustContain: /requestPasswordReset\s*\(/,
  },
  {
    file: "app/components/account/AccountModal.tsx",
    why:
      "public parent signup. `signUp` joined MAIL_CAPABLE in U15 after review found this " +
      "door open: typing a student's address here made Supabase mail a confirmation into " +
      "a child's inbox. The form now refuses the school domain using authMailVerdict — " +
      "the SAME verdict function the server-side guard uses, so the two cannot drift. " +
      "RESIDUAL, stated plainly: this is a browser-side call with the public anon key, so " +
      "a crafted request straight to Supabase still bypasses it. No app-side code can " +
      "close that; it needs a project-level Supabase auth hook or an email-domain deny " +
      "list, which pairs with the standing 'no catch-all is armed' ops invariant. Moving " +
      "signup server-side would NOT close it either — the anon key is public by design.",
    mustContain: /authMailVerdict\s*\(/,
  },
];

/**
 * A SECOND enforcement lane (security review, Unit 5b): admin email CHANGES.
 *
 * `admin.updateUserById(id, { email })` does not SEND mail the way the
 * `MAIL_CAPABLE` calls above do (GoTrue's admin API writes the field directly),
 * so it is deliberately NOT in that set — routing it through
 * `assertNoAuthMailToFwStudent` is impossible anyway, because that guard THROWS
 * on an FW address by design and the anonymize rename's target is exactly such
 * an address (`removed-<id>.fw@`). But an email change is still the one admin
 * operation that COULD reach a minor's namespace if GoTrue's behaviour ever
 * changes or a refactor swaps in the self-service `updateUser()`. This lane
 * forces every such call onto a reviewed allowlist — a deliberate security
 * decision per call site, not an accident nobody sees.
 */
const ADMIN_EMAIL_CHANGE = /updateUserById\s*\([^)]*\bemail\b/;

const REVIEWED_EMAIL_CHANGE_SITES: readonly { file: string; why: string }[] = [
  {
    file: "app/lib/fp/fw-ops-core.ts",
    why:
      "anonymize rename (Decision 10): admin updateUserById sets the email directly " +
      "to the tombstone removed-<id>.fw@ address with email_confirm:true, so no " +
      "confirmation/change mail is enqueued; the target stays inside the guarded " +
      "namespace. Cannot route through assertNoAuthMailToFwStudent — that guard " +
      "throws on FW addresses by design.",
  },
  {
    file: "app/lib/funnel/provision-deps.ts",
    why:
      "funnel provisioning collision realign (wrap U6): after a Workspace 409 forces " +
      "the child onto the next candidate address, the child's own dormant Supabase " +
      "identity is realigned to that new bare student address with email_confirm:true " +
      "— no confirmation/change mail is enqueued, and the target is by construction " +
      "the address the DB claim just arbitrated for this same child. Cannot route " +
      "through the default-deny guard: student addresses are exactly what it refuses. " +
      "VERIFIED EMPIRICALLY 2026-07-29 against the live project (secure email change " +
      "ENABLED): admin updateUserById applied the change directly — new_email null, " +
      "email_change_sent_at null — probe user created and deleted the same minute.",
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

/**
 * Drop comment-ONLY lines before scanning. A doc comment that merely names
 * `signUp()` is not a call site, and flagging it would push a real file
 * onto the reviewed allowlist for no reason — which is how an allowlist
 * stops meaning anything.
 *
 * Deliberately conservative: only lines whose first non-space character
 * starts a comment are removed. Stripping `//` anywhere would eat the tail
 * of any line holding a URL, and could hide a real call sharing that line.
 */
function withoutCommentLines(source: string): string {
  return source
    .split(/\r?\n/)
    .filter((line) => {
      const t = line.trimStart();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
}

describe("no-auth-mail invariant — enforcement, not intention", () => {
  const files = walk(APP_DIR);

  it("every mail-capable Supabase Auth call in app/ is either guarded or on the reviewed list", () => {
    const reviewed = new Set(REVIEWED_CALL_SITES.map((s) => s.file));
    const unreviewed: string[] = [];

    for (const full of files) {
      const source = withoutCommentLines(readFileSync(full, "utf8"));
      if (!MAIL_CAPABLE.test(source)) continue;
      const rel = relative(full);
      if (reviewed.has(rel)) continue;
      // A new call site is fine — as long as it passes the recipient through
      // a guard in the same file. Either name counts: the FW fast path or
      // the domain-wide default-deny it delegates to (W12).
      if (GUARD_CALL.test(source)) continue;
      unreviewed.push(rel);
    }

    expect(
      unreviewed,
      `These files send Supabase Auth mail without routing the recipient through the ` +
        `auth-mail guard (assertAuthMailAllowed / authMailVerdict / assertNoAuthMailToFwStudent). ` +
        `Route it through the guard, or add the file to REVIEWED_CALL_SITES with a reason. ` +
        `Student addresses are bare first.last@the120.school — guessable, and they belong to children.`
    ).toEqual([]);
  });

  it("every admin email CHANGE (updateUserById with email) is on the reviewed allowlist", () => {
    const reviewed = new Set(REVIEWED_EMAIL_CHANGE_SITES.map((s) => s.file));
    const unreviewed: string[] = [];
    for (const full of files) {
      const source = readFileSync(full, "utf8");
      if (!ADMIN_EMAIL_CHANGE.test(source)) continue;
      const rel = relative(full);
      if (!reviewed.has(rel)) unreviewed.push(rel);
    }
    expect(
      unreviewed,
      `These files change an auth account's email via admin.updateUserById. That is ` +
        `the one admin op that could reach a minor's FW namespace. Add each to ` +
        `REVIEWED_EMAIL_CHANGE_SITES with the reason it is safe (e.g. email_confirm:true, ` +
        `target inside the .fw@ namespace, no self-service updateUser()).`
    ).toEqual([]);
  });

  it("the reviewed anonymize rename still passes email_confirm: true (no confirmation mail)", () => {
    // The specific safeguard the review lane exists to protect: if a refactor
    // ever drops email_confirm, GoTrue could enqueue a change-confirmation to the
    // FW namespace. Pin it to the actual call.
    const source = readFileSync(path.resolve(process.cwd(), "app/lib/fp/fw-ops-core.ts"), "utf8");
    expect(ADMIN_EMAIL_CHANGE.test(source), "fw-ops-core no longer changes an email").toBe(true);
    // Same safeguard for the funnel realign site (wrap U6): the email
    // change must carry email_confirm:true or GoTrue could enqueue a
    // change-confirmation to a bare student address.
    const funnel = readFileSync(
      path.resolve(process.cwd(), "app/lib/funnel/provision-deps.ts"),
      "utf8"
    );
    expect(funnel).toMatch(/updateUserById\([\s\S]{0,120}email_confirm: true/);
    expect(source).toMatch(/updateUserById\([^)]*email:[^)]*email_confirm:\s*true/);
  });

  it("the reviewed call sites still exist and still hold the property their reason rests on", () => {
    // An exemption is only as good as the fact it cites. If that fact stops
    // being true, this fails and the entry has to be re-justified or removed.
    for (const site of REVIEWED_CALL_SITES) {
      const source = readFileSync(path.resolve(process.cwd(), site.file), "utf8");
      expect(MAIL_CAPABLE.test(source), `${site.file} no longer sends auth mail`).toBe(true);
      expect(
        site.mustContain.test(source),
        `${site.file} no longer matches ${site.mustContain} — the reason recorded in ` +
          `REVIEWED_CALL_SITES ("${site.why}") no longer describes this file. Re-justify it or ` +
          `route the recipient through the auth-mail guard directly.`
      ).toBe(true);
    }
  });

  it("W12: NEITHER reset form calls Supabase auth mail from the browser any more", () => {
    // The regression this unit exists to prevent: putting either form back
    // on supabaseBrowser().auth.resetPasswordForEmail re-opens a path that
    // can mail a child, and no server-side guard can see it.
    for (const file of ["app/dashboard/SignIn.tsx", "app/crm/login/LoginForm.tsx"]) {
      const source = readFileSync(path.resolve(process.cwd(), file), "utf8");
      expect(source, `${file} still calls a mail-capable Supabase Auth method client-side`).not.toMatch(
        MAIL_CAPABLE
      );
      expect(source, `${file} should call the reset Server Action`).toMatch(
        /request(Parent|Staff)PasswordResetAction\s*\(/
      );
    }
  });

  it("W12: the reset core runs every recipient through the guard before Supabase", () => {
    const core = readFileSync(path.resolve(process.cwd(), "app/lib/auth/reset-core.ts"), "utf8");
    const guardIdx = core.indexOf("authMailVerdict(");
    const sendIdx = core.indexOf("deps.sendReset(");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(guardIdx);
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
