/**
 * Next's `redirect()` control-flow throw — the auth guard firing before a
 * Server Action's body runs. Client callers must catch it and route to
 * sign-in (or pause a background drain), never show a doomed "try again".
 * One shared predicate (maintainability review: it was duplicated verbatim
 * in TaskSurface and sync-engine — a digest-shape change now lands once).
 */
export function isNextRedirect(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "digest" in e &&
    String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT")
  );
}
