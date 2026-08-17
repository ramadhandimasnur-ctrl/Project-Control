'use client';

import { Ban, Check, Loader2, RotateCcw, UserMinus, X } from 'lucide-react';
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
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { selectClassName } from '@/features/master-data/form-fields';
import { EMPTY_VALUE, formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { USER_STATUS_LABELS, type UserRow, type UserStatus } from '@/lib/users/labels';

import { removeUserAction, reviewUserAction, setGlobalRoleAction } from './user-actions';

const STATUS_VARIANT: Record<UserStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  PENDING: 'default',
  ACTIVE: 'secondary',
  REJECTED: 'destructive',
  DEACTIVATED: 'outline',
  REMOVED: 'destructive',
};

const ROLE_LABELS = { ADMIN: 'Administrator', MEMBER: 'Anggota' } as const;

/**
 * Who may sign in, and as what.
 *
 * Pending accounts are listed first and separately: they are the only rows
 * that need a decision, and burying them among fifty active users is how a new
 * colleague waits three days for access.
 */
export function UsersManager({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [roleChoice, setRoleChoice] = useState<Record<string, 'ADMIN' | 'MEMBER'>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (id: string, fn: () => Promise<ActionOutcome>, success: string) => {
    setBusyId(id);
    startTransition(async () => {
      const result = await fn();
      setBusyId(null);
      if (result.ok) {
        toast.success(success);
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  const waiting = users.filter((user) => user.status === 'PENDING');
  const decided = users.filter((user) => user.status !== 'PENDING');

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Menunggu persetujuan</h2>
          {waiting.length > 0 ? (
            <Badge variant="default" className="text-[10px]">
              {waiting.length}
            </Badge>
          ) : null}
        </div>

        {waiting.length === 0 ? (
          <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            Tidak ada pendaftaran yang menunggu.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead className="w-40">Username</TableHead>
                  <TableHead className="w-64">Email</TableHead>
                  <TableHead className="w-48">Mendaftar</TableHead>
                  <TableHead className="w-72">Keputusan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {waiting.map((user) => {
                  const busy = pending && busyId === user.id;
                  const role = roleChoice[user.id] ?? 'MEMBER';

                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.fullName}</TableCell>
                      <TableCell className="font-mono text-xs">
                        {user.username ?? EMPTY_VALUE}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDateTime(new Date(user.createdAt))}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <Label htmlFor={`role-${user.id}`} className="text-xs">
                              Peran
                            </Label>
                            <select
                              id={`role-${user.id}`}
                              className={cn(selectClassName, 'w-36')}
                              value={role}
                              disabled={busy}
                              onChange={(event) =>
                                setRoleChoice((current) => ({
                                  ...current,
                                  [user.id]: event.target.value as 'ADMIN' | 'MEMBER',
                                }))
                              }
                            >
                              <option value="MEMBER">Anggota</option>
                              <option value="ADMIN">Administrator</option>
                            </select>
                          </div>

                          <Button
                            size="sm"
                            disabled={busy}
                            onClick={() =>
                              run(
                                user.id,
                                () => reviewUserAction(user.id, 'APPROVE', role),
                                `${user.fullName} disetujui sebagai ${ROLE_LABELS[role]}.`,
                              )
                            }
                          >
                            {busy ? (
                              <Loader2 className="size-3.5 animate-spin" aria-hidden />
                            ) : (
                              <Check className="size-3.5" aria-hidden />
                            )}
                            Setujui
                          </Button>

                          <AlertDialog>
                            <AlertDialogTrigger
                              render={
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive"
                                  disabled={busy}
                                />
                              }
                            >
                              <X className="size-3.5" aria-hidden />
                              Tolak
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Tolak {user.fullName}?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Akun tetap ada tetapi tidak akan pernah dapat masuk. Anda dapat
                                  menyetujuinya kemudian bila ini keliru.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Batal</AlertDialogCancel>
                                <Button
                                  variant="destructive"
                                  disabled={pending}
                                  onClick={() =>
                                    run(
                                      user.id,
                                      () => reviewUserAction(user.id, 'REJECT'),
                                      `Pendaftaran ${user.fullName} ditolak.`,
                                    )
                                  }
                                >
                                  Ya, tolak
                                </Button>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold">Semua pengguna</h2>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="w-40">Username</TableHead>
                <TableHead className="w-64">Email</TableHead>
                <TableHead className="w-44">Peran</TableHead>
                <TableHead className="w-40">Status</TableHead>
                <TableHead className="w-40" />
                <TableHead className="w-36" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {decided.map((user) => {
                const busy = pending && busyId === user.id;
                const isSelf = user.id === currentUserId;

                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">
                      {user.fullName}
                      {isSelf ? (
                        <span className="ml-2 text-xs text-muted-foreground">(Anda)</span>
                      ) : null}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {user.username ?? EMPTY_VALUE}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      {/*
                        Own row is read-only. An administrator who demotes
                        themselves is locked out with no way back in, and the
                        service refuses it anyway — offering the control would
                        only teach the rule the hard way.
                      */}
                      {isSelf ? (
                        <span className="text-sm">{ROLE_LABELS[user.globalRole]}</span>
                      ) : (
                        <select
                          className={cn(selectClassName, 'w-36')}
                          value={user.globalRole}
                          disabled={busy}
                          aria-label={`Peran ${user.fullName}`}
                          onChange={(event) =>
                            run(
                              user.id,
                              () => setGlobalRoleAction(user.id, event.target.value),
                              'Peran diperbarui.',
                            )
                          }
                        >
                          <option value="MEMBER">Anggota</option>
                          <option value="ADMIN">Administrator</option>
                        </select>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[user.status]} className="text-[10px]">
                        {USER_STATUS_LABELS[user.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {isSelf ? null : user.status === 'ACTIVE' ? (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={busy}
                              />
                            }
                          >
                            <Ban className="size-3.5" aria-hidden />
                            Nonaktifkan
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Nonaktifkan {user.fullName}?</AlertDialogTitle>
                              <AlertDialogDescription>
                                Sesi yang sedang berjalan akan berhenti bekerja pada permintaan
                                berikutnya, dan akun ini tidak dapat masuk lagi sampai diaktifkan
                                kembali. Data yang pernah dibuatnya tetap utuh.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Batal</AlertDialogCancel>
                              <Button
                                variant="destructive"
                                disabled={pending}
                                onClick={() =>
                                  run(
                                    user.id,
                                    () => reviewUserAction(user.id, 'DEACTIVATE'),
                                    `${user.fullName} dinonaktifkan.`,
                                  )
                                }
                              >
                                Ya, nonaktifkan
                              </Button>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      ) : user.status === 'REMOVED' ? null : (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            run(
                              user.id,
                              () => reviewUserAction(user.id, 'REACTIVATE'),
                              `${user.fullName} diaktifkan kembali.`,
                            )
                          }
                        >
                          <RotateCcw className="size-3.5" aria-hidden />
                          Aktifkan
                        </Button>
                      )}
                    </TableCell>

                    {/*
                      Removal sits in its own column, away from the
                      activate/deactivate pair. It is not a third setting on
                      that dial: it drops every project membership and deletes
                      the sign-in credential, and nothing here puts them back.
                    */}
                    <TableCell>
                      {isSelf || user.status === 'REMOVED' ? null : (
                        <AlertDialog>
                          <AlertDialogTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                disabled={busy}
                              />
                            }
                          >
                            <UserMinus className="size-3.5" aria-hidden />
                            Keluarkan
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Keluarkan {user.fullName} dari organisasi?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                Keanggotaannya di seluruh proyek dilepas, dan akun masuknya dihapus
                                sehingga alamat emailnya bebas dipakai mendaftar lagi. Tindakan ini
                                tidak dapat dibatalkan dari sini — mengembalikannya berarti
                                mendaftar ulang dan menyetujuinya kembali.
                                <span className="mt-2 block">
                                  Data yang pernah dibuatnya tetap utuh, dan namanya tetap tercatat
                                  sebagai pembuat progres, pembelian, dan persetujuan yang pernah
                                  dilakukannya.
                                </span>
                                <span className="mt-2 block">
                                  Untuk sekadar menghentikan akses sementara, pakai
                                  &ldquo;Nonaktifkan&rdquo;.
                                </span>
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Batal</AlertDialogCancel>
                              <Button
                                variant="destructive"
                                disabled={pending}
                                onClick={() =>
                                  run(
                                    user.id,
                                    () => removeUserAction(user.id),
                                    `${user.fullName} dikeluarkan dari organisasi.`,
                                  )
                                }
                              >
                                Ya, keluarkan
                              </Button>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

type ActionOutcome = { ok: true } | { ok: false; message: string; hint?: string };
