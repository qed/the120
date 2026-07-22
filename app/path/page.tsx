import type { Metadata } from "next";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { loadStudentProfileForAuth } from "@/app/path/lib/provision-core";
import { signOutPath } from "@/app/path/lib/actions/sign-out";
import { Button } from "@/app/path/components/system/Button";

/**
 * /path landing (T1 Unit 6) — a deliberate PLACEHOLDER until Unit 14's app
 * shells. It exists so the unit's exit check is real: "a name + password
 * sign-in reaches a profile" needs an authenticated surface that proves the
 * session AND the identity graph (grants → profile → roster name) end to end.
 * requirePathUser() is the whole gate — the auth check runs before anything
 * else in the body (no earlier await), and the proxy's JWT fence is only the
 * outer layer. Pre-skin like the sign-in page: HQ neutral treatment.
 */

export const metadata: Metadata = {
  title: "The Path",
  robots: { index: false, follow: false },
};

export default async function PathHomePage() {
  const { grants } = await requirePathUser();

  const selfGrant = grants.find((g) => g.role === "student" && g.scopeType === "student");
  const isParent = grants.some((g) => g.role === "parent" && g.scopeType === "family");

  let firstName: string | null = null;
  if (selfGrant) {
    const profile = await loadStudentProfileForAuth(supabaseAdmin(), selfGrant.scopeId);
    firstName = profile?.firstName ?? null;
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-hq-canvas px-6 py-12">
      <div className="w-full max-w-md rounded-2xl border border-hq-border bg-hq-surface p-8 shadow-hq sm:p-10">
        <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
          The 120
        </p>
        <h1 className="mt-2 font-path-display text-3xl font-semibold tracking-tight text-hq-ink">
          {selfGrant
            ? firstName
              ? `You're on the Path, ${firstName}.`
              : "You're on the Path."
            : isParent
              ? "You're signed in."
              : "The Path"}
        </h1>
        <p className="mt-3 font-path-body text-sm leading-6 text-hq-ink-soft">
          {selfGrant
            ? "Your sign-in works. The map, your tasks, and your Founder File are being built — they arrive here soon."
            : isParent
              ? "The family tools — adding a founder, reviewing work — are being built and arrive here soon."
              : "Your account is set up, but there's nothing here for it yet."}
        </p>

        <form action={signOutPath} className="mt-8">
          <Button type="submit" skin="hq" variant="secondary" size="md">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}
