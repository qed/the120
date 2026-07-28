import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The FW form-submit catch blocks' one wiring property no behavioural test can
 * reach (`environment: "node"`, no jsdom — the StaffBar suite's posture, see
 * app/lib/staff-bar/__tests__/bar-wiring.test.ts).
 *
 * Every FW Server-Action form ends its success path in `redirect()`, which Next
 * implements by THROWING a digest — so on the HAPPY path the action's promise
 * REJECTS and lands in the form's catch. A catch that reports before checking
 * `isNextRedirect(e)` paints every successful submit as a failure ("Something
 * went wrong") over a student that was just created or a guide that was just
 * signed in — latent only because the navigation usually paints first. The
 * StaffBar sign-out carried exactly this bug until Unit 4; these forms must not
 * reintroduce it.
 *
 * So the scan asserts ORDER, not presence: within each catch block, the
 * `isNextRedirect(e)` early-return must come BEFORE the first error-reporting
 * call. Comment-stripped first — these files' comments name `isNextRedirect`
 * and NEXT_REDIRECT by design, and a scan a comment can satisfy protects
 * nothing (the bar-wiring lesson). Paths resolve relative to THIS FILE, never
 * `process.cwd()` — a scan that reads no file is worse than no scan, because
 * it passes.
 */

const dir = fileURLToPath(new URL(".", import.meta.url));
const read = (relative: string) => readFileSync(new URL(relative, `file://${dir}`), "utf8");

const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** Each FW form whose submit handler catches a Server Action rejection, with
 *  its path from this file and the anchor its submit handler declares. */
const FORMS = [
  {
    name: "FwQuickCreate",
    relative: "../../fw/components/FwQuickCreate.tsx",
    handlerAnchor: "const handleSubmit",
  },
  {
    name: "FwSignInForm",
    relative: "../../fw/(auth)/sign-in/FwSignInForm.tsx",
    handlerAnchor: "const handleSubmit",
  },
  {
    name: "ClaimGuideInviteForm",
    relative: "../../fw/(auth)/invite/[token]/ClaimGuideInviteForm.tsx",
    handlerAnchor: "const handleSubmit",
  },
] as const;

describe("a late-resolving quick-create never lands state on a dead component", () => {
  it("FwQuickCreate: both failure arms of handleSubmit sit behind the mounted-ref guard", () => {
    // Todo 001: the form can be DISMISSED while the submit await is pending
    // (Cancel, or the roster's New-student toggle), and the action resolves
    // only on failure — success redirects. So every post-await state write in
    // the handler must be mounted-guarded, the same discipline runLookup
    // already holds. Pinned structurally (guard exists, and it comes before
    // the report), not by spelling of the surrounding code; the recovery
    // itself is covered by fwUnfinishedStudents' behavioural tests.
    const code = stripComments(read("../../fw/components/FwQuickCreate.tsx"));
    const handlerAt = code.indexOf("const handleSubmit");
    expect(handlerAt, "FwQuickCreate declares its submit handler").toBeGreaterThanOrEqual(0);
    const handler = code.slice(handlerAt);

    const guardRe = /if\s*\(\s*!mounted\.current\s*\)\s*return\b/g;
    const guards = handler.match(guardRe) ?? [];
    expect(guards.length, "one guard per failure arm (resolved refusal + rejection)")
      .toBeGreaterThanOrEqual(2);

    // The resolved-refusal arm: the guard precedes the failure report.
    const firstGuard = handler.search(/if\s*\(\s*!mounted\.current\s*\)\s*return\b/);
    const refusalReport = handler.search(/setError\(failureMessage/);
    expect(refusalReport, "the refusal arm reports at all").toBeGreaterThanOrEqual(0);
    expect(refusalReport, "the refusal report comes after a mounted guard").toBeGreaterThan(
      firstGuard
    );

    // The rejection arm: redirect guard first (the success path), THEN the
    // mounted guard, THEN the report.
    const catchAt = handler.indexOf("} catch (e) {");
    expect(catchAt, "handleSubmit catches the action rejection").toBeGreaterThanOrEqual(0);
    const catchBlock = handler.slice(catchAt);
    const redirectGuard = catchBlock.search(/if\s*\(\s*isNextRedirect\(e\)\s*\)\s*return\b/);
    const mountedGuard = catchBlock.search(/if\s*\(\s*!mounted\.current\s*\)\s*return\b/);
    const catchReport = catchBlock.search(/setError\(/);
    expect(redirectGuard, "the redirect digest is guarded first").toBeGreaterThanOrEqual(0);
    expect(mountedGuard, "the mounted guard follows the redirect guard").toBeGreaterThan(
      redirectGuard
    );
    expect(catchReport, "the report comes last").toBeGreaterThan(mountedGuard);
  });
});

describe("the Server Action redirect is not painted as a failure", () => {
  for (const form of FORMS) {
    it(`${form.name}: checks isNextRedirect and returns before reporting any failure`, () => {
      const code = stripComments(read(form.relative));

      // Anchor on the submit handler's OWN catch — FwQuickCreate has an earlier
      // bare `catch {` in its lookup path that must not satisfy this scan.
      const handlerAt = code.indexOf(form.handlerAnchor);
      expect(handlerAt, `${form.name} declares its submit handler`).toBeGreaterThanOrEqual(0);
      const catchAt = code.indexOf("} catch (e) {", handlerAt);
      expect(catchAt, `${form.name} catches the action rejection`).toBeGreaterThanOrEqual(0);
      const catchBlock = code.slice(catchAt);

      // Whitespace-tolerant on the early return, but the GUARD and the RETURN
      // must be one statement — `if (…) {} return;` unconditionally swallowing
      // would also match a bare `return` scan, so pin the pair.
      const guard = catchBlock.search(/if\s*\(\s*isNextRedirect\(e\)\s*\)\s*return\b/);
      const report = catchBlock.search(/set(Error|Message)\(/);
      expect(guard, `${form.name} guards the redirect digest`).toBeGreaterThanOrEqual(0);
      expect(report, `${form.name} reports failures at all`).toBeGreaterThanOrEqual(0);
      expect(report, `${form.name}: the redirect check comes FIRST`).toBeGreaterThan(guard);
    });
  }
});
