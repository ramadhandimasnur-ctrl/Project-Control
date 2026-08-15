'use client';

import { Trash2 } from 'lucide-react';
import { useTransition } from 'react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { deleteProjectAction, updateProjectAction } from '@/features/projects/actions';
import { ProjectForm } from '@/features/projects/project-form';
import { type ProjectFormInput, type ProjectFormValues } from '@/lib/validation/project';

export type DeletionImpact = {
  workItems: number;
  progressEntries: number;
  materialTransactions: number;
  purchases: number;
};

export function ProjectSettingsForm({
  projectId,
  projectName,
  defaultValues,
  canEdit,
  canEditContractTerms,
  deletionImpact,
}: {
  projectId: string;
  projectName: string;
  defaultValues: ProjectFormInput;
  canEdit: boolean;
  canEditContractTerms: boolean;
  deletionImpact: DeletionImpact | null;
}) {
  const [deleting, startDelete] = useTransition();

  if (!canEdit) {
    return (
      <Alert>
        <AlertTitle>Anda hanya dapat melihat pengaturan ini</AlertTitle>
        <AlertDescription>
          Perubahan pengaturan proyek memerlukan peran Engineer atau lebih tinggi.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-8">
      <ProjectForm
        defaultValues={defaultValues}
        submitLabel="Simpan perubahan"
        canEditContractTerms={canEditContractTerms}
        onSubmitAction={(values: ProjectFormValues) => updateProjectAction(projectId, values)}
      />

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="text-destructive">Hapus proyek</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Menghapus proyek akan menghapus seluruh data yang menempel padanya. Tindakan ini tidak
            dapat dibatalkan.
          </p>

          <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="destructive" disabled={deleting} />}
            >
              <Trash2 className="size-4" aria-hidden />
              Hapus proyek
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Hapus proyek &ldquo;{projectName}&rdquo;?</AlertDialogTitle>
                {/* Charter section 7: name the consequence specifically. */}
                <AlertDialogDescription render={<div />}>
                  {deletionImpact ? (
                    <>
                      <p>Data berikut akan ikut terhapus permanen:</p>
                      <ul className="mt-2 list-inside list-disc space-y-0.5">
                        <li>{deletionImpact.workItems} pekerjaan beserta analisanya</li>
                        <li>{deletionImpact.progressEntries} entri progres</li>
                        <li>{deletionImpact.materialTransactions} transaksi material</li>
                        <li>{deletionImpact.purchases} pembelian</li>
                      </ul>
                    </>
                  ) : (
                    <p>Seluruh data proyek ini akan terhapus permanen.</p>
                  )}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Batal</AlertDialogCancel>
                <AlertDialogAction
                  onClick={() => {
                    startDelete(async () => {
                      const result = await deleteProjectAction(projectId);
                      if (!result.ok) toast.error(result.message, { description: result.hint });
                    });
                  }}
                >
                  Ya, hapus proyek
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
