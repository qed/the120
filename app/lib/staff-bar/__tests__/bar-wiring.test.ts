import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The properties of the WIRING that no behavioural test in this repo can reach.
 *
 * `environment: "node"` with no jsdom means components cannot be rendered, so a few
 * requirements are properties OF a file rather than of the pure rules it composes —
 * R23's unconditional sign-out, the settled decision that no role-derived value
 * arrives as a server prop, and the invariant that exactly one module reconciles the
 * device's cache owner. A property with no assertion survives exactly until someone
 * refactors past it, so they are asserted where they live: in the source.
 *
 * ── Two lessons from this unit's own review are baked into how these are written ──
 *
 * 1. **Anchor on semantics, not on a spelling you happened to choose.** The first
 *    draft's R23 check rejected the literals `identity &&` and `identity ?`, and a
 *    reviewer walked straight through it with `{Boolean(identity) && <button …>}` — a
 *    real R23 regression. These now use whitespace-tolerant patterns over the whole
 *    identifier, not two anticipated spellings.
 * 2. **Do not pin formatting.** The first draft asserted an exact single-line call
 *    including argument spacing, which reddened on a no-op reformat. A source scan
 *    that cries wolf gets deleted, and then it protects nothing.
 *
 * Resolved relative to THIS FILE, never `process.cwd()` — the working directory is a
 * property of how the runner was invoked, and a scan that reads the wrong file (or no
 * file) is worse than no scan, because it passes.
 */

const dir = fileURLToPath(new URL(".", import.meta.url));
const read = (relative: string) => readFileSync(new URL(relative, `file://${dir}`), "utf8");

const SOURCE = read("../StaffBar.tsx");

/**
 * The source with comments removed.
 *
 * A scan over raw source cannot tell a comment from a call, and these files are
 * heavily commented BY DESIGN — including comments that name the very identifiers
 * being scanned for, because they explain why the code does what it does. The first
 * draft of the reconcile-outcome assertion below matched the string `clear_failed`
 * inside the comment explaining `clear_failed`, so a mutation that deleted the actual
 * branch passed. (`fp-rename-straggler.test.ts` has the same shape: fix the scan,
 * never the comment.) Any assertion about what the CODE does uses this.
 */
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** The component's props block — everything the SERVER is allowed to hand it. */
const PROPS_BLOCK = CODE.slice(
  CODE.indexOf("export function StaffBar("),
  CODE.indexOf("const [live, setLive]")
);

