"use client";

/**
 * Add-family modal (brief §7, alphahub R12 restyled): required first/last;
 * optional email, phone, spouse, area, source, referral code, kid rows;
 * CASL consent checkbox with date + source. Duplicate probe on blur —
 * an email conflict blocks submit, a name/phone similarity only warns.
 * Escape closes, basic focus trap + focus return (plan a11y baseline).
 */

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SOURCES, SOURCE_LABELS, type Source } from "@/app/crm/lib/constants";
import { addFamily, checkDuplicates } from "@/app/crm/lib/actions/families";
import { useToast } from "@/app/crm/components/Toast";
import { useFocusTrap } from "@/app/crm/components/useFocusTrap";
import { BTN_PRIMARY, BTN_SECONDARY } from "./atoms";

interface KidRow {
  name: string;
  grade: string;
}

const INPUT =
  "w-full rounded-[12px] border border-crm-line2 bg-white px-3 py-2 text-[13.5px] text-crm-ink placeholder:text-crm-faint focus:border-crm-blue focus:outline-none disabled:opacity-50";

const LABEL =
  "mb-1 block font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-muted";

export default function AddFamilyModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const panelRef = useRef<HTMLDivElement>(null);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [spouse, setSpouse] = useState("");
  const [area, setArea] = useState("");
  const [source, setSource] = useState<Source | "">("");
  const [referral, setReferral] = useState("");
  const [kids, setKids] = useState<KidRow[]>([]);
  const [consentGiven, setConsentGiven] = useState(false);
  const [consentDate, setConsentDate] = useState("");
  const [consentSource, setConsentSource] = useState("");

  const [emailConflict, setEmailConflict] = useState<string | null>(null);
  const [similar, setSimilar] = useState<string | null>(null);

  const reset = useCallback(() => {
    setFirstName("");
    setLastName("");
    setEmail("");
    setPhone("");
    setSpouse("");
    setArea("");
    setSource("");
    setReferral("");
    setKids([]);
    setConsentGiven(false);
    setConsentDate("");
    setConsentSource("");
    setEmailConflict(null);
    setSimilar(null);
    setError(null);
  }, []);

  const close = useCallback(() => {
    if (!submitting) onClose();
  }, [onClose, submitting]);

  useFocusTrap(panelRef, open, close);

  // Pre-submit duplicate probe (non-blocking for name+phone, blocking for
  // email) — fired on blur of the identity fields.
  const probeDuplicates = useCallback(async () => {
    const name = `${firstName} ${lastName}`.trim();
    if (!name && !phone && !email) return;
    try {
      const result = await checkDuplicates({ name, phone, email });
      setEmailConflict(result.emailConflict?.name ?? null);
      setSimilar(result.similar?.name ?? null);
    } catch {
      // A failed probe never blocks the modal — the server action re-checks.
    }
  }, [firstName, lastName, phone, email]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const payload: Record<string, unknown> = {
      firstName,
      lastName,
      kids: kids
        .filter((k) => k.name.trim())
        .map((k) => ({ name: k.name, grade: k.grade })),
    };
    if (email.trim()) payload.email = email.trim();
    if (phone.trim()) payload.phone = phone;
    if (spouse.trim()) payload.spouseName = spouse;
    if (area.trim()) payload.area = area;
    if (source) payload.source = source;
    if (referral.trim()) payload.referralCode = referral;
    if (consentGiven) {
      payload.consent = {
        given: true,
        ...(consentDate ? { at: consentDate } : {}),
        ...(consentSource.trim() ? { source: consentSource } : {}),
      };
    }

    const result = await addFamily(payload);
    setSubmitting(false);

    if (result.success) {
      toast("success", "Family added");
      if (result.warning) toast("info", result.warning);
      reset();
      onClose();
      if (result.familyId) {
        router.push(`/crm/pipeline?family=${result.familyId}`, {
          scroll: false,
        });
      } else {
        router.refresh();
      }
    } else {
      setError(result.error ?? "Failed to add the family.");
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Add a family"
    >
      <div
        className="absolute inset-0 bg-crm-ink/40"
        onClick={close}
        aria-hidden
      />

      <div
        ref={panelRef}
        className="relative max-h-[90vh] w-full max-w-[560px] overflow-y-auto rounded-[12px] bg-white shadow-[0_4px_18px_rgba(19,20,22,0.14)]"
      >
        <div className="flex items-start justify-between border-b border-crm-line px-6 py-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-red">
              New family
            </p>
            <h2 className="mt-1 font-serif text-[22px] font-normal text-crm-ink">
              Add a family
            </h2>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="cursor-pointer text-[20px] leading-none text-crm-faint hover:text-crm-ink"
          >
            ×
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {error && (
            <div className="rounded-[10px] border border-crm-red/30 bg-crm-red/5 px-3 py-2 font-mono text-[10.5px] uppercase tracking-[0.06em] text-crm-red">
              {error}
            </div>
          )}
          {emailConflict && (
            <div className="rounded-[10px] border border-crm-red/30 bg-crm-red/5 px-3 py-2 text-[12.5px] text-crm-red">
              A family with this email already exists — {emailConflict}. Open
              it instead of adding a duplicate.
            </div>
          )}
          {similar && !emailConflict && (
            <div className="rounded-[10px] border border-crm-amber/40 bg-crm-blush/30 px-3 py-2 text-[12.5px] text-crm-ink">
              Similar family exists: {similar}. You can still add this one.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fam-first" className={LABEL}>
                First name *
              </label>
              <input
                id="fam-first"
                type="text"
                required
                maxLength={100}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                onBlur={probeDuplicates}
                className={INPUT}
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="fam-last" className={LABEL}>
                Last name *
              </label>
              <input
                id="fam-last"
                type="text"
                required
                maxLength={100}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                onBlur={probeDuplicates}
                className={INPUT}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fam-email" className={LABEL}>
                Email
              </label>
              <input
                id="fam-email"
                type="email"
                maxLength={254}
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setEmailConflict(null);
                }}
                onBlur={probeDuplicates}
                className={INPUT}
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="fam-phone" className={LABEL}>
                Phone
              </label>
              <input
                id="fam-phone"
                type="tel"
                maxLength={30}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={probeDuplicates}
                className={INPUT}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fam-spouse" className={LABEL}>
                Spouse
              </label>
              <input
                id="fam-spouse"
                type="text"
                maxLength={200}
                value={spouse}
                onChange={(e) => setSpouse(e.target.value)}
                className={INPUT}
                disabled={submitting}
              />
            </div>
            <div>
              <label htmlFor="fam-area" className={LABEL}>
                Area
              </label>
              <input
                id="fam-area"
                type="text"
                maxLength={100}
                placeholder="Leaside, Beaches, North York…"
                value={area}
                onChange={(e) => setArea(e.target.value)}
                className={INPUT}
                disabled={submitting}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="fam-source" className={LABEL}>
                Source
              </label>
              <select
                id="fam-source"
                value={source}
                onChange={(e) => setSource(e.target.value as Source | "")}
                className={INPUT}
                disabled={submitting}
              >
                <option value="">Pick a source…</option>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="fam-referral" className={LABEL}>
                Referral code
              </label>
              <input
                id="fam-referral"
                type="text"
                maxLength={40}
                placeholder="AMB-FIRSTNAME"
                value={referral}
                onChange={(e) => setReferral(e.target.value)}
                className={INPUT}
                disabled={submitting}
              />
            </div>
          </div>

          {/* Kids */}
          <fieldset>
            <legend className={LABEL}>Kids</legend>
            <div className="space-y-2">
              {kids.map((kid, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    type="text"
                    aria-label={`Kid ${i + 1} name`}
                    placeholder="Name"
                    maxLength={100}
                    value={kid.name}
                    onChange={(e) =>
                      setKids((prev) =>
                        prev.map((k, j) =>
                          j === i ? { ...k, name: e.target.value } : k
                        )
                      )
                    }
                    className={INPUT}
                    disabled={submitting}
                  />
                  <input
                    type="text"
                    aria-label={`Kid ${i + 1} grade`}
                    placeholder="Grade"
                    maxLength={20}
                    value={kid.grade}
                    onChange={(e) =>
                      setKids((prev) =>
                        prev.map((k, j) =>
                          j === i ? { ...k, grade: e.target.value } : k
                        )
                      )
                    }
                    className={`${INPUT} w-24 flex-none`}
                    disabled={submitting}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setKids((prev) => prev.filter((_, j) => j !== i))
                    }
                    aria-label={`Remove kid ${i + 1}`}
                    className="cursor-pointer px-1 text-[16px] leading-none text-crm-faint hover:text-crm-red"
                    disabled={submitting}
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setKids((prev) => [...prev, { name: "", grade: "" }])
                }
                className="cursor-pointer font-mono text-[10px] uppercase tracking-[0.08em] text-crm-blue hover:underline"
                disabled={submitting || kids.length >= 12}
              >
                + Add kid
              </button>
            </div>
          </fieldset>

          {/* CASL consent */}
          <div className="rounded-[12px] border border-crm-line bg-crm-card p-3.5">
            <label className="flex cursor-pointer items-center gap-2.5">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={(e) => setConsentGiven(e.target.checked)}
                className="h-4 w-4 accent-[#0300ED]"
                disabled={submitting}
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-crm-ink">
                CASL consent given
              </span>
            </label>
            {consentGiven && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="fam-consent-date" className={LABEL}>
                    Consent date
                  </label>
                  <input
                    id="fam-consent-date"
                    type="date"
                    value={consentDate}
                    onChange={(e) => setConsentDate(e.target.value)}
                    className={INPUT}
                    disabled={submitting}
                  />
                </div>
                <div>
                  <label htmlFor="fam-consent-source" className={LABEL}>
                    Consent source
                  </label>
                  <input
                    id="fam-consent-source"
                    type="text"
                    maxLength={200}
                    placeholder="RSVP'd to info session Jul 22"
                    value={consentSource}
                    onChange={(e) => setConsentSource(e.target.value)}
                    className={INPUT}
                    disabled={submitting}
                  />
                </div>
              </div>
            )}
            {!consentGiven && (
              <p className="mt-2 text-[11.5px] text-crm-muted">
                No CASL — private notes only, never emailed, excluded from the
                interested-families KPI.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2.5 pt-1">
            <button
              type="button"
              onClick={close}
              className={BTN_SECONDARY}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={BTN_PRIMARY}
              disabled={submitting || Boolean(emailConflict)}
            >
              {submitting ? "Saving…" : "Add family"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
