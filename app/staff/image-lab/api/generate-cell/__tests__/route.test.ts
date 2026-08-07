import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The generate-cell route — THE PAID ENDPOINT
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5).
 *
 * The route's own job is small and entirely about ORDER: gate → parse →
 * cooldown → delegate. Each step is asserted by what did NOT happen when it
 * refused — a refusal that still reached `generateCell` is a refusal that spent
 * money, and `generateCell` is where the CAS and the vendor call live.
 *
 * The sequencing itself is covered in `lib/__tests__/run-core.test.ts` against
 * fakes that can stage a CAS race; this file deliberately mocks it out so the
 * route's own decisions are the only thing under test.
 */

const { requireStaffSpy, generateCellSpy, runDepsSpy, imageLabDbSpy } = vi.hoisted(() => ({
  requireStaffSpy: vi.fn(),
  generateCellSpy: vi.fn(),
  runDepsSpy: vi.fn(),
  imageLabDbSpy: vi.fn(),
}));

vi.mock("@/app/crm/lib/auth", () => ({ requireStaff: requireStaffSpy }));
vi.mock("../../../lib/run-core", () => ({ generateCell: generateCellSpy }));
vi.mock("../../../lib/run-loader", () => ({ runDeps: runDepsSpy }));
vi.mock("../../../lib/image-lab-db", () => ({ imageLabDb: imageLabDbSpy }));

import { POST, maxDuration } from "../route";
import {
  assertRouteBudget,
  IMAGE_LAB_ROUTE_BUDGET_MS,
} from "../../../lib/model-registry";
import {
  IMAGE_LAB_GENERATE_RATE_LIMIT,
  IMAGE_LAB_MAX_CELLS_PER_RUN,
} from "../../../lib/run-rules";
import { resetRateLimitStoreForTests } from "@/app/fp/lib/rate-limit-store";

const STAFF = { staffId: "00000000-0000-4000-8000-000000000001", email: "s@the120.example" };
const IMAGE_ID = "11111111-1111-4111-8111-111111111111";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/staff/image-lab/api/generate-cell", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );

beforeEach(() => {
  resetRateLimitStoreForTests();
  requireStaffSpy.mockReset().mockResolvedValue(STAFF);
  generateCellSpy.mockReset().mockResolvedValue({ kind: "done", imageId: IMAGE_ID });
  runDepsSpy.mockReset().mockReturnValue({});
  imageLabDbSpy.mockReset().mockReturnValue({});
});

// ── The budget, asserted at module scope ─────────────────────────────────────

describe("the function budget is asserted at BUILD time", () => {
  it("this route's maxDuration contains the slowest model plus finalize headroom", () => {
    // The route calls `assertRouteBudget(maxDuration)` at module scope, so the
    // import above would already have thrown. Restating it names the failure.
    expect(() => assertRouteBudget(maxDuration)).not.toThrow();
    expect(maxDuration * 1000).toBeGreaterThanOrEqual(IMAGE_LAB_ROUTE_BUDGET_MS);
  });

  it("the nearest precedent's 60s would be REFUSED", () => {
    // Copy `maxDuration = 60` from the FP import page and gpt-image-2's 240s
    // abort can never fire: the platform kills the invocation first, so no
    // finalize runs, the row stays latched for the whole staleness window, and
    // the vendor bills for the image anyway.
    expect(() => assertRouteBudget(60)).toThrow(/too short/);
  });
});

// ── The gate ─────────────────────────────────────────────────────────────────

describe("the staff gate is first and unconditional", () => {
  it("calls requireStaff before anything else can spend", async () => {
    await post({ imageId: IMAGE_ID });
    expect(requireStaffSpy).toHaveBeenCalled();
  });

  it("a refused gate never reaches the generation path", async () => {
    // `requireStaff` refuses by THROWING (a redirect, or
    // IdentityUnavailableError). What matters is that nothing downstream ran.
    requireStaffSpy.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(post({ imageId: IMAGE_ID })).rejects.toThrow();
    expect(generateCellSpy).not.toHaveBeenCalled();
    expect(imageLabDbSpy).not.toHaveBeenCalled();
  });
});

