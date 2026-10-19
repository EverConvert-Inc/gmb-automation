// Which lead's editor is open. One at a time across the whole page: opening
// one closes any other, wherever its table is.
import { useSyncExternalStore } from "react";

let openId: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function openLeadDrawer(id: string) {
  openId = id;
  emit();
}

export function closeLeadDrawer(id: string) {
  if (openId !== id) return;
  openId = null;
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** True while this lead's drawer is the open one. Closed on the server. */
export function useLeadDrawerOpen(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => openId === id,
    () => false,
  );
}

export function __resetLeadDrawerForTests() {
  openId = null;
  listeners.clear();
}

export function __peekLeadDrawerForTests(): string | null {
  return openId;
}
