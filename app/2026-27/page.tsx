import type { Metadata } from "next";
import Nav from "@/app/components/Nav";
import Footer from "@/app/components/Footer";
import { getSeatsRemaining } from "@/app/lib/seats";
import { groupLines } from "./data";
import ProgramContent from "./ProgramContent";

export const metadata: Metadata = {
  title: "The 2026-27 Year · The 120",
  description: groupLines.the120,
};

/**
 * /2026-27 — The 120's flagship founding-year recruitment page. Server shell
 * (metadata + live seats + shared Nav/Footer chrome), mirroring the
 * scholars/page.tsx pattern; all interactivity lives in the single
 * <ProgramContent> client island.
 */
export default async function Program202627Page() {
  const seatsRemaining = await getSeatsRemaining();

  return (
    <>
      <Nav />
      <ProgramContent seatsRemaining={seatsRemaining} />
      <Footer />
    </>
  );
}
