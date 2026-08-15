'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Ban, Loader2, Plus, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { useForm } from 'react-hook-form';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SelectField, TextAreaField, TextField } from '@/features/master-data/form-fields';
import { IN_CATEGORY_LABELS, OUT_CATEGORY_LABELS } from '@/lib/calc/cashflow';
import {
  CASH_ACCOUNT_TYPE_LABELS,
  cashAccountFormSchema,
  cashTransactionFormSchema,
  type CashAccountFormInput,
  type CashTransactionFormInput,
} from '@/lib/validation/cash';

import { recordCashAction, saveCashAccountAction, voidCashAction } from './actions';

export function CashAccountButton({
  projectId,
  canManage,
  variant,
  label = 'Akun kas baru',
}: {
  projectId: string;
  canManage: boolean;
  variant?: React.ComponentProps<typeof Button>['variant'];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!canManage) return null;

  return (
    <>
      <Button variant={variant} onClick={() => setOpen(true)}>
        <Wallet className="size-4" aria-hidden />
        {label}
      </Button>
      {open ? <CashAccountDialog open onOpenChange={setOpen} projectId={projectId} /> : null}
    </>
  );
}

function CashAccountDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);

  const form = useForm<CashAccountFormInput>({
    resolver: zodResolver(cashAccountFormSchema),
    defaultValues: { name: '', type: 'BANK', openingBalance: '0' },
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof CashAccountFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Akun kas baru</DialogTitle>
          <DialogDescription>
            Saldo awal adalah uang yang sudah ada di akun sebelum proyek mulai dicatat di sini.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(async (values) => {
            setFormError(null);
            const result = await saveCashAccountAction(projectId, null, values);
            if (result.ok) {
              toast.success('Akun kas dibuat.');
              onOpenChange(false);
              router.refresh();
              return;
            }
            if (result.fieldErrors) {
              for (const [field, message] of Object.entries(result.fieldErrors)) {
                setError(field as keyof CashAccountFormInput, { type: 'server', message });
              }
            }
            setFormError(result.message);
          })}
          className="space-y-4"
          noValidate
        >
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{formError}</AlertTitle>
            </Alert>
          ) : null}

          <TextField
            id="account-name"
            label="Nama akun"
            placeholder="Rekening Proyek BCA"
            error={messageOf('name')}
            registration={register('name')}
          />
          <SelectField
            id="account-type"
            label="Jenis"
            error={messageOf('type')}
            registration={register('type')}
            options={Object.entries(CASH_ACCOUNT_TYPE_LABELS).map(([value, label]) => ({
              value,
              label,
            }))}
          />
          <TextField
            id="openingBalance"
            label="Saldo awal (Rp)"
            inputMode="decimal"
            error={messageOf('openingBalance')}
            registration={register('openingBalance')}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function CashTransactionButton({
  projectId,
  accounts,
  canManage,
}: {
  projectId: string;
  accounts: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!canManage) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={accounts.length === 0}
        title={accounts.length === 0 ? 'Buat akun kas terlebih dahulu.' : undefined}
      >
        <Plus className="size-4" aria-hidden />
        Catat transaksi
      </Button>
      {open ? (
        <CashTransactionDialog
          open
          onOpenChange={setOpen}
          projectId={projectId}
          accounts={accounts}
        />
      ) : null}
    </>
  );
}

function CashTransactionDialog({
  open,
  onOpenChange,
  projectId,
  accounts,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<CashTransactionFormInput>({
    resolver: zodResolver(cashTransactionFormSchema),
    defaultValues: {
      accountId: accounts[0]?.id ?? '',
      txnDate: new Date().toISOString().slice(0, 10),
      direction: 'OUT',
      category: 'MATERIAL',
      amount: '',
      description: '',
    },
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = form;

  const direction = watch('direction');
  // Categories are directional; showing the wrong half invites a rejection the
  // user cannot act on.
  const categories = direction === 'IN' ? IN_CATEGORY_LABELS : OUT_CATEGORY_LABELS;

  const messageOf = (field: keyof CashTransactionFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat transaksi kas</DialogTitle>
          <DialogDescription>
            Untuk pencatatan manual. Pembelian dan tagihan menulis kasnya sendiri saat di-POST.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(async (values) => {
            setFormError(null);
            const result = await recordCashAction(projectId, values);
            if (result.ok) {
              toast.success('Transaksi tercatat.');
              onOpenChange(false);
              router.refresh();
              return;
            }
            if (result.fieldErrors) {
              for (const [field, message] of Object.entries(result.fieldErrors)) {
                setError(field as keyof CashTransactionFormInput, { type: 'server', message });
              }
            }
            setFormError(
              result.hint === undefined
                ? { message: result.message }
                : { message: result.message, hint: result.hint },
            );
          })}
          className="space-y-4"
          noValidate
        >
          {formError ? (
            <Alert variant="destructive">
              <AlertTitle>{formError.message}</AlertTitle>
              {formError.hint ? <AlertDescription>{formError.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <SelectField
            id="accountId"
            label="Akun kas"
            error={messageOf('accountId')}
            registration={register('accountId')}
            options={accounts.map((account) => ({ value: account.id, label: account.name }))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              id="direction"
              label="Arah"
              error={messageOf('direction')}
              registration={register('direction')}
              options={[
                { value: 'OUT', label: 'Keluar' },
                { value: 'IN', label: 'Masuk' },
              ]}
            />
            <SelectField
              id="category"
              label="Kategori"
              error={messageOf('category')}
              registration={register('category')}
              options={Object.entries(categories).map(([value, label]) => ({ value, label }))}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="txnDate"
              label="Tanggal"
              type="date"
              error={messageOf('txnDate')}
              registration={register('txnDate')}
            />
            <TextField
              id="amount"
              label="Nilai (Rp)"
              inputMode="decimal"
              error={messageOf('amount')}
              registration={register('amount')}
            />
          </div>

          <TextAreaField
            id="description"
            label="Keterangan"
            rows={2}
            error={messageOf('description')}
            registration={register('description')}
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Simpan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function VoidCashButton({
  projectId,
  transactionId,
  label,
  isManual,
}: {
  projectId: string;
  transactionId: string;
  label: string;
  isManual: boolean;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();

  if (!isManual) return null;

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:text-destructive"
            disabled={pending}
          />
        }
      >
        <Ban className="size-3.5" aria-hidden />
        Batalkan
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Batalkan transaksi {label}?</AlertDialogTitle>
          <AlertDialogDescription render={<div />}>
            <p>Barisnya ditandai batal, bukan dihapus, agar riwayatnya tetap dapat ditelusuri.</p>
            <div className="mt-3 space-y-1.5">
              <Label htmlFor="void-cash-reason">Alasan</Label>
              <Input
                id="void-cash-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Contoh: salah akun"
              />
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending || reason.trim() === ''}
            onClick={() =>
              startTransition(async () => {
                const result = await voidCashAction(projectId, transactionId, reason);
                if (result.ok) {
                  toast.success('Transaksi dibatalkan.');
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
  );
}
