import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  fakeClient,
  newStore,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import { FP_CONSENT_POLICY } from "@/app/api/fp/signup/consent-rules";
import {
  authorizeCoverGeneration,
  performCoverGeneration,
  type CoverCaller,
  type CoverDeps,
} from "@/app/api/fp/cover/cover-core";
import { deriveCoverSessionFields } from "@/app/api/fp/login/login-rules";
import { planCoverCarry, isCoverStatus, type CoverStatus } from "../cover-store-rules";
import { renderTemplateCover } from "../cover-template";

/**
 * ONE RENDER, ONE COVER — the owner's requirement, as an executable claim.
 *
 * Verbatim (New User Flow v3, Unit 7):
 *
 *   "The cover being created at signup needs to be the exact same cover a kid
 *    sees in First Profit. When that cover is created, it goes into the DB
 *    attached to the kid as the one and only cover for that kid. There is only
 *    one cover creation process. It happens during the parent signup process.
 *    We should only have to create the image once."
 *
 * ── WHY THIS FILE EXISTS, AND WHY IT SPANS FOUR MODULES ──
 * Every other cover test checks one hop, and each of them passed while the
 * product was wrong: signup rendered a personalized cover and stored nothing,
 * and the sign-in doors RE-RENDERED from the child's first name alone — a
 * different palette, no age badge, generic captions instead of the kid's own
 * words. The two doors agreed with each other perfectly, which is precisely why
 * door-vs-door parity tests could not see it.
 *
 * The only assertion that catches that class of bug follows the SAME artifact
 * across every hop:
 *
 *     POST /api/fp/cover  →  fp_onboarding_drafts.cover_data_url
 *                         →  planCoverCarry
 *                         →  children.fp_cover_data_url
 *                         →  deriveCoverSessionFields  →  BOTH sign-in doors
 *
 * …and then counts the renders. The REAL compositor runs throughout, so the
 * bytes compared are the real thing.
 */

const PARENT = "parent-a";
const ATTEMPT = "attempt-1";
const CALLER: CoverCaller = { kind: "parent", parentId: PARENT };

/** The kid, and the two inputs that DO NOT survive provisioning. Both appear in
 *  the rendered picture, which is what makes a later re-render detectably wrong. */
const KID = { firstName: "Remi", age: 11, answers: { q1: "a lemonade stand on my street" } };

function signupHarness() {
  const store: Store = newStore();
  const draftId = randomUUID();
  store.fp_onboarding_drafts = [
    {
      id: draftId,
      parent_id: PARENT,
      signup_attempt_id: ATTEMPT,
      child_id: null,
      kid_first_name: KID.firstName,
      kid_last_name: "Newal",
      kid_age: KID.age,
      answers: { ...KID.answers },
      cover_status: "none",
      cover_blob_key: null,
      cover_data_url: null,
      generation_count: 0,
      status: "active",
      updated_at: "2026-08-05T00:00:00.000Z",
    },
  ];
  store.fp_parental_consent = [
    {
      id: "consent-1",
      signup_attempt_id: ATTEMPT,
      parent_id: PARENT,
      child_id: null,
      policy_version: FP_CONSENT_POLICY.version,
      accepted_at: "2026-08-05T00:00:00.000Z",
      revoked_at: null,
    },
  ];
  const client = fakeClient(store);
  let renderCalls = 0;
  const deps: CoverDeps = {
    authenticate: async () => CALLER,
    db: () => client as unknown as ReturnType<CoverDeps["db"]>,
    now: () => 1_700_000_000_000,
    env: {},
    // A COUNTING PASS-THROUGH, not a stub: the real compositor runs and the
    // real bytes flow, but every invocation on this path is observable. (The
    // renderer is a plain ESM export, so counting via the injected seam is both
    // more honest and more portable than spying on a module namespace.)
    renderCover: (input) => {
      renderCalls += 1;
      return renderTemplateCover(input);
    },
  };
  return {
    store,
    draftId,
    deps,
    draftRow: () => store.fp_onboarding_drafts[0],
    renderCalls: () => renderCalls,
  };
}

