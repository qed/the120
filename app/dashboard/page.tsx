import type { Metadata } from "next";
import DashboardProvider from "./store";
import DashboardApp from "./DashboardApp";
import { getSeatsRemaining } from "@/app/lib/seats";

export const metadata: Metadata = {
  title: "Your dashboard — The 120",
  description: "Build your child's dossier and submit it for review.",
};

export default async function DashboardPage() {
  const seatsRemaining = await getSeatsRemaining();
  return (
    <DashboardProvider>
      <DashboardApp seatsRemaining={seatsRemaining} />
    </DashboardProvider>
  );
}
