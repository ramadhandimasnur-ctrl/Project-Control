import { Tags } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { buildCategoryTree, listCategories, type CategoryNode } from '@/services/resource-categories';
import { requireSessionUser } from '@/services/session';

export const metadata: Metadata = { title: 'Kategori' };

const TYPE_LABELS = {
  LABOR: 'Tenaga',
  MATERIAL: 'Material',
  EQUIPMENT: 'Alat',
  SUBCON: 'Subkon',
  PACKAGE: 'Paket',
  OVERHEAD: 'Operasional',
} as const;

function CategoryRows({ nodes, depth = 0 }: { nodes: CategoryNode[]; depth?: number }) {
  return (
    <>
      {nodes.map((node) => (
        <li key={node.id}>
          <div
            className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
            style={{ paddingLeft: `${depth * 1.5 + 0.5}rem` }}
          >
            <span className="font-mono text-xs text-muted-foreground">{node.code}</span>
            <span className="font-medium">{node.name}</span>
            <Badge variant="secondary" className="text-[10px]">
              {TYPE_LABELS[node.type]}
            </Badge>
            {node.resourceCount > 0 ? (
              <Link
                href={`/master-data/resources?category=${node.id}`}
                className="ml-auto text-sm text-muted-foreground hover:underline"
              >
                {node.resourceCount.toLocaleString('id-ID')} sumber daya
              </Link>
            ) : (
              <span className="ml-auto text-sm text-muted-foreground">kosong</span>
            )}
          </div>
          {node.children.length > 0 ? (
            <ul>
              <CategoryRows nodes={node.children} depth={depth + 1} />
            </ul>
          ) : null}
        </li>
      ))}
    </>
  );
}

export default async function CategoriesPage() {
  const user = await requireSessionUser();
  const categories = await listCategories(user.id);
  const tree = buildCategoryTree(categories);

  return (
    <div className="space-y-6 p-6">
      <PageHeader
        title="Kategori"
        description="Pengelompokan sumber daya, mengikuti struktur blok pada file UTBA."
      />

      {categories.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="Belum ada kategori"
          description="Kategori terbentuk otomatis dari judul blok saat mengimpor file Excel UTBA."
        />
      ) : (
        <div className="rounded-lg border p-2">
          <ul>
            <CategoryRows nodes={tree} />
          </ul>
        </div>
      )}
    </div>
  );
}
