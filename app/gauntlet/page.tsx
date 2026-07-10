import type { Metadata } from "next";
import GauntletGame from "./GauntletGame";

export const metadata: Metadata = {
  title: "The Gauntlet — The 120",
  description:
    "FastMath training, boss-battle style: fast correct answers do damage. Multiplication to triangle congruence.",
};

export default function GauntletPage() {
  return <GauntletGame />;
}
