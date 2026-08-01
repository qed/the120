import type { Metadata } from "next";
import ComingSoon from "../ComingSoon";
import GradePathway from "../components/GradePathway";

export const metadata: Metadata = {
  title: "Fast Math Pathway — The Gauntlet",
};

export default function GauntletPathwayPage() {
  if (process.env.GAUNTLET_OPEN !== "1") return <ComingSoon />;
  return <GradePathway backHref="/gauntlet" />;
}
