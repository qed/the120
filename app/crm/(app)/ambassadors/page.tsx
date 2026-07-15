import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  computeAmbassadorReport,
  type AmbassadorCode,
  type AmbassadorSignupFamily,
} from "@/app/crm/lib/ambassadors";
import AmbassadorConsole from "@/app/crm/components/ambassadors/AmbassadorConsole";

export const metadata: Metadata = {
  title: "Ambassadors — The 120 (staff)",
  robots: { index: false, follow: false },
};

/**
 * Ambassador reporting (GTM-4; brief §8) — issued-code registry + per-code
 * leads / accounts / deposits, every number derived from truth (never
 * hand-entered). Deposits map paid rows parent → family, exactly like the
 * dashboard's Source & ambassador tally, so the two can't disagree. The
 * registry read is tolerated pre-migration (empty registry → codes still show
 * from signups), same posture as the gtm_* / library reads.
 */
export default async function AmbassadorsPage() {
  await requireStaff();
  const db = supabaseAdmin();

  const [registryRes, familiesRes, depositsRes] = await Promise.all([
    db
      .from("ambassador_codes")
      .select("code, owner_name, note, created_at"),
    db
      .from("families")
      .select("id, parent_id, referral_code")
      .is("merged_into_id", null),
    db.from("deposits").select("parent_id, status"),
  ]);

  // Families + deposits are truth tables — a real error must surface, never
  // render as an empty tally. The registry is deliberately tolerated.
  for (const res of [familiesRes, depositsRes]) {
    if (res.error) {
      throw new Error(`Ambassadors fetch failed: ${res.error.message}`);
    }
  }

  const registry: AmbassadorCode[] = registryRes.error
    ? []
    : (
        (registryRes.data ?? []) as {
          code: string;
          owner_name: string;
          note: string;
          created_at: string;
        }[]
      ).map((r) => ({
        code: r.code,
        ownerName: r.owner_name ?? "",
        note: r.note ?? "",
        createdAt: r.created_at,
      }));

  const families = (familiesRes.data ?? []) as {
    id: string;
    parent_id: string | null;
    referral_code: string;
  }[];
  const signupFamilies: AmbassadorSignupFamily[] = families.map((f) => ({
    id: f.id,
    referralCode: f.referral_code ?? "",
    hasAccount: Boolean(f.parent_id),
  }));

  // One family id per paid deposit (duplicates OK — matches computeSourceTally).
  const familyByParent = new Map(
    families
      .filter((f) => f.parent_id)
      .map((f) => [f.parent_id as string, f.id])
  );
  const depositFamilyIds = (
    (depositsRes.data ?? []) as { parent_id: string; status: string }[]
  )
    .filter((d) => d.status === "paid")
    .map((d) => familyByParent.get(d.parent_id))
    .filter((id): id is string => Boolean(id));

  const report = computeAmbassadorReport(
    registry,
    signupFamilies,
    depositFamilyIds
  );

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-5 py-6 sm:px-7">
      <header>
        <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-crm-faint">
          GTM · Ambassadors
        </p>
        <h1 className="mt-1 font-mono text-[15px] uppercase tracking-[0.06em] text-crm-ink">
          Referral code tally
        </h1>
        <p className="mt-1.5 max-w-[60ch] text-[12.5px] leading-5 text-crm-muted">
          Every issued code and what it produced — leads, linked accounts, and
          paid deposits. The Friday-review number, in one place.
        </p>
      </header>

      <AmbassadorConsole report={report} />
    </div>
  );
}
