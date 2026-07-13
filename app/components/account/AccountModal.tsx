"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import { supabaseBrowser } from "@/app/lib/supabase/client";

/**
 * Account creation — the lead-capture step of the funnel (brief §13.2).
 * S1: creates a real Supabase user (email + password, auto-confirmed until
 * custom SMTP exists) and persists the parent profile to the `parents` table.
 */
export type AccountForm = {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  phone: string;
  postalCode: string;
  heardAbout: string;
  referralCode: string;
  caslConsent: boolean;
};

const EMPTY: AccountForm = {
  firstName: "",
  lastName: "",
  email: "",
  password: "",
  phone: "",
  postalCode: "",
  heardAbout: "",
  referralCode: "",
  caslConsent: false,
};

/** Attribution options (GTM: ambassadors, verticals). Both fields optional. */
const HEARD_ABOUT_OPTIONS = [
  "A friend or ambassador",
  "Parent group or forum",
  "My child's school",
  "Coach or program director",
  "Search",
  "Event",
  "Other",
];

const POSTAL = /^[A-Za-z]\d[A-Za-z]\s?\d[A-Za-z]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Errors = Partial<Record<keyof AccountForm, string>>;

function validate(f: AccountForm): Errors {
  const e: Errors = {};
  if (!f.firstName.trim()) e.firstName = "Required";
  if (!f.lastName.trim()) e.lastName = "Required";
  if (!EMAIL.test(f.email)) e.email = "Enter a valid email";
  if (f.password.length < 8) e.password = "At least 8 characters";
  if (f.phone.replace(/\D/g, "").length < 10) e.phone = "Enter a valid phone number";
  if (!POSTAL.test(f.postalCode.trim())) e.postalCode = "Enter a valid postal code (e.g. M5V 2T6)";
  if (!f.caslConsent) e.caslConsent = "Consent is required to create your account";
  return e;
}

