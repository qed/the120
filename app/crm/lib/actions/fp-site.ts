"use server";

/**
 * CRM staff action: operator lock/unlock of a child's First Profit public site
 * (real-public-site plan, Unit 2; R22 — the abuse takedown that always wins
 * over `published`). Same alphahub canon as the family actions:
 * requireStaff → Zod safeParse → mutate via supabaseAdmin (the shared core) →
 * `crm_audit_log` insert ('fp-site-lock', allowlisted in 20260908120000) →
 * `{ success, error? }`, never throwing to the client. The CLI twin
 * (scripts/fp-site-lock.ts) drives the SAME core — never a fork.
 */

import { requireStaff } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { z } from "zod";
import {
  recordFpSiteLockAudit,
  setFpSiteOperatorLock,
} from "@/app/fp/lib/fp-site-ops-core";

const lockSchema = z.object({ handle: z.string().min(1).max(80), locked: z.boolean() }).strip();

export interface FpSiteLockActionResult {
  success: boolean;
  error?: string;
  /** False when the lock landed but the audit insert failed (loud in logs). */
  audited?: boolean;
}

export async function setFpSiteLock(input: unknown): Promise<FpSiteLockActionResult> {
  const staff = await requireStaff();
  const parsed = lockSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const result = await setFpSiteOperatorLock(db, parsed.data);
  if (!result.ok) {
    return {
      success: false,
      error:
        result.reason === "not-found"
          ? "No public site has that handle."
          : result.reason === "invalid-handle"
            ? "That is not a valid handle."
            : "Failed to update the lock.",
    };
  }
  const audited = await recordFpSiteLockAudit(db, {
    actor: staff.staffId,
    handle: result.handle,
    locked: result.locked,
  });
  return { success: true, audited };
}
