import type { Metadata } from "next";
import ResetForm from "./ResetForm";

export const metadata: Metadata = {
  title: "Set a new password · The 120",
  robots: { index: false, follow: false },
};

/** Landing page for parent password-recovery emails (SignIn "Forgot password?"). */
export default function ResetPage() {
  return <ResetForm />;
}
