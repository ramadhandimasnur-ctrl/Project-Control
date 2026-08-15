'use client';

import { Printer } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { selectClassName } from '@/features/master-data/form-fields';
import {
  DEFAULT_PAPER,
  MARGINS,
  ORIENTATION_LABELS,
  PAPERS,
  contentWidthMm,
  pageRule,
  parsePaperSetting,
  type MarginId,
  type Orientation,
  type PaperId,
  type PaperSetting,
} from '@/lib/print/paper';
import { cn } from '@/lib/utils';

/**
 * Chooses the sheet the report is printed on.
 *
 * `@page` cannot be set from a style attribute, so the rule is written into a
 * `<style>` element in the head. Appending it there also settles the cascade:
 * it lands after the stylesheet link, so it wins over the default rule without
 * needing `!important`.
 *
 * The choice is remembered per browser. A site office prints on one size for
 * months, and asking again every visit would be a small daily insult.
 */

const STORAGE_KEY = 'project-control:paper';

export function PaperSettings({ previewSelector }: { previewSelector?: string }) {
  const [setting, setSetting] = useState<PaperSetting>(DEFAULT_PAPER);
  const [ready, setReady] = useState(false);

  // Read once on mount rather than during render: localStorage does not exist
  // on the server, and reading it while rendering would mismatch hydration.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setSetting(parsePaperSetting(JSON.parse(raw) as unknown));
    } catch {
      // A corrupt or blocked store is not worth failing a page over.
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;

    const style = document.createElement('style');
    style.dataset.paperRule = 'true';
    style.textContent = pageRule(setting);
    document.head.appendChild(style);

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(setting));
    } catch {
      // Ignored: the setting still applies for this visit.
    }

    return () => style.remove();
  }, [setting, ready]);

  /*
   * The preview is sized to the printable width so what is arranged on screen
   * is what comes out. Applied to a target element rather than wrapping it, to
   * keep this control usable from any report page.
   */
  useEffect(() => {
    if (!ready || !previewSelector) return;
    const target = document.querySelector<HTMLElement>(previewSelector);
    if (!target) return;

    const previous = target.style.maxWidth;
    target.style.maxWidth = `${contentWidthMm(setting)}mm`;
    return () => {
      target.style.maxWidth = previous;
    };
  }, [setting, ready, previewSelector]);

  return (
    <div data-print="hide" className="flex flex-wrap items-end gap-3">
      <Field label="Ukuran kertas" htmlFor="paper-size">
        <select
          id="paper-size"
          className={cn(selectClassName, 'w-56')}
          value={setting.paper}
          onChange={(e) => setSetting({ ...setting, paper: e.target.value as PaperId })}
        >
          {PAPERS.map((paper) => (
            <option key={paper.id} value={paper.id}>
              {paper.label}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Orientasi" htmlFor="paper-orientation">
        <select
          id="paper-orientation"
          className={cn(selectClassName, 'w-32')}
          value={setting.orientation}
          onChange={(e) =>
            setSetting({ ...setting, orientation: e.target.value as Orientation })
          }
        >
          {(Object.keys(ORIENTATION_LABELS) as Orientation[]).map((value) => (
            <option key={value} value={value}>
              {ORIENTATION_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Margin" htmlFor="paper-margin">
        <select
          id="paper-margin"
          className={cn(selectClassName, 'w-40')}
          value={setting.margin}
          onChange={(e) => setSetting({ ...setting, margin: e.target.value as MarginId })}
        >
          {(Object.keys(MARGINS) as MarginId[]).map((value) => (
            <option key={value} value={value}>
              {MARGINS[value].label}
            </option>
          ))}
        </select>
      </Field>

      <Button variant="outline" onClick={() => window.print()}>
        <Printer className="size-4" aria-hidden />
        Cetak / Simpan PDF
      </Button>

      <p className="w-full text-xs text-muted-foreground">
        Lebar area cetak {contentWidthMm(setting)} mm. Pada dialog cetak peramban, pastikan skala
        100% dan pilihan kertasnya sama agar hasilnya persis seperti pratinjau.
      </p>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}
