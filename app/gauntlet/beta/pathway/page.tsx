import type { Metadata } from "next";
import GradePathway from "../../components/GradePathway";

export const metadata: Metadata = {
  title: "Fast Math Pathway — The Gauntlet",
  robots: { index: false, follow: false },
};

export default function GauntletBetaPathwayPage() {
  return <GradePathway backHref="/gauntlet/beta" />;
}
