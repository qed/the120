import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { safeReturnTo, returnToHref, RETURN_TO_PARAM } from "@/app/lib/funnel/return-to-rules";
import { nextStepsReachable } from "@/app/lib/funnel/deposit-rules";
import {
  MERGED_NEXT_STEPS,
  resolveMergedStep,
  type MergedFlowFacts,
} from "@/app/lib/funnel/merged-flow-rules";

/**
 * Unified-flow Unit 8 (R12): /start/next-steps becomes a pure-GET SHIM when
 * MERGED_FLOW_ENABLED is on, preserving every standalone gate; while the
 * flag is off the page renders NextStepsFlow exactly as today. Source scans
 * (node env, no renderer) + rules-level assertions on the redirect chain.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const PAGE = "app/start/next-steps/page.tsx";
const pageRaw = read(PAGE);
const page = stripComments(pageRaw);
// The flag branch owns the shim; everything after it is the dark path.
const shim = page.slice(
  page.indexOf("if (MERGED_FLOW_ENABLED)"),
  page.indexOf("?step=progress")
);

describe("flag OFF — the page still renders NextStepsFlow (byte-path identity)", () => {
  it("the flag decides at the TOP of the component; the dark path keeps the standalone render", () => {
    expect(page).toContain("if (MERGED_FLOW_ENABLED)");
    // The dark path's render survives untouched: same component, same props.
    expect(page).toContain("<NextStepsFlow");
    expect(page).toContain("initialGoal={String(child.family_goal");
    expect(page).toContain("navCardIdentityName(");
    // Dark signed-out behaviour stays the plain dashboard redirect.
    expect(page).toContain('if (!user) redirect("/dashboard");');
  });

  it("the flag comes from the ONE merged-flow module — never a local literal", () => {
    expect(pageRaw).toMatch(
      /import \{ MERGED_FLOW_ENABLED \} from "@\/app\/lib\/funnel\/merged-flow-rules"/
    );
    expect(page).not.toMatch(/MERGED_FLOW_ENABLED\s*=/);
  });
});

describe("flag ON — the shim's redirect targets (R12, full standalone behaviour preserved)", () => {
  it("signed out → the dashboard sign-in carrying the shim's OWN URL, query preserved", () => {
    expect(shim).toContain("returnToHref(`/start/next-steps${search ? `?${search}` : \"\"}`)");
    // The query round-trips: every string param is re-encoded into the
    // returnTo path, so ?child= survives the sign-in bounce.
    expect(shim).toContain("new URLSearchParams()");
    expect(shim).toContain("qs.set(key, v)");
  });

  it("no offered child (nextStepsReachable over the family) → /dashboard", () => {
    expect(shim).toContain("nextStepsReachable({");
    expect(shim).toContain('if (offered.length === 0) redirect("/dashboard");');
  });

  it("absent/foreign ?child= falls back to the first offered child, then redirects to ?step=progress", () => {
    expect(shim).toContain("?? offered[0]");
    expect(page).toContain("redirect(`/start/child/${String(child.id)}?step=progress`)");
  });

  it("pure GET: the shim path reads and redirects — no mutation, no action import", () => {
    // No writes anywhere in the page (the state-changing-email-links
    // learning): reads + redirects only.
    for (const writer of [".update(", ".insert(", ".upsert(", ".delete(", ".rpc("]) {
      expect(page).not.toContain(writer);
    }
    expect(pageRaw).not.toMatch(/from "@\/app\/lib\/funnel\/actions\//);
    expect(pageRaw).not.toContain('"use server"');
  });
});

describe("the returnTo round trip — the shim's own URL passes the validator", () => {
  it("bare and query-carrying shim URLs are admitted verbatim by safeReturnTo", () => {
    expect(safeReturnTo("/start/next-steps")).toBe("/start/next-steps");
    expect(safeReturnTo("/start/next-steps?child=abc")).toBe("/start/next-steps?child=abc");
  });

  it("returnToHref builds the dashboard bounce the SignIn redirect-back consumes", () => {
    const href = returnToHref("/start/next-steps?child=abc");
    expect(href).toBe(`/dashboard?${RETURN_TO_PARAM}=${encodeURIComponent("/start/next-steps?child=abc")}`);
    // Decoding what rides in the param admits it again — the full loop.
    const url = new URL(`https://x.test${href}`);
    expect(safeReturnTo(url.searchParams.get(RETURN_TO_PARAM))).toBe(
      "/start/next-steps?child=abc"
    );
  });
});

describe("integration: the ACTUAL offer-email URL walks the chain (source-level pins)", () => {
  it("the offer email links bare /start/next-steps, no ?child= (the shim's no-param fallback owns it)", () => {
    const offer = stripComments(read("app/crm/lib/offer-rules.ts"));
    expect(offer).toContain("/start/next-steps");
    expect(offer).not.toContain("/start/next-steps?");
  });

  it("SignIn completes the chain: a validated returnTo navigates back into the shim", () => {
    const signIn = stripComments(read("app/dashboard/SignIn.tsx"));
    expect(signIn).toContain("safeReturnTo(");
  });

  it("rules: the shim's destination step is real — ?step=progress resolves to progress for a gated child", () => {
    const facts: MergedFlowFacts = {
      applicantState: "offered",
      status: "submitted",
      doorConfirmed: true,
      hasProject: true,
      nextStepsReachable: true,
      formProgress: true,
      firstIncompleteFormStep: "basics",
      mergeFlagOn: true,
    };
    expect(nextStepsReachable(facts)).toBe(true);
    expect(resolveMergedStep("progress", facts)).toBe("progress");
    expect(MERGED_NEXT_STEPS[0]).toBe("progress");
    // And for an UNGATED child the clamp re-lands the deep link — the shim
    // can never strand someone on a screen their list doesn't contain.
    const ungated: MergedFlowFacts = { ...facts, applicantState: "submitted", nextStepsReachable: false };
    expect(resolveMergedStep("progress", ungated)).not.toBe("progress");
  });
});
