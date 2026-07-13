import { notFound } from "next/navigation";

/**
 * 404 semantics for non-staff visitors (brief §3): the proxy REWRITES here
 * and `requireStaff()` redirects here. Rendering Next's not-found gives a
 * true 404 status and the stock "This page could not be found." screen —
 * brand-neutral, zero CRM markup, no hint that /crm matters.
 */
export default function StaffOnlyPage() {
  notFound();
}
