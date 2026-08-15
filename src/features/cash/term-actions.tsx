'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Banknote, FileText, Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
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
import {
  SelectField,
  TextAreaField,
  TextField,
  selectClassName,
} from '@/features/master-data/form-fields';
import { formatCurrency, formatPercent } from '@/lib/format';
import {
  PAYMENT_TERM_DEFAULTS,
  TERM_TYPE_LABELS,
  claimFormSchema,
  payClaimFormSchema,
  paymentTermFormSchema,
  type ClaimFormInput,
  type PaymentTermFormInput,
} from '@/lib/validation/cash';

import {
  createClaimAction,
  deletePaymentTermAction,
  payClaimAction,
  previewClaimAction,
  savePaymentTermAction,
} from './actions';

export function PaymentTermButton({
  projectId,
  nextSeq,
  canManage,
}: {
  projectId: string;
  nextSeq: number;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!canManage) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Termin baru
      </Button>
      {open ? (
        <PaymentTermDialog open onOpenChange={setOpen} projectId={projectId} nextSeq={nextSeq} />
      ) : null}
    </>
  );
}

function PaymentTermDialog({
  open,
  onOpenChange,
  projectId,
  nextSeq,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  nextSeq: number;
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);

  const form = useForm<PaymentTermFormInput>({
    resolver: zodResolver(paymentTermFormSchema),
    defaultValues: { ...PAYMENT_TERM_DEFAULTS, seq: nextSeq },
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = form;

  const messageOf = (field: keyof PaymentTermFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Termin baru</DialogTitle>
          <DialogDescription>
            Isi persentase terhadap nilai kontrak, atau nominal tetap bila terminnya sudah
            disepakati dalam angka.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(async (values) => {
            setFormError(null);
            const result = await savePaymentTermAction(projectId, null, values);
            if (result.ok) {
              toast.success('Termin disimpan.');
              onOpenChange(false);
              router.refresh();
              return;
            }
            if (result.fieldErrors) {
              for (const [field, message] of Object.entries(result.fieldErrors)) {
                setError(field as keyof PaymentTermFormInput, { type: 'server', message });
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

          <div className="grid gap-4 sm:grid-cols-[6rem_1fr]">
            <TextField
              id="seq"
              label="Urutan"
              type="number"
              min={1}
              error={messageOf('seq')}
              registration={register('seq')}
            />
            <TextField
              id="term-name"
              label="Nama termin"
              placeholder="Termin I"
              error={messageOf('name')}
              registration={register('name')}
            />
          </div>

          <SelectField
            id="termType"
            label="Jenis"
            error={messageOf('termType')}
            registration={register('termType')}
            options={Object.entries(TERM_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="percentInput"
              label="Persentase (%)"
              inputMode="decimal"
              hint="Terhadap nilai kontrak."
              error={messageOf('percentInput')}
              registration={register('percentInput')}
            />
            <TextField
              id="amount"
              label="Nominal (Rp)"
              inputMode="decimal"
              hint="Isi salah satu saja."
              error={messageOf('amount')}
              registration={register('amount')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="triggerInput"
              label="Pemicu progres (%)"
              inputMode="decimal"
              hint="Termin terbuka setelah progres mencapai ini."
              error={messageOf('triggerInput')}
              registration={register('triggerInput')}
            />
            <TextField
              id="dpRecoupmentInput"
              label="Potongan uang muka (%)"
              inputMode="decimal"
              hint="Bagian tagihan yang dipakai mengembalikan uang muka."
              error={messageOf('dpRecoupmentInput')}
              registration={register('dpRecoupmentInput')}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              id="plannedDate"
              label="Rencana tagih"
              type="date"
              error={messageOf('plannedDate')}
              registration={register('plannedDate')}
            />
            <TextField
              id="verificationDays"
              label="Verifikasi (hari)"
              type="number"
              min={0}
              error={messageOf('verificationDays')}
              registration={register('verificationDays')}
            />
            <TextField
              id="paymentLagDays"
              label="Jeda bayar (hari)"
              type="number"
              min={0}
              error={messageOf('paymentLagDays')}
              registration={register('paymentLagDays')}
            />
          </div>

          <TextAreaField
            id="term-note"
            label="Catatan"
            rows={2}
            error={messageOf('note')}
            registration={register('note')}
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

export function DeleteTermButton({
  projectId,
  termId,
  name,
  claimed,
}: {
  projectId: string;
  termId: string;
  name: string;
  claimed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            disabled={pending || claimed}
            title={claimed ? 'Termin ini sudah pernah ditagihkan.' : 'Hapus termin'}
            aria-label={`Hapus ${name}`}
          />
        }
      >
        <Trash2 className="size-3.5" aria-hidden />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus termin {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Termin yang sudah pernah ditagihkan tidak dapat dihapus.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deletePaymentTermAction(projectId, termId);
                if (result.ok) {
                  toast.success('Termin dihapus.');
                  router.refresh();
                } else {
                  toast.error(result.message, { description: result.hint });
                }
              })
            }
          >
            Ya, hapus
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ClaimButton({
  projectId,
  terms,
  canManage,
}: {
  projectId: string;
  terms: { id: string; name: string; seq: number }[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!canManage) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={terms.length === 0}
        title={terms.length === 0 ? 'Susun termin terlebih dahulu.' : undefined}
      >
        <FileText className="size-4" aria-hidden />
        Buat tagihan
      </Button>
      {open ? (
        <ClaimDialog open onOpenChange={setOpen} projectId={projectId} terms={terms} />
      ) : null}
    </>
  );
}

/**
 * Raising a claim.
 *
 * The breakdown is fetched from the server as the figures are typed rather than
 * recomputed here: retention, VAT and withholding come from project settings,
 * and a second implementation in the browser would be a second thing to keep in
 * step with the contract.
 */
function ClaimDialog({
  open,
  onOpenChange,
  projectId,
  terms,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  terms: { id: string; name: string; seq: number }[];
}) {
  const router = useRouter();
  const [formError, setFormError] = useState<{ message: string; hint?: string } | null>(null);
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewClaimAction>
  > | null>(null);
  const [loadingPreview, startPreview] = useTransition();

  const form = useForm<ClaimFormInput>({
    resolver: zodResolver(claimFormSchema),
    defaultValues: {
      paymentTermId: terms[0]?.id ?? '',
      claimNo: '',
      claimDate: new Date().toISOString().slice(0, 10),
      certifiedInput: '',
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

  const termId = watch('paymentTermId');
  const certified = watch('certifiedInput');

  useEffect(() => {
    const value = Number(certified);
    if (!termId || !Number.isFinite(value) || value <= 0) {
      setPreview(null);
      return;
    }

    const timer = window.setTimeout(() => {
      startPreview(async () => {
        setPreview(await previewClaimAction(projectId, termId, value));
      });
    }, 350);

    return () => window.clearTimeout(timer);
  }, [projectId, termId, certified]);

  const messageOf = (field: keyof ClaimFormInput): string | undefined => {
    const entry = errors[field];
    return typeof entry?.message === 'string' ? entry.message : undefined;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Buat tagihan</DialogTitle>
          <DialogDescription>
            Yang ditagih adalah selisih sejak sertifikasi terakhir, bukan angka kumulatifnya.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit(async (values) => {
            setFormError(null);
            const result = await createClaimAction(projectId, values);
            if (result.ok) {
              toast.success('Tagihan dibuat.');
              onOpenChange(false);
              router.refresh();
              return;
            }
            if (result.fieldErrors) {
              for (const [field, message] of Object.entries(result.fieldErrors)) {
                setError(field as keyof ClaimFormInput, { type: 'server', message });
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
            id="paymentTermId"
            label="Termin"
            error={messageOf('paymentTermId')}
            registration={register('paymentTermId')}
            options={terms.map((term) => ({
              value: term.id,
              label: `${term.seq}. ${term.name}`,
            }))}
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              id="claimNo"
              label="Nomor tagihan"
              placeholder="INV-001"
              error={messageOf('claimNo')}
              registration={register('claimNo')}
            />
            <TextField
              id="claimDate"
              label="Tanggal tagihan"
              type="date"
              error={messageOf('claimDate')}
              registration={register('claimDate')}
            />
          </div>

          <TextField
            id="certifiedInput"
            label="Progres tersertifikasi (%)"
            inputMode="decimal"
            hint="Kumulatif sejak awal proyek, bukan capaian periode ini."
            error={messageOf('certifiedInput')}
            registration={register('certifiedInput')}
          />

          {loadingPreview ? (
            <p className="text-sm text-muted-foreground">Menghitung…</p>
          ) : preview?.ok ? (
            <dl className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm">
              <Line label="Sudah tersertifikasi" value={formatPercent(preview.preview.previouslyCertifiedPct, 2)} />
              <Line label="Bruto tagihan" value={formatCurrency(preview.preview.grossAmount)} />
              {Number(preview.preview.dpRecoupment) > 0 ? (
                <Line
                  label="Pengembalian uang muka"
                  value={`− ${formatCurrency(preview.preview.dpRecoupment)}`}
                />
              ) : null}
              <Line
                label="Retensi ditahan"
                value={`− ${formatCurrency(preview.preview.retentionWithheld)}`}
              />
              <Line label="PPN" value={`+ ${formatCurrency(preview.preview.vatAmount)}`} />
              <Line label="PPh" value={`− ${formatCurrency(preview.preview.whtAmount)}`} />
              <div className="flex justify-between border-t pt-1 font-medium">
                <dt>Diterima bersih</dt>
                <dd className="font-mono tabular-nums">
                  {formatCurrency(preview.preview.netAmount)}
                </dd>
              </div>
            </dl>
          ) : preview && !preview.ok ? (
            <Alert variant="destructive">
              <AlertTitle>{preview.message}</AlertTitle>
              {preview.hint ? <AlertDescription>{preview.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Buat tagihan
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums">{value}</dd>
    </div>
  );
}

export function PayClaimButton({
  projectId,
  claimId,
  claimNo,
  netAmount,
  accounts,
  canManage,
}: {
  projectId: string;
  claimId: string;
  claimNo: string;
  netAmount: string;
  accounts: { id: string; name: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canManage) return null;

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        disabled={accounts.length === 0}
        title={accounts.length === 0 ? 'Buat akun kas terlebih dahulu.' : undefined}
        onClick={() => setOpen(true)}
      >
        <Banknote className="size-3.5" aria-hidden />
        Catat lunas
      </Button>

      {open ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Catat pembayaran {claimNo}</DialogTitle>
              <DialogDescription>
                Menandai lunas sekaligus menulis kas masuk {formatCurrency(netAmount)} dalam satu
                transaksi.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>{error.message}</AlertTitle>
                  {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
                </Alert>
              ) : null}

              {/* Plain controls: this dialog holds two fields and no form state. */}
              <div className="space-y-1.5">
                <Label htmlFor="pay-account">Akun kas penerima</Label>
                <select
                  id="pay-account"
                  className={selectClassName}
                  value={accountId}
                  onChange={(e) => setAccountId(e.target.value)}
                >
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="paidAt">Tanggal bayar</Label>
                <Input
                  id="paidAt"
                  type="date"
                  value={paidAt}
                  onChange={(e) => setPaidAt(e.target.value)}
                />
              </div>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Batal
              </Button>
              <Button
                disabled={pending}
                onClick={() =>
                  startTransition(async () => {
                    const parsed = payClaimFormSchema.safeParse({ accountId, paidAt });
                    if (!parsed.success) {
                      setError({ message: 'Periksa kembali isian pembayaran.' });
                      return;
                    }
                    const result = await payClaimAction(projectId, claimId, parsed.data);
                    if (result.ok) {
                      toast.success('Pembayaran tercatat.');
                      setOpen(false);
                      router.refresh();
                    } else {
                      setError(
                        result.hint === undefined
                          ? { message: result.message }
                          : { message: result.message, hint: result.hint },
                      );
                    }
                  })
                }
              >
                {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                Catat lunas
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
