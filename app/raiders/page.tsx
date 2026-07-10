import type { Metadata } from "next";
import RaidersGame from "./RaidersGame";

export const metadata: Metadata = {
  title: "MathRaiders — The 120",
  description:
    "FastMath training, boss-battle style: fast correct answers do damage. Multiplication to triangle congruence.",
};

export default function RaidersPage() {
  return <RaidersGame />;
}
