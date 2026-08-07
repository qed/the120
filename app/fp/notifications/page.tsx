import { redirect } from "next/navigation";

import { FP_APP_URL } from "@/app/lib/fp/retired-ui-routes";

/**
 * Retired First Profit UI route (v3 plan Unit 10, R16). The header in
 * `app/lib/fp/retired-ui-routes.ts` says which URLs these are, who is holding
 * them, and why each lands where it does.
 */
export default function RetiredFpUiRoute(): never {
  redirect(FP_APP_URL);
}