/** Run the whole chain once and hand back every artifact it produced. */
async function runSignupThroughSignIn() {
  const h = signupHarness();

  // ── (1) SIGNUP. The one render, in the one place it is allowed to happen.
  const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
  expect(authz.ok).toBe(true);
  if (!authz.ok) throw new Error("authorization refused");
  const done = await performCoverGeneration(h.deps, authz.authorized, () => {});
  expect(done.kind).toBe("ready");
  if (done.kind !== "ready") throw new Error("generation refused");

  // ── (2) WHAT THE DRAFT ROW NOW HOLDS.
  const draft = h.draftRow();
  const draftStatus = draft.cover_status;

  // ── (3) PROVISIONING: the carry onto a child. This is the exact call
  //        v3ProvisionKid makes, with the exact columns it reads.
  const childId = randomUUID();
  const carry = planCoverCarry({
    draftId: h.draftId,
    childId,
    draftCoverKey: (draft.cover_blob_key as string | null) ?? null,
    draftCoverStatus: (isCoverStatus(draftStatus) ? draftStatus : "none") as CoverStatus,
    draftGenerationCount: draft.generation_count as number,
    draftCoverDataUrl: (draft.cover_data_url as string | null) ?? null,
  });

  // ── (4) EITHER SIGN-IN DOOR. Both call exactly this, on exactly these
  //        columns — see app/api/fp/login/route.ts and
  //        app/api/fp/handoff/handoff-core.ts.
  const served = deriveCoverSessionFields({
    coverStatus: carry.child.fp_cover_status,
    coverBlobKey: carry.child.fp_cover_blob_key,
    coverDataUrl: carry.child.fp_cover_data_url,
  });

  return {
    signupResponseUrl: done.coverUrl,
    storedOnDraft: draft.cover_data_url as string | null,
    draftStatus,
    carriedToChild: carry.child,
    served,
    renderCalls: h.renderCalls(),
  };
}

describe("one render, one cover — signup → draft → child → both sign-in doors", () => {
  it("hands the child's sign-in the EXACT artifact the parent was shown at signup", async () => {
    const r = await runSignupThroughSignIn();

    // The picture the parent saw, in the SSE `done` event.
    expect(r.signupResponseUrl.startsWith("data:image/svg+xml;base64,")).toBe(true);
    // Persisted on the draft by the SAME write that settled the status, so the
    // two can never be written apart.
    expect(r.storedOnDraft).toBe(r.signupResponseUrl);
    expect(r.draftStatus).toBe("final");
    // Carried onto the child verbatim — copied, not recomputed.
    expect(r.carriedToChild.fp_cover_data_url).toBe(r.signupResponseUrl);
    expect(r.carriedToChild.fp_cover_status).toBe("final");
    expect(r.carriedToChild.fp_cover_blob_key).toBeNull();
    // And served, byte-for-byte, by the one read BOTH doors call.
    expect(r.served.coverUrl).toBe(r.signupResponseUrl);
    expect(r.served.coverStatus).toBe("final");
  });

  it("invokes the compositor EXACTLY ONCE across the entire chain", async () => {
    const r = await runSignupThroughSignIn();
    // THE REGRESSION GUARD. Two renders is two pictures: the second one has
    // only the child's name to work from and cannot reproduce the first.
    expect(r.renderCalls).toBe(1);
  });

  it("the served picture carries the AGE and the STORY ANSWER — the parts a re-render loses", async () => {
    const r = await runSignupThroughSignIn();
    const svg = Buffer.from((r.served.coverUrl ?? "").split(",")[1] ?? "", "base64").toString(
      "utf8"
    );
    // The reviewer's three verified differences, asserted from the SERVED bytes
    // rather than from the signup response:
    expect(svg).toContain(`Meet ${KID.firstName}`); // the name (a re-render kept this)
    expect(svg).toContain("years old"); // the age badge (a re-render lost it)
    expect(svg).toContain(KID.answers.q1); // the kid's own words (a re-render replaced them)
    expect(svg).not.toContain("version 1 of the idea."); // the generic caption

    // The palette is hashed over name+age+answers, so a name-only re-render also
    // repaints the cover. Proved directly: same name, no age, no answers ⇒
    // different bytes. This is literally what the old read side produced.
    expect(renderTemplateCover({ firstName: KID.firstName, age: null })).not.toBe(r.served.coverUrl);
  });

  it("a redraw replaces the stored artifact, so the child carries the LAST cover, not a stale one", async () => {
    const h = signupHarness();
    const run = async () => {
      const authz = await authorizeCoverGeneration(h.deps, { body: { draftId: h.draftId } });
      expect(authz.ok).toBe(true);
      if (!authz.ok) throw new Error("refused");
      const done = await performCoverGeneration(h.deps, authz.authorized, () => {});
      if (done.kind !== "ready") throw new Error("refused");
      return done.coverUrl;
    };

    const first = await run();
    expect(h.draftRow().cover_data_url).toBe(first);

    // A redraw with DIFFERENT answers — the family edited their story.
    h.draftRow().answers = { q1: "dog walking for the neighbours" };
    const second = await run();

    expect(second).not.toBe(first);
    expect(h.draftRow().cover_data_url).toBe(second);
    expect(h.draftRow().generation_count).toBe(2);
    // Two renders because the family asked twice — that is the cap, not a leak.
    expect(h.renderCalls()).toBe(2);
  });
});

