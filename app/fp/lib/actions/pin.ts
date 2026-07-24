"use server";

/**
 * The Now-card pin actions (T1 Unit 14). A STUDENT override for the Now
 * selection ("I want to work on this one"): device-local cookie, scoped per
 * student profile — see `pinCookieName` in now-card-rules.ts for why it is not
 * a DB column in T1.
 *
 * Same canon as every Path action: gate → zod → authorize → effect → typed
 * result. Only the student themself may pin (the pin is THEIR focus choice —
 * a parent browsing the child's map must not move it); the profile id comes
 * from the caller's own self-grant, never a client field.
 */

import { cookies } from "next/headers";
import { z } from "zod";
import { requirePathUser } from "@/app/fp/lib/auth";
import { pinCookieName } from "@/app/fp/lib/now-card-rules";

const PIN_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // a stale pin is ignored by the rule anyway

const pinSchema = z.object({
  taskId: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export type PinResult = { ok: true } | { ok: false; reason: "forbidden" | "invalid_input" };

export async function pinNowTask(input: unknown): Promise<PinResult> {
  const { grants } = await requirePathUser();
  const parsed = pinSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };

  const selfGrant = grants.find((g) => g.role === "student" && g.scopeType === "student");
  if (!selfGrant) return { ok: false, reason: "forbidden" };

  (await cookies()).set(pinCookieName(selfGrant.scopeId), parsed.data.taskId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/fp",
    maxAge: PIN_MAX_AGE_SECONDS,
  });
  return { ok: true };
}

export async function clearNowPin(): Promise<PinResult> {
  const { grants } = await requirePathUser();
  const selfGrant = grants.find((g) => g.role === "student" && g.scopeType === "student");
  if (!selfGrant) return { ok: false, reason: "forbidden" };

  (await cookies()).delete(pinCookieName(selfGrant.scopeId));
  return { ok: true };
}
