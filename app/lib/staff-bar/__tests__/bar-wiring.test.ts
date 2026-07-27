import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The three properties of `StaffBar.tsx` that no behavioural test can reach.
 *
 * This repo runs `environment: "node"` with no jsdom, so the component cannot be
 * rendered. Two of the plan's requirements are nonetheless properties OF the
 * component rather than of the rules it composes — R23's unconditional sign-out and
 * the settled decision that no role-derived value arrives as a server prop — and a
 * property with no assertion is a property that survives exactly until someone
 * refactors past it. So they are asserted where they live: in the source.
 *
 * These are narrow on purpose. A scanner that tried to parse the component would
 * redden on formatting; each of these pins one named string against one named reason.
 */

const SOURCE = readFileSync(
  path.join(process.cwd(), "app/lib/staff-bar/StaffBar.tsx"),
  "utf8"
);

/** The component's props block — everything the SERVER is allowed to hand it. */
const PROPS_BLOCK = SOURCE.slice(
  SOURCE.indexOf("export function StaffBar("),
  SOURCE.indexOf("const [live, setLive]")
);

describe("StaffBar receives nothing role-derived from the server", () => {
  it("takes exactly two props: the application and an opaque actor id", () => {
    expect(PROPS_BLOCK).toContain("application: StaffBarApplication");
    expect(PROPS_BLOCK).toContain("actorUserId: string");
  });

  it("never takes the email, staff-ness, or guide-ness as a prop", () => {
    // `/fp/fw` navigations are cached into `path-sw-fw-shell-v1`, and props passed to
    // a client component are serialized into that cached payload. A bar whose email
    // or role arrived as a prop would leave a cached shell that DIFFERS between a
    // staff and a non-staff visit — handing the next holder of a shared iPad the
    // previous operator's address and role. Identity comes over a Server Action
    // (a POST, never in that cache) instead.
    for (const forbidden of ["email:", "isStaff:", "isFwGuide:", "identity:"]) {
      expect(PROPS_BLOCK, forbidden).not.toContain(forbidden);
    }
  });

  it("resolves identity through the Server Action, not through props", () => {
    expect(SOURCE).toContain("loadStaffBarIdentity()");
  });
});

describe("R23 — the sign-out control renders unconditionally", () => {
  it("the sign-out button is not gated on identity", () => {
    // R16 removed the per-subtree sign-outs that used to work independently of the
    // identity read. If this button were gated on it, a slow or failed read would
    // strand a staff member on a page with no way out — strictly worse than the three
    // disagreeing-but-functional chromes this replaces.
    const button = SOURCE.slice(SOURCE.indexOf("onClick={() => void onSignOut()}"));
    expect(button.length).toBeGreaterThan(0);

    const beforeButton = SOURCE.slice(
      SOURCE.indexOf("<span className={skin.email}>"),
      SOURCE.indexOf("onClick={() => void onSignOut()}")
    );
    // The hub link and the chip are conditional; the sign-out control must not be.
    expect(beforeButton).not.toContain("identity &&");
    expect(beforeButton).not.toContain("identity ?");
  });

  it("the hub link IS conditional — it is the affordance that must not be guessed", () => {
    expect(SOURCE).toContain("staffBarShowsHubLink({ application, identity })");
  });
});

describe("the sign-out redirect is not swallowed", () => {
  it("checks isNextRedirect and rethrows before reporting a failure", () => {
    // `signOutStaffBar` ends in `redirect()`, which Next implements by THROWING a
    // digest. `FwSignOutButton` still catches that digest generically and reports a
    // SUCCESSFUL sign-out as "Couldn't sign out just now" — latent there only because
    // the navigation paints first. Unit 4 retires it; this bar must not inherit it.
    const catchBlock = SOURCE.slice(
      SOURCE.indexOf("} catch (e) {", SOURCE.indexOf("const onSignOut"))
    );
    const rethrow = catchBlock.indexOf("if (isNextRedirect(e)) throw e;");
    const report = catchBlock.indexOf('setMessage("Couldn\'t sign out just now.');
    expect(rethrow).toBeGreaterThanOrEqual(0);
    expect(report).toBeGreaterThan(rethrow); // the check comes FIRST
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
