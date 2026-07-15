import { useQuery } from "@tanstack/react-query";
import {
  fetchEntitlements,
  type AddonId,
  type Entitlements,
} from "@/lib/entitlements";

export const ENTITLEMENTS_QUERY_KEY = ["entitlements"] as const;

/**
 * What this business is allowed to do. Use for showing/hiding UI and rendering
 * upgrade prompts — never as the only check on anything that costs money.
 *
 * Gates nothing on its own; call sites decide what to do with the answer.
 */
export function useEntitlements() {
  return useQuery<Entitlements>({
    queryKey: ENTITLEMENTS_QUERY_KEY,
    queryFn: fetchEntitlements,
    // Entitlements change only on subscribe/add-on/renewal, all of which
    // invalidate this key explicitly. A minute of staleness is fine otherwise.
    staleTime: 60_000,
  });
}

/**
 * Convenience for the common case: "does this business have X?".
 * Returns false while loading, so UI defaults to locked rather than flashing
 * a feature the customer hasn't paid for.
 */
export function useHasGrant(addon: AddonId): boolean {
  const { data } = useEntitlements();
  return Boolean(data?.entitled && data.grants[addon]);
}
