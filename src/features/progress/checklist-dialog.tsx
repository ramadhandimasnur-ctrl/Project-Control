'use client';

import { Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectClassName } from '@/features/master-data/form-fields';
import { CHECKLIST_ITEM_LABELS, CHECKLIST_LABELS } from '@/lib/validation/progress';

import { saveChecklistAction } from './actions';
import { PhotoField } from './photo-field';
import { inspectionKey } from './photo-stash';

type Result = 'PASS' | 'FAIL' | 'NA';

/**
 * The quality gate.
 *
 * The verdict is not an input. It is derived in the database — any FAIL makes
 * the whole check fail, and everything must pass for it to pass — so nobody can
 * record a passing inspection over a failed dimension.
 */
export function ChecklistDialog({
  open,
  onOpenChange,
  projectId,
  workItemId,
  periodId,
  label,
  current,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workItemId: string;
  periodId: string;
  label: string;
  current: { asDrawing: Result; position: Result; dimension: Result } | null;
}) {
  const router = useRouter();
  const [form, setForm] = useState({
    asDrawing: current?.asDrawing ?? ('NA' as Result),
    position: current?.position ?? ('NA' as Result),
    dimension: current?.dimension ?? ('NA' as Result),
    checkedAt: new Date().toISOString().slice(0, 10),
    note: '',
  });
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const values = [form.asDrawing, form.position, form.dimension];
  const verdict: Result = values.includes('FAIL')
    ? 'FAIL'
    : values.every((v) => v === 'PASS')
      ? 'PASS'
      : 'NA';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Checklist mutu — {label}</DialogTitle>
          <DialogDescription>
            Putusannya dihitung sendiri: satu butir tidak sesuai membuat seluruh pemeriksaan gagal.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>{error.message}</AlertTitle>
              {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
            </Alert>
          ) : null}

          {(Object.keys(CHECKLIST_ITEM_LABELS) as (keyof typeof CHECKLIST_ITEM_LABELS)[]).map(
            (key) => (
              <div key={key} className="space-y-1.5">
                <Label htmlFor={`checklist-${key}`}>{CHECKLIST_ITEM_LABELS[key]}</Label>
                <select
                  id={`checklist-${key}`}
                  className={selectClassName}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value as Result })}
                >
                  {(Object.keys(CHECKLIST_LABELS) as Result[]).map((value) => (
                    <option key={value} value={value}>
                      {CHECKLIST_LABELS[value]}
                    </option>
                  ))}
                </select>
              </div>
            ),
          )}

          <div className="space-y-1.5">
            <Label htmlFor="checkedAt">Tanggal periksa</Label>
            <Input
              id="checkedAt"
              type="date"
              value={form.checkedAt}
              onChange={(e) => setForm({ ...form, checkedAt: e.target.value })}
            />
          </div>

          <PhotoField stashKey={inspectionKey(workItemId, periodId)} />

          <div
            className={
              verdict === 'PASS'
                ? 'rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm'
                : verdict === 'FAIL'
                  ? 'rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive'
                  : 'rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground'
            }
          >
            Putusan: <span className="font-medium">{CHECKLIST_LABELS[verdict]}</span>
            {verdict !== 'PASS' ? ' — progres belum dapat disetujui bila proyek mewajibkan checklist.' : null}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const result = await saveChecklistAction(projectId, workItemId, periodId, form);
                if (result.ok) {
                  toast.success('Checklist tersimpan.');
                  onOpenChange(false);
                  router.refresh();
                } else {
                  setError(result.hint === undefined ? { message: result.message } : result);
                }
              })
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Menyimpan…' : 'Simpan checklist'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
