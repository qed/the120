import Nav from "@/app/components/Nav";
import Hero from "@/app/components/Hero";
import ProductPillars from "@/app/components/ProductPillars";
import TimeBackSimulator from "@/app/components/TimeBackSimulator";
import KeyDates from "@/app/components/KeyDates";
import Promises from "@/app/components/Promises";
import Testimonials from "@/app/components/Testimonials";
import TuitionCard from "@/app/components/TuitionCard";
import Faq from "@/app/components/Faq";
import CtaBand from "@/app/components/CtaBand";
import Footer from "@/app/components/Footer";

export default function Home() {
  return (
    <>
      <Nav />
      <main className="flex-1">
        <Hero />
        <ProductPillars />
        <TimeBackSimulator />
        <KeyDates />
        <Promises />
        <Testimonials />
        <TuitionCard />
        <Faq />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
