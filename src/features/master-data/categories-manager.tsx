'use client';

import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tags } from 'lucide-react';

import { deleteCategoryAction } from './actions';
import { CategoryDialog } from './category-dialog';

export type CategoryItem = {
  id: string;
  code: string;
  name: string;
  type: string;
  parentId: string | null;
  resourceCount: number;
  childCount: number;
  depth: number;
};

const TYPE_LABELS: Record<string, string> = {
  LABOR: 'Tenaga',
  MATERIAL: 'Material',
  EQUIPMENT: 'Alat',
  SUBCON: 'Subkon',
  PACKAGE: 'Paket',
  OVERHEAD: 'Operasional',
};

/**
 * The category tree, with the actions that change it.
 *
 * Flattened to a depth-annotated list before it gets here: the indentation is
 * the only thing the tree shape is needed for, and a flat list is far easier to
 * give row actions to than a recursive render.
 */
export function CategoriesManager({
  items,
  canManage,
}: {
  items: CategoryItem[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<CategoryItem | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const remove = (item: CategoryItem) => {
    setBusyId(item.id);
    startTransition(async () => {
      const result = await deleteCategoryAction(item.id);
      setBusyId(null);

      if (result.ok) {
        toast.success(`Kategori "${item.name}" dihapus.`);
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  /*
   * A category cannot be its own parent, nor the parent of one of its own
   * ancestors. The service refuses both, but offering them in the list only to
   * reject the save is a worse way to teach the rule.
   */
  const parentCandidates = (item: CategoryItem | null) => {
    if (item === null) return items;

    const descendants = new Set<string>([item.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const candidate of items) {
        if (candidate.parentId !== null && descendants.has(candidate.parentId)) {
          if (!descendants.has(candidate.id)) {
            descendants.add(candidate.id);
            grew = true;
          }
        }
      }
    }

    return items.filter((candidate) => !descendants.has(candidate.id));
  };

  return (
    <div className="space-y-3">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            Tambah kategori
          </Button>
        </div>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={Tags}
          title="Belum ada kategori"
          description="Kategori terbentuk otomatis dari judul blok saat mengimpor file Excel UTBA, atau tambahkan sendiri di sini."
        />
      ) : (
        <ul className="rounded-lg border p-2">
          {items.map((item) => (
            <li key={item.id}>
              <div
                className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-accent/50"
                style={{ paddingLeft: `${item.depth * 1.5 + 0.5}rem` }}
              >
                <span className="font-mono text-xs text-muted-foreground">{item.code}</span>
                <span className="font-medium">{item.name}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {TYPE_LABELS[item.type] ?? item.type}
                </Badge>

                {item.resourceCount > 0 ? (
                  <Link
                    href={`/master-data/resources?category=${item.id}`}
                    className="ml-auto text-sm text-muted-foreground hover:underline"
                  >
                    {item.resourceCount.toLocaleString('id-ID')} sumber daya
                  </Link>
                ) : (
                  <span className="ml-auto text-sm text-muted-foreground">kosong</span>
                )}

                {canManage ? (
                  <div className="flex gap-1">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Ubah ${item.name}`}
                      disabled={pending && busyId === item.id}
                      onClick={() => setEditing(item)}
                    >
                      <Pencil className="size-3.5" aria-hidden />
                    </Button>

                    <AlertDialog>
                      <AlertDialogTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive"
                            aria-label={`Hapus ${item.name}`}
                            disabled={pending && busyId === item.id}
                          />
                        }
                      >
                        {pending && busyId === item.id ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Trash2 className="size-3.5" aria-hidden />
                        )}
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Hapus kategori &ldquo;{item.name}&rdquo;?</AlertDialogTitle>
                          <AlertDialogDescription>
                            {item.resourceCount > 0
                              ? `Kategori ini berisi ${item.resourceCount} sumber daya, jadi penghapusannya akan ditolak. Pindahkan isinya terlebih dahulu.`
                              : item.childCount > 0
                                ? `Kategori ini masih memiliki ${item.childCount} sub-kategori, jadi penghapusannya akan ditolak.`
                                : 'Kategori ini kosong dan akan dihapus permanen.'}
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Batal</AlertDialogCancel>
                          <Button
                            variant="destructive"
                            disabled={pending}
                            onClick={() => remove(item)}
                          >
                            Ya, hapus
                          </Button>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      {creating ? (
        <CategoryDialog
          open
          onOpenChange={setCreating}
          categoryId={null}
          categories={parentCandidates(null)}
        />
      ) : null}

      {editing ? (
        <CategoryDialog
          open
          onOpenChange={(open) => setEditing(open ? editing : null)}
          categoryId={editing.id}
          defaultValues={{
            code: editing.code,
            name: editing.name,
            type: editing.type as 'MATERIAL',
            parentId: editing.parentId ?? '',
          }}
          categories={parentCandidates(editing)}
        />
      ) : null}
    </div>
  );
}
