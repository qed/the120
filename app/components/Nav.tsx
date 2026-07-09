"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "motion/react";
import Wordmark from "./Wordmark";
import Cta from "./Cta";
import JoinButton from "./JoinButton";
import { nav } from "@/app/lib/site";

export default function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const solid = scrolled || open; // solid bar while scrolled OR menu open

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock scroll + Esc-to-close while the mobile menu is open.
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
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-colors duration-300 ${
        solid
          ? "border-b border-line bg-paper/90 backdrop-blur-md"
          : "border-b border-transparent bg-transparent"
      }`}
    >
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-6">
        <Link href="/" aria-label="The 120 — GT Toronto home" onClick={close}>
          <Wordmark tone={solid ? "dark" : "light"} />
        </Link>

        {/* Desktop links — lg+ only; tablet gets the hamburger (links wrap/cram at 768) */}
        <nav className="hidden items-center gap-8 lg:flex">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={`font-mono text-xs uppercase tracking-[0.12em] transition-colors ${
                solid ? "text-ink-soft hover:text-red" : "text-white/80 hover:text-white"
              }`}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-4">
          <Link
            href="/dashboard"
            className={`mr-1 hidden font-mono text-xs uppercase tracking-[0.12em] transition-colors sm:inline ${
              solid ? "text-muted hover:text-ink" : "text-white/70 hover:text-white"
            }`}
          >
            Sign in
          </Link>
          {/* Wrapper controls visibility — a bare `hidden` can't override the CTA's own `inline-flex`. */}
          <span className="hidden lg:inline-flex">
            <Cta href="#call" variant={solid ? "ghost" : "ghostLight"}>
              Book a call
            </Cta>
          </span>
          {/* In-bar Join hides on the smallest screens (lives in the menu) to avoid crowding the hamburger. */}
          <span className="hidden sm:inline-flex">
            <JoinButton>Join the 120</JoinButton>
          </span>

          {/* Hamburger — mobile + tablet (visibility on the wrapper span) */}
          <span className="lg:hidden">
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              aria-expanded={open}
              aria-controls="mobile-menu"
              aria-label={open ? "Close menu" : "Open menu"}
              className={`relative flex h-9 w-9 items-center justify-center ${
                solid ? "text-ink" : "text-white"
              }`}
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
      </div>

      {/* Mobile menu panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            id="mobile-menu"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: "easeOut" }}
            className="overflow-hidden border-t border-line bg-paper lg:hidden"
          >
            <nav className="mx-auto flex w-full max-w-6xl flex-col px-6 py-4">
              {nav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={close}
                  className="border-b border-line py-3.5 font-mono text-sm uppercase tracking-[0.1em] text-ink-soft transition-colors hover:text-red"
                >
                  {item.label}
                </a>
              ))}

              <div className="mt-5 flex flex-col gap-3">
                <JoinButton className="w-full" onClick={close}>
                  Join the 120
                </JoinButton>
                <Cta href="#call" variant="ghost" className="w-full" onClick={close}>
                  Book a call
                </Cta>
              </div>
              <Link
                href="/dashboard"
                onClick={close}
                className="mt-5 block border-t border-line pt-5 text-center font-mono text-xs uppercase tracking-[0.12em] text-muted hover:text-ink"
              >
                Already started? Sign in
              </Link>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
