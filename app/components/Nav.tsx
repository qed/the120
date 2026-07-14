"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import Wordmark from "./Wordmark";
import Cta from "./Cta";
import JoinButton from "./JoinButton";
import { supabaseBrowser } from "@/app/lib/supabase/client";
import { nav as defaultLinks } from "@/app/lib/site";

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
  const items = [...defaultLinks];

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
        <div className="flex items-center justify-between px-[22px] py-[11px]">
          <span className="flex items-center gap-4">
            <Link href="/" aria-label="The 120 home" onClick={close}>
              <Wordmark sublabel="TORONTO" />
            </Link>
          </span>

          {/* Desktop links */}
          <span className="hidden items-center gap-[18px] lg:flex">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap text-sm text-ink transition-colors hover:text-red"
              >
                {item.label}
              </Link>
            ))}
            {signedIn ? (
              <Cta href="/dashboard">My dashboard</Cta>
            ) : (
              <>
                <Cta href="/dashboard" variant="ghost">
                  Log in
                </Cta>
                <JoinButton>Join the 120</JoinButton>
              </>
            )}
          </span>

          {/* Mobile: join + hamburger */}
          <span className="flex items-center gap-3 lg:hidden">
            <span className="hidden sm:inline-flex">
              {signedIn ? (
                <Cta href="/dashboard">My dashboard</Cta>
              ) : (
                <JoinButton>Join the 120</JoinButton>
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
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={close}
                    className="border-b border-line py-3.5 text-[15px] text-ink transition-colors hover:text-red"
                  >
                    {item.label}
                  </Link>
                ))}
                <div className="mt-5 flex flex-col gap-3">
                  {signedIn ? (
                    <Cta href="/dashboard" className="w-full" onClick={close}>
                      My dashboard
                    </Cta>
                  ) : (
                    <>
                      <JoinButton className="w-full" onClick={close}>
                        Join the 120
                      </JoinButton>
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
