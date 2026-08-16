'use client';

import { Check, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TableCell } from '@/components/ui/table';
import { applyPriceEdit, type PriceMode } from '@/lib/calc/markup';

import { quickSetPriceAction } from './actions';

/**
 * RAP, RAB and markup, edited straight in the catalogue row.
 *
 * The three move together exactly as they do in the dialog — typing a markup
 * fills the budget, typing a budget reports the markup back, and the execution
 * cost is never rewritten by either. What is different here is the ceremony:
 * no dialog, no effective date, no save-and-close. A price typed in a list
 * means "this is what it costs now", and it is written against today.
 *
 * Saving is explicit rather than on blur. A catalogue of several hundred rows
 * is scrolled and tabbed through constantly, and a stray focus change that
 * silently rewrote a price would be discovered weeks later in an estimate.
 */
export function PriceCells({
  resourceId,
  resourceName,
  initialRap,
  initialRab,
  initialMarkup,
  canEdit,
}: {
  resourceId: string;
  resourceName: string;
  initialRap: string | null;
  initialRab: string | null;
  /** Stored fraction, already converted to a percentage string. */
  initialMarkup: string | null;
  canEdit: boolean;
}) {
  const router = useRouter();

  const [values, setValues] = useState({
    rap: initialRap ?? '',
    rab: initialRab ?? '',
    markup: initialMarkup ?? '',
  });
  const mode = useRef<PriceMode>(initialMarkup ? 'markup' : 'rab');
  const [pending, startTransition] = useTransition();

  const saved = useRef({
    rap: initialRap ?? '',
    rab: initialRab ?? '',
    markup: initialMarkup ?? '',
  });

  const dirty =
    values.rap !== saved.current.rap ||
    values.rab !== saved.current.rab ||
    values.markup !== saved.current.markup;

  const edit = (field: 'rap' | 'rab' | 'markup', value: string) => {
    const result = applyPriceEdit(values, field, value, mode.current);
    mode.current = result.mode;
    setValues(result.next);
  };

  const save = () => {
    if (values.rap.trim() === '' && values.rab.trim() === '') {
      toast.error('Isi setidaknya salah satu harga.');
      return;
    }

    startTransition(async () => {
      const result = await quickSetPriceAction(resourceId, {
        priceRap: values.rap,
        priceRab: values.rab,
        markupPercent: values.markup,
      });

      if (result.ok) {
        saved.current = { ...values };
        toast.success(`Harga "${resourceName}" tersimpan, berlaku hari ini.`);
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (dirty) save();
    }
  };

  if (!canEdit) {
    return (
      <>
        <TableCell className="text-right font-mono tabular-nums">{initialRab ?? '—'}</TableCell>
        <TableCell className="text-right font-mono tabular-nums">{initialRap ?? '—'}</TableCell>
        <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
          {initialMarkup === null ? '—' : `${initialMarkup}%`}
        </TableCell>
        <TableCell />
      </>
    );
  }

  return (
    <>
      <TableCell>
        <Input
          aria-label={`Harga RAB ${resourceName}`}
          inputMode="decimal"
          className="h-8 w-32 text-right font-mono tabular-nums"
          value={values.rab}
          disabled={pending}
          onChange={(event) => edit('rab', event.target.value)}
          onKeyDown={onKeyDown}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label={`Harga RAP ${resourceName}`}
          inputMode="decimal"
          className="h-8 w-32 text-right font-mono tabular-nums"
          value={values.rap}
          disabled={pending}
          onChange={(event) => edit('rap', event.target.value)}
          onKeyDown={onKeyDown}
        />
      </TableCell>
      <TableCell>
        <Input
          aria-label={`Markup ${resourceName}`}
          inputMode="decimal"
          className="h-8 w-20 text-right font-mono tabular-nums"
          value={values.markup}
          disabled={pending}
          placeholder="%"
          onChange={(event) => edit('markup', event.target.value)}
          onKeyDown={onKeyDown}
        />
      </TableCell>
      <TableCell>
        {/*
          Shown only once something changed, so a row nobody touched carries no
          button inviting an accidental write.
        */}
        {dirty ? (
          <Button size="sm" disabled={pending} onClick={save} aria-label={`Simpan harga ${resourceName}`}>
            {pending ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Check className="size-3.5" aria-hidden />
            )}
            Simpan
          </Button>
        ) : null}
      </TableCell>
    </>
  );
}