// ── Parsing ──────────────────────────────────────────────────────────────────

describe("a malformed request is refused before it costs a budget", () => {
  it.each([
    ["no body at all", undefined],
    ["a missing imageId", {}],
    ["a non-string imageId", { imageId: 7 }],
    ["an empty imageId", { imageId: "" }],
  ])("refuses %s with 400 and no generation", async (_why, body) => {
    const response =
      body === undefined
        ? await POST(
            new Request("http://localhost/staff/image-lab/api/generate-cell", {
              method: "POST",
            })
          )
        : await post(body);
    expect(response.status).toBe(400);
    expect(generateCellSpy).not.toHaveBeenCalled();
  });

  it("a bad body does NOT consume the cooldown budget", async () => {
    // A malformed request is not a priced attempt, so it must not eat into the
    // allowance a legitimate compare fan needs.
    for (let i = 0; i < IMAGE_LAB_GENERATE_RATE_LIMIT.limit + 5; i++) {
      await post({ imageId: 7 });
    }
    const response = await post({ imageId: IMAGE_ID });
    expect(response.status).toBe(200);
  });
});

// ── The cooldown ─────────────────────────────────────────────────────────────

describe("the server-side cooldown", () => {
  it("a FULL 12-cell compare fan fits inside the burst allowance", async () => {
    // The client fires one request per cell, so the feature's headline workflow
    // arrives as twelve requests in a second. A limit that refused it would
    // refuse PARTWAY — some cells generated, some not.
    const statuses: number[] = [];
    for (let i = 0; i < IMAGE_LAB_MAX_CELLS_PER_RUN; i++) {
      statuses.push((await post({ imageId: IMAGE_ID })).status);
    }
    expect(statuses.every((status) => status === 200)).toBe(true);
    expect(generateCellSpy).toHaveBeenCalledTimes(IMAGE_LAB_MAX_CELLS_PER_RUN);
  });

  it("a breach refuses with 429 and WITHOUT a vendor call", async () => {
    for (let i = 0; i < IMAGE_LAB_GENERATE_RATE_LIMIT.limit; i++) {
      await post({ imageId: IMAGE_ID });
    }
    generateCellSpy.mockClear();

    const response = await post({ imageId: IMAGE_ID });
    expect(response.status).toBe(429);
    const body = (await response.json()) as { outcome: { kind: string; retryAfterMs: number } };
    expect(body.outcome.kind).toBe("cooldown");
    expect(body.outcome.retryAfterMs).toBeGreaterThan(0);
    // NOTHING was dialled: the refusal happens before the CAS, so no row is
    // latched and no vendor call exists to be billed for.
    expect(generateCellSpy).not.toHaveBeenCalled();
  });

  it("LEAVES A LOG LINE — a throttle used to be invisible after the fact", async () => {
    // The generation breadcrumb is emitted post-CAS only and `rate-limit-store`
    // logs nothing, so a runaway fan that tripped the guardrail left no trace at
    // all. Ids and a duration; there is no run, prompt or child in scope here.
    for (let i = 0; i < IMAGE_LAB_GENERATE_RATE_LIMIT.limit; i++) {
      await post({ imageId: IMAGE_ID });
    }
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect((await post({ imageId: IMAGE_ID })).status).toBe(429);
      const logged = spy.mock.calls.flat().join(" ");
      expect(logged).toContain("cooldown refused");
      expect(logged).toContain(STAFF.staffId);
      // ⚠ A DIGIT, NOT A PREFIX. `toContain("retryAfterMs=")` passes on
      // `retryAfterMs=undefined`, which is exactly the line an operator cannot
      // act on and exactly what a broken decision would print.
      expect(logged).toMatch(/retryAfterMs=\d+/);
      expect(logged).not.toContain(IMAGE_ID);
    } finally {
      spy.mockRestore();
    }
  });

  it("logs the TRIP ONCE per window, not once per refused request", async () => {
    // ⚠ THE FLOOD IS ON THE BRANCH THE FLOOD COMES FROM. This is the branch a
    // runaway tab hits at full rate for the rest of the window — the very
    // scenario the line exists to make visible — so a line per refusal buries
    // the trip in thousands of copies of itself.
    for (let i = 0; i < IMAGE_LAB_GENERATE_RATE_LIMIT.limit; i++) {
      await post({ imageId: IMAGE_ID });
    }
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (let i = 0; i < 25; i++) {
        expect((await post({ imageId: IMAGE_ID })).status).toBe(429);
      }
      const trips = spy.mock.calls
        .flat()
        .filter((arg) => String(arg).includes("cooldown refused"));
      expect(trips).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });

  it("is keyed per staff member — one runaway tab cannot lock a colleague out", async () => {
    for (let i = 0; i < IMAGE_LAB_GENERATE_RATE_LIMIT.limit; i++) {
      await post({ imageId: IMAGE_ID });
    }
    expect((await post({ imageId: IMAGE_ID })).status).toBe(429);

    requireStaffSpy.mockResolvedValue({ ...STAFF, staffId: "another-staff" });
    expect((await post({ imageId: IMAGE_ID })).status).toBe(200);
  });
});

