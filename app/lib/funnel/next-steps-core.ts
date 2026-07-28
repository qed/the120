import "server-only";

/**
 * Next Steps (funnel U14; R50) — the goal save. RLS-authorized like every
 * parent-session funnel core: no supabaseAdmin, the children policy scopes
 * the write.
 */

import { z } from "zod";
import { supabaseServer } from "@/app/lib/supabase/server";
import { GOAL_MAX_CHARS } from "@/app/lib/funnel/deposit-rules";
import { capWellFormed } from "@/app/lib/funnel/moderation";

export type GoalDeps = {
  session: () => Promise<{
    userId: string | null;
    writeGoal: (childId: string, goal: string) => Promise<boolean>;
  }>;
};

function realDeps(): GoalDeps {
  return {
    session: async () => {
      const supabase = await supabaseServer();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      return {
        userId: user?.id ?? null,
        writeGoal: async (childId, goal) => {
          // ZERO matched rows (foreign or stale childId under RLS) is a
          // FAILURE, not a silent fake success — the family must never see
          // "saved" for a write that persisted nothing (both reviewers).
          const { data, error } = await supabase
            .from("children")
            .update({ family_goal: goal })
            .eq("id", childId)
            .select("id");
          if (error) {
            console.error("[funnel/next-steps] goal write failed:", error.message);
            return false;
          }
          return (data ?? []).length > 0;
        },
      };
    },
  };
}

const goalSchema = z.object({
  childId: z.uuid(),
  goal: z.string().max(GOAL_MAX_CHARS * 4),
});

export type SaveGoalResult =
  | { kind: "saved"; goal: string }
  | { kind: "invalid" }
  | { kind: "unauthenticated" }
  | { kind: "failed" };

export async function saveGoalCore(
  input: unknown,
  deps: GoalDeps = realDeps()
): Promise<SaveGoalResult> {
  try {
    const parsed = goalSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid" };
    const session = await deps.session();
    if (!session.userId) return { kind: "unauthenticated" };
    // Server-side cap regardless of the textarea's client cap; the fence
    // characters never enter stored funnel text (the U9/U10 invariant).
    const goal = capWellFormed(
      parsed.data.goal.replace(/[⟦⟧]/g, "").trim(),
      GOAL_MAX_CHARS
    );
    const ok = await session.writeGoal(parsed.data.childId, goal);
    return ok ? { kind: "saved", goal } : { kind: "failed" };
  } catch (err) {
    console.error("[funnel/next-steps] goal exception:", err);
    return { kind: "failed" };
  }
}
