"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "motion/react";
import Wordmark from "./Wordmark";
import Cta from "./Cta";
import StartCta from "./StartCta";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import { nav as defaultLinks, isActiveNav } from "@/app/lib/site";
import {
  NAV_RESERVE_CTA,
  showReserveCta,
  type NavChildRow,
  type NavDepositRow,
} from "@/app/lib/nav-reserve-rules";

/**
 * Floating card nav (handoff): white, radius 14px, floats 18px from the top
 * with side margins, over hero imagery. One nav for every page — The 120 is
 * the product; groups (including the Scholars) are sub-pages with no variant
 * chrome. Links are identical site-wide by design.
 *
 * Session-aware CTA: signed-in families see "My dashboard" where "Join the
 * 120" sits (and no redundant "Sign in" link). Defaults to the signed-out
 * state so the static render never flashes for anonymous visitors.
 */
export default function Nav() {
  const [open, setOpen] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  // Direct reserve (2026-08-02, U4): the rows behind the deposit CTA.
  // null = not yet resolved → the CTA stays hidden (no-flash convention);
  // the pure predicate decides everything else, and the label/href come
  // only from NAV_RESERVE_CTA.
  const [reserveChildren, setReserveChildren] = useState<NavChildRow[] | null>(null);
  const [reserveDeposits, setReserveDeposits] = useState<NavDepositRow[] | null>(null);
  const items = [...defaultLinks];
  const pathname = usePathname();

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSignedIn(Boolean(session));
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSignedIn(Boolean(session));
    });
    return () => subscription.unsubscribe();
  }, []);

  // RLS-scoped browser-client reads (the dashboard store's pattern) — never
  // a service-role query for nav convenience. Re-runs on auth change AND on
  // navigation, so a just-paid parent loses the CTA on their next page move
  // (accepted staleness window, pilot scale). Signed out → rows reset to
  // null and the CTA hides.
  useEffect(() => {
    if (!signedIn) {
      // ⚠ KNOWN LINT EXCEPTION, deliberately not "fixed" in the commit that
      // turned lint into a gate. `react-hooks/set-state-in-effect` is right in
      // general — a synchronous setState in an effect can cascade renders —
      // but this particular pair IS the fail-safe described above: signed out
      // must reset the rows to null so a paid-parent CTA can never linger for
      // a signed-out visitor. Rewriting it (deriving the CTA instead of
      // storing rows, or moving the reset into the auth-change handler, which
      // would miss the on-navigation re-run) changes auth-visible nav
      // behaviour, which is not something to do as a side effect of plumbing
      // eslint into `npm run ship`. Suppressed HERE, narrowly, with the real
      // fix tracked as its own change so it gets its own review.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReserveChildren(null);
      setReserveDeposits(null);
      return;
    }
    let cancelled = false;
    const supabase = supabaseBrowser();
    Promise.all([
      supabase.from("children").select("id"),
      supabase.from("deposits").select("child_id,status"),
    ])
      .then(([kids, deps]) => {
        if (cancelled) return;
        setReserveChildren((kids.data as NavChildRow[] | null) ?? null);
        setReserveDeposits((deps.data as NavDepositRow[] | null) ?? null);
      })
      .catch(() => {
        // Fail safe to hidden (null), never a stale carry-over from the
        // previous route's rows — and no unhandled-rejection noise.
        if (cancelled) return;
        setReserveChildren(null);
        setReserveDeposits(null);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, pathname]);

  const showReserve = signedIn && showReserveCta(reserveChildren, reserveDeposits);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <header className="sticky top-[18px] z-50 mx-5 mt-[18px]">
      <div className="rounded-[14px] bg-white shadow-[0_4px_18px_rgba(19,20,22,0.14)]">
        {/* min-h-16 mirrors ProgressNavCard's row — the funnel's floating
            card holds the exact same geometry (2026-07-30); change together. */}
        <div className="flex min-h-16 items-center justify-between px-[22px] py-[11px]">
          <span className="flex items-center gap-4">
            <Link href="/" aria-label="The 120 home" onClick={close}>
              <Wordmark sublabel="TORONTO" />
            </Link>
          </span>

          {/* Desktop links */}
          <span className="hidden items-center gap-[18px] lg:flex">
            {items.map((item) => {
              const active = isActiveNav(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`whitespace-nowrap text-sm transition-colors ${
                    active
                      ? "text-red font-semibold"
                      : "text-ink hover:text-red"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            {signedIn ? (
              showReserve ? (
                // Direct reserve (U4): the deposit CTA is the primary red
                // action; My dashboard degrades to ghost beside it — never
                // two adjacent solid-red buttons.
                <>
                  <Cta href="/dashboard" variant="ghost">
                    My dashboard
                  </Cta>
                  <Cta href={NAV_RESERVE_CTA.href}>{NAV_RESERVE_CTA.label}</Cta>
                </>
              ) : (
                <Cta href="/dashboard">My dashboard</Cta>
              )
            ) : (
              <>
                <Cta href="/dashboard" variant="ghost">
                  Log in
                </Cta>
                <StartCta source={"home"}/>
              </>
            )}
          </span>

          {/* Mobile: join + hamburger */}
          <span className="flex items-center gap-3 lg:hidden">
            <span className="hidden sm:inline-flex">
              {signedIn ? (
                // The single mobile-header slot goes to the deposit CTA when
                // it applies; My dashboard stays reachable in the panel.
                showReserve ? (
                  <Cta href={NAV_RESERVE_CTA.href}>{NAV_RESERVE_CTA.label}</Cta>
                ) : (
                  <Cta href="/dashboard">My dashboard</Cta>
                )
              ) : (
                <StartCta source={"home"}/>
              )}
            </span>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              className="relative flex h-9 w-9 items-center justify-center text-ink"
            >
              <span className="relative block h-3.5 w-5">
                <span
                  className={`absolute left-0 h-0.5 w-5 rounded-full bg-current transition-all duration-300 ${
                    open ? "top-1.5 rotate-45" : "top-0"
                  }`}
                />
                <span
                  className={`absolute left-0 top-1.5 h-0.5 w-5 rounded-full bg-current transition-opacity duration-200 ${
                    open ? "opacity-0" : "opacity-100"
                  }`}
                />
                <span
                  className={`absolute left-0 h-0.5 w-5 rounded-full bg-current transition-all duration-300 ${
                    open ? "top-1.5 -rotate-45" : "top-3"
                  }`}
                />
              </span>
            </button>
          </span>
        </div>

        {/* Mobile menu panel (inside the card) */}
        <AnimatePresence>
          {open && (
            <motion.div
              id="mobile-menu"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="overflow-hidden border-t border-line lg:hidden"
            >
              <nav className="flex flex-col px-[22px] py-4">
                {items.map((item) => {
                  const active = isActiveNav(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={`border-b border-line py-3.5 text-[15px] transition-colors ${
                        active
                          ? "text-red font-semibold"
                          : "text-ink hover:text-red"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
                <div className="mt-5 flex flex-col gap-3">
                  {signedIn ? (
                    showReserve ? (
                      <>
                        <Cta href={NAV_RESERVE_CTA.href} className="w-full" onClick={close}>
                          {NAV_RESERVE_CTA.label}
                        </Cta>
                        <Cta href="/dashboard" variant="ghost" className="w-full" onClick={close}>
                          My dashboard
                        </Cta>
                      </>
                    ) : (
                      <Cta href="/dashboard" className="w-full" onClick={close}>
                        My dashboard
                      </Cta>
                    )
                  ) : (
                    <>
                      <StartCta source={"home"} className="w-full" onClick={close}/>
                      <Cta href="/dashboard" variant="ghost" className="w-full" onClick={close}>
                        Log in
                      </Cta>
                    </>
                  )}
                </div>
              </nav>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </header>
  );
}
