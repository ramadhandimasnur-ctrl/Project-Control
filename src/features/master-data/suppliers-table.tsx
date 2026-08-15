'use client';

import { Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EMPTY_VALUE } from '@/lib/format';
import { type SupplierFormInput } from '@/lib/validation/master-data';

import { deleteSupplierAction } from './actions';
import { SupplierDialog } from './supplier-dialog';

export type SupplierRowView = {
  id: string;
  code: string;
  name: string;
  contact: string | null;
  address: string | null;
  creditDays: number;
  note: string | null;
  purchaseCount: number;
};

export function SuppliersTable({
  suppliers,
  canManage,
}: {
  suppliers: SupplierRowView[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<SupplierRowView | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  const toFormValues = (s: SupplierRowView): SupplierFormInput => ({
    code: s.code,
    name: s.name,
    contact: s.contact ?? '',
    address: s.address ?? '',
    creditDays: s.creditDays,
    note: s.note ?? '',
  });

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            Tambah pemasok
          </Button>
        </div>
      ) : null}

      {suppliers.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="Belum ada pemasok"
          description="Tambahkan pemasok agar pembelian dapat ditelusuri dan termin kreditnya diperhitungkan dalam proyeksi kas."
          action={
            canManage ? (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                Tambah pemasok
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Kode</TableHead>
                <TableHead>Nama</TableHead>
                <TableHead>Kontak</TableHead>
                <TableHead className="w-32 text-right">Termin (hari)</TableHead>
                <TableHead className="w-28 text-right">Pembelian</TableHead>
                {canManage ? <TableHead className="w-24" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {suppliers.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-mono text-xs">{s.code}</TableCell>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.contact ?? EMPTY_VALUE}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.creditDays}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {s.purchaseCount.toLocaleString('id-ID')}
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Ubah pemasok ${s.name}`}
                          onClick={() => setEditing(s)}
                        >
                          <Pencil className="size-4" aria-hidden />
                        </Button>

                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Hapus pemasok ${s.name}`}
                                disabled={pending}
                              />
                            }
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Hapus &ldquo;{s.name}&rdquo;?</AlertDialogTitle>
                              <AlertDialogDescription>
                                {s.purchaseCount > 0
                                  ? `Pemasok ini tercatat pada ${s.purchaseCount} pembelian, sehingga penghapusan akan ditolak — riwayat pembelian harus tetap dapat ditelusuri ke pemasoknya.`
                                  : 'Belum tercatat pada pembelian mana pun, jadi aman dihapus.'}
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Batal</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() =>
                                  startTransition(async () => {
                                    const result = await deleteSupplierAction(s.id);
                                    if (result.ok) {
                                      toast.success('Pemasok dihapus.');
                                      router.refresh();
                                    } else {
                                      toast.error(result.message, { description: result.hint });
                                    }
                                  })
                                }
                              >
                                Ya, hapus
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {creating ? <SupplierDialog open onOpenChange={setCreating} supplierId={null} /> : null}

      {editing ? (
        <SupplierDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          supplierId={editing.id}
          defaultValues={toFormValues(editing)}
        />
      ) : null}
    </div>
  );
}
