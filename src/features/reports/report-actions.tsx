'use client';

import { FileCheck2, Loader2, Plus, Trash2 } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { selectClassName } from '@/features/master-data/form-fields';
import {
  ISSUE_SEVERITY_LABELS,
  ISSUE_STATUS_LABELS,
  REPORT_TYPE_LABELS,
  type IssueSeverity,
  type IssueStatus,
} from '@/lib/reports/labels';

import { deleteIssueAction, publishReportAction, saveIssueAction } from './actions';

/**
 * Publishing freezes the figures.
 *
 * The confirmation says so in those words: a published report is what the owner
 * was handed, and a correction made next week must not rewrite what they read
 * last week.
 */
export function PublishButton({
  projectId,
  periodId,
  periodLabel,
  canPublish,
}: {
  projectId: string;
  periodId: string | null;
  periodLabel: string | null;
  canPublish: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reportType, setReportType] = useState<'DAILY' | 'WEEKLY' | 'MONTHLY'>('WEEKLY');
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canPublish) return null;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={periodId === null}
        title={periodId === null ? 'Pilih periode terlebih dahulu.' : undefined}
      >
        <FileCheck2 className="size-4" aria-hidden />
        Terbitkan laporan
      </Button>

      {open && periodId ? (
        <Dialog open onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Terbitkan laporan {periodLabel}</DialogTitle>
              <DialogDescription>
                Angkanya dibekukan pada saat penerbitan. Koreksi yang dibuat setelah ini tidak akan
                mengubah laporan yang sudah terbit — itulah gunanya menerbitkan.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {error ? (
                <Alert variant="destructive">
                  <AlertTitle>{error.message}</AlertTitle>
                  {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
                </Alert>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="report-type">Jenis laporan</Label>
                <select
                  id="report-type"
                  className={selectClassName}
                  value={reportType}
                  onChange={(e) =>
                    setReportType(e.target.value as 'DAILY' | 'WEEKLY' | 'MONTHLY')
                  }
                >
                  {(Object.keys(REPORT_TYPE_LABELS) as (keyof typeof REPORT_TYPE_LABELS)[]).map(
                    (value) => (
                      <option key={value} value={value}>
                        {REPORT_TYPE_LABELS[value]}
                      </option>
                    ),
                  )}
                </select>
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
                    const result = await publishReportAction(projectId, periodId, reportType);
                    if (result.ok) {
                      toast.success('Laporan diterbitkan.');
                      setOpen(false);
                      router.push(`/projects/${projectId}/reports/${result.id}`);
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
                Terbitkan
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}

export function IssueButton({
  projectId,
  periodId,
  canRecord,
}: {
  projectId: string;
  periodId: string | null;
  canRecord: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!canRecord) return null;

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Catat kendala
      </Button>
      {open ? (
        <IssueDialog open onOpenChange={setOpen} projectId={projectId} periodId={periodId} />
      ) : null}
    </>
  );
}

function IssueDialog({
  open,
  onOpenChange,
  projectId,
  periodId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  periodId: string | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    title: '',
    description: '',
    severity: 'MEDIUM' as IssueSeverity,
    status: 'OPEN' as IssueStatus,
  });
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Catat kendala lapangan</DialogTitle>
          <DialogDescription>
            Kendala yang tercatat pada periode ini ikut terbawa ke laporan yang diterbitkan.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{error.message}</AlertTitle>
              {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="issue-title">Judul</Label>
            <Input
              id="issue-title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              placeholder="Hujan deras menghentikan pengecoran"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="issue-description">Keterangan</Label>
            <Textarea
              id="issue-description"
              rows={3}
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="issue-severity">Tingkat</Label>
              <select
                id="issue-severity"
                className={selectClassName}
                value={form.severity}
                onChange={(e) => setForm({ ...form, severity: e.target.value as IssueSeverity })}
              >
                {(Object.keys(ISSUE_SEVERITY_LABELS) as IssueSeverity[]).map((value) => (
                  <option key={value} value={value}>
                    {ISSUE_SEVERITY_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="issue-status">Status</Label>
              <select
                id="issue-status"
                className={selectClassName}
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value as IssueStatus })}
              >
                {(Object.keys(ISSUE_STATUS_LABELS) as IssueStatus[]).map((value) => (
                  <option key={value} value={value}>
                    {ISSUE_STATUS_LABELS[value]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            disabled={pending || form.title.trim() === ''}
            onClick={() =>
              startTransition(async () => {
                const result = await saveIssueAction(projectId, null, {
                  title: form.title,
                  description: form.description === '' ? null : form.description,
                  severity: form.severity,
                  status: form.status,
                  periodId,
                });

                if (result.ok) {
                  toast.success('Kendala tercatat.');
                  onOpenChange(false);
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
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeleteIssueButton({
  projectId,
  issueId,
  title,
  canManage,
}: {
  projectId: string;
  issueId: string;
  title: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!canManage) return null;

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-destructive hover:text-destructive"
            disabled={pending}
            aria-label={`Hapus kendala ${title}`}
          />
        }
      >
        <Trash2 className="size-3.5" aria-hidden />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Hapus kendala ini?</AlertDialogTitle>
          <AlertDialogDescription>
            Laporan yang sudah terbit tetap memuat kendala ini, karena isinya dibekukan saat
            diterbitkan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Batal</AlertDialogCancel>
          <Button
            variant="destructive"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await deleteIssueAction(projectId, issueId);
                if (result.ok) {
                  toast.success('Kendala dihapus.');
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
