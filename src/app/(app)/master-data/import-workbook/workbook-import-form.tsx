'use client';

import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  importWorkbookFromUploadAction,
  type WorkbookImportActionResult,
} from '@/features/master-data/workbook-import-actions';
import type { WorkbookImportReport } from '@/services/import-workbook';

const number = (value: number): string => value.toLocaleString('id-ID');

/**
 * Uploads a PROJECT_CONTROL workbook and shows what the import did.
 *
 * Two steps, and the first is not a preview: the dry run performs the whole
 * import inside a transaction and rolls it back, so what it reports is what
 * happened rather than what was predicted. That distinction is the reason the
 * apply button stays disabled until a dry run has been seen.
 */
export function WorkbookImportForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState('PROJECT_CONTROL');
  const [report, setReport] = useState<WorkbookImportReport | null>(null);
  const [error, setError] = useState<{ message: string; hint?: string } | null>(null);

  const submit = (apply: boolean) => {
    if (!file) {
      setError({ message: 'Pilih berkas workbook terlebih dahulu.' });
      return;
    }

    const data = new FormData();
    data.set('file', file);
    data.set('apply', String(apply));
    data.set('source', source);

    startTransition(async () => {
      setError(null);
      const result: WorkbookImportActionResult = await importWorkbookFromUploadAction(data);

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

  const issues = report?.steps.flatMap((step) => step.issues.map((i) => `${step.label}: ${i}`)) ?? [];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Berkas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="wb-file">Workbook PROJECT_CONTROL (.xlsm)</Label>
            <Input
              id="wb-file"
              type="file"
              accept=".xlsm,.xlsx"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                setReport(null);
                setError(null);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Yang dibaca hanya lembar <span className="font-mono">_DB_*</span>. Lembar tampilan,
              rumus, dan makro diabaikan.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="wb-source">Nama sumber</Label>
            <Input
              id="wb-source"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              className="max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              Penanda asal data. Dua workbook berbeda dengan nama sumber berbeda tidak akan saling
              menimpa, meski kode barisnya kebetulan sama.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={pending || !file} onClick={() => submit(false)}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <FileSpreadsheet className="size-4" aria-hidden />
              )}
              Uji coba
            </Button>
            <Button disabled={pending || !file || report === null} onClick={() => submit(true)}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Upload className="size-4" aria-hidden />
              )}
              Impor sekarang
            </Button>
          </div>

          {report === null ? (
            <p className="text-xs text-muted-foreground">
              Jalankan uji coba lebih dulu. Uji coba melakukan impor sungguhan lalu membatalkannya,
              sehingga angka yang ditampilkan adalah yang benar-benar akan terjadi. Workbook besar
              membutuhkan waktu setengah menit atau lebih — biarkan halaman ini terbuka.
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
            {report.dryRun ? null : (
              <Alert>
                <CheckCircle2 className="size-4" aria-hidden />
                <AlertTitle>Tersimpan</AlertTitle>
                <AlertDescription>
                  Mengimpor workbook yang sama sekali lagi tidak menggandakan apa pun: setiap baris
                  sudah dicatat asalnya, jadi impor berikutnya memperbarui baris yang sama.
                </AlertDescription>
              </Alert>
            )}

            <div className="w-full overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-44">Tabel</TableHead>
                    <TableHead className="w-24 text-right">Dibaca</TableHead>
                    <TableHead className="w-24 text-right">Baru</TableHead>
                    <TableHead className="w-28 text-right">Diperbarui</TableHead>
                    <TableHead className="w-24 text-right">Dilewati</TableHead>
                    <TableHead className="w-24 text-right">Dihapus</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.steps.map((step) => (
                    <TableRow key={step.sheet}>
                      <TableCell>
                        <div>{step.label}</div>
                        <div className="font-mono text-xs text-muted-foreground">{step.sheet}</div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{number(step.read)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {number(step.created)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {number(step.updated)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {number(step.skipped)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {number(step.deleted)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="font-medium">
                    <TableCell>Jumlah</TableCell>
                    <TableCell />
                    <TableCell className="text-right tabular-nums">
                      {number(report.totals.created)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number(report.totals.updated)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number(report.totals.skipped)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>

            <p className="text-xs text-muted-foreground">
              &ldquo;Dihapus&rdquo; adalah baris yang workbook sendiri sudah tandai terhapus, jadi
              tidak dibaca. Untuk setiap baris lain berlaku: dibaca = baru + diperbarui + dilewati.
            </p>

            {issues.length > 0 ? (
              <div>
                <p className="mb-2 text-sm font-medium">{issues.length} catatan</p>
                <ul className="max-h-64 space-y-2 overflow-y-auto rounded-md border p-3 text-sm text-muted-foreground">
                  {issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
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