describe("StaffBar receives nothing role-derived from the server", () => {
  it("takes exactly two props: the application and an opaque actor id", () => {
    expect(PROPS_BLOCK).toMatch(/application:\s*StaffBarApplication/);
    expect(PROPS_BLOCK).toMatch(/actorUserId:\s*string/);
  });

  it("never takes the email, staff-ness, or guide-ness as a prop", () => {
    // `/fp/fw` navigations are cached into `path-sw-fw-shell-v1`, and props passed to
    // a client component are serialized into that cached payload. A bar whose email
    // or role arrived as a prop would leave a cached shell that DIFFERS between a
    // staff and a non-staff visit — handing the next holder of a shared iPad the
    // previous operator's address and role. Identity comes over a Server Action
    // (a POST, never in that cache) instead.
    for (const forbidden of ["email", "isStaff", "isFwGuide", "identity"]) {
      expect(PROPS_BLOCK, forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\s*:`));
    }
  });

  it("resolves identity through the Server Action, not through props", () => {
    expect(CODE).toContain("loadStaffBarIdentity()");
  });
});

describe("R23 — the sign-out control renders unconditionally", () => {
  /** From the identity string (the last thing before it) to the button's own tag. */
  const beforeButton = CODE.slice(
    CODE.indexOf("<span className={skin.email}>"),
    CODE.indexOf("onClick={() => void onSignOut()}")
  );

  it("is not gated on identity by ANY conditional shape", () => {
    // R16 retires the per-subtree sign-outs that today work independently of the
    // identity read (Unit 4 does the retiring). Once they are gone, a gate here would
    // strand a staff member on a page with no way out whenever that read is slow or
    // fails — strictly worse than the three disagreeing-but-functional chromes this
    // replaces. Matches `identity` inside any `&&` or ternary, however it is spelled
    // or wrapped, rather than the two spellings the first draft happened to guess.
    expect(beforeButton.length).toBeGreaterThan(0);
    expect(beforeButton).not.toMatch(/identity[\s\S]{0,40}(&&|\?)/);
    expect(beforeButton).not.toMatch(/(&&|\?)[\s\S]{0,40}identity/);
  });

  it("…and neither is it gated on the queue, the probe, or the persisted copy", () => {
    for (const gate of ["queue", "probe", "persisted", "live"]) {
      expect(beforeButton, gate).not.toMatch(new RegExp(`\\b${gate}\\b[\\s\\S]{0,40}(&&|\\?)`));
    }
  });

  it("the hub link IS conditional — it is the affordance that must not be guessed", () => {
    // Whitespace-tolerant: a formatter wrapping this call must not redden the suite.
    expect(CODE).toMatch(/staffBarShowsHubLink\(\s*\{[\s\S]{0,60}?application[\s\S]{0,60}?identity/);
  });
});

describe("the sign-out redirect is not swallowed", () => {
  it("checks isNextRedirect and rethrows before reporting any failure", () => {
    // `signOutStaffBar` ends in `redirect()`, which Next implements by THROWING a
    // digest. `FwSignOutButton` still catches that digest generically and reports a
    // SUCCESSFUL sign-out as "Couldn't sign out just now" — latent there only because
    // the navigation paints first. Unit 4 retires it; this bar must not inherit it.
    const catchBlock = CODE.slice(
      CODE.indexOf("} catch (e) {", CODE.indexOf("const onSignOut"))
    );
    const rethrow = catchBlock.indexOf("if (isNextRedirect(e)) throw e;");
    const report = catchBlock.search(/setMessage\(/);
    expect(rethrow).toBeGreaterThanOrEqual(0);
    expect(report).toBeGreaterThan(rethrow); // the check comes FIRST
  });
});

describe("the bar decides nothing itself", () => {
  it("delegates both FW-device gates to the tested pure functions", () => {
    // Five reviewers independently found these written inline in this unit's first
    // draft, where flipping either left the whole suite green — the previous unit's
    // headline finding, recurring inside the unit meant to apply it. The two are
    // deliberately DIFFERENT functions: sign-out fails closed on an unresolved actor,
    // the queue probe declines to look. Collapsing them back into one expression is
    // what creates a database on an admissions staffer's browser.
    expect(CODE).toContain("staffBarSignOutActorIsFwGuide(live)");
    expect(CODE).toContain("staffBarQueueProbe(live)");
    expect(CODE).toContain("staffBarSurfaceCreatesFwResidue(application)");
  });

  it("never re-derives those gates inline", () => {
    expect(CODE).not.toMatch(/isFwGuide\s*\?\?/);
    expect(CODE).not.toMatch(/application\s*===\s*"fw"/);
  });

  it("passes the LIVE identity to them, never the persisted copy", () => {
    // A cached identity can predate a mid-event guide grant. Feeding it to the
    // evidence gate would let a stale `isFwGuide:false` be trusted as fact.
    expect(CODE).not.toMatch(/staffBarSignOutActorIsFwGuide\(\s*(identity|persisted)/);
    expect(CODE).not.toMatch(/staffBarQueueProbe\(\s*(identity|persisted)/);
  });
});

describe("the reconcile's resolved outcome is not dropped", () => {
  it("inspects the outcome rather than only catching a rejection", () => {
    // `clear_failed` and `queue_preserved` are RESOLVED values. A bare `.catch()`
    // drops exactly the outcomes B2 added them to surface — and this is the automatic
    // path, which runs far more often than the sign-out button.
    const effect = CODE.slice(CODE.indexOf("void reconcileFwCacheOwner("));
    const then = effect.indexOf(".then(");
    const catchIdx = effect.indexOf(".catch(");
    expect(then).toBeGreaterThanOrEqual(0);
    expect(then).toBeLessThan(catchIdx);
    // The BRANCH, not the word: `outcome.kind` cannot appear in a comment-stripped
    // slice unless the code genuinely inspects the resolved value.
    const body = effect.slice(then, catchIdx);
    expect(body).toMatch(/outcome\.kind[\s\S]{0,60}clear_failed/);
    expect(body).toContain("setMessage(");
  });
});

describe("the bar takes no lock of its own", () => {
  it("never touches navigator.locks — Web Locks are not reentrant, and re-entry HANGS", () => {
    // `runFwSignOut` and `reconcileFwCacheOwner` each acquire `fw-offline-drain`
    // exactly once, internally. A second acquisition here would not error: it would
    // hang sign-out forever on a shared iPad at a live event.
    //
    // Scans for the ACQUISITION, not the lock's name: this file's own docblock names
    // `fw-offline-drain` while explaining why it must not take it, and a scan over raw
    // source cannot tell a comment from a call. (The same shape reddens
    // `fp-rename-straggler.test.ts` — fix the scan, never the comment.)
    expect(SOURCE).not.toContain("navigator.locks");
    expect(SOURCE).not.toContain("locks.request");
  });
});

/* ═══════════════════════════ the Unit 4 tripwire ══ */

describe("exactly one module reconciles the FW cache owner on /fp/fw", () => {
  const FW_APP_LAYOUT = read("../../../fp/fw/(app)/layout.tsx");
  const FW_PWA = read("../../../fp/fw/components/FwPwa.tsx");

  /** A call, not a mention — both files discuss the reconcile in comments. */
  const callsReconcile = (source: string) => /reconcileFwCacheOwner\(\s*\{/.test(source);
  const mountsStaffBar = /<StaffBar[\s/>]/.test(FW_APP_LAYOUT);

  it("has exactly one reconcile owner mounted in the FW subtree, right now", () => {
    // THE HAZARD THIS EXISTS FOR. The plan schedules `FwPwa`'s reconcile effect for
    // removal in Unit 3, but the removal is only safe at the moment the bar takes it
    // over — and Unit 4 is what mounts the bar here. Deleting it a PR early leaves
    // `main` with NO reconcile on the one subtree where shared iPads change hands;
    // mounting the bar without deleting it races two reconciles on one localStorage
    // key. Both are silent, and both are one line of someone else's diff away.
    //
    // Counted rather than asserted directionally, so it reddens BOTH ways: zero owners
    // (the early deletion) and two owners (the un-retired duplicate).
    const owners = [mountsStaffBar, callsReconcile(FW_PWA)].filter(Boolean).length;
    expect(owners).toBe(1);
  });

  it("names which module owns it today, so Unit 4 knows what to remove", () => {
    // As of Unit 3: FwPwa owns it and the bar is not mounted here. When Unit 4 flips
    // both in one change, this assertion is the one to update — and the count above is
    // what stops it being flipped only half way.
    expect(mountsStaffBar).toBe(false);
    expect(callsReconcile(FW_PWA)).toBe(true);
  });
});
