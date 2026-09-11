'use client';

import { Loader2, Plus } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
import { saveForemanAction } from '@/features/labor/actions';
import { EMPTY_VALUE } from '@/lib/format';
import type { ForemanRow } from '@/services/daily-labor';

/**
 * The address book behind every piecework contract and every day of labour.
 *
 * The bank account is the reason it exists: looked up from a WhatsApp thread
 * each payday, it is how money reaches the wrong account, and a name typed
 * afresh on every document eventually makes two people out of one.
 */
export function ForemenTable({
  foremen,
  canManage,
}: {
  foremen: ForemanRow[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    code: '',
    name: '',
    phone: '',
    address: '',
    bankAccount: '',
    note: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const startNew = () => {
    setEditingId(null);
    setForm({ code: '', name: '', phone: '', address: '', bankAccount: '', note: '' });
    setErrors({});
    setOpen(true);
  };

  const startEdit = (row: ForemanRow) => {
    setEditingId(row.id);
    setForm({
      code: row.code,
      name: row.name,
      phone: row.phone ?? '',
      address: '',
      bankAccount: row.bankAccount ?? '',
      note: row.note ?? '',
    });
    setErrors({});
    setOpen(true);
  };

  const submit = () => {
    startTransition(async () => {
      const result = await saveForemanAction(editingId, { ...form, isActive: true });
      if (result.ok) {
        toast.success('Mandor tersimpan.');
        setOpen(false);
      } else {
        setErrors(result.fieldErrors ?? {});
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{foremen.length} mandor terdaftar.</p>
        {canManage ? (
          <Button size="sm" variant="outline" onClick={startNew}>
            <Plus className="size-4" aria-hidden />
            Mandor baru
          </Button>
        ) : null}
      </div>

      {open && canManage ? (
        <div className="grid gap-3 rounded-lg border p-4 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label htmlFor="fm-code">Kode</Label>
            <Input
              id="fm-code"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value })}
            />
            {errors.code ? <p className="text-sm text-destructive">{errors.code}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fm-name">Nama</Label>
            <Input
              id="fm-name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            {errors.name ? <p className="text-sm text-destructive">{errors.name}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fm-phone">Telepon</Label>
            <Input
              id="fm-phone"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="fm-bank">Rekening</Label>
            <Input
              id="fm-bank"
              value={form.bankAccount}
              onChange={(e) => setForm({ ...form, bankAccount: e.target.value })}
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="fm-address">Alamat</Label>
            <Input
              id="fm-address"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
          </div>
          <div className="flex items-end gap-2 sm:col-span-3">
            <Button onClick={submit} disabled={pending}>
              {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Simpan
            </Button>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Batal
            </Button>
          </div>
        </div>
      ) : null}

      <div className="w-full rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Kode</TableHead>
              <TableHead className="min-w-40">Nama</TableHead>
              <TableHead className="w-36">Telepon</TableHead>
              <TableHead className="min-w-40">Rekening</TableHead>
              <TableHead className="w-24">Status</TableHead>
              {canManage ? <TableHead className="w-0" /> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {foremen.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={canManage ? 6 : 5}
                  className="text-center text-sm text-muted-foreground"
                >
                  Belum ada mandor terdaftar.
                </TableCell>
              </TableRow>
            ) : (
              foremen.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-mono text-xs">{row.code}</TableCell>
                  <TableCell>{row.name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {row.phone ?? EMPTY_VALUE}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.bankAccount ?? EMPTY_VALUE}
                  </TableCell>
                  <TableCell>
                    <Badge variant={row.isActive ? 'secondary' : 'outline'}>
                      {row.isActive ? 'Aktif' : 'Nonaktif'}
                    </Badge>
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      <Button variant="ghost" size="sm" onClick={() => startEdit(row)}>
                        Ubah
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
