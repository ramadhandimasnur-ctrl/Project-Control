'use client';

import { Ban, CircleCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

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
import { type ResourceFormInput } from '@/lib/validation/master-data';

import { deleteResourceAction, setResourceActiveAction } from './actions';
import { PriceDialog } from './price-dialog';
import { ResourceDialog } from './resource-dialog';

export type ResourceUsageSummary = {
  workItems: number;
  ahspTemplates: number;
  materialTransactions: number;
  purchaseItems: number;
  total: number;
};

export function ResourceDetailActions({
  resourceId,
  resourceName,
  unitCode,
  isActive,
  defaultValues,
  units,
  categories,
  usage,
  canManage,
  canManagePrices,
  currentRap,
  currentRab,
  defaultMarkupPercent,
}: {
  resourceId: string;
  resourceName: string;
  unitCode: string;
  isActive: boolean;
  defaultValues: ResourceFormInput;
  units: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
  usage: ResourceUsageSummary;
  canManage: boolean;
  canManagePrices: boolean;
  /** Prices in force, so the dialog opens on what is already true. */
  currentRap?: string | null;
  currentRab?: string | null;
  /** Markup remembered from the last save, as a percentage string. */
  defaultMarkupPercent?: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string; hint?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success('Perubahan tersimpan.');
        router.refresh();
      } else {
        toast.error(result.message ?? 'Gagal menyimpan.', { description: result.hint });
      }
    });
  };

  const usageLines = [
    usage.workItems > 0 ? `${usage.workItems} baris analisa pekerjaan` : null,
    usage.ahspTemplates > 0 ? `${usage.ahspTemplates} baris template AHSP` : null,
    usage.materialTransactions > 0 ? `${usage.materialTransactions} transaksi material` : null,
    usage.purchaseItems > 0 ? `${usage.purchaseItems} baris pembelian` : null,
  ].filter((line): line is string => line !== null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canManagePrices ? (
        <Button variant="outline" onClick={() => setPricing(true)}>
          <Plus className="size-4" aria-hidden />
          Tambah harga
        </Button>
      ) : null}

      {canManage ? (
        <>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil className="size-4" aria-hidden />
            Ubah
          </Button>

          <Button
            variant="outline"
            disabled={pending}
            onClick={() => run(() => setResourceActiveAction(resourceId, !isActive))}
          >
            {isActive ? (
              <>
                <Ban className="size-4" aria-hidden />
                Nonaktifkan
              </>
            ) : (
              <>
                <CircleCheck className="size-4" aria-hidden />
                Aktifkan
              </>
            )}
          </Button>

          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" disabled={pending} />}
            >
              <Trash2 className="size-4" aria-hidden />
              Hapus
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Hapus &ldquo;{resourceName}&rdquo;?</AlertDialogTitle>
                <AlertDialogDescription render={<div />}>
                  {usage.total > 0 ? (
                    <>
                      {/* Naming the references is the point: the delete will be
                          refused, and this explains why before the attempt. */}
                      <p>Sumber daya ini masih dipakai di:</p>
                      <ul className="mt-2 list-inside list-disc space-y-0.5">
                        {usageLines.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                      <p className="mt-2">
                        Penghapusan akan ditolak. Nonaktifkan saja agar tidak muncul lagi saat
                        memilih, tanpa mengubah data lama.
                      </p>
                    </>
                  ) : (
                    <p>
                      Belum dipakai di mana pun. Seluruh riwayat harganya ikut terhapus permanen.
                    </p>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deleteResourceAction(resourceId);
                      if (result.ok) {
                        toast.success('Sumber daya dihapus.');
                        router.push('/master-data/resources');
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
        </>
      ) : null}

      {editing ? (
        <ResourceDialog
          open={editing}
          onOpenChange={setEditing}
          resourceId={resourceId}
          defaultValues={defaultValues}
          units={units}
          categories={categories}
          unitLocked={usage.total > 0}
        />
      ) : null}

      {pricing ? (
        <PriceDialog
          open={pricing}
          onOpenChange={setPricing}
          resourceId={resourceId}
          resourceName={resourceName}
          unitCode={unitCode}
          currentRap={currentRap}
          currentRab={currentRab}
          defaultMarkupPercent={defaultMarkupPercent}
        />
      ) : null}
    </div>
  );
}
