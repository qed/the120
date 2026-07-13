import type { Metadata } from "next";
import { after } from "next/server";
import { requireStaff } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { fetchDossierQueue, type DossierItem } from "@/app/crm/lib/queries";
import QueueList from "@/app/crm/components/dossiers/QueueList";
import DossierDetail from "@/app/crm/components/dossiers/DossierDetail";

export const metadata: Metadata = {
  title: "Dossiers — The 120 (staff)",
  robots: { index: false, follow: false },
};

/**
 * Read-audit (Decision 14 / brief §12): opening a child's dossier detail
 * logs a 'drill-down' row. Runs via `after()` so it never blocks render,
 * and skips the insert when the same staff member drilled into the same
 * child within the last 10 minutes (soft-nav dedupe, kept simple). A read
 * audit must never break the page — failures are swallowed.
 */
async function logDrillDown(staffId: string, item: DossierItem): Promise<void> {
  try {
    const db = supabaseAdmin();
    const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const { data } = await db
      .from("crm_audit_log")
      .select("id")
      .eq("actor", staffId)
      .eq("action", "drill-down")
      .eq("child_id", item.childId)
      .gte("created_at", since)
      .limit(1);
    if (data && data.length > 0) return;

    await db.from("crm_audit_log").insert({
      actor: staffId,
      action: "drill-down",
      family_id: item.familyId,
      child_id: item.childId,
      metadata: { review_status: item.reviewStatus },
    });
  } catch {
    // fire-and-forget by design
  }
}

/**
 * Dossier review queue (plan Unit 5 — S5 for real): Admin.dc.html as a
 * working two-pane screen. Server component — guards, fetches all truth in
 * parallel via the service role, and hands plain data to the client panes.
 * `?child={id}` drives the detail (Next 16: `searchParams` is a Promise).
 * Desktop two-pane; stacks (list above detail) below 768px.
 */
export default async function DossiersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const staff = await requireStaff();

  const params = await searchParams;
  const childId = typeof params.child === "string" ? params.child : undefined;

  const items = await fetchDossierQueue();
  const selected = childId
    ? items.find((i) => i.childId === childId) ?? null
    : null;

  if (selected) {
    after(() => logDrillDown(staff.staffId, selected));
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center px-6 py-24 text-center">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-red">
          Dossier queue
        </p>
        <h1 className="mt-3 font-serif text-[28px] font-normal tracking-[-0.01em] text-crm-ink">
          No dossiers yet — families appear here when they submit.
        </h1>
      </div>
    );
  }

  return (
    <div className="grid min-h-full grid-cols-1 md:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      {/* queue — no-print so window.print() yields just the dossier */}
      <div className="no-print border-b border-crm-line px-5 py-6 sm:px-7 md:border-b-0 md:border-r">
        <QueueList items={items} selectedId={selected?.childId ?? null} />
      </div>

      <div className="px-5 py-6 sm:px-7">
        {selected ? (
          <DossierDetail key={selected.childId} item={selected} />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-16 text-center">
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-faint">
              Candidate dossier
            </p>
            <p className="font-serif text-[22px] tracking-[-0.01em] text-crm-muted">
              Pick a dossier from the queue.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
