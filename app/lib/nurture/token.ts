import "server-only";

/**
 * Server-only re-export of the plain unsubscribe-url module
 * (`app/lib/nurture/unsubscribe-url.ts`). App code imports from here (keeping the
 * client-bundle guard); the standalone `tsx` welcome-backfill imports the plain
 * module directly. One implementation, no divergence.
 */
export { unsubscribeToken, verifyUnsubscribeToken, unsubscribeUrl } from "@/app/lib/nurture/unsubscribe-url";
