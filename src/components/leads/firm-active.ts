// The Active switch's whole action, outside React so it can be tested end to
// end against the real PATCH route. FirmHeader calls exactly this.

export function deactivateConfirmText(firmName: string): string {
  return `Deactivate ${firmName}? Its clients lose portal access and new leads stop routing to it. Leads it already holds are kept.`;
}

export type ToggleResult =
  | { status: "cancelled"; active: boolean }
  | { status: "saved"; active: boolean }
  | { status: "failed"; active: boolean; error: string };

/**
 * Flips Active. Deactivating asks first (activating never does); a "no"
 * sends nothing. `onOptimistic` is called with the new value BEFORE the
 * request, so the switch moves at once; on failure the result carries the
 * ORIGINAL value to revert to, plus the server's message. Only isActive is
 * sent, so this can never touch the name or slug.
 */
export async function toggleFirmActive(input: {
  firmId: string;
  firmName: string;
  current: boolean;
  confirmFn: (message: string) => boolean;
  fetchFn: (url: string, init: RequestInit) => Promise<Response>;
  onOptimistic?: (next: boolean) => void;
}): Promise<ToggleResult> {
  const next = !input.current;
  if (!next && !input.confirmFn(deactivateConfirmText(input.firmName))) {
    return { status: "cancelled", active: input.current };
  }
  input.onOptimistic?.(next);
  try {
    const res = await input.fetchFn(`/api/admin/firms/${input.firmId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: next }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { status: "failed", active: input.current, error: body.error ?? `Could not save (HTTP ${res.status}).` };
    }
    const saved = (await res.json().catch(() => null)) as { isActive?: unknown } | null;
    // Trust what the server stored, not what was asked for.
    return { status: "saved", active: typeof saved?.isActive === "boolean" ? saved.isActive : next };
  } catch {
    return { status: "failed", active: input.current, error: "Could not reach the server. Nothing was changed." };
  }
}
