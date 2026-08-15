'use client';

import { AlertTriangle, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
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
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { selectClassName } from '@/features/master-data/form-fields';
import { formatCoefficient } from '@/lib/format';
import { AHSP_ROLE_LABELS } from '@/lib/validation/work-breakdown';
import { LayoutTemplate } from 'lucide-react';

import { applyTemplateAction, previewTemplateAction, type TemplatePreviewLine } from './actions';

type TemplateOption = { id: string; code: string; name: string; unitCode: string; lineCount: number };

export function ApplyTemplateDialog({
  open,
  onOpenChange,
  projectId,
  workItemId,
  workItemName,
  unitCode,
  existingLineCount,
  templates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workItemId: string;
  workItemName: string;
  unitCode: string;
  existingLineCount: number;
  templates: TemplateOption[];
}) {
  const router = useRouter();
  const [templateId, setTemplateId] = useState('');
  const [mode, setMode] = useState<'APPEND' | 'REPLACE'>(
    existingLineCount === 0 ? 'APPEND' : 'APPEND',
  );
  const [preview, setPreview] = useState<TemplatePreviewLine[] | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);
  const [loadingPreview, startPreview] = useTransition();
  const [applying, startApply] = useTransition();

  const selected = templates.find((t) => t.id === templateId);

  const choose = (id: string) => {
    setTemplateId(id);
    setPreview(null);
    setError(null);
    if (id === '') return;

    startPreview(async () => {
      const result = await previewTemplateAction(id);
      if (result.ok) setPreview(result.lines);
      else setError(result.hint === undefined ? { message: result.message } : result);
    });
  };

  const apply = () => {
    startApply(async () => {
      const result = await applyTemplateAction(projectId, workItemId, { templateId, mode });

      if (!result.ok) {
        setError(result.hint === undefined ? { message: result.message } : result);
        return;
      }

      const parts = [`${result.added} baris ditambahkan`];
      if (result.skipped > 0) parts.push(`${result.skipped} dilewati karena sudah ada`);
      if (result.removed > 0) parts.push(`${result.removed} baris lama diganti`);

      toast.success('Template diterapkan.', { description: parts.join(', ') + '.' });
      onOpenChange(false);
      router.refresh();
    });
  };

  const unitMismatch = selected !== undefined && selected.unitCode !== unitCode;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Terapkan template</DialogTitle>
          <DialogDescription>
            Menyalin baris analisa dari pustaka ke &ldquo;{workItemName}&rdquo;. Koefisiennya
            disalin apa adanya; harga tetap diambil dari master data.
          </DialogDescription>
        </DialogHeader>

        {templates.length === 0 ? (
          <EmptyState
            icon={LayoutTemplate}
            title="Belum ada template"
            description="Simpan analisa sebuah pekerjaan sebagai template terlebih dahulu, lalu template itu dapat dipakai di sini."
          />
        ) : (
          <div className="space-y-4">
            {error ? (
              <Alert variant="destructive">
                <AlertTitle>{error.message}</AlertTitle>
                {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
              </Alert>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="templateId">Template</Label>
              <select
                id="templateId"
                className={selectClassName}
                value={templateId}
                onChange={(e) => choose(e.target.value)}
              >
                <option value="">Pilih template</option>
                {templates.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} — {t.name} (per {t.unitCode}, {t.lineCount} baris)
                  </option>
                ))}
              </select>
            </div>

            {/* Coefficients are per unit of work, so a template built per m3
                means something different on an item measured in m2. */}
            {unitMismatch ? (
              <Alert variant="destructive">
                <AlertTriangle className="size-4" aria-hidden />
                <AlertTitle>Satuan berbeda</AlertTitle>
                <AlertDescription>
                  Template ini disusun per <strong>{selected?.unitCode}</strong>, sedangkan
                  pekerjaan ini bersatuan <strong>{unitCode}</strong>. Koefisiennya kemungkinan
                  besar tidak berlaku. Periksa kembali sebelum menerapkan.
                </AlertDescription>
              </Alert>
            ) : null}

            {existingLineCount > 0 ? (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Cara penerapan</legend>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-accent/40">
                  <input
                    type="radio"
                    name="mode"
                    value="APPEND"
                    checked={mode === 'APPEND'}
                    onChange={() => setMode('APPEND')}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    <span className="font-medium">Tambahkan</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {existingLineCount} baris yang ada dipertahankan. Sumber daya yang sudah ada
                      pada bagian yang sama dilewati.
                    </span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm has-[:checked]:border-destructive has-[:checked]:bg-destructive/5">
                  <input
                    type="radio"
                    name="mode"
                    value="REPLACE"
                    checked={mode === 'REPLACE'}
                    onChange={() => setMode('REPLACE')}
                    className="mt-0.5 size-4 accent-primary"
                  />
                  <span>
                    <span className="font-medium">Ganti seluruhnya</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {existingLineCount} baris analisa yang ada dihapus lebih dahulu.
                    </span>
                  </span>
                </label>
              </fieldset>
            ) : null}

            {loadingPreview ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Memuat isi template…
              </p>
            ) : null}

            {preview !== null && preview.length > 0 ? (
              <div className="max-h-64 overflow-y-auto rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-20">Kode</TableHead>
                      <TableHead>Uraian</TableHead>
                      <TableHead className="w-16">Sat</TableHead>
                      <TableHead className="w-28">Bagian</TableHead>
                      <TableHead className="w-24 text-right">Koef RAP</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.map((line, i) => (
                      <TableRow key={`${line.resourceCode}-${line.role}-${i}`}>
                        <TableCell className="font-mono text-xs">{line.resourceCode}</TableCell>
                        <TableCell>{line.resourceName}</TableCell>
                        <TableCell className="text-muted-foreground">{line.unitCode}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {AHSP_ROLE_LABELS[line.role as keyof typeof AHSP_ROLE_LABELS] ?? line.role}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCoefficient(line.coefRap)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Batal
          </Button>
          {templates.length > 0 ? (
            <Button
              disabled={applying || templateId === '' || preview === null}
              variant={mode === 'REPLACE' ? 'destructive' : 'default'}
              onClick={apply}
            >
              {applying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              {mode === 'REPLACE' ? 'Ganti analisa' : 'Terapkan'}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
