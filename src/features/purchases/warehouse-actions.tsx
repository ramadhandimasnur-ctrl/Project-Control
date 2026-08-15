'use client';

import { Pencil, Plus, Trash2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';

import { deleteWarehouseAction } from './actions';
import { WarehouseDialog } from './warehouse-dialog';

/**
 * Opens the create form.
 *
 * Takes the button's appearance from props because the same action appears in
 * three places — the page header, the empty state, and the purchase dialog
 * where the missing warehouse actually blocks the user.
 */
export function WarehouseCreateButton({
  projectId,
  canManage,
  isFirst = false,
  label = 'Buat gudang',
  variant,
  size,
  onSaved,
}: {
  projectId: string;
  canManage: boolean;
  isFirst?: boolean;
  label?: string;
  variant?: React.ComponentProps<typeof Button>['variant'];
  size?: React.ComponentProps<typeof Button>['size'];
  onSaved?: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (!canManage) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)} variant={variant} size={size}>
        <Plus className="size-4" aria-hidden />
        {label}
      </Button>
      {/* Remounted per opening so a cancelled draft never leaks into the next. */}
      {open ? (
        <WarehouseDialog
          open
          onOpenChange={setOpen}
          projectId={projectId}
          warehouseId={null}
          isFirst={isFirst}
          {...(onSaved ? { onSaved } : {})}
        />
      ) : null}
    </>
  );
}

export function WarehouseRowActions({
  projectId,
  warehouse,
  canManage,
}: {
  projectId: string;
  warehouse: {
    id: string;
    name: string;
    location: string | null;
    isDefault: boolean;
    movementCount: number;
  };
  canManage: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  if (!canManage) return null;

  // A warehouse that has been used cannot be deleted; the service refuses it so
  // history stays traceable. Saying so up front beats an error after the click.
  const used = warehouse.movementCount > 0;

  return (
    <div className="flex justify-end gap-1">
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <Pencil className="size-4" aria-hidden />
        Ubah
      </Button>

      <AlertDialog>
        <AlertDialogTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={pending || used}
              title={used ? 'Sudah dipakai pada mutasi barang.' : undefined}
            />
          }
        >
          <Trash2 className="size-4" aria-hidden />
          Hapus
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Hapus gudang {warehouse.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Gudang yang sudah pernah menerima atau mengeluarkan barang tidak dapat dihapus.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  const result = await deleteWarehouseAction(projectId, warehouse.id);
                  if (result.ok) {
                    toast.success('Gudang dihapus.');
                    router.refresh();
                  } else {
                    toast.error(result.message, { description: result.hint });
                  }
                })
              }
            >
              Ya, hapus
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {open ? (
        <WarehouseDialog
          open
          onOpenChange={setOpen}
          projectId={projectId}
          warehouseId={warehouse.id}
          defaultValues={{
            name: warehouse.name,
            location: warehouse.location ?? '',
            isDefault: warehouse.isDefault,
          }}
        />
      ) : null}
    </div>
  );
}
