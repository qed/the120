import { describe, expect, it } from "vitest";

/**
 * First test under `app/fp/**` (T1 Unit 2).
 *
 * Its only job is to prove the tree is discovered by `npm run test`. That was
 * verified the honest way: this file first asserted `"discovered" === "NOT
 * DISCOVERED"`, `npm run test` reported `1 failed`, and only then was it
 * inverted. Running `npx vitest run <path>` would NOT have proved anything —
 * that bypasses `vitest.config.ts` entirely and passes even when the glob is
 * missing, which is exactly how a whole directory once went silently unrun.
 *
 * The allowlist entry itself is guarded from outside this tree by
 * `app/lib/__tests__/vitest-include.test.ts` — a guard living in here could not
 * catch its own removal.
 *
 * ── Conventions for everything under app/fp/lib ──
 *
 * Decision logic goes in pure `*-rules.ts` modules with NO next/, supabase, or
 * react imports, and a colocated `__tests__/`. This is not stylistic: the repo
 * has no jsdom, no @testing-library, and no component tests anywhere, so a
 * React component or a Supabase call is undefendable here. Anything that must
 * be correct — the task state machine, access verdicts, offline sync
 * reconciliation, band resolution — has to be pure to be tested at all.
 *
 * The wrapper that talks to Next or Supabase stays thin and calls the pure
 * module. See `app/crm/lib/access.ts` (pure) + `app/crm/lib/auth.ts` (wrapper),
 * and `app/lib/supabase/proxy-rules.ts` + `proxy.ts` from Unit 1.
 *
 * Two boundaries that are easy to conflate, both recorded in docs/solutions:
 *   - `"use server"` makes EVERY export a client-callable Server Action.
 *   - `import "server-only"` throws under `tsx`, so anything a script must
 *     reuse (the content parser, seeds, backfills) cannot sit behind it.
 */
describe("app/fp test discovery", () => {
  it("is discovered by npm run test, not just by a direct vitest invocation", () => {
    expect("discovered").toBe("discovered");
  });
});
