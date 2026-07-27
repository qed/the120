"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { label: "DASHBOARD", href: "/crm" },
  { label: "SPRINT", href: "/crm/sprint" },
  { label: "PIPELINE", href: "/crm/pipeline" },
  { label: "DOSSIERS", href: "/crm/dossiers" },
  { label: "LIBRARY", href: "/crm/library" },
  { label: "AMBASSADORS", href: "/crm/ambassadors" },
] as const;

/**
 * The slim tab row under the blue band (brief §4): mono 11px letterspaced
 * chips, active = #0300ED filled. Client component only for pathname-driven
 * active state — everything else in the chrome stays server-rendered.
 * Scrolls horizontally on narrow viewports (survive-at-375px contract).
 *
 * IDENTITY AND SIGN-OUT MOVED UP to the persistent staff bar (Staff Front Door
 * Unit 4; R15, R16, R24). The SECTIONS stay here, deliberately: folding six
 * destinations plus identity plus sign-out into one bar would break the 375px
 * contract this row already meets only by scrolling, and dropping them would strand
 * five CRM sections behind URL-typing. What left was one email string and a
 * client-side `supabaseBrowser().auth.signOut()` that ran no drain gate and landed
 * every account on `/crm/login` — including a staff member who is also a guide, and
 * including one whose device still held unsent check-ins.
 *
 * The row is now three sticky-free rows deep under the bar; it does not offset
 * itself, because `CrmChrome` has never been sticky.
 */
export default function CrmTabs() {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/crm"
      ? pathname === "/crm"
      : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <nav
      aria-label="CRM sections"
      className="flex items-center gap-1.5 overflow-x-auto border-b border-crm-line bg-crm-card px-5 py-2 sm:px-7"
    >
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={isActive(tab.href) ? "page" : undefined}
          className={`flex-none whitespace-nowrap rounded-full px-3 py-1.5 font-mono text-[11px] tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue ${
            isActive(tab.href)
              ? "bg-crm-blue text-white"
              : "text-crm-muted hover:text-crm-ink"
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