export default function AccountModal({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [form, setForm] = useState<AccountForm>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [submitted, setSubmitted] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Reset + focus + scroll-lock + Esc handling while open.
  useEffect(() => {
    if (!isOpen) return;
    setForm(EMPTY);
    setErrors({});
    setSubmitted(false);
    setNeedsConfirm(false);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => firstFieldRef.current?.focus(), 60);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKey);
      clearTimeout(t);
    };
  }, [isOpen, onClose]);

  const set = <K extends keyof AccountForm>(key: K, value: AccountForm[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const eObj = validate(form);
    setErrors(eObj);
    if (Object.keys(eObj).length > 0) return;

    setSaving(true);
    setSubmitError(null);
    try {
      const supabase = supabaseBrowser();
      const heardAbout = form.heardAbout.trim();
      const referralCode = form.referralCode.trim().toUpperCase();

      const { data, error } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: {
          emailRedirectTo: `${window.location.origin}/dashboard`,
          data: {
            first_name: form.firstName,
            last_name: form.lastName,
            // The full profile lives in auth metadata: with email confirmations
            // on there is no session at signup, so the dashboard creates the
            // parents row from this metadata on the first signed-in visit.
            phone: form.phone,
            postal_code: form.postalCode.trim().toUpperCase(),
            casl_consent: form.caslConsent,
            casl_consent_at: new Date().toISOString(),
            heard_about: heardAbout,
            referral_code: referralCode,
          },
        },
      });
      if (error) throw error;
      const userId = data.user?.id;
      if (!userId) throw new Error("Account created but no user returned — try signing in.");

      if (!data.session) {
        // Email confirmations are on — no session until the link is clicked,
        // so the parents upsert below would be rejected by RLS. The dashboard
        // (store.tsx) creates the row post-confirmation and sends welcome #1.
        setNeedsConfirm(true);
        setSubmitted(true);
        return;
      }

      const baseProfile = {
        id: userId,
        first_name: form.firstName,
        last_name: form.lastName,
        email: form.email,
        phone: form.phone,
        postal_code: form.postalCode.trim().toUpperCase(),
        casl_consent: form.caslConsent,
        casl_consent_at: new Date().toISOString(),
      };
      let { error: profileError } = await supabase
        .from("parents")
        .upsert({ ...baseProfile, heard_about: heardAbout, referral_code: referralCode });
      if (profileError && /heard_about|referral_code|column/i.test(profileError.message)) {
        // Migration not applied yet — save the profile without attribution columns
        // (attribution still lives in auth metadata above).
        ({ error: profileError } = await supabase.from("parents").upsert(baseProfile));
      }
      if (profileError) throw profileError;

      // E3: welcome email #1 — fire-and-forget; the route is idempotent and
      // a send failure must never block account creation.
      const accessToken = data.session?.access_token;
      if (accessToken) {
        void fetch("/api/welcome", {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        }).catch(() => {});
      }

      setSubmitted(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Something went wrong — try again.";
      setSubmitError(
        /already registered/i.test(message)
          ? "That email already has an account — sign in from the dashboard instead."
          : message
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto p-4 sm:items-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          aria-hidden={false}
        >
          {/* backdrop */}
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="fixed inset-0 -z-10 cursor-default bg-ink/60 backdrop-blur-sm"
          />

          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-modal-title"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="relative my-8 w-full max-w-lg overflow-hidden rounded-3xl bg-paper shadow-[0_0_0_1px_rgba(19,20,22,0.06),0_8px_16px_-8px_rgba(19,20,22,0.2),0_32px_80px_-16px_rgba(19,20,22,0.5)]"
          >
            {/* Letterhead accent */}
            <div className="h-1 bg-red" />

            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute right-4 top-5 z-10 flex h-9 w-9 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-line"
            >
              ✕
            </button>

            {submitted ? (
              <SuccessView
                firstName={form.firstName}
                email={form.email}
                needsConfirm={needsConfirm}
                onClose={onClose}
              />
            ) : (
              <div className="max-h-[85vh] overflow-y-auto px-7 py-8 sm:px-9">
                <p className="eyebrow">Founding cohort · Fall 2026</p>
                <h2
                  id="account-modal-title"
                  className="mt-3 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl"
                >
                  Claim your child&rsquo;s seat.
                </h2>
                <p className="mt-2 text-sm leading-6 text-ink-soft">
                  Create your parent account. Next, you&rsquo;ll build your child&rsquo;s dossier and
                  submit it for review — an assessment invitation follows.
                </p>

                <form className="mt-6 space-y-4" onSubmit={handleSubmit} noValidate>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Parent first name" error={errors.firstName}>
                      <input
                        ref={firstFieldRef}
                        className={inputCls(errors.firstName)}
                        value={form.firstName}
                        onChange={(e) => set("firstName", e.target.value)}
                        autoComplete="given-name"
                      />
                    </Field>
                    <Field label="Last name" error={errors.lastName}>
                      <input
                        className={inputCls(errors.lastName)}
                        value={form.lastName}
                        onChange={(e) => set("lastName", e.target.value)}
                        autoComplete="family-name"
                      />
                    </Field>
                  </div>

                  <Field label="Email" error={errors.email}>
                    <input
                      type="email"
                      className={inputCls(errors.email)}
                      value={form.email}
                      onChange={(e) => set("email", e.target.value)}
                      autoComplete="email"
                    />
                  </Field>

                  <Field label="Password" error={errors.password}>
                    <input
                      type="password"
                      className={inputCls(errors.password)}
                      value={form.password}
                      onChange={(e) => set("password", e.target.value)}
                      autoComplete="new-password"
                      placeholder="At least 8 characters"
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Phone" error={errors.phone}>
                      <input
                        type="tel"
                        className={inputCls(errors.phone)}
                        value={form.phone}
                        onChange={(e) => set("phone", e.target.value)}
                        autoComplete="tel"
                        placeholder="(416) 555-0123"
                      />
                    </Field>
                    <Field label="Postal code" error={errors.postalCode}>
                      <input
                        className={inputCls(errors.postalCode)}
                        value={form.postalCode}
                        onChange={(e) => set("postalCode", e.target.value.toUpperCase())}
                        autoComplete="postal-code"
                        placeholder="M5V 2T6"
                        maxLength={7}
                      />
                    </Field>
                  </div>

                  {/* Attribution (optional): how they heard + ambassador/referral code */}
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">
                        How did you hear about us?
                      </span>
                      <select
                        className={inputCls()}
                        value={form.heardAbout}
                        onChange={(e) => set("heardAbout", e.target.value)}
                      >
                        <option value="">Optional — pick one</option>
                        {HEARD_ABOUT_OPTIONS.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Field label="Referral code (optional)">
                      <input
                        className={inputCls()}
                        value={form.referralCode}
                        onChange={(e) => set("referralCode", e.target.value.toUpperCase())}
                        placeholder="AMB-NAME"
                        maxLength={24}
                      />
                    </Field>
                  </div>

                  {/* CASL express opt-in (brief §13.2, §14.7) — Canadian, not GT's US SMS text */}
                  <label
                    className={`flex cursor-pointer gap-3 rounded-xl border p-3.5 text-xs leading-5 transition-colors ${
                      errors.caslConsent ? "border-red bg-red/5" : "border-line bg-white"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5 h-4 w-4 flex-none accent-red"
                      checked={form.caslConsent}
                      onChange={(e) => set("caslConsent", e.target.checked)}
                    />
                    <span className="text-ink-soft">
                      Yes — The 120 (GT Toronto) may email and text me about my application, seat
                      status, events, and enrolment. I can withdraw consent anytime via the
                      unsubscribe link or by emailing{" "}
                      <span className="text-ink">admissions@the120.school</span>.
                    </span>
                  </label>
                  {errors.caslConsent && <ErrorText>{errors.caslConsent}</ErrorText>}

                  {submitError && (
                    <p className="rounded-xl border border-red bg-red/5 p-3 text-xs leading-5 text-red">
                      {submitError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={saving}
                    className="mt-2 inline-flex h-12 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-xs font-medium uppercase tracking-[0.14em] text-white shadow-sm shadow-red/20 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-red-dark hover:shadow-md hover:shadow-red/30 active:translate-y-0 disabled:cursor-wait disabled:opacity-60"
                  >
                    {saving ? "Creating your account…" : "Create account & claim seat"}
                  </button>

                  <p className="text-center text-[0.7rem] leading-4 text-muted">
                    Already started?{" "}
                    <Link href="/dashboard" className="text-ink underline underline-offset-2">
                      Sign in
                    </Link>
                    . Your information is stored securely and used only for admissions (PIPEDA).
                  </p>
                </form>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- success ---------- */

function SuccessView({
  firstName,
  email,
  needsConfirm,
  onClose,
}: {
  firstName: string;
  email: string;
  needsConfirm: boolean;
  onClose: () => void;
}) {
  const steps = needsConfirm
    ? [
        `Open the confirmation email we just sent to ${email}.`,
        "Click the link — it signs you in and opens your dashboard.",
        "Add your child and build their dossier — submit for review when ready.",
      ]
    : [
        "You're signed in — your account is live.",
        "Add your child and build their dossier in the dashboard.",
        "Submit for review → we invite you to a qualifying assessment + call.",
      ];
  return (
    <div className="px-7 py-10 text-center sm:px-9">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red/10 text-2xl text-red">
        ✓
      </div>
      <h2 className="mt-5 font-display text-2xl font-bold tracking-tight text-ink">
        {needsConfirm ? "Check your inbox" : "You're in"}
        {firstName ? `, ${firstName}` : ""}.
      </h2>
      <p className="mt-2 text-sm leading-6 text-ink-soft">
        {needsConfirm
          ? "One step left: confirm your email address to activate your account."
          : "Your account is created and you're in the funnel — nurture updates start now. Here's what happens next:"}
      </p>

      <ol className="mx-auto mt-6 max-w-sm space-y-3 text-left">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-sm text-ink-soft">
            <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-blue font-mono text-xs text-white">
              {i + 1}
            </span>
            {s}
          </li>
        ))}
      </ol>

      <div className="mt-6 flex flex-col items-center gap-3">
        {needsConfirm ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-12 items-center justify-center rounded-full bg-red px-8 font-mono text-xs uppercase tracking-[0.14em] text-white hover:bg-red-dark"
          >
            Done — I&rsquo;ll check my email
          </button>
        ) : (
          <>
            <Link
              href="/dashboard"
              onClick={onClose}
              className="inline-flex h-12 items-center justify-center rounded-full bg-red px-8 font-mono text-xs uppercase tracking-[0.14em] text-white hover:bg-red-dark"
            >
              Go to your dashboard →
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="font-mono text-[0.7rem] uppercase tracking-[0.12em] text-muted hover:text-ink"
            >
              Later
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- field primitives ---------- */

function inputCls(error?: string) {
  return `h-11 w-full rounded-xl border bg-white px-3.5 text-sm text-ink outline-none transition-all duration-150 placeholder:text-muted focus:border-red focus:ring-4 focus:ring-red/10 ${
    error ? "border-red" : "border-line-strong"
  }`;
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink-soft">
        {label}
      </span>
      {children}
      {error && <ErrorText>{error}</ErrorText>}
    </label>
  );
}

function ErrorText({ children }: { children: React.ReactNode }) {
  return <span className="mt-1 block font-mono text-[0.65rem] text-red">{children}</span>;
}