// ── Delegation ───────────────────────────────────────────────────────────────

describe("delegation and outcome shaping", () => {
  it("passes the staff id from the GATE, not from the body", async () => {
    await post({ imageId: IMAGE_ID, staffId: "impersonated" });
    expect(generateCellSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ staffId: STAFF.staffId, imageId: IMAGE_ID })
    );
  });

  it("passes the request's AbortSignal through to the core", async () => {
    await post({ imageId: IMAGE_ID });
    const [, input] = generateCellSpy.mock.calls[0]!;
    expect((input as { abortSignal?: AbortSignal }).abortSignal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["done", 200],
    ["failed", 200],
    ["not_found", 404],
    ["not_admitted", 409],
    ["already_finalized", 409],
    ["retry_refused", 409],
    ["run_purged", 409],
    ["stale_latched", 409],
    ["not_attempted", 409],
    ["prompt_missing", 409],
    // ⚠ THE GATE REFUSAL. `statusFor` returning 200 for it passed the whole
    // suite once: the table covered only the kinds that predate the gate, so a
    // refusal could regress to "ok" with nothing going red.
    //
    // 403 and not 409/400: the request is well-formed and the cell is in a
    // perfectly good state — what is refused is the MODEL, and a caller that
    // retries it unchanged is refused identically forever.
    //
    // (`child_text_gate` and `child_reference_gate` were also 403 here until
    // 2026-08-06; both were removed with provenance — see `run-rules`.)
    ["unknown_model_gate", 403],
    ["reference_unavailable", 503],
    ["cooldown", 429],
    ["invalid_input", 400],
    ["unavailable", 503],
  ])("maps outcome %s to HTTP %i", async (kind, status) => {
    generateCellSpy.mockResolvedValue({ kind, imageId: IMAGE_ID, reason: "timeout" });
    const response = await post({ imageId: IMAGE_ID });
    expect(response.status).toBe(status);
  });

  it("a thrown core collapses into a typed 503, never Next's error page", async () => {
    generateCellSpy.mockRejectedValue(new Error("boom"));
    const response = await post({ imageId: IMAGE_ID });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { outcome: { kind: string } };
    expect(body.outcome.kind).toBe("unavailable");
  });

  it("never returns a prompt, a slot value or a vendor message", async () => {
    generateCellSpy.mockResolvedValue({
      kind: "failed",
      imageId: IMAGE_ID,
      reason: "safety_blocked",
      detail: "The model's safety filter blocked this generation.",
    });
    const text = await (await post({ imageId: IMAGE_ID })).text();
    expect(text).not.toMatch(/prompt|template|slot/i);
  });
});
