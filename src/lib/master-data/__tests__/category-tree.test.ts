import { describe, expect, it } from 'vitest';

import { buildCategoryTree } from '../category-tree';

const node = (id: string, parentId: string | null = null) => ({ id, parentId });

describe('buildCategoryTree', () => {
  it('nests children under their parent', () => {
    const tree = buildCategoryTree([
      node('TENAGA'),
      node('IRENGAN', 'TENAGA'),
      node('NON-IRENGAN', 'TENAGA'),
      node('MATERIAL'),
    ]);

    expect(tree.map((n) => n.id)).toEqual(['TENAGA', 'MATERIAL']);
    expect(tree[0]?.children.map((c) => c.id)).toEqual(['IRENGAN', 'NON-IRENGAN']);
  });

  it('handles an empty list', () => {
    expect(buildCategoryTree([])).toEqual([]);
  });

  it('nests to arbitrary depth', () => {
    const tree = buildCategoryTree([node('a'), node('b', 'a'), node('c', 'b')]);
    expect(tree[0]?.children[0]?.children[0]?.id).toBe('c');
  });

  // Losing a row here would remove resources from the catalogue with nothing
  // to explain the absence.
  it('promotes a row whose parent is missing to the root', () => {
    const tree = buildCategoryTree([node('orphan', 'gone'), node('normal')]);
    expect(tree.map((n) => n.id).sort()).toEqual(['normal', 'orphan']);
  });

  it('promotes a row that points at itself', () => {
    const tree = buildCategoryTree([node('self', 'self')]);
    expect(tree).toHaveLength(1);
    expect(tree[0]?.children).toEqual([]);
  });

  it('does not hang or lose rows on a parent cycle', () => {
    const tree = buildCategoryTree([node('a', 'b'), node('b', 'a')]);
    const ids = new Set<string>();
    const walk = (nodes: ReturnType<typeof buildCategoryTree>) => {
      for (const n of nodes) {
        ids.add(n.id);
        walk(n.children);
      }
    };
    walk(tree);
    expect(ids).toEqual(new Set(['a', 'b']));
  });

  it('preserves the extra fields of each row', () => {
    const tree = buildCategoryTree([{ id: 'x', parentId: null, name: 'Material dasar' }]);
    expect(tree[0]?.name).toBe('Material dasar');
  });

  it('keeps the input order among siblings', () => {
    const tree = buildCategoryTree([node('p'), node('z', 'p'), node('a', 'p')]);
    expect(tree[0]?.children.map((c) => c.id)).toEqual(['z', 'a']);
  });
});
