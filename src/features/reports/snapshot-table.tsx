'use client';

import { Trash2 } from 'lucide-react';
import Link from 'next/link';
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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { REPORT_TYPE_LABELS, type ReportType } from '@/lib/reports/labels';

import { deleteSnapshotsAction } from './actions';

export type SnapshotItem = {
  id: string;
  reportType: ReportType;
  periodLabel: string;
  generatedAt: string;
};

/**
 * Published reports, with the means to withdraw one.
 *
 * Deleting is offered only to roles that may do it, and the confirmation says
 * plainly what is being destroyed: a document that may already be in someone
 * else's hands. The copy in the audit log survives, which is what makes this
 * recoverable as a record even though the report itself is gone.
 */
export function SnapshotTable({
  projectId,
  snapshots,
  canDelete,
}: {
  projectId: string;
  snapshots: SnapshotItem[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();

  const allSelected = snapshots.length > 0 && snapshots.every((row) => selected.has(row.id));
  const someSelected = selected.size > 0 && !allSelected;

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const removeSelected = () => {
    const ids = [...selected];

    startTransition(async () => {
      const result = await deleteSnapshotsAction(projectId, ids);

      if (!result.ok) {
        toast.error(result.message, { description: result.hint });
        return;
      }

      if (result.refused.length === 0) {
        toast.success(`${result.deleted} laporan dihapus.`);
      } else {
        toast.warning(`${result.deleted} dihapus, ${result.refused.length} ditolak.`, {
          description: result.refused[0]?.reason,
        });
      }

      setSelected(new Set(result.refused.map((row) => row.id)));
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      {canDelete && selected.size > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
          <p className="text-sm">
            <strong>{selected.size}</strong> laporan dipilih
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Batalkan pilihan
            </Button>

            <AlertDialog>
              <AlertDialogTrigger
                render={<Button variant="destructive" size="sm" disabled={pending} />}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Hapus terpilih
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hapus {selected.size} laporan terbit?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Laporan terbit adalah dokumen yang mungkin sudah diserahkan ke pemberi kerja
                    beserta tagihannya. Menghapusnya di sini tidak menariknya kembali dari tangan
                    penerima. Isinya tetap tercatat pada jejak audit, tetapi halaman laporannya
                    hilang dan tautannya akan mati.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Batal</AlertDialogCancel>
                  <Button variant="destructive" disabled={pending} onClick={removeSelected}>
                    Ya, hapus
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              {canDelete ? (
                <TableHead className="w-10">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary align-middle"
                    aria-label="Pilih semua laporan"
                    checked={allSelected}
                    ref={(node) => {
                      if (node) node.indeterminate = someSelected;
                    }}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(snapshots.map((r) => r.id)))
                    }
                  />
                </TableHead>
              ) : null}
              <TableHead className="w-28">Jenis</TableHead>
              <TableHead>Periode</TableHead>
              <TableHead className="w-56">Diterbitkan</TableHead>
              <TableHead className="w-28" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {snapshots.map((snapshot) => (
              <TableRow
                key={snapshot.id}
                data-state={selected.has(snapshot.id) ? 'selected' : undefined}
              >
                {canDelete ? (
                  <TableCell>
                    <input
                      type="checkbox"
                      className="size-4 accent-primary align-middle"
                      aria-label={`Pilih laporan ${snapshot.periodLabel}`}
                      checked={selected.has(snapshot.id)}
                      onChange={() => toggle(snapshot.id)}
                    />
                  </TableCell>
                ) : null}
                <TableCell>
                  <Badge variant="secondary" className="text-[10px]">
                    {REPORT_TYPE_LABELS[snapshot.reportType]}
                  </Badge>
                </TableCell>
                <TableCell>{snapshot.periodLabel}</TableCell>
                <TableCell className="text-muted-foreground">
                  {formatDateTime(new Date(snapshot.generatedAt))}
                </TableCell>
                <TableCell>
                  <Link
                    href={`/projects/${projectId}/reports/${snapshot.id}`}
                    className="text-sm underline underline-offset-2 hover:text-foreground"
                  >
                    Buka
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
