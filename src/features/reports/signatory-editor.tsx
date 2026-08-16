'use client';

import { Loader2, PenLine, Trash2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  SIGNATORY_SLOTS,
  SIGNATORY_SLOT_LABELS,
  COMMON_POSITIONS,
  type SignatorySlot,
} from '@/lib/reports/signatories';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { formatBytes } from '@/lib/upload/photo';

import {
  clearSignatureAction,
  createSignatureTargetAction,
  saveSignatoryAction,
} from './signatory-actions';

const BUCKET = 'project-documents';

/** Signatures are small; anything larger is a scan that should be cropped. */
const MAX_SIGNATURE_BYTES = 1024 * 1024;

export type SignatoryDraft = {
  slot: SignatorySlot;
  name: string;
  position: string;
  signatureUrl: string | null;
};

/**
 * Fills the three columns that appear at the foot of every printed sheet.
 *
 * Name and position are required; the signature image is not. A site that
 * signs on paper leaves it empty and prints a clean box, which is why nothing
 * here nags about a missing upload.
 *
 * PNG only, and deliberately not compressed: a signature is line art on a
 * transparent background, and re-encoding it to JPEG replaces that
 * transparency with a white rectangle sitting on top of the ruled line.
 */
export function SignatoryEditor({
  projectId,
  signatories,
  canEdit,
}: {
  projectId: string;
  signatories: SignatoryDraft[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState(() =>
    Object.fromEntries(
      SIGNATORY_SLOTS.map((slot) => {
        const row = signatories.find((entry) => entry.slot === slot);
        return [slot, { name: row?.name ?? '', position: row?.position ?? '' }];
      }),
    ) as Record<SignatorySlot, { name: string; position: string }>,
  );
  const [busySlot, setBusySlot] = useState<SignatorySlot | null>(null);
  const [pending, startTransition] = useTransition();
  const inputs = useRef<Partial<Record<SignatorySlot, HTMLInputElement | null>>>({});

  if (!canEdit) return null;

  const save = (slot: SignatorySlot, signaturePath?: string | null) => {
    const draft = drafts[slot];
    setBusySlot(slot);

    startTransition(async () => {
      const result = await saveSignatoryAction(projectId, slot, {
        name: draft.name,
        position: draft.position,
        ...(signaturePath === undefined ? {} : { signaturePath }),
      });
      setBusySlot(null);

      if (result.ok) {
        toast.success(`${SIGNATORY_SLOT_LABELS[slot]} tersimpan.`);
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  const uploadSignature = async (slot: SignatorySlot, file: File) => {
    if (file.type !== 'image/png') {
      toast.error('Tanda tangan harus berformat PNG.', {
        description: 'PNG mendukung latar transparan, sehingga tanda tangan duduk di atas garis.',
      });
      return;
    }

    if (file.size > MAX_SIGNATURE_BYTES) {
      toast.error(`Berkas terlalu besar (${formatBytes(file.size)}).`, {
        description: 'Potong gambarnya sebatas tanda tangan saja; maksimum 1 MB.',
      });
      return;
    }

    const draft = drafts[slot];
    if (draft.name.trim() === '' || draft.position.trim() === '') {
      toast.error('Isi nama terang dan jabatan terlebih dahulu.');
      return;
    }

    setBusySlot(slot);

    const target = await createSignatureTargetAction(projectId, slot);
    if (!target.ok) {
      setBusySlot(null);
      toast.error(target.message, { description: target.hint });
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.storage
      .from(BUCKET)
      .uploadToSignedUrl(target.path, target.token, file, { contentType: 'image/png' });

    setBusySlot(null);

    if (error) {
      toast.error('Gagal mengunggah tanda tangan.', { description: error.message });
      return;
    }

    save(slot, target.path);
  };

  const clear = (slot: SignatorySlot) => {
    setBusySlot(slot);
    startTransition(async () => {
      const result = await clearSignatureAction(projectId, slot);
      setBusySlot(null);
      if (result.ok) {
        toast.success('Tanda tangan dihapus; nama dan jabatan tetap.');
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  return (
    <section data-print="hide" className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="text-sm font-semibold">Lembar pengesahan</h2>
        <p className="text-xs text-muted-foreground">
          Nama dan jabatan tercetak di kaki setiap laporan. Tanda tangan PNG bersifat opsional —
          kosongkan bila laporan akan ditandatangani basah.
        </p>
      </div>

      <datalist id="jabatan-umum">
        {COMMON_POSITIONS.map((position) => (
          <option key={position} value={position} />
        ))}
      </datalist>

      <div className="grid gap-4 lg:grid-cols-3">
        {SIGNATORY_SLOTS.map((slot) => {
          const stored = signatories.find((entry) => entry.slot === slot);
          const busy = pending && busySlot === slot;

          return (
            <div key={slot} className="space-y-2 rounded-md border p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {SIGNATORY_SLOT_LABELS[slot]}
              </p>

              <div className="space-y-1.5">
                <Label htmlFor={`name-${slot}`}>Nama terang</Label>
                <Input
                  id={`name-${slot}`}
                  value={drafts[slot].name}
                  disabled={busy}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [slot]: { ...current[slot], name: event.target.value },
                    }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={`position-${slot}`}>Jabatan</Label>
                <Input
                  id={`position-${slot}`}
                  list="jabatan-umum"
                  placeholder="Contoh: Site Engineer"
                  value={drafts[slot].position}
                  disabled={busy}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [slot]: { ...current[slot], position: event.target.value },
                    }))
                  }
                />
              </div>

              {stored?.signatureUrl ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={stored.signatureUrl}
                    alt={`Tanda tangan ${stored.name}`}
                    className="h-10 max-w-32 object-contain"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="ml-auto text-destructive hover:text-destructive"
                    aria-label={`Hapus tanda tangan ${SIGNATORY_SLOT_LABELS[slot]}`}
                    disabled={busy}
                    onClick={() => clear(slot)}
                  >
                    <Trash2 className="size-3.5" aria-hidden />
                  </Button>
                </div>
              ) : (
                <p className="rounded-md border border-dashed px-2 py-3 text-center text-xs text-muted-foreground">
                  Tanpa tanda tangan digital — siap tanda tangan basah.
                </p>
              )}

              <input
                ref={(node) => {
                  inputs.current[slot] = node;
                }}
                type="file"
                accept="image/png"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void uploadSignature(slot, file);
                }}
              />

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => inputs.current[slot]?.click()}
                >
                  <Upload className="size-3.5" aria-hidden />
                  TTD PNG
                </Button>
                <Button size="sm" disabled={busy} onClick={() => save(slot)}>
                  {busy ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <PenLine className="size-3.5" aria-hidden />
                  )}
                  Simpan
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
