"use client";

/**
 * Step 2 — the kid: full name, age, and the per-kid CONSENT RE-AFFIRMATION.
 *
 * ── WHY CONSENT IS ASKED AGAIN HERE ──
 * `consentGate` binds ONE active consent to ONE child per attempt (a partial
 * unique index). Step 1's checkbox is the account-terms affirmation; the legal,
 * versioned, bound-to-rendered-text consent RECORD is per kid, so the
 * add-another-kid loop re-enters here and captures it again. The full policy
 * text is shown (not linked): the record snapshots what was rendered, and a
 * consent to text nobody displayed is not consent.
 *
 * ── THE DUPLICATE-KID GUARD ──
 * The server matches the typed first+last name (case-insensitively) against the
 * parent's existing CHILDREN and their live DRAFTS. A hit does not silently mint
 * `maya2`; it returns the match and this screen asks. "Resume" walks back into
 * the flow for the kid who already exists; "This is a different child" re-submits
 * with the explicit override — the only way past.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { previewKidSiteAction, v3AddKidAction, v3EditKidAction } from "./actions";
import { splitKidName, type ExistingKid } from "@/app/lib/v3-signup/flow-rules";
// The SAME pure predicates the real handle claim enforces server-side — pure
// module, safe in a client bundle. The preview must never advertise an address
// the backend will refuse.
import { containsBlockedTerm, isReservedHandle } from "@/app/lib/fp/fp-public-site-rules";
import {
  STEP_ORDER,
  V3Button,
  V3Field,
  V3Notice,
  V3StepKicker,
  V3TextButton,
  V3_INPUT_CLASSES,
} from "./v3-ui";

/** The fpv03 S04 kicker: "Step 2 of 3 · Add your kid". The total derives from
 *  STEP_ORDER (3 since U3 retired cover/story), same rule as StepParent's. */
const KID_STEP_KICKER = {
  current: STEP_ORDER.indexOf("kid") + 1,
  total: STEP_ORDER.length,
  label: "Add your kid",
} as const;

/**
 * The FALLBACK website preview under KID'S WEBSITE (fpv03 S04, demoted by the
 * U3 amendment): the AUTHORITATIVE preview is now `previewKidSiteAction` —
 * the shared allocator derivation plus the duplicate ladder against real
 * fp_public_sites rows, debounced below — so what renders is the actual
 * address the kid will get. THIS function remains only as the degrade path
 * (action pending, refused, or failed): a client-side derivation from the
 * kid's first name, lowercase letters and digits, the same first-token split
 * the username generator uses. Nothing from THIS function reaches the wire.
 *
 * The derived slug is screened through the SAME pure predicates the real claim
 * enforces (fpv03 U3 review, adversarial): a kid named Admin (reserved) or a
 * name whose fold trips the blocklist must not be shown a specific address the
 * backend will refuse. Empty when refused; the caller renders the neutral
 * placeholder. (Mirrored by a rules-level test beside the predicates:
 * app/lib/fp/__tests__/fp-public-sites-migration-parity.test.ts.)
 */
function sitePreviewSlug(fullName: string): string {
  const slug = splitKidName(fullName)
    .firstName.toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]/g, "");
  if (slug.length === 0 || isReservedHandle(slug) || containsBlockedTerm(slug)) return "";
  return slug;
}

/** One fully typed name should cost roughly one action call. */
const PREVIEW_DEBOUNCE_MS = 400;

