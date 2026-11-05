type Guard = () => boolean;

const guards = new Set<Guard>();

/** Pages with unsaved drafts register a guard. Navigation asks once before leaving. */
export function registerUnsavedGuard(guard: Guard): () => void {
  guards.add(guard);
  return () => {
    guards.delete(guard);
  };
}

export function confirmLeaveIfDirty(): boolean {
  const dirty = [...guards].some((guard) => guard());
  if (!dirty) return true;
  return window.confirm('You have unsaved changes. Leave without saving?');
}
