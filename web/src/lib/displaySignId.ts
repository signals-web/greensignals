// ─── Shared sign-id formatter ─────────────────────────────────────────
//
// Sign IDs in the seed are storage-shaped (`cu-bldr-sign-PM-001`) for
// uniqueness across projects, but reviewers think in terms of the
// type-driven nomenclature (`PM-001`). This helper hides the storage
// prefix everywhere a sign id surfaces in the UI — sidebar list, sign
// card header, neighborhood panel rows, map labels, confirm dialogs.
//
// Two seed prefixes in the wild today; both strip cleanly:
//   `cu-bldr-sign-PM-001` → `PM-001`
//   `si-cu-01`            → `SD-01`   (legacy demo seed)
// Anything else falls through unchanged.

export function displaySignId(id: string): string {
  if (id.startsWith('cu-bldr-sign-')) return id.slice('cu-bldr-sign-'.length);
  if (id.startsWith('si-cu-')) return `SD-${id.slice('si-cu-'.length)}`;
  return id;
}
