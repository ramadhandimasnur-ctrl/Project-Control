'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

import { ResourceDialog } from './resource-dialog';

export function ResourceCreateButton({
  units,
  categories,
  canManage,
}: {
  units: { id: string; code: string; name: string }[];
  categories: { id: string; name: string }[];
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!canManage) return null;

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden />
        Tambah sumber daya
      </Button>
      {/* Remounted per opening so a cancelled edit never leaks into the next. */}
      {open ? (
        <ResourceDialog
          open={open}
          onOpenChange={setOpen}
          resourceId={null}
          units={units}
          categories={categories}
        />
      ) : null}
    </>
  );
}
