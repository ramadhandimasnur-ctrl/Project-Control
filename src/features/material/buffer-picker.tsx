'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * How much margin to keep before a supplier's lead time runs out.
 *
 * Held in the URL rather than in state so a plan can be sent to somebody with
 * the assumption it was made under still attached. Two people comparing order
 * dates without agreeing on the buffer are comparing different plans.
 */
export function BufferPicker({ bufferDays }: { bufferDays: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(String(bufferDays));

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const next = new URLSearchParams(params.toString());
        next.set('buffer', value);
        router.push(`${pathname}?${next.toString()}`);
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="buffer">Margin pengaman (hari)</Label>
        <Input
          id="buffer"
          inputMode="numeric"
          className="w-32"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
      </div>
      <Button type="submit" variant="outline" size="sm">
        Perbarui rencana
      </Button>
      <p className="text-xs text-muted-foreground">
        Ditambahkan di atas lead time pemasok. Pesanan yang jatuh tepat pada hari terakhir tidak
        menyisakan ruang untuk pemasok yang menjawab terlambat.
      </p>
    </form>
  );
}