describe("no cover is never a re-rendered cover", () => {
  it("a child provisioned before the artifact existed is served NOTHING to show", () => {
    // The pre-Unit-7 cohort: `final` on the row, no bytes anywhere. The honest
    // answer is the status alone. Backfilling this by re-rendering from the
    // name would recreate the exact bug the rework removed, so nothing does.
    expect(
      deriveCoverSessionFields({ coverStatus: "final", coverBlobKey: null, coverDataUrl: null })
    ).toEqual({ coverStatus: "final" });
  });

  it("a child provisioned before v3 is served no cover fields at all", () => {
    expect(
      deriveCoverSessionFields({ coverStatus: null, coverBlobKey: null, coverDataUrl: null })
    ).toEqual({});
  });
});

/* ------------------------------------------------- the call-site census */

/**
 * THE STRUCTURAL HALF OF THE GUARANTEE.
 *
 * The chain test above proves the SHIPPED path renders once. This proves there
 * is nowhere else it could: it walks the application source and counts every
 * module that IMPORTS the compositor. Exactly one non-test module may.
 *
 * Imports rather than identifier mentions, deliberately — the modules around
 * this one legitimately DISCUSS the renderer in their comments (several exist
 * to explain why they must not call it), and a census that fired on prose would
 * be a census nobody keeps.
 *
 * A grep-as-a-test is unusual and worth justifying. "There is only one cover
 * creation process" is a claim about the WHOLE codebase, not about one code
 * path, and no runtime assertion can see a renderer call on a route that this
 * suite never exercises. This can, and it fails at the moment someone adds one
 * — which is the moment it is cheapest to reconsider.
 */
const APP_ROOT = join(process.cwd(), "app");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__" || entry === "node_modules") continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("there is exactly ONE renderer call site in the product", () => {
  it("only app/api/fp/cover/cover-core.ts imports the compositor", () => {
    const owner = join("app", "fp", "lib", "cover-template.ts");
    const importsTemplate = /from\s+["'][^"']*\/cover-template["']/;
    const callers = sourceFiles(APP_ROOT)
      .filter((f) => !f.endsWith(owner))
      .filter((f) => importsTemplate.test(readFileSync(f, "utf8")))
      .map((f) => f.slice(process.cwd().length + 1).replace(/\\/g, "/"));

    expect(callers).toEqual(["app/api/fp/cover/cover-core.ts"]);
  });
});
