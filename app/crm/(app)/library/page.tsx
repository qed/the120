import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { fetchLibrary } from "@/app/crm/lib/queries";
import LibraryGrid from "@/app/crm/components/library/LibraryGrid";

export const metadata: Metadata = {
  title: "Library — The 120 (staff)",
  robots: { index: false, follow: false },
};

/**
 * Content library + send composer (plan Unit 7; brief §9): server component
 * — guards, fetches items + the composer family list via the service role,
 * and hands plain data to the client grid. `?family={id}` (the drawer's
 * SEND FROM LIBRARY route) pre-selects that family in the composer.
 */
export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireStaff();

  const params = await searchParams;
  const familyId =
    typeof params.family === "string" ? params.family : undefined;

  const { items, families } = await fetchLibrary();

  return (
    <LibraryGrid items={items} families={families} initialFamilyId={familyId} />
  );
}