export function StepAddKid({
  consentPolicy,
  draftId,
  initialFullName,
  initialAge,
  onAdded,
  onResumeExisting,
}: {
  consentPolicy: { version: string; hash: string; text: string };
  /** Present when the family is BACK on this step correcting their own draft.
   *  An edit re-uses the draft (and its attempt + consent); it never mints a
   *  second one, because a typo fix is not a new child. */
  draftId: string | null;
  initialFullName: string;
  initialAge: string;
  onAdded: (draftId: string) => void;
  onResumeExisting: (kid: ExistingKid) => void;
}) {
  const [fullName, setFullName] = useState(initialFullName);
  const [age, setAge] = useState(initialAge);
  // TWO checkboxes, ONE attestation (fpv03 S04, founder decision): the site
  // and ToS rows are a PRESENTATIONAL SPLIT of the single version+hash
  // attestation this step has always recorded. Both must be ticked before the
  // one consent echo is sent; nothing about the recording model forks.
  // Founder decision 2026-08-09: all three consent rows arrive PRE-CHECKED
  // (fresh signups included) and the submit CTA requires all three.
  const [siteAccepted, setSiteAccepted] = useState(true);
  const [termsAccepted, setTermsAccepted] = useState(true);
  // The OPTIONAL photo line, DEFAULT ON. Unchecking sends `photoDeclined:
  // true`, which stamps the per-child photo-consent tombstone at child
  // creation (fail-safe: on/absent records nothing).
  const [photoOk, setPhotoOk] = useState(true);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicate, setDuplicate] = useState<ExistingKid | null>(null);
  const [pending, startTransition] = useTransition();

  // The AUTHORITATIVE preview answer (fpv03 U3 amendment, founder request):
  // the debounced server verdict carrying the real allocator's rules —
  // normalization, min length, charset, reserved, blocklist, AND the
  // duplicate ladder (mary → mary2, the claim surface's own variants). The
  // answer remembers WHICH name it was for, so a keystroke instantly demotes
  // a stale answer to the local fallback instead of showing the previous
  // name's address. Advisory only: it never blocks typing or submit, and no
  // failure of it is surfaced.
  const [preview, setPreview] = useState<{ forName: string; handle: string } | null>(null);
  const [previewCallsInFlight, setPreviewCallsInFlight] = useState(0);
  // Monotonic sequence so a slow response for an OLDER name can never
  // overwrite the answer for the current one.
  const previewSeq = useRef(0);

  useEffect(() => {
    const seq = ++previewSeq.current;
    // Nothing typed: placeholder, and no wire call. (State resets are handled
    // by the forName check at render time, not by a setState here.)
    if (splitKidName(fullName).firstName === "") return;
    const timer = setTimeout(() => {
      void (async () => {
        if (previewSeq.current !== seq) return;
        setPreviewCallsInFlight((n) => n + 1);
        try {
          const res = await previewKidSiteAction({ fullName });
          if (previewSeq.current === seq) {
            setPreview(res.kind === "ok" ? { forName: fullName, handle: res.handle } : null);
          }
        } catch {
          // Advisory only — the local predicate preview stands in.
        } finally {
          setPreviewCallsInFlight((n) => n - 1);
        }
      })();
    }, PREVIEW_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [fullName]);

  // What the address line renders: the server answer for THIS name, else the
  // local fallback below. The subtle dim marks an in-flight refresh.
  const serverHandle = preview !== null && preview.forName === fullName ? preview.handle : null;
  const previewPending = previewCallsInFlight > 0;

  const submit = (differentChild: boolean) => {
    setNotice(null);
    startTransition(async () => {
      const result = draftId
        ? await v3EditKidAction({ draftId, fullName: fullName.trim(), age: age.trim() })
        : await v3AddKidAction({
            fullName: fullName.trim(),
            age: age.trim(),
            consentVersion: consentPolicy.version,
            consentHash: consentPolicy.hash,
            ...(differentChild ? { differentChild: true as const } : {}),
            // Only ever sent when the parent UNCHECKED the photo line; the
            // default-on state sends nothing (absent = no tombstone).
            ...(photoOk ? {} : { photoDeclined: true }),
          });
      switch (result.kind) {
        case "added":
          setDuplicate(null);
          onAdded(result.draftId);
          return;
        case "duplicate":
          setDuplicate(result.kid);
          return;
        case "invalid":
          setNotice(result.message);
          return;
        case "capped":
          setNotice(
            "You have a lot of sign-ups on the go already. Finish one of them, or talk to us and we will sort it out."
          );
          return;
        case "consent_refused":
          // The stale-policy path (fpv03 U3 review, learnings): the reload this
          // notice asks for re-renders the NEW consent text, so ticks given to
          // the OLD text must not silently carry. Under the founder's
          // pre-checked model (2026-08-09) the reset restores the DEFAULT
          // state (all three ticked) rather than unticking, and the notice
          // asks the parent to reload so the new text is what stands above
          // the pre-ticked boxes.
          setSiteAccepted(true);
          setTermsAccepted(true);
          setPhotoOk(true);
          setNotice(
            "The consent notice was updated while this page was open. Please reload the page and press the button again."
          );
          return;
        default:
          setNotice("That didn't save just now. Give it a second and try again.");
      }
    });
  };

  // Founder decision 2026-08-09: the CTA is enabled only when ALL THREE rows
  // are ticked (photo included). The edit path (draftId) shows no checkboxes
  // and keeps its consent from the original attestation.
  const allConsentsTicked = draftId !== null || (siteAccepted && termsAccepted && photoOk);

  const onSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;
    if (!allConsentsTicked) {
      setNotice("Please tick all three boxes so we can create your kid's account.");
      return;
    }
    submit(false);
  };

  return (
    <section className="mx-auto w-full max-w-xl px-5 py-10 sm:py-16">
      <V3StepKicker {...KID_STEP_KICKER} />
      <p className="v3-label mt-6 text-v3-one20">Welcome from The 120</p>
      <h1 className="mt-3 font-path-display text-4xl leading-[1.05] font-black text-v3-ink sm:text-5xl">
        Add your kid, and their story starts.
      </h1>
      <p className="mt-4 text-base leading-relaxed text-v3-stone">
        First Profit turns starting a real business into a guided graphic novel. It begins with
        one page: theirs.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-8 space-y-5">
        <V3Field id="v3-kid-name" label="Kid's full name">
          <input
            id="v3-kid-name"
            type="text"
            autoComplete="off"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Remi Newal"
            className={V3_INPUT_CLASSES}
          />
        </V3Field>

        <V3Field id="v3-kid-age" label="Age">
          <input
            id="v3-kid-age"
            type="text"
            inputMode="numeric"
            maxLength={2}
            value={age}
            onChange={(e) => setAge(e.target.value.replace(/\D/g, ""))}
            placeholder="9"
            // Bounded so the field reads as a two-digit box, but `max-w-[8rem]`
            // never exceeds the column at 390px.
            className={`${V3_INPUT_CLASSES} max-w-[8rem]`}
          />
        </V3Field>

        {/* fpv03 S04 + U3 amendment: the KID'S WEBSITE preview. READ-ONLY;
            there is still no handle field — the server answer is the shared
            allocator run over the typed name (previewKidSiteAction), so what
            shows is the actual address provisioning would grant. The real
            domain (firstprofit.school), never the mock's placeholder. */}
        <V3Field id="v3-kid-site" label="Kid's website">
          <p
            id="v3-kid-site"
            className={`${V3_INPUT_CLASSES} cursor-default select-none font-path-mono text-base text-v3-stone`}
          >
            firstprofit.school/
            {/* Server handle first; the local predicate slug while pending or
                on failure; the neutral placeholder when the name yields no
                showable slug (empty, reserved, blocklisted) — never a specific
                address the claim would refuse. The pending dim is the subtle
                loading state: typing is never blocked on it. */}
            <span
              className={`text-v3-ink transition-opacity ${previewPending ? "opacity-60" : ""}`}
            >
              {serverHandle ?? (sitePreviewSlug(fullName) || "your-kid")}
            </span>
          </p>
        </V3Field>

        {!draftId && (
          <div className="space-y-3">
            {/* The split attestation (see the state comment): rows in founder
                order (2026-08-09): ToS first, then site, then photo. All three
                arrive PRE-CHECKED and the CTA requires all three, so a parent
                who unchecks any row (photo included) cannot submit; the
                photoDeclined wiring stays for the post-signup revoke path. */}
            <label className="flex min-h-[44px] items-start gap-3">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 h-5 w-5 flex-none accent-v3-profit"
              />
              <span className="text-sm leading-relaxed text-v3-stone">
                I agree to Terms of Service
              </span>
            </label>
            <label className="flex min-h-[44px] items-start gap-3">
              <input
                type="checkbox"
                checked={siteAccepted}
                onChange={(e) => setSiteAccepted(e.target.checked)}
                className="mt-0.5 h-5 w-5 flex-none accent-v3-profit"
              />
              <span className="text-sm leading-relaxed text-v3-stone">
                I consent to my kid having a website for their new business.
              </span>
            </label>
            <label className="flex min-h-[44px] items-start gap-3">
              <input
                type="checkbox"
                checked={photoOk}
                onChange={(e) => setPhotoOk(e.target.checked)}
                className="mt-0.5 h-5 w-5 flex-none accent-v3-profit"
              />
              <span className="text-sm leading-relaxed text-v3-stone">
                The 120 may use a photo of my kid, if I provide one, in their story artwork.
              </span>
            </label>
            <button
              type="button"
              onClick={() => setPolicyOpen((o) => !o)}
              className="v3-label mt-2 inline-flex min-h-[44px] items-center text-v3-profit underline underline-offset-4"
              aria-expanded={policyOpen}
              aria-controls="v3-consent-text"
            >
              {policyOpen ? "Hide our Terms of Service" : "Read our Terms of Service"}
            </button>
            {/* The RENDERED text: the consent record binds to this, and the
                payload echoes its version + hash. */}
            <div
              id="v3-consent-text"
              hidden={!policyOpen}
              className="mt-2 max-h-64 overflow-y-auto rounded-xl bg-v3-paper/60 p-3 text-[13px] leading-relaxed text-v3-stone"
            >
              <p>{consentPolicy.text}</p>
              <p className="v3-label mt-3 text-v3-stone/70">Version {consentPolicy.version}</p>
            </div>
          </div>
        )}

        {duplicate && (
          <div
            role="alertdialog"
            aria-labelledby="v3-dup-title"
            className="rounded-2xl border border-v3-sun bg-v3-sun/15 p-4"
          >
            <p id="v3-dup-title" className="font-path-display text-lg font-semibold text-v3-ink">
              You already have a {duplicate.firstName} {duplicate.lastName}.
            </p>
            <p className="mt-1 text-sm leading-relaxed text-v3-stone">
              {duplicate.kind === "child"
                ? "That kid already has an account. Pick up where they left off, or tell us this is someone else."
                : "There is already a sign-up in progress for that name. Carry on with it, or tell us this is someone else."}
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <V3Button
                type="button"
                onClick={() => onResumeExisting(duplicate)}
                disabled={pending}
              >
                Resume {duplicate.firstName}
              </V3Button>
              <V3Button
                type="button"
                variant="ghost"
                onClick={() => submit(true)}
                disabled={pending}
              >
                This is a different child
              </V3Button>
            </div>
          </div>
        )}

        {notice && <V3Notice tone="error">{notice}</V3Notice>}

        <V3Button type="submit" disabled={pending || !allConsentsTicked}>
          {pending ? "Saving…" : "Start their journey"}
        </V3Button>
        {draftId && (
          <V3TextButton type="button" onClick={() => onAdded(draftId)} disabled={pending}>
            Keep what I had
          </V3TextButton>
        )}
      </form>
    </section>
  );
}
