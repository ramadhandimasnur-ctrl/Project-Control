'use client';

import { AlertTriangle, ArrowRight, Loader2, Upload } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { EMPTY_VALUE, formatCurrency, formatDay, formatQuantity } from '@/lib/format';
import type { PostingImpact } from '@/services/purchases';

import { postPurchaseAction, previewPostingAction } from './actions';

/**
 * Confirmation for posting a purchase.
 *
 * Charter section 6.5: the dialog states what will happen in concrete terms —
 * stock in, cash out, and how the moving average moves — rather than asking
 * for approval of an abstraction. Posting is irreversible except by voiding,
 * so the numbers are computed on the server first and shown before the button
 * becomes available.
 */
export function PostPurchaseDialog({
  open,
  onOpenChange,
  projectId,
  purchaseId,
  invoiceLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  purchaseId: string;
  invoiceLabel: string;
}) {
  const router = useRouter();
  const [impact, setImpact] = useState<PostingImpact | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const [posting, startPosting] = useTransition();

  useEffect(() => {
    startLoading(async () => {
      const result = await previewPostingAction(projectId, purchaseId);
      if (result.ok) setImpact(result.impact);
      else setError(result.hint === undefined ? { message: result.message } : result);
    });
  }, [projectId, purchaseId]);

  const submit = () => {
    startPosting(async () => {
      const result = await postPurchaseAction(projectId, purchaseId);
      if (result.ok) {
        toast.success('Pembelian di-POST.', {
          description: 'Stok bertambah dan kas tercatat dalam satu transaksi.',
        });
        onOpenChange(false);
        router.refresh();
      } else {
        setError(result.hint === undefined ? { message: result.message } : result);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>POST pembelian {invoiceLabel}</DialogTitle>
          <DialogDescription>
            Setelah di-POST, pembelian tidak dapat diubah lagi — hanya dibatalkan. Berikut yang akan
            terjadi:
          </DialogDescription>
        </DialogHeader>

        {error ? (
          <Alert variant="destructive">
            <AlertTriangle className="size-4" aria-hidden />
            <AlertTitle>{error.message}</AlertTitle>
            {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
          </Alert>
        ) : null}

        {loading ? (
          <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Menghitung dampak…
          </p>
        ) : null}

        {impact ? (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-sm font-medium">Stok bertambah</p>
              <div className="overflow-x-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Kode</TableHead>
                      <TableHead>Uraian</TableHead>
                      <TableHead className="w-28 text-right">Masuk</TableHead>
                      <TableHead className="w-28 text-right">Harga</TableHead>
                      <TableHead className="w-48 text-right">Rata-rata bergerak</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {impact.lines.map((line) => (
                      <TableRow key={line.resourceCode}>
                        <TableCell className="font-mono text-xs">{line.resourceCode}</TableCell>
                        <TableCell>{line.resourceName}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          +{formatQuantity(line.qtyIn)} {line.unitCode}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCurrency(line.unitCost)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {/* The before → after that makes the effect legible. */}
                          {line.averageBefore === null ? (
                            <span className="text-muted-foreground">
                              belum ada stok → {formatCurrency(line.averageAfter)}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              {formatCurrency(line.averageBefore)}
                              <ArrowRight className="size-3" aria-hidden />
                              {formatCurrency(line.averageAfter)}
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <p className="text-sm font-medium">Kas</p>
              {impact.cashOut === null ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  Tidak ada kas keluar. Proyek ini mengakui biaya saat pemakaian, sehingga
                  pembelian belum menjadi biaya.
                </p>
              ) : (
                <p className="mt-1 text-sm">
                  Keluar <strong className="font-mono">{formatCurrency(impact.cashOut)}</strong> dari{' '}
                  {impact.cashAccountName}, bertanggal{' '}
                  {impact.cashDate === null ? EMPTY_VALUE : formatDay(impact.cashDate)}.
                </p>
              )}
            </div>

            <Alert>
              <AlertTitle>Keduanya tercatat sekaligus</AlertTitle>
              <AlertDescription>
                Mutasi stok dan kas ditulis dalam satu transaksi database. Bila salah satunya
                gagal, tidak ada yang tersimpan.
              </AlertDescription>
            </Alert>
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button disabled={posting || impact === null} onClick={submit}>
            {posting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-4" aria-hidden />
            )}
            {posting ? 'Memproses…' : 'Ya, POST sekarang'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
