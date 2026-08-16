'use client';

import { BookmarkPlus, Copy, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { ApplyTemplateDialog } from './apply-template-dialog';
import { DuplicateWorkItemDialog } from './duplicate-work-item-dialog';
import { SaveTemplateDialog } from './save-template-dialog';
import { WorkItemDialog } from './work-item-dialog';

type Lists = {
  units: { id: string; code: string; name: string }[];
};

export type TemplateOption = {
  id: string;
  code: string;
  name: string;
  unitCode: string;
  lineCount: number;
};

export function WorkItemCreateButton({
  projectId,
  units,
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
        />
      ) : null}
    </>
  );
}

export function WorkItemActionsBar({
  projectId,
  workItemId,
  workItemCode,
  workItemName,
  unitCode,
  defaultValues,
  volumeLocked,
  impact,
  units,
  templates,
}: {
  projectId: string;
  workItemId: string;
  workItemCode: string;
  workItemName: string;
  unitCode: string;
  defaultValues: WorkItemFormInput;
  volumeLocked: boolean;
  impact: WorkItemDeletionImpact;
  templates: TemplateOption[];
} & Lists) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [pending, startTransition] = useTransition();

  const blocked = impact.progressEntries > 0 || impact.materialTransactions > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setApplyingTemplate(true)}>
        <LayoutTemplate className="size-4" aria-hidden />
        Terapkan template
      </Button>

      <Button
        variant="outline"
        size="sm"
        disabled={impact.ahspLines === 0}
        title={
          impact.ahspLines === 0
            ? 'Belum ada baris analisa yang dapat disimpan sebagai template.'
            : undefined
        }
        onClick={() => setSavingTemplate(true)}
      >
        <BookmarkPlus className="size-4" aria-hidden />
        Simpan sebagai template
      </Button>

      <Button variant="outline" size="sm" onClick={() => setDuplicating(true)}>
        <Copy className="size-4" aria-hidden />
        Duplikat
      </Button>

      <span className="mx-1 h-5 w-px bg-border" aria-hidden />

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
          volumeLocked={volumeLocked}
        />
      ) : null}

      {savingTemplate ? (
        <SaveTemplateDialog
          open
          onOpenChange={setSavingTemplate}
          projectId={projectId}
          workItemId={workItemId}
          workItemName={workItemName}
          lineCount={impact.ahspLines}
        />
      ) : null}

      {applyingTemplate ? (
        <ApplyTemplateDialog
          open
          onOpenChange={setApplyingTemplate}
          projectId={projectId}
          workItemId={workItemId}
          workItemName={workItemName}
          unitCode={unitCode}
          existingLineCount={impact.ahspLines}
          templates={templates}
        />
      ) : null}

      {duplicating ? (
        <DuplicateWorkItemDialog
          open
          onOpenChange={setDuplicating}
          projectId={projectId}
          workItemId={workItemId}
          sourceCode={workItemCode}
          sourceName={workItemName}
          ahspLineCount={impact.ahspLines}
          takeoffCount={impact.takeoffs}
        />
      ) : null}
    </div>
  );
}
