import "server-only";

/**
 * Server-only re-export of the pure HMAC core (`app/lib/hmac-core.ts`). App code
 * imports from here so the client-bundle guard stays in place; the standalone
 * `tsx` welcome-backfill imports `app/lib/hmac-core` directly (a `server-only`
 * module throws outside Next's bundler). One implementation, no divergence.
 */
export { signToken, verifyToken } from "@/app/lib/hmac-core";
