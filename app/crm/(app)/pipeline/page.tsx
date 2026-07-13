import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { fetchFamilyDetail, fetchPipeline } from "@/app/crm/lib/queries";
import PipelineShell from "@/app/crm/components/pipeline/PipelineShell";

export const metadata: Metadata = {
  title: "Pipeline — The 120 (staff)",
  robots: { index: false, follow: false },
};

/**
 * Family pipeline (plan Unit 4): server component — guards, fetches all
 * truth in parallel via the service role, derives stages server-side, and
 * hands plain data to the client shell. `?family={id}` drives the drawer
 * (Next 16: `searchParams` is a Promise — awaited).
 */
export default async function PipelinePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireStaff();

  const params = await searchParams;
  const familyId =
    typeof params.family === "string" ? params.family : undefined;

  const [families, detail] = await Promise.all([
    fetchPipeline(),
    familyId ? fetchFamilyDetail(familyId) : Promise.resolve(null),
  ]);

  return <PipelineShell families={families} detail={detail} />;
}
