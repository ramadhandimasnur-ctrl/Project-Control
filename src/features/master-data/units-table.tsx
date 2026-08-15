'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import {
  AlertDialog,
  AlertDialogAction,
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
import { Decimal } from '@/lib/calc/decimal';
import { EMPTY_VALUE, formatCoefficient } from '@/lib/format';
import { type UnitFormInput } from '@/lib/validation/master-data';

import { deleteUnitAction } from './actions';
import { DIMENSION_OPTIONS, UnitDialog } from './unit-dialog';

export type UnitRowView = {
  id: string;
  code: string;
  name: string;
  dimension: string;
  baseUnitId: string | null;
  factorToBase: string;
  usageCount: number;
};

const dimensionLabel = (value: string) =>
  DIMENSION_OPTIONS.find((d) => d.value === value)?.label ?? value;

export function UnitsTable({ units, canManage }: { units: UnitRowView[]; canManage: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState<UnitRowView | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();

  const byId = new Map(units.map((u) => [u.id, u]));

  const toFormValues = (unit: UnitRowView): UnitFormInput => ({
    code: unit.code,
    name: unit.name,
    dimension: unit.dimension as UnitFormInput['dimension'],
    baseUnitId: unit.baseUnitId ?? '',
    factorToBase: new Decimal(unit.factorToBase).toString(),
  });

  return (
    <div className="space-y-4">
      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            Tambah satuan
          </Button>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Kode</TableHead>
              <TableHead>Nama</TableHead>
              <TableHead className="w-32">Dimensi</TableHead>
              <TableHead className="w-32">Satuan dasar</TableHead>
              <TableHead className="w-28 text-right">Faktor</TableHead>
              <TableHead className="w-24 text-right">Dipakai</TableHead>
              {canManage ? <TableHead className="w-24" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {units.map((unit) => (
              <TableRow key={unit.id}>
                <TableCell className="font-mono text-xs">{unit.code}</TableCell>
                <TableCell className="font-medium">{unit.name}</TableCell>
                <TableCell>
                  <Badge variant="secondary" className="text-[10px]">
                    {dimensionLabel(unit.dimension)}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {unit.baseUnitId === null
                    ? EMPTY_VALUE
                    : (byId.get(unit.baseUnitId)?.code ?? EMPTY_VALUE)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {formatCoefficient(unit.factorToBase)}
                </TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {unit.usageCount.toLocaleString('id-ID')}
                </TableCell>
                {canManage ? (
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Ubah satuan ${unit.code}`}
                        onClick={() => setEditing(unit)}
                      >
                        <Pencil className="size-4" aria-hidden />
                      </Button>

                      <AlertDialog>
                        <AlertDialogTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Hapus satuan ${unit.code}`}
                              disabled={pending}
                            />
                          }
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Hapus satuan &ldquo;{unit.code}&rdquo;?</AlertDialogTitle>
                            <AlertDialogDescription>
                              {unit.usageCount > 0
                                ? `Satuan ini dipakai oleh ${unit.usageCount} sumber daya, sehingga penghapusan akan ditolak. Ubah satuan sumber daya tersebut terlebih dahulu.`
                                : 'Belum dipakai sumber daya mana pun, jadi aman dihapus.'}
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Batal</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() =>
                                startTransition(async () => {
                                  const result = await deleteUnitAction(unit.id);
                                  if (result.ok) {
                                    toast.success('Satuan dihapus.');
                                    router.refresh();
                                  } else {
                                    toast.error(result.message, { description: result.hint });
                                  }
                                })
                              }
                            >
                              Ya, hapus
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                ) : null}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {creating ? (
        <UnitDialog open onOpenChange={setCreating} unitId={null} units={units} />
      ) : null}

      {editing ? (
        <UnitDialog
          open
          onOpenChange={(open) => !open && setEditing(null)}
          unitId={editing.id}
          defaultValues={toFormValues(editing)}
          units={units}
          dimensionLocked={editing.usageCount > 0}
        />
      ) : null}
    </div>
  );
}
