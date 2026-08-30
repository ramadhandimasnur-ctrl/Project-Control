'use client';

import { Search } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { AHSP_ROLE_LABELS } from '@/lib/validation/work-breakdown';
import { formatCoefficient } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { LibraryEntryDetail, LibraryEntryRow } from '@/services/ahsp-library';

/**
 * Browsing a published library of a few thousand analyses.
 *
 * Paged and searched through the URL rather than through state, so a colleague
 * can be sent the analysis you are looking at. The panel on the right reports
 * how many of the entry's resources exist in this organisation's catalogue —
 * the number that decides whether applying it produces a complete unit rate or
 * a half-built one.
 */
export function LibraryBrowser({
  items,
  total,
  pageSize,
  pageNumber,
  search,
  selected,
}: {
  items: LibraryEntryRow[];
  total: number;
  pageSize: number;
  pageNumber: number;
  search: string;
  selected: LibraryEntryDetail | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [term, setTerm] = useState(search);

  const lastPage = Math.max(Math.ceil(total / pageSize), 1);

  const withParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value === null || value === '') next.delete(key);
      else next.set(key, value);
    }
    return `${pathname}?${next.toString()}`;
  };

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          // A new search starts at page one; keeping the old page number would
          // land on an empty page whenever the result set shrinks.
          router.push(withParams({ q: term, page: null, entry: null }));
        }}
      >
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            aria-label="Cari analisa"
            className="w-72 pl-8"
            placeholder="Cari kode atau uraian…"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
          />
        </div>
        <Button type="submit" size="sm" variant="outline">
          Cari
        </Button>
        <span className="text-sm text-muted-foreground">{total} analisa</span>
      </form>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="w-full rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">Kode</TableHead>
                <TableHead>Uraian</TableHead>
                <TableHead className="w-16">Sat</TableHead>
                <TableHead className="w-20 text-right">Baris</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    Tidak ada yang cocok dengan pencarian itu.
                  </TableCell>
                </TableRow>
              ) : (
                items.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn(
                      'cursor-pointer',
                      selected?.id === row.id && 'bg-accent text-accent-foreground',
                    )}
                    onClick={() => router.push(withParams({ entry: row.id }), { scroll: false })}
                  >
                    <TableCell className="font-mono text-xs">{row.code}</TableCell>
                    <TableCell>{row.name}</TableCell>
                    <TableCell className="text-muted-foreground">{row.unitCode}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.lineCount}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="space-y-3">
          {selected === null ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              Pilih satu analisa untuk melihat rinciannya.
            </p>
          ) : (
            <div className="space-y-3 rounded-lg border p-4">
              <div>
                <p className="font-mono text-xs text-muted-foreground">{selected.code}</p>
                <h2 className="font-semibold">{selected.name}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Satuan {selected.unitCode}
                  {selected.sourceName === null ? null : ` · ${selected.sourceName}`}
                  {selected.sourceYear === null ? null : ` ${selected.sourceYear}`}
                  {selected.sourceDocument === null ? null : ` · ${selected.sourceDocument}`}
                </p>
              </div>

              {/*
                Said plainly, because it decides whether this analysis is usable
                at all. A count is more honest than a tick: "18 dari 24" tells
                you there is work to do before applying it.
              */}
              <p className="text-sm">
                <Badge variant={selected.matchedCount === selected.lines.length ? 'secondary' : 'outline'}>
                  {selected.matchedCount} dari {selected.lines.length} sumber daya cocok dengan
                  katalog Anda
                </Badge>
              </p>

              <div className="w-full rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Uraian</TableHead>
                      <TableHead className="w-16">Sat</TableHead>
                      <TableHead className="w-24 text-right">Koef</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {selected.lines.map((line) => (
                      <TableRow key={line.id}>
                        <TableCell>
                          <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">
                            {AHSP_ROLE_LABELS[line.role]}
                          </span>
                          {line.resourceName}
                          {line.matchedResourceId === null ? (
                            <span className="ml-2 text-xs text-destructive">belum ada di katalog</span>
                          ) : (
                            <span className="ml-2 font-mono text-xs text-muted-foreground">
                              {line.matchedResourceCode}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{line.unitCode}</TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatCoefficient(line.coef)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <p className="text-xs text-muted-foreground">
                Terapkan analisa ini dari panel AHSP sebuah pekerjaan, lewat tombol Pustaka AHSP.
              </p>
            </div>
          )}
        </div>
      </div>

      {lastPage > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Halaman {pageNumber} dari {lastPage}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pageNumber <= 1}
              render={
                pageNumber <= 1 ? undefined : (
                  <Link href={withParams({ page: String(pageNumber - 1) })} />
                )
              }
            >
              Sebelumnya
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pageNumber >= lastPage}
              render={
                pageNumber >= lastPage ? undefined : (
                  <Link href={withParams({ page: String(pageNumber + 1) })} />
                )
              }
            >
              Berikutnya
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
