import type { Metadata } from "next";
import DashboardProvider from "./store";
import DashboardApp from "./DashboardApp";

export const metadata: Metadata = {
  title: "Your dashboard — The 120",
  description: "Build your child's dossier and submit it for review.",
};

export default function DashboardPage() {
  return (
    <DashboardProvider>
      <DashboardApp />
    </DashboardProvider>
  );
}
