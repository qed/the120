import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * R12's redirect-back half (unified-flow Unit 8): after a SUCCESSFUL sign-in
 * on /dashboard?returnTo=<validated /start/… path>, SignIn navigates to that
 * path instead of letting the store swap the dashboard in. Source-scan pins
 * (node env, no renderer): the navigation input must be safeReturnTo's
 * output — never raw location.search — success-only, and latched to fire
 * once. No returnTo means EXACTLY today's in-place-swap behavior.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.resolve(here, "../SignIn.tsx"), "utf8");

describe("SignIn returnTo — validation is the only admission gate", () => {
  it("imports safeReturnTo + RETURN_TO_PARAM from the R12 rules module", () => {
    expect(src).toMatch(
      /import \{ RETURN_TO_PARAM, safeReturnTo \} from "@\/app\/lib\/funnel\/return-to-rules";/
    );
  });

  it("reads the param once at mount via lazy initializer, through safeReturnTo", () => {
    // The depositBanner pattern: lazy useState initializer, SSR-guarded,
    // URL → URLSearchParams → safeReturnTo. No setState-in-effect.
    expect(src).toMatch(
      /useState<string \| null>\(\(\) => \{\s*\n\s*if \(typeof window === "undefined"\) return null;\s*\n\s*return safeReturnTo\(new URLSearchParams\(window\.location\.search\)\.get\(RETURN_TO_PARAM\)\);/
    );
  });

  it("never feeds raw location.search (or any non-validated value) into assign", () => {
    // Every location.search read sits inside the safeReturnTo call above…
    const searchReads = src.match(/window\.location\.search/g) ?? [];
    expect(searchReads).toHaveLength(1);
    expect(src).toMatch(/safeReturnTo\(new URLSearchParams\(window\.location\.search\)/);
    // …and the ONLY assign call takes the validated state variable.
    const assigns = src.match(/window\.location\.assign\([^)]*\)/g) ?? [];
    expect(assigns).toEqual(["window.location.assign(returnTo)"]);
  });
});

describe("SignIn returnTo — success-only navigation, latched", () => {
  it("the failed-sign-in branch returns before any navigation", () => {
    // The error branch must end in an early return, and the assign must sit
    // AFTER it in the submit handler — a failed sign-in can never navigate.
    const submit = src.slice(src.indexOf("const handleSubmit"), src.indexOf("const handleReset"));
    const errorReturn = submit.indexOf("return; // failed sign-ins NEVER navigate");
    const assign = submit.indexOf("window.location.assign(returnTo)");
    expect(errorReturn).toBeGreaterThan(-1);
    expect(assign).toBeGreaterThan(errorReturn);
  });

  it("navigation is guarded by the validated value AND a fire-once latch", () => {
    expect(src).toMatch(/if \(returnTo && !navigatedRef\.current\) \{/);
    expect(src).toMatch(/navigatedRef\.current = true;\s*\n\s*window\.location\.assign\(returnTo\);/);
    expect(src).toMatch(/const navigatedRef = useRef\(false\);/);
  });

  it("assign appears exactly once (inside the guard), so no-returnTo keeps today's swap", () => {
    const assigns = src.match(/window\.location\.assign/g) ?? [];
    expect(assigns).toHaveLength(1);
    // The fallback path is still the store's auth listener, documented in place.
    expect(src).toMatch(/On success \(no returnTo\) the store's onAuthStateChange swaps in the dashboard\./);
  });

  it("documents the already-signed-in scope decision (no yank on back-button)", () => {
    expect(src).toMatch(/returnTo applies only to a sign-in COMPLETING in this/);
  });
});
