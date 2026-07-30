import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { ProgressNavCard } from "@/app/components/funnel/ProgressNavCard";
import {
  navCardIdentityName,
  navCardIdentityOnly,
} from "@/app/lib/funnel/nav-card-rules";
import { groups } from "@/app/lib/site";
import {
  parseAcademics,
  planLabel,
  statusMeta,
  type SeatStatus,
} from "@/app/dashboard/data";

/**
 * The one-page application review (2026-07-30, Peter's pick): "Review
 * application" opens THIS — the whole application on a single read-only
 * page — instead of dropping into the locked Basics form. RLS scopes the
 * child read to the signed-in family; a child the session does not own
 * reads as absent and bounces to the dashboard.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Review application — The 120" };

const label = "font-mono text-[0.6rem] uppercase tracking-[0.12em] text-muted";
const value = "mt-0.5 text-[15px] leading-6 text-ink";

function Field({ name, children }: { name: string; children: React.ReactNode }) {
  return (
    <div>
      <p className={label}>{name}</p>
      <p className={value}>{children}</p>
    </div>
  );
}

export default async function ReviewApplicationPage({
  params,
}: {
  params: Promise<{ childId: string }>;
}) {
  const { childId } = await params;
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  const { data: child } = await supabase
    .from("children")
    .select("*")
    .eq("id", childId)
    .maybeSingle();
  if (!child) redirect("/dashboard");

  const [{ data: project }, { data: parentRow }] = await Promise.all([
    supabase
      .from("projects")
      .select("name, description, offer_sketch, first_customer_hypothesis")
      .eq("child_id", childId)
      .eq("status", "active")
      .maybeSingle(),
    supabase
      .from("parents")
      .select("first_name, last_name")
      .eq("id", user.id)
      .maybeSingle(),
  ]);

  const childName =
    `${String(child.first_name ?? "")} ${String(child.last_name ?? "")}`.trim() || "Your child";
  const groupName =
    groups.find((g) => g.slug === String(child.group_slug ?? ""))?.name ?? "";
  const academics = parseAcademics(child.academics).filter(
    (a) => a.subject.trim() !== "" || a.goal.trim() !== ""
  );
  const status = statusMeta(String(child.status ?? "draft") as SeatStatus);
  const projectName = String(project?.name ?? "").trim();

  return (
    <div className="min-h-screen bg-paper text-ink">
      <ProgressNavCard
        model={navCardIdentityOnly(
          navCardIdentityName(
            String(parentRow?.first_name ?? ""),
            String(parentRow?.last_name ?? "")
          )
        )}
      />
      <main className="mx-auto flex w-full max-w-xl flex-col px-6 py-10">
        <Link
          href="/dashboard"
          className="mb-4 inline-flex items-center gap-1 self-start font-mono text-[0.65rem] uppercase tracking-[0.12em] text-muted transition-colors hover:text-ink"
        >
          ← Back to dashboard
        </Link>
        <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-red">
          Application · {status.label}
        </p>
        <h1 className="display mt-2 text-3xl text-ink">{childName}</h1>

        <section className="mt-7 rounded-2xl border border-line bg-white p-6">
          <h2 className="display text-lg text-ink">Basics</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field name="Grade">
              {child.grade == null || child.grade === "" ? "—" : `Grade ${child.grade}`}
            </Field>
            <Field name="Birth year">{String(child.birth_year ?? "").trim() || "—"}</Field>
            <Field name="Current school">
              {String(child.current_school ?? "").trim() || "—"}
            </Field>
            <Field name="Group">{groupName || "—"}</Field>
            <Field name="Child email">
              {child.child_email_none
                ? "Doesn't have one"
                : String(child.child_email ?? "").trim() || "—"}
            </Field>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-line bg-white p-6">
          <h2 className="display text-lg text-ink">Academics</h2>
          {academics.length === 0 ? (
            <p className={`mt-3 ${value}`}>—</p>
          ) : (
            <div className="mt-4 flex flex-col gap-4">
              {academics.map((a, i) => (
                <div key={i}>
                  <p className={value}>
                    <span className="font-semibold">{a.subject || "—"}</span>
                    {a.plan ? ` · ${planLabel(a.plan)}` : ""}
                  </p>
                  {a.goal.trim() !== "" && (
                    <p className="mt-0.5 text-[14px] leading-6 text-ink-soft">{a.goal}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="mt-4 rounded-2xl border border-line bg-white p-6">
          <h2 className="display text-lg text-ink">Interests &amp; project</h2>
          <div className="mt-4 flex flex-col gap-4">
            <Field name="Interests">{String(child.interests ?? "").trim() || "—"}</Field>
            <Field name="Project pitch">
              {String(child.project_pitch ?? "").trim() || "—"}
            </Field>
            <Field name="Portfolio links">
              {String(child.portfolio_links ?? "").trim() || "—"}
            </Field>
          </div>
        </section>

        {project && (
          <section className="mt-4 rounded-2xl border border-line bg-white p-6">
            <h2 className="display text-lg text-ink">
              {projectName || "The company"}
            </h2>
            <div className="mt-4 flex flex-col gap-4">
              {String(project.description ?? "").trim() !== "" && (
                <Field name="The pitch">{String(project.description)}</Field>
              )}
              <Field name="The offer">
                {String(project.offer_sketch ?? "").trim() || "—"}
              </Field>
              <Field name="First customers">
                {String(project.first_customer_hypothesis ?? "").trim() || "—"}
              </Field>
            </div>
          </section>
        )}

        <Link
          href="/dashboard"
          className="mt-8 inline-flex h-11 items-center justify-center self-start rounded-full border border-line-strong px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink hover:border-ink"
        >
          ← Back to the dashboard
        </Link>
      </main>
    </div>
  );
}
