import type { Metadata } from "next";
import LoginForm from "./LoginForm";

export const metadata: Metadata = {
  title: "Sign in — The 120",
  robots: { index: false, follow: false },
};

/** Staff sign-in (brief §11): centered bone card on full-bleed #0300ED. */
export default function CrmLoginPage() {
  return <LoginForm />;
}
