import type { Metadata } from 'next';

import { PageHeader } from '@/components/page-header';
import {
  CategoriesManager,
  type CategoryItem,
} from '@/features/master-data/categories-manager';
import { assertOrgAccess } from '@/services/org-access';
import {
  buildCategoryTree,
  listCategories,
  type CategoryNode,
} from '@/services/resource-categories';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Kategori' };

/**
 * Depth-first walk, so the flat list still reads as a tree once indented.
 *
 * The child count travels with each row because the delete dialog has to say
 * what stands in the way before the user commits to it.
 */
function flatten(nodes: CategoryNode[], depth = 0): CategoryItem[] {
  return nodes.flatMap((node) => [
    {
      id: node.id,
      code: node.code,
      name: node.name,
      type: node.type,
      parentId: node.parentId,
      resourceCount: node.resourceCount,
      childCount: node.children.length,
      depth,
    },
    ...flatten(node.children, depth + 1),
  ]);
}

export default async function CategoriesPage() {
  const user = await requireSessionUser();
  const [categories, access] = await Promise.all([
    listCategories(user.id),
    assertOrgAccess(user.id),
  ]);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Kategori"
        description="Pengelompokan sumber daya, mengikuti struktur blok pada file UTBA."
      />

      <CategoriesManager
        items={flatten(buildCategoryTree(categories))}
        canManage={access.globalRole === 'ADMIN'}
      />
    </div>
  );
}
