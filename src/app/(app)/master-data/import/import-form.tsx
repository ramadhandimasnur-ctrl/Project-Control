'use client';

import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { selectClassName } from '@/features/master-data/form-fields';
import {
  importUtbaFromUploadAction,
  type ImportActionResult,
} from '@/features/master-data/import-actions';
import type { ImportReport } from '@/services/import-utba';

export function ImportForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();

  const [file, setFile] = useState<File | null>(null);
  const [priceType, setPriceType] = useState('RAP');
  const [effectiveFrom, setEffectiveFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);

  const submit = (apply: boolean) => {
    if (!file) {
      setError({ message: 'Pilih berkas Excel terlebih dahulu.' });
      return;
    }

    const data = new FormData();
    data.set('file', file);
    data.set('apply', String(apply));
    data.set('priceType', priceType);
    data.set('effectiveFrom', effectiveFrom);

    startTransition(async () => {
      setError(null);
      const result: ImportActionResult = await importUtbaFromUploadAction(data);

      if (!result.ok) {
        setReport(null);
        setError(result.hint === undefined ? { message: result.message } : result);
        return;
      }

      setReport(result.report);
      if (apply) {
        toast.success('Impor selesai.');
        router.refresh();
      }
    });
  };

  const errors = report?.issues.filter((i) => i.severity === 'ERROR') ?? [];
  const warnings = report?.issues.filter((i) => i.severity === 'WARNING') ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Berkas dan pilihan</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="file">Berkas Excel (.xlsx)</Label>
            <Input
              id="file"
              ref={fileRef}
              type="file"
              accept=".xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReport(null);
                setError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Yang dibaca hanya sheet bernama <span className="font-mono">UTBA</span>. Sheet lain
              diabaikan.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="priceType">Kolom harga tujuan</Label>
              <select
                id="priceType"
                className={selectClassName}
                value={priceType}
                onChange={(e) => setPriceType(e.target.value)}
              >
                <option value="RAP">RAP saja</option>
                <option value="RAB">RAB saja</option>
                <option value="BOTH">RAB dan RAP</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Workbook &ldquo;ANALISA RAP&rdquo; memuat harga pelaksanaan, jadi RAP adalah
                pilihan yang tepat untuknya.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="effectiveFrom">Harga berlaku sejak</Label>
              <Input
                id="effectiveFrom"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Harga lama tidak ditimpa. Estimasi bertanggal sebelum ini tetap memakai harga
                sebelumnya.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending || !file} onClick={() => submit(false)}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FileSpreadsheet className="size-4" aria-hidden />}
              Uji coba
            </Button>
            <Button disabled={pending || !file || report === null} onClick={() => submit(true)}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Upload className="size-4" aria-hidden />}
              Impor sekarang
            </Button>
          </div>

          {report === null ? (
            <p className="text-xs text-muted-foreground">
              Jalankan uji coba lebih dulu. Uji coba melakukan impor sungguhan lalu membatalkannya,
              sehingga angka yang ditampilkan adalah yang benar-benar akan terjadi.
            </p>
          ) : null}
        </CardContent>
      </Card>

      {error ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" aria-hidden />
          <AlertTitle>{error.message}</AlertTitle>
          {error.hint ? <AlertDescription>{error.hint}</AlertDescription> : null}
        </Alert>
      ) : null}

      {report ? (
        <Card>
          <CardHeader>
            <CardTitle>
              {report.dryRun ? 'Hasil uji coba — belum ada yang disimpan' : 'Impor diterapkan'}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!report.dryRun ? (
              <Alert>
                <CheckCircle2 className="size-4" aria-hidden />
                <AlertTitle>Tersimpan</AlertTitle>
                <AlertDescription>
                  Katalog sudah diperbarui. Mengimpor berkas yang sama lagi tidak akan
                  menggandakan apa pun.
                </AlertDescription>
              </Alert>
            ) : null}

            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Satuan" created={report.units.created} extra={`${report.units.existing} sudah ada`} />
              <Stat
                label="Kategori"
                created={report.categories.created}
                extra={`${report.categories.existing} sudah ada`}
              />
              <Stat
                label="Sumber daya"
                created={report.resources.created}
                extra={`${report.resources.updated} diperbarui, ${report.resources.unchanged} tetap`}
              />
              <Stat
                label="Harga"
                created={report.prices.created}
                extra={`${report.prices.superseded} diganti, ${report.prices.unchanged} tetap`}
              />
            </dl>

            {errors.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium text-destructive">
                  {errors.length} baris ditolak
                </p>
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-3 text-sm">
                  {errors.slice(0, 50).map((issue, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs text-muted-foreground">
                        baris {issue.rowNumber}
                      </span>{' '}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {warnings.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium">{warnings.length} peringatan</p>
                <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-3 text-sm text-muted-foreground">
                  {warnings.slice(0, 50).map((issue, i) => (
                    <li key={i}>
                      <span className="font-mono text-xs">baris {issue.rowNumber}</span>{' '}
                      {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Stat({ label, created, extra }: { label: string; created: number; extra: string }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-2xl font-semibold tabular-nums">{created.toLocaleString('id-ID')}</dd>
      <dd className="text-xs text-muted-foreground">dibuat · {extra}</dd>
    </div>
  );
}
