'use client';

import { Loader2, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EMPTY_VALUE, formatCurrency } from '@/lib/format';
import { type ResourceFormInput } from '@/lib/validation/master-data';

import { deleteResourceAction, deleteResourcesAction } from './actions';
import { ResourceDialog } from './resource-dialog';

export type ResourceRow = {
  id: string;
  code: string;
  name: string;
  spec: string | null;
  unitId: string;
  unitCode: string;
  type: string;
  categoryId: string | null;
  categoryName: string | null;
  leadTimeDays: number;
  notes: string | null;
  priceRab: string | null;
  priceRap: string | null;
  isActive: boolean;
};

/**
 * The catalogue table, with selection.
 *
 * A client component because the selection lives in the browser and nowhere
 * else — there is no reason to round-trip a set of ticked boxes to the server,
 * and putting it in the URL would make a fifty-row selection unshareable
 * anyway.
 */
export function ResourcesTable({
  items,
  units,
  categories,
  typeLabels,
  showCosts,
  canManage,
}: {
  items: ResourceRow[];
  units: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
  typeLabels: Record<string, string>;
  showCosts: boolean;
  canManage: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<ResourceRow | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const allSelected = items.length > 0 && items.every((item) => selected.has(item.id));
  // Distinct from "all": drives the indeterminate tick on the header box.
  const someSelected = selected.size > 0 && !allSelected;

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(items.map((item) => item.id)));
  };

  const removeOne = (row: ResourceRow) => {
    setBusyId(row.id);
    startTransition(async () => {
      const result = await deleteResourceAction(row.id);
      setBusyId(null);

      if (result.ok) {
        toast.success(`"${row.name}" dihapus.`);
        setSelected((current) => {
          const next = new Set(current);
          next.delete(row.id);
          return next;
        });
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  const removeSelected = () => {
    const ids = [...selected];

    startTransition(async () => {
      const result = await deleteResourcesAction(ids);

      if (!result.ok) {
        toast.error(result.message, { description: result.hint });
        return;
      }

      /*
       * Three outcomes, three messages. "12 dihapus, 3 ditolak" with no reason
       * leaves the user guessing which three and why, so the first refusal is
       * spelled out and the rest counted.
       */
      if (result.refused.length === 0) {
        toast.success(`${result.deleted} sumber daya dihapus.`);
      } else if (result.deleted === 0) {
        toast.error('Tidak ada yang dapat dihapus.', {
          description: result.refused[0]?.reason,
        });
      } else {
        toast.warning(`${result.deleted} dihapus, ${result.refused.length} ditolak.`, {
          description: result.refused[0]?.reason,
        });
      }

      // The refused ones stay ticked: they are what still needs a decision,
      // and clearing them would hide the part of the job left undone.
      setSelected(new Set(result.refused.map((row) => row.id)));
      router.refresh();
    });
  };

  const defaultsFor = (row: ResourceRow): ResourceFormInput => ({
    code: row.code,
    name: row.name,
    spec: row.spec ?? '',
    unitId: row.unitId,
    type: row.type as ResourceFormInput['type'],
    categoryId: row.categoryId ?? '',
    leadTimeDays: row.leadTimeDays,
    notes: row.notes ?? '',
  });

  return (
    <div className="space-y-3">
      {canManage && selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
          <p className="text-sm">
            <strong>{selected.size}</strong> dipilih
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Batalkan pilihan
            </Button>

            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="destructive" size="sm" disabled={pending} />}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Hapus terpilih
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus {selected.size} sumber daya?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Sumber daya yang masih dipakai pada analisa AHSP, transaksi material, atau
                    pembelian akan ditolak dan tetap ada — penghapusannya dilaporkan satu per satu.
                    Yang tidak dipakai akan hilang permanen.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <Button variant="destructive" disabled={pending} onClick={removeSelected}>
                    Ya, hapus
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {canManage ? (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary align-middle"
                    aria-label="Pilih semua di halaman ini"
                    checked={allSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = someSelected;
                    }}
                    onChange={toggleAll}
                  />
                </TableHead>
              ) : null}
              <TableHead className="w-24">Kode</TableHead>
              <TableHead>Uraian</TableHead>
              <TableHead className="w-20">Satuan</TableHead>
              <TableHead className="w-28">Jenis</TableHead>
              <TableHead>Kategori</TableHead>
              {showCosts ? <TableHead className="w-36 text-right">Harga RAB</TableHead> : null}
              {showCosts ? <TableHead className="w-36 text-right">Harga RAP</TableHead> : null}
              {canManage ? <TableHead className="w-28" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const busy = pending && busyId === item.id;

              return (
                <TableRow key={item.id} data-state={selected.has(item.id) ? 'selected' : undefined}>
                  {canManage ? (
                    <TableCell>
                      <input
                        type="checkbox"
                        className="size-4 accent-primary align-middle"
                        aria-label={`Pilih ${item.name}`}
                        checked={selected.has(item.id)}
                        onChange={() => toggle(item.id)}
                      />
                    </TableCell>
                  ) : null}

                  <TableCell className="font-mono text-xs">
                    <Link href={`/master-data/resources/${item.id}`} className="hover:underline">
                      {item.code}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/master-data/resources/${item.id}`}
                      className="font-medium hover:underline"
                    >
                      {item.name}
                    </Link>
                    {item.spec ? (
                      <span className="block text-xs text-muted-foreground">{item.spec}</span>
                    ) : null}
                    {!item.isActive ? (
                      <Badge variant="outline" className="ml-2 text-[10px]">
                        nonaktif
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{item.unitCode}</TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {typeLabels[item.type] ?? item.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {item.categoryName ?? EMPTY_VALUE}
                  </TableCell>

                  {showCosts ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {item.priceRab === null ? (
                        <span className="text-muted-foreground">{EMPTY_VALUE}</span>
                      ) : (
                        formatCurrency(item.priceRab)
                      )}
                    </TableCell>
                  ) : null}
                  {showCosts ? (
                    <TableCell className="text-right font-mono tabular-nums">
                      {item.priceRap === null ? (
                        <span className="text-muted-foreground">{EMPTY_VALUE}</span>
                      ) : (
                        formatCurrency(item.priceRap)
                      )}
                    </TableCell>
                  ) : null}

                  {canManage ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Ubah ${item.name}`}
                          disabled={busy}
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
                                disabled={busy}
                              />
                            }
                          >
                            {busy ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Trash2 className="size-3.5" aria-hidden />
                            )}
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Hapus &ldquo;{item.name}&rdquo;?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Jika sumber daya ini masih dipakai pada analisa AHSP, transaksi
                                material, atau pembelian, penghapusan akan ditolak dan datanya tetap
                                utuh. Nonaktifkan saja bila hanya ingin menyembunyikannya dari
                                pilihan.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Batal</AlertDialogCancel>
                              <Button
                                variant="destructive"
                                disabled={pending}
                                onClick={() => removeOne(item)}
                              >
                                Ya, hapus
                              </Button>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {editing ? (
        <ResourceDialog
          open
          onOpenChange={(open) => setEditing(open ? editing : null)}
          resourceId={editing.id}
          defaultValues={defaultsFor(editing)}
          units={units}
          categories={categories}
        />
      ) : null}
    </div>
  );
}
