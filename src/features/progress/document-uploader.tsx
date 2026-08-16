'use client';

import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { compressPhoto } from '@/lib/upload/compress';
import { admitPhotos, formatBytes } from '@/lib/upload/photo';

import {
  createUploadTargetAction,
  deleteDocumentAction,
  recordDocumentAction,
} from './document-actions';

const BUCKET = 'project-documents';

export type StoredDocument = {
  id: string;
  workItemId: string | null;
  caption: string | null;
  byteSize: number | null;
  url: string | null;
};

/**
 * Uploads site photographs and keeps them.
 *
 * Three steps per file, in this order: compress in the browser, ask the server
 * for a single-use upload URL, then post the bytes straight to storage and
 * record the row. The file never travels through the Next server — a server
 * action body is capped in the low megabytes, and a photograph has no business
 * occupying the Node process on its way past.
 *
 * Compression happens first so the upload that follows is the small one. A
 * phone photograph routinely arrives at 4–12 MB and leaves at a few hundred
 * kilobytes, which is the difference between working and not working on a site
 * connection.
 */
export function DocumentUploader({
  projectId,
  periodId,
  workItemId = null,
  documents,
  label,
  hint,
  canEdit = true,
}: {
  projectId: string;
  periodId: string;
  /** Null attaches to the report as a whole rather than to a work item. */
  workItemId?: string | null;
  documents: StoredDocument[];
  label: string;
  hint?: string;
  canEdit?: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  /*
   * What the button says while it works.
   *
   * Compression happens in the browser and, on a phone photograph over a site
   * connection, takes long enough to be mistaken for a hang. Labelling it
   * "Mengunggah…" the whole time is not only vague, it is wrong for the first
   * half — and a progress count is what tells someone dropping in eight photos
   * that the eighth is coming.
   */
  const [phase, setPhase] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const upload = async (files: File[]) => {
    const verdict = admitPhotos(documents.length, files);
    for (const reason of verdict.rejected) toast.error(reason);
    if (verdict.accepted.length === 0) return;

    setBusy(true);
    const supabase = createSupabaseBrowserClient();
    const total = verdict.accepted.length;
    let stored = 0;

    for (const [index, original] of verdict.accepted.entries()) {
      const counter = total === 1 ? '' : ` (${index + 1}/${total})`;
      try {
        setPhase(`Mengecilkan${counter}…`);
        const { file, originalBytes, compressedBytes } = await compressPhoto(original);
        setPhase(`Mengunggah${counter}…`);
        const extension = file.name.split('.').pop() ?? 'jpg';

        const target = await createUploadTargetAction(projectId, periodId, extension);
        if (!target.ok) {
          toast.error(target.message, { description: target.hint });
          break;
        }

        const { error } = await supabase.storage
          .from(BUCKET)
          .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type });

        if (error) {
          toast.error(`Gagal mengunggah "${original.name}".`, { description: error.message });
          continue;
        }

        const recorded = await recordDocumentAction({
          projectId,
          periodId,
          workItemId,
          storagePath: target.path,
          caption: null,
          byteSize: compressedBytes,
        });

        if (!recorded.ok) {
          toast.error(recorded.message, { description: recorded.hint });
          continue;
        }

        stored += 1;
        if (compressedBytes < originalBytes) {
          toast.success(
            `"${original.name}" tersimpan — ${formatBytes(originalBytes)} dikecilkan menjadi ${formatBytes(compressedBytes)}.`,
          );
        } else {
          toast.success(`"${original.name}" tersimpan.`);
        }
      } catch (error) {
        toast.error(`Gagal memproses "${original.name}".`, {
          description: error instanceof Error ? error.message : undefined,
        });
      }
    }

    setBusy(false);
    setPhase(null);
    if (inputRef.current) inputRef.current.value = '';
    if (stored > 0) router.refresh();
  };

  const remove = (documentId: string) => {
    setRemovingId(documentId);
    startTransition(async () => {
      const result = await deleteDocumentAction(projectId, documentId);
      setRemovingId(null);
      if (result.ok) {
        toast.success('Foto dihapus.');
        router.refresh();
      } else {
        toast.error(result.message, { description: result.hint });
      }
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`upload-${workItemId ?? 'umum'}`}>{label}</Label>
        {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}

        {canEdit ? (
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              id={`upload-${workItemId ?? 'umum'}`}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length > 0) void upload(files);
              }}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <ImagePlus className="size-4" aria-hidden />
              )}
              {busy ? (phase ?? 'Memproses…') : 'Tambah foto'}
            </Button>
            <span className="text-xs text-muted-foreground">
              {documents.length} foto tersimpan
            </span>
          </div>
        ) : null}
      </div>

      {documents.length > 0 ? (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {documents.map((doc) => (
            <li key={doc.id} data-print="keep-together" className="space-y-1">
              <div className="relative overflow-hidden rounded-md border bg-muted">
                {doc.url === null ? (
                  <div className="flex aspect-[4/3] items-center justify-center p-2 text-center text-xs text-muted-foreground">
                    Foto tidak dapat dimuat
                  </div>
                ) : (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={doc.url}
                    alt={doc.caption ?? 'Dokumentasi lapangan'}
                    className="aspect-[4/3] w-full object-cover"
                  />
                )}

                {canEdit ? (
                  <Button
                    data-print="hide"
                    variant="destructive"
                    size="icon-sm"
                    className="absolute right-1 top-1"
                    aria-label="Hapus foto"
                    disabled={pending && removingId === doc.id}
                    onClick={() => remove(doc.id)}
                  >
                    {pending && removingId === doc.id ? (
                      <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    ) : (
                      <Trash2 className="size-3.5" aria-hidden />
                    )}
                  </Button>
                ) : null}
              </div>

              <p className="text-xs text-muted-foreground">
                {doc.caption ?? 'Dokumentasi lapangan'}
                {doc.byteSize !== null ? (
                  <span data-print="hide"> · {formatBytes(doc.byteSize)}</span>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
