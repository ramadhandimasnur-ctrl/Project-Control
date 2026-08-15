/**
 * Nesting rule for the resource category tree.
 *
 * Pure and separate from the service so it can be tested — the interesting
 * part is not the happy path but what happens to a category whose parent is
 * missing or whose parent chain loops. Dropping those rows would hide
 * resources from the catalogue with no indication why, so they are surfaced at
 * the root instead.
 */

export type CategoryLike = {
  id: string;
  parentId: string | null;
};

export type TreeNode<T extends CategoryLike> = T & { children: TreeNode<T>[] };

export function buildCategoryTree<T extends CategoryLike>(rows: readonly T[]): TreeNode<T>[] {
  const nodes = new Map<string, TreeNode<T>>();
  for (const row of rows) nodes.set(row.id, { ...row, children: [] });

  const roots: TreeNode<T>[] = [];

  for (const row of rows) {
    const node = nodes.get(row.id);
    if (!node) continue;

    // A row pointing at itself, or at a parent that is not in the set, is
    // treated as a root rather than silently discarded.
    const parent =
      row.parentId === null || row.parentId === row.id ? undefined : nodes.get(row.parentId);

    if (parent && !createsCycle(nodes, row.id, row.parentId)) parent.children.push(node);
    else roots.push(node);
  }

  return roots;
}

/** True when attaching `id` under `parentId` would close a loop. */
function createsCycle<T extends CategoryLike>(
  nodes: Map<string, TreeNode<T>>,
  id: string,
  parentId: string | null,
): boolean {
  let cursor = parentId;
  for (let depth = 0; cursor !== null && depth < 64; depth += 1) {
    if (cursor === id) return true;
    cursor = nodes.get(cursor)?.parentId ?? null;
  }
  return false;
}
