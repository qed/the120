import type { Metadata } from "next";
import ResetForm from "./ResetForm";

export const metadata: Metadata = {
  title: "Set a new password · The 120",
  robots: { index: false, follow: false },
};

/**
 * Landing page for the password-recovery email (LoginForm's "Forgot
 * password?" → Supabase recovery link → here). Unguarded in proxy.ts by
 * necessity — the visitor has no session until the client exchanges the
 * link's code — and safe unguarded: with a valid recovery session you can
 * only change your own password; without one the form refuses.
 */
export default function ResetPage() {
  return <ResetForm />;
}
