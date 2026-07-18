import Nav from "@/app/components/Nav";
import Hero from "@/app/components/Hero";
import GroupsBand from "@/app/components/GroupsBand";
import ThreeThings from "@/app/components/ThreeThings";
import HowItWorks from "@/app/components/HowItWorks";
import ParentStoriesBand from "@/app/components/ParentStoriesBand";
import TuitionTeaser from "@/app/components/TuitionTeaser";
import CtaBand from "@/app/components/CtaBand";
import Footer from "@/app/components/Footer";
import { getSeatsRemaining } from "@/app/lib/seats";

export default async function Home() {
  const seatsRemaining = await getSeatsRemaining();
  return (
    <>
      <Nav />
      <main className="flex-1">
        <Hero />
        <GroupsBand seatsRemaining={seatsRemaining} />
        <ThreeThings />
        <HowItWorks />
        {/* GauntletBand pulled until launch (Peter 2026-07-18) — restore with GAUNTLET_OPEN */}
        <ParentStoriesBand />
        <TuitionTeaser />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
