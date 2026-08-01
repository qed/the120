/**
 * SCRIPT-SAFE construction of `EraseFamilyDeps` for the R28 erase entrypoint
 * (scripts/erase-fp-family.ts), which runs under `tsx`.
 *
 * WHY THIS EXISTS (security review P1): the production factory
 * `realEraseFamilyDeps()` lives in `app/lib/funnel/provision-deps.ts`, whose very
 * first import is `@/app/lib/supabase/admin`, whose first line is
 * `import "server-only"`. `server-only` is a Next.js *runtime alias*, not an
 * installed package, so under `tsx` that module chain fails to load with
 * `Cannot find module 'server-only'` BEFORE `main()` ever runs — every run (dry
 * and real) was dead on arrival. So this factory mirrors `realEraseFamilyDeps`
 * WITHOUT the server-only chain: it builds the service-role client with
 * `createClient(url, SERVICE_ROLE_KEY, …)` directly (the same approach
 * scripts/rls-reprobe-fp-parent.ts uses) and lazily imports googleapis for the
 * credential-gated Workspace legs.
 *
 * SOURCE OF TRUTH: the effect semantics here are a deliberate, minimal mirror of
 * `realEraseFamilyDeps()` / the Workspace helpers in
 * `app/lib/funnel/provision-deps.ts`. Keep them in lockstep:
 *   - `workspaceConfigured` gates on GOOGLE_WORKSPACE_SA_KEY (absent → both
 *     Google legs skipped by the core, no Directory call);
 *   - suspend/delete are idempotent (a 404 → "missing");
 *   - deleteAuthUser treats a 404 as ok (already-gone account = successful erase);
 *   - failure branches NEVER log a minor's full @the120.school address — only a
 *     hashed local_part tag + the HTTP status (FIX 6a).
 */

import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { EraseFamilyDeps } from "@/app/lib/funnel/erase-family-core";
import { buildWorkspaceJwtConfig } from "@/app/lib/funnel/workspace-auth";

const saKeyRaw = (): string => process.env.GOOGLE_WORKSPACE_SA_KEY ?? "";

/** Mirror of provision-deps.DirectoryClient, narrowed to the erase legs. */
type DirectoryClient = {
  users: {
    update: (params: Record<string, unknown>) => Promise<unknown>;
    delete: (params: Record<string, unknown>) => Promise<unknown>;
  };
};

let cachedDirectory: Promise<DirectoryClient> | null = null;

/** Lazy googleapis Directory client — nothing Google-shaped is constructed at
 *  import time or when GOOGLE_WORKSPACE_SA_KEY is absent (mirrors
 *  provision-deps.directoryClient). Cached per process; a failed build unsticks. */
async function directoryClient(): Promise<DirectoryClient> {
  if (!cachedDirectory) {
    cachedDirectory = (async () => {
      const { google } = await import("googleapis");
      // DWD: impersonate a Workspace admin when GOOGLE_WORKSPACE_ADMIN_SUBJECT is
      // set (standard path), else SA-as-itself (direct role). Mirrors provision-deps.
      const auth = new google.auth.JWT(
        buildWorkspaceJwtConfig(
          saKeyRaw(),
          ["https://www.googleapis.com/auth/admin.directory.user"],
          process.env.GOOGLE_WORKSPACE_ADMIN_SUBJECT ?? ""
        )
      );
      return google.admin({ version: "directory_v1", auth }) as unknown as DirectoryClient;
    })();
    cachedDirectory.catch(() => {
      cachedDirectory = null;
    });
  }
  return cachedDirectory;
}

/** A non-reversible tag for a mailbox address — logs must never print a minor's
 *  full @the120.school address (FIX 6a). Mirror of provision-deps.localPartTag. */
const localPartTag = (email: string): string => {
  const local = (email.split("@")[0] ?? "").trim().toLowerCase();
  return createHash("sha256").update(local).digest("hex").slice(0, 12);
};

/** Mirror of provision-deps.googleStatus — pull an HTTP status off a Google/PG
 *  error however it is shaped. */
const googleStatus = (err: unknown): number | null => {
  const e = err as { code?: unknown; response?: { status?: unknown } };
  const code = typeof e?.code === "number" ? e.code : Number(e?.code);
  if (Number.isFinite(code)) return code;
  const status = e?.response?.status;
  return typeof status === "number" ? status : null;
};

/**
 * Build the `EraseFamilyDeps` the core needs, script-safe. Reads the service-role
 * pair off the environment (loadSupabaseEnv must have populated it and the caller
 * must have asserted SUPABASE_SERVICE_ROLE_KEY is present — this is a service-role
 * admin operation, never a parent/anon token).
 */
export function scriptEraseFamilyDeps(): EraseFamilyDeps {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return {
    db,
    workspaceConfigured: saKeyRaw().length > 0,
    deleteAuthUser: async (userId) => {
      const res = await db.auth.admin.deleteUser(userId);
      if (res.error) {
        const status = googleStatus(res.error);
        if (status === 404) return { ok: true }; // already gone = idempotent success
        console.error(`[erase] deleteUser failed for ${userId}: ${res.error.message}`);
        return { ok: false };
      }
      return { ok: true };
    },
    suspendWorkspaceUser: async (email) => {
      try {
        const dir = await directoryClient();
        await dir.users.update({ userKey: email, requestBody: { suspended: true } });
        return "suspended";
      } catch (err) {
        if (googleStatus(err) === 404) return "missing";
        console.error(
          `[erase] workspace suspend failed (local_part#${localPartTag(email)}, status ${googleStatus(err)})`
        );
        return "error";
      }
    },
    deleteWorkspaceUser: async (email) => {
      try {
        const dir = await directoryClient();
        await dir.users.delete({ userKey: email });
        return "deleted";
      } catch (err) {
        if (googleStatus(err) === 404) return "missing";
        console.error(
          `[erase] workspace delete failed (local_part#${localPartTag(email)}, status ${googleStatus(err)})`
        );
        return "error";
      }
    },
    now: () => Date.now(),
  };
}
