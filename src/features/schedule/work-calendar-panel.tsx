'use client';

import { CalendarOff, Loader2, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { formatDay } from '@/lib/format';

import { addHolidayAction, deleteHolidayAction, setCountWeekendsAction } from './actions';

export type Holiday = { id: string; holidayDate: string; name: string };

/**
 * The project's working calendar.
 *
 * Changing it does not rewrite plans that already exist. Those were agreed
 * against the calendar in force when they were drawn — and one of them may
 * already be frozen into a baseline — so a public holiday recorded in March
 * must not silently move the line the project is judged against. The notice
 * below says so, and points at the redistribute action that does it on purpose.
 */
export function WorkCalendarPanel({
  projectId,
  countWeekends,
  holidays,
  canEdit,
}: {
  projectId: string;
  countWeekends: boolean;
  holidays: Holiday[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [date, setDate] = useState('');
  const [name, setName] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (fn: () => Promise<{ ok: boolean; message?: string; hint?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      setBusyId(null);
      if (result.ok) router.refresh();
      else toast.error(result.message ?? 'Gagal.', { description: result.hint });
    });
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">Kalender kerja</h2>
          <p className="text-xs text-muted-foreground">
            Menentukan hari mana yang dihitung sebagai durasi, dan bagaimana bobot rencana disebar
            ke tiap periode.
          </p>
        </div>

        <label className="flex items-center gap-3 rounded-md border px-3 py-2">
          <span className="text-sm">
            <span className="font-medium">Sabtu &amp; Minggu hari kerja</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {countWeekends
                ? 'Akhir pekan ikut dihitung sebagai durasi.'
                : 'Akhir pekan dikecualikan dari durasi dan distribusi.'}
            </span>
          </span>
          <Switch
            checked={countWeekends}
            disabled={!canEdit || pending}
            aria-label="Hitung akhir pekan sebagai hari kerja"
            onCheckedChange={(next) =>
              run(async () => {
                const result = await setCountWeekendsAction(projectId, next);
                if (result.ok) {
                  toast.success(
                    next ? 'Akhir pekan dihitung sebagai hari kerja.' : 'Akhir pekan dikecualikan.',
                  );
                }
                return result;
              })
            }
          />
        </label>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Hari libur proyek</h3>
          {holidays.length > 0 ? (
            <Badge variant="secondary" className="text-[10px]">
              {holidays.length} tanggal
            </Badge>
          ) : null}
        </div>

        {canEdit ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (date === '' || name.trim() === '') return;
              run(async () => {
                const result = await addHolidayAction(projectId, { holidayDate: date, name });
                if (result.ok) {
                  toast.success('Hari libur ditambahkan.');
                  setDate('');
                  setName('');
                }
                return result;
              });
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="holiday-date">Tanggal</Label>
              <Input
                id="holiday-date"
                type="date"
                className="w-44"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="holiday-name">Keterangan</Label>
              <Input
                id="holiday-name"
                className="w-64"
                placeholder="Contoh: Idul Fitri"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <Button type="submit" variant="outline" disabled={pending || date === '' || name.trim() === ''}>
              <Plus className="size-4" aria-hidden />
              Tambah
            </Button>
          </form>
        ) : null}

        {holidays.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-4 text-center text-sm text-muted-foreground">
            Belum ada hari libur khusus. Akhir pekan diatur terpisah lewat sakelar di atas.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {holidays.map((holiday) => (
              <li key={holiday.id} className="flex items-center gap-3 px-3 py-2">
                <CalendarOff className="size-4 text-muted-foreground" aria-hidden />
                <span className="font-mono text-xs">{formatDay(holiday.holidayDate)}</span>
                <span className="text-sm">{holiday.name}</span>
                {canEdit ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto text-destructive hover:text-destructive"
                    aria-label={`Hapus libur ${holiday.name}`}
                    disabled={pending && busyId === holiday.id}
                    onClick={() => {
                      setBusyId(holiday.id);
                      run(async () => {
                        const result = await deleteHolidayAction(projectId, holiday.id);
                        if (result.ok) toast.success('Hari libur dihapus.');
                        return result;
                      });
                    }}
                  >
                    {pending && busyId === holiday.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden />
                    )}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Perubahan kalender berlaku untuk perhitungan berikutnya. Distribusi yang sudah tersimpan —
        apalagi yang sudah dikunci sebagai baseline — tidak ditulis ulang secara diam-diam; sebar
        ulang pekerjaan yang bersangkutan bila ingin rencananya mengikuti kalender baru.
      </p>
    </section>
  );
}
