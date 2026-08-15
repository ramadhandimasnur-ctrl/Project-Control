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
import { Button } from '@/components/ui/button';
import { type WorkItemFormInput } from '@/lib/validation/work-breakdown';
import type { WorkItemDeletionImpact } from '@/services/work-breakdown';

import { deleteWorkItemAction } from './actions';
import { WorkItemDialog } from './work-item-dialog';

type Lists = {
  units: { id: string; code: string; name: string }[];
  groups: { id: string; code: string; name: string }[];
};

export function WorkItemCreateButton({
  projectId,
  units,
  groups,
}: { projectId: string } & Lists) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Tambah pekerjaan
      </Button>
      {open ? (
        <WorkItemDialog
          open
          onOpenChange={setOpen}
          projectId={projectId}
          workItemId={null}
          units={units}
          groups={groups}
        />
      ) : null}
    </>
  );
}

export function WorkItemActionsBar({
  projectId,
  workItemId,
  workItemName,
  defaultValues,
  volumeLocked,
  impact,
  units,
  groups,
}: {
  projectId: string;
  workItemId: string;
  workItemName: string;
  defaultValues: WorkItemFormInput;
  volumeLocked: boolean;
  impact: WorkItemDeletionImpact;
} & Lists) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();

  const blocked = impact.progressEntries > 0 || impact.materialTransactions > 0;

  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
        <Pencil className="size-4" aria-hidden />
        Ubah
      </Button>

      <AlertDialog>
        <AlertDialogTrigger render={<Button variant="ghost" size="sm" disabled={pending} />}>
          <Trash2 className="size-4" aria-hidden />
          Hapus
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus pekerjaan &ldquo;{workItemName}&rdquo;?</AlertDialogTitle>
            {/* Charter section 7: name the consequence, in numbers. */}
            <AlertDialogDescription render={<div />}>
              {blocked ? (
                <>
                  <p>Pekerjaan ini sudah memiliki catatan lapangan:</p>
                  <ul className="mt-2 list-inside list-disc space-y-0.5">
                    {impact.progressEntries > 0 ? (
                      <li>{impact.progressEntries} entri progres</li>
                    ) : null}
                    {impact.materialTransactions > 0 ? (
                      <li>{impact.materialTransactions} transaksi material</li>
                    ) : null}
                  </ul>
                  <p className="mt-2">
                    Penghapusan akan ditolak. Catatan lapangan tidak boleh hilang.
                  </p>
                </>
              ) : (
                <>
                  <p>Data berikut akan ikut terhapus permanen:</p>
                  <ul className="mt-2 list-inside list-disc space-y-0.5">
                    <li>{impact.ahspLines} baris analisa</li>
                    <li>{impact.takeoffs} baris volume take-off</li>
                  </ul>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteWorkItemAction(projectId, workItemId);
                  if (result.ok) {
                    toast.success('Pekerjaan dihapus.');
                    router.replace(`/projects/${projectId}/work-items`);
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

      {editing ? (
        <WorkItemDialog
          open
          onOpenChange={setEditing}
          projectId={projectId}
          workItemId={workItemId}
          defaultValues={defaultValues}
          units={units}
          groups={groups}
          volumeLocked={volumeLocked}
        />
      ) : null}
    </div>
  );
}
