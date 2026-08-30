'use client';

import { BookmarkPlus, Copy, LayoutTemplate, Library, Pencil, Plus, Trash2 } from 'lucide-react';
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
import { ApplyLibraryDialog } from './apply-library-dialog';
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

/**
 * `variant="fab"` is the same action, placed where a thumb can reach it.
 *
 * On a phone the top-right corner of a scrolling list is the hardest part of
 * the screen to touch one-handed, and it scrolls away besides. The floating
 * button stays put above the list and within reach; the inline button is what
 * a mouse expects on a wide screen. Both open the same dialog — the only thing
 * that differs is where the finger has to go.
 */
export function WorkItemCreateButton({
  projectId,
  units,
  variant = 'inline',
}: { projectId: string; variant?: 'inline' | 'fab' } & Lists) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === 'fab' ? (
        <Button
          aria-label="Tambah pekerjaan"
          className="fixed bottom-5 right-5 z-30 size-14 rounded-full shadow-lg lg:hidden"
          onClick={() => setOpen(true)}
        >
          <Plus className="size-6" aria-hidden />
        </Button>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="size-4" aria-hidden />
          Tambah pekerjaan
        </Button>
      )}
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
  /*
   * Which analysis the library entry lands on. Held here rather than chosen
   * inside the dialog so the two buttons say plainly which one they mean —
   * a published analysis copied into the wrong side of the estimate is a
   * mistake nobody notices until the margin is wrong.
   */
  const [fromLibrary, setFromLibrary] = useState<'RAB' | 'RAP' | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  const [pending, startTransition] = useTransition();

  const blocked = impact.progressEntries > 0 || impact.materialTransactions > 0;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" size="sm" onClick={() => setApplyingTemplate(true)}>
        <LayoutTemplate className="size-4" aria-hidden />
        Terapkan template
      </Button>

      <Button variant="outline" size="sm" onClick={() => setFromLibrary('RAB')}>
        <Library className="size-4" aria-hidden />
        Pustaka → RAB
      </Button>

      <Button variant="outline" size="sm" onClick={() => setFromLibrary('RAP')}>
        <Library className="size-4" aria-hidden />
        Pustaka → RAP
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

      {fromLibrary === null ? null : (
        <ApplyLibraryDialog
          open
          onOpenChange={(open) => !open && setFromLibrary(null)}
          projectId={projectId}
          workItemId={workItemId}
          workItemName={workItemName}
          estimateType={fromLibrary}
        />
      )}

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
