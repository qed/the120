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
