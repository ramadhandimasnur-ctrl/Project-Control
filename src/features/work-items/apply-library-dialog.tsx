'use client';

import { Loader2, Search } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';

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
import { ESTIMATE_TYPE_LABELS } from '@/lib/validation/work-breakdown';
import { cn } from '@/lib/utils';

import { applyLibraryEntryAction, searchLibraryAction } from './actions';

type Entry = { id: string; code: string; name: string; unitCode: string; lineCount: number };

/**
 * Picks a published analysis and copies it onto this work item.
 *
 * Searching happens on the server on every keystroke pause rather than by
 * shipping the library to the browser: it is several thousand analyses, and
 * the catalogue matching that decides what will actually be written can only
 * be done where the catalogue is.
 */
export function ApplyLibraryDialog({
  open,
  onOpenChange,
  projectId,
  workItemId,
  workItemName,
  estimateType,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  workItemId: string;
  workItemName: string;
  estimateType: 'RAB' | 'RAP';
}) {
  const [term, setTerm] = useState('');
  const [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [chosen, setChosen] = useState<Entry | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, startTransition] = useTransition();

  /*
   * Debounced, and the result of a stale request is discarded. Without the
   * guard a slow early query can land after a fast later one and replace a
   * correct list with an out-of-date one.
   */
  useEffect(() => {
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchLibraryAction(term).then((result) => {
        if (!live) return;
        setSearching(false);
        if (result.ok) {
          setItems(result.items);
          setTotal(result.total);
        } else {
          toast.error(result.message);
        }
      });
    }, 250);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term]);

  const apply = () => {
    if (chosen === null) return;
    startTransition(async () => {
      const result = await applyLibraryEntryAction(projectId, workItemId, chosen.id, estimateType);

      if (!result.ok) {
        toast.error(result.message, { description: result.hint });
        return;
      }

      /*
       * The unmatched resources are the point of this message. Reporting only
       * the number written would let somebody walk away believing the analysis
       * is complete when a third of it silently did not arrive.
       */
      const parts = [`${result.created} baris ditambahkan`];
      if (result.skippedExisting > 0) parts.push(`${result.skippedExisting} sudah ada`);

      if (result.unmatched.length > 0) {
        toast.warning(parts.join(', '), {
          description:
            `${result.unmatched.length} sumber daya belum ada di katalog dan tidak ikut disalin: ` +
            result.unmatched
              .slice(0, 4)
              .map((u) => u.resourceName)
              .join(', ') +
            (result.unmatched.length > 4 ? ', …' : ''),
        });
      } else {
        toast.success(parts.join(', '));
      }

      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Ambil dari pustaka AHSP</DialogTitle>
          <DialogDescription>
            Menyalin koefisien terbitan resmi ke {ESTIMATE_TYPE_LABELS[estimateType]} pada{' '}
            {workItemName}. Harga tidak ikut — harga tetap dari katalog Anda sendiri.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              autoFocus
              aria-label="Cari analisa pustaka"
              className="pl-8"
              placeholder="Cari kode atau uraian, misalnya: pasangan bata"
              value={term}
              onChange={(event) => setTerm(event.target.value)}
            />
          </div>

          <div className="h-72 overflow-y-auto rounded-md border">
            {searching && items.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">Mencari…</p>
            ) : items.length === 0 ? (
              <p className="p-4 text-center text-sm text-muted-foreground">
                Tidak ada analisa yang cocok.
              </p>
            ) : (
              <ul className="divide-y">
                {items.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => setChosen(entry)}
                      className={cn(
                        'block w-full px-3 py-2 text-left text-sm transition-colors',
                        chosen?.id === entry.id
                          ? 'bg-accent text-accent-foreground'
                          : 'hover:bg-accent/60',
                      )}
                    >
                      <span className="font-mono text-xs text-muted-foreground">{entry.code}</span>
                      <span className="block">{entry.name}</span>
                      <span className="text-xs text-muted-foreground">
                        satuan {entry.unitCode} · {entry.lineCount} baris
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            {total} analisa cocok. Sumber daya yang belum ada di katalog akan dilaporkan dan tidak
            disalin.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
            Batal
          </Button>
          <Button onClick={apply} disabled={chosen === null || pending}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
            Terapkan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
