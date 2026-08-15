'use client';

import { Ban, Plus, Upload } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { voidPurchaseAction } from './actions';
import { PostPurchaseDialog } from './post-purchase-dialog';
import { PurchaseFormDialog, type PurchasePickers } from './purchase-form-dialog';

type PurchaseSummary = { id: string; status: 'DRAFT' | 'POSTED' | 'VOID'; label: string };

export function PurchaseActions({
  projectId,
  mode,
  canPost,
  purchase,
  pickers,
}: {
  projectId: string;
  mode: 'create' | 'row';
  canPost: boolean;
  purchase?: PurchaseSummary;
  pickers?: PurchasePickers;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [posting, setPosting] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  if (mode === 'create') {
    if (!pickers) return null;
    return (
      <>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden />
          Pembelian baru
        </Button>
        {creating ? (
          <PurchaseFormDialog
            open
            onOpenChange={setCreating}
            projectId={projectId}
            pickers={pickers}
          />
        ) : null}
      </>
    );
  }

  if (!purchase) return null;

  return (
    <div className="flex justify-end gap-1">
      {purchase.status === 'DRAFT' && canPost ? (
        <Button variant="outline" size="sm" onClick={() => setPosting(true)}>
          <Upload className="size-4" aria-hidden />
          POST
        </Button>
      ) : null}

      {purchase.status === 'POSTED' && canPost ? (
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={pending} />}>
            <Ban className="size-4" aria-hidden />
            Batalkan
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Batalkan pembelian {purchase.label}?</AlertDialogTitle>
              <AlertDialogDescription render={<div />}>
                <p>
                  Mutasi stok dan baris kas dari pembelian ini akan ditandai batal. Keduanya tetap
                  terlihat sebagai riwayat, sehingga buku besar masih menunjukkan apa yang sempat
                  terjadi.
                </p>
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="void-reason">Alasan pembatalan</Label>
                  <Input
                    id="void-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Contoh: salah pemasok, barang diretur"
                  />
                </div>
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Batal</AlertDialogCancel>
              {/* Not AlertDialogAction: the dialog must stay open when the
                  reason is empty so the message can be read. */}
              <Button
                variant="destructive"
                disabled={pending || reason.trim() === ''}
                onClick={() =>
                  startTransition(async () => {
                    const result = await voidPurchaseAction(projectId, purchase.id, reason);
                    if (result.ok) {
                      toast.success('Pembelian dibatalkan.');
                      setReason('');
                      router.refresh();
                    } else {
                      toast.error(result.message, { description: result.hint });
                    }
                  })
                }
              >
                Ya, batalkan
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      ) : null}

      {posting ? (
        <PostPurchaseDialog
          open
          onOpenChange={setPosting}
          projectId={projectId}
          purchaseId={purchase.id}
          invoiceLabel={purchase.label}
        />
      ) : null}
    </div>
  );
}
