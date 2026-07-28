import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const routeSrc = () =>
  readFileSync(path.resolve(REPO_ROOT, "app/api/cron/nurture/route.ts"), "utf8");

/**
 * The cron's contract with the engine. These are source pins because the
 * handler's own body is a thin Supabase read/claim/send loop — but each
 * one guards a failure that has actually happened in this repo.
 */
describe("the nurture cron's wiring", () => {
  it("exports GET — Vercel cron sends GET, and a POST-only export 405s every run forever", () => {
    const src = routeSrc();
    expect(src).toMatch(/export async function GET\b/);
    expect(src).not.toMatch(/export async function POST\b/);
  });

  it("W8: the deposits select carries child_id — without it the per-child offer gate reads undefined", () => {
    // The engine gates the offer nudge on which CHILD holds a live paid
    // deposit. If this column ever drops out of the select, every
    // paidChildIds lookup silently misses and deposited children get
    // nudged again.
    const src = routeSrc();
    const depositsSelect = /\.from\("deposits"\)\s*\.select\(\s*"([^"]+)"/.exec(src);
    expect(depositsSelect, "deposits select not found").not.toBeNull();
    expect(depositsSelect![1].split(",")).toContain("child_id");
  });

  it("the children select carries id — the per-child send key is built from it", () => {
    const src = routeSrc();
    const childrenSelect = /\.from\("children"\)\s*\.select\(\s*"([^"]+)"/.exec(src);
    expect(childrenSelect, "children select not found").not.toBeNull();
    expect(childrenSelect![1].split(",")).toContain("id");
  });

  it("claims the (family, sequence, step) slot BEFORE sending, and releases it on failure", () => {
    // Claim-then-send: the unique constraint is the dedupe, so the insert
    // must precede the send and a failed send must delete its claim or
    // the family is silenced forever.
    const src = routeSrc();
    const claimIdx = src.indexOf('.from("nurture_sends").insert(');
    const sendIdx = src.indexOf("await sendNurtureEmail("); // the CALL, not the import
    const releaseIdx = src.indexOf(".delete()");
    expect(claimIdx).toBeGreaterThan(-1);
    expect(sendIdx).toBeGreaterThan(claimIdx);
    expect(releaseIdx).toBeGreaterThan(sendIdx);
  });

  it("requires the cron secret", () => {
    expect(routeSrc()).toContain("CRON_SECRET");
  });
});
