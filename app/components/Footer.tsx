import Link from "next/link";
import Wordmark from "./Wordmark";

const links = [
  { label: "The groups", href: "/#groups" },
  { label: "Parents", href: "/parents" },
  { label: "GT Toronto", href: "/gt" },
  { label: "Tuition", href: "/tuition" },
  { label: "FAQ", href: "/faq" },
  { label: "Sign in", href: "/dashboard" },
];

/** Handoff footer: electric blue, lockup, muted links, hairline + legal line. */
export default function Footer() {
  return (
    <footer className="bg-blue px-6 pb-9 pt-12 sm:px-11">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-7">
        <div className="flex flex-wrap items-center justify-between gap-x-10 gap-y-6">
          <Link href="/" aria-label="The 120 home">
            <Wordmark tone="light" />
          </Link>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {links.map((l) => (
              <Link
                key={l.label}
                href={l.href}
                className="text-[13px] text-muted transition-colors hover:text-paper"
              >
                {l.label}
              </Link>
            ))}
            <a
              href="mailto:admissions@the120.school"
              className="text-[13px] text-muted transition-colors hover:text-paper"
            >
              admissions@the120.school
            </a>
          </div>
        </div>
        <div className="border-t border-white/25 pt-5">
          <span className="text-xs leading-relaxed text-white/70">
            © 2026 The 120 · A learning centre, part of the 2 Hour Learning Network. Not an
            accredited school. TIN CAN is a trademark of Tin Can Untechnologies, Inc.
          </span>
        </div>
      </div>
    </footer>
  );
}
