import "server-only";

/**
 * Server-only re-export of the plain nurture sender
 * (`app/lib/nurture/send-nurture.ts`). App code imports from here (keeping the
 * client-bundle guard); the standalone `tsx` scripts import the plain module
 * directly. One implementation, no divergence — the same split
 * `token.ts` / `unsubscribe-url.ts` uses.
 */
export { sendNurtureEmail } from "./send-nurture";
