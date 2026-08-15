'use client';

import { Lock, Loader2 } from 'lucide-react';
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
import { formatDateTime } from '@/lib/format';

import { activateBaselineAction, createBaselineAction } from './actions';

/**
 * Freezing the plan.
 *
 * The button is disabled while any weighted work item is not distributed to
 * exactly 100%, and says which ones — the service refuses anyway, and finding
 * that out after clicking teaches nothing about what to fix.
 */
export function BaselineButton({
  projectId,
  canManage,
  incompleteCodes,
  hasPeriods,
}: {
  projectId: string;
  canManage: boolean;
  incompleteCodes: string[];
  hasPeriods: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!canManage) return null;

  const blocked = !hasPeriods || incompleteCodes.length > 0;

  return (
    <>
      <Button
        onClick={() => setOpen(true)}
        disabled={blocked}
        title={
          !hasPeriods
            ? 'Bangun periode terlebih dahulu.'
            : incompleteCodes.length > 0
              ? `${incompleteCodes.length} pekerjaan belum tersebar 100%.`
              : 'Bekukan rencana sebagai baseline.'
        }
      >
        <Lock className="size-4" aria-hidden />
        Kunci baseline
      </Button>
      {open ? <BaselineDialog open onOpenChange={setOpen} projectId={projectId} /> : null}
    </>
  );
}

function BaselineDialog({
  open,
  onOpenChange,
  projectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(`Baseline ${new Date().toLocaleDateString('id-ID')}`);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Kunci baseline</DialogTitle>
          <DialogDescription>
            Menyalin rencana saat ini menjadi acuan tetap. Kurva-S rencana dibaca dari salinan itu,
            sehingga mengubah rencana setelah ini tidak menggeser garis acuannya.
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
            <Label htmlFor="baseline-name">Nama baseline</Label>
            <Input
              id="baseline-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Baseline kontrak awal"
            />
            <p className="text-xs text-muted-foreground">
              Beri nama yang menjelaskan dasarnya, misalnya &quot;Kontrak awal&quot; atau
              &quot;Adendum 1&quot;.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          <Button
            disabled={pending || name.trim() === ''}
            onClick={() =>
              startTransition(async () => {
                const result = await createBaselineAction(projectId, { name });
                if (result.ok) {
                  toast.success('Baseline terkunci.');
                  onOpenChange(false);
                  router.refresh();
                } else {
                  setError(result.hint === undefined ? { message: result.message } : result);
                }
              })
            }
          >
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            {pending ? 'Mengunci…' : 'Kunci baseline'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function BaselineList({
  projectId,
  baselines,
  canManage,
}: {
  projectId: string;
  baselines: { id: string; name: string; baselinedAt: string; isActive: boolean; cellCount: number }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (baselines.length === 0) return null;

  return (
    <ul className="divide-y rounded-lg border">
      {baselines.map((baseline) => (
        <li key={baseline.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium">{baseline.name}</p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(new Date(baseline.baselinedAt))} · {baseline.cellCount} sel
            </p>
          </div>
          {baseline.isActive ? (
            <span className="shrink-0 text-xs font-medium text-primary">aktif</span>
          ) : canManage ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await activateBaselineAction(projectId, baseline.id);
                  if (result.ok) {
                    toast.success(`Baseline "${baseline.name}" diaktifkan.`);
                    router.refresh();
                  } else {
                    toast.error(result.message, { description: result.hint });
                  }
                })
              }
            >
              Aktifkan
            </Button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
