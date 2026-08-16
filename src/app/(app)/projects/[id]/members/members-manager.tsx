'use client';

import { UserPlus, Users, X } from 'lucide-react';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';

import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  addMemberAction,
  changeMemberRoleAction,
  removeMemberAction,
} from '@/features/projects/actions';
import {
  PROJECT_ROLE_DESCRIPTIONS,
  PROJECT_ROLE_LABELS,
  PROJECT_ROLES,
  type ProjectRole,
} from '@/lib/auth/roles';
import { type ProjectMemberRow } from '@/services/members';

type OrgUser = { id: string; fullName: string; email: string };

export function MembersManager({
  projectId,
  members,
  assignableUsers,
  canManage,
  currentUserId,
}: {
  projectId: string;
  members: ProjectMemberRow[];
  assignableUsers: OrgUser[];
  canManage: boolean;
  currentUserId: string;
}) {
  const [pending, startTransition] = useTransition();
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [selectedRole, setSelectedRole] = useState<ProjectRole>('ENGINEER');

  /*
   * Base UI shows the raw value in the trigger unless the Root is told how
   * values map to labels — a role select would otherwise read "PROJECT_MANAGER"
   * and a user select would show a UUID.
   */
  const roleItems = PROJECT_ROLES.map((role) => ({
    value: role,
    label: PROJECT_ROLE_LABELS[role],
  }));

  const userItems = assignableUsers.map((user) => ({
    value: user.id,
    label: `${user.fullName} — ${user.email}`,
  }));

  const run = (fn: () => Promise<{ ok: boolean; message?: string; hint?: string }>) => {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success('Perubahan tersimpan.');
      } else {
        toast.error(result.message ?? 'Gagal menyimpan.', { description: result.hint });
      }
    });
  };

  return (
    <div className="space-y-6">
      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Tambah anggota</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {assignableUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Semua pengguna aktif di organisasi ini sudah menjadi anggota proyek.
              </p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Select
                    items={userItems}
                    value={selectedUser}
                    onValueChange={(value) => setSelectedUser(value ?? '')}
                  >
                    <SelectTrigger aria-label="Pilih pengguna">
                      <SelectValue placeholder="Pilih pengguna" />
                    </SelectTrigger>
                    <SelectContent>
                      {userItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    items={roleItems}
                    value={selectedRole}
                    onValueChange={(value) => {
                      if (value !== null) setSelectedRole(value as ProjectRole);
                    }}
                  >
                    <SelectTrigger aria-label="Pilih peran">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roleItems.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Button
                    disabled={pending || !selectedUser}
                    onClick={() =>
                      run(async () => {
                        const result = await addMemberAction(projectId, {
                          userId: selectedUser,
                          role: selectedRole,
                        });
                        if (result.ok) setSelectedUser('');
                        return result;
                      })
                    }
                  >
                    <UserPlus className="size-4" aria-hidden />
                    Tambah
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {PROJECT_ROLE_DESCRIPTIONS[selectedRole]}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}

      {members.length === 0 ? (
        <EmptyState
          icon={Users}
          title="Belum ada anggota"
          description="Tambahkan anggota agar tim dapat mengisi estimasi, jadwal, dan progres proyek ini."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead>Email</TableHead>
                <TableHead className="w-56">Peran</TableHead>
                {canManage ? <TableHead className="w-16" /> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell className="font-medium">
                    {member.fullName}
                    {member.userId === currentUserId ? (
                      <span className="ml-2 text-xs text-muted-foreground">(Anda)</span>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{member.email}</TableCell>
                  <TableCell>
                    {canManage ? (
                      <Select
                        items={roleItems}
                        value={member.role}
                        disabled={pending}
                        onValueChange={(value) => {
                          if (value === null) return;
                          run(() =>
                            changeMemberRoleAction(projectId, member.id, value as ProjectRole),
                          );
                        }}
                      >
                        <SelectTrigger aria-label={`Peran ${member.fullName}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {roleItems.map((item) => (
                            <SelectItem key={item.value} value={item.value}>
                              {item.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      PROJECT_ROLE_LABELS[member.role]
                    )}
                  </TableCell>
                  {canManage ? (
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Keluarkan ${member.fullName}`}
                        disabled={pending}
                        onClick={() => run(() => removeMemberAction(projectId, member.id))}
                      >
                        <X className="size-4" aria-hidden />
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
