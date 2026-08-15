'use client';

import { ImagePlus, X } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ALLOWED_PHOTO_TYPES, MAX_PHOTOS_PER_ITEM } from '@/lib/upload/photo';
import { cn } from '@/lib/utils';

import { usePhotoStash } from './photo-stash';

/**
 * Picks photographs and shows them back as thumbnails.
 *
 * The warning about photographs being temporary is not fine print: they exist
 * only until the page reloads, and someone who assumes otherwise will lose an
 * afternoon of site documentation. It is stated wherever the picker appears.
 */
export function PhotoField({
  stashKey,
  label = 'Foto dokumentasi lapangan',
  hint,
  captions = true,
  className,
}: {
  stashKey: string;
  label?: string;
  hint?: string;
  captions?: boolean;
  className?: string;
}) {
  const { photosFor, add, remove, setCaption } = usePhotoStash();
  const inputRef = useRef<HTMLInputElement>(null);
  const photos = photosFor(stashKey);

  const onPick = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const { rejected } = add(stashKey, Array.from(files));
    for (const reason of rejected) toast.error(reason);
    // Lets the same file be picked again after being removed.
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={`photos-${stashKey}`}>{label}</Label>
        <span className="text-xs text-muted-foreground">
          {photos.length}/{MAX_PHOTOS_PER_ITEM}
        </span>
      </div>

      <input
        ref={inputRef}
        id={`photos-${stashKey}`}
        type="file"
        accept={ALLOWED_PHOTO_TYPES.join(',')}
        multiple
        className="sr-only"
        onChange={(e) => onPick(e.target.files)}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={photos.length >= MAX_PHOTOS_PER_ITEM}
        onClick={() => inputRef.current?.click()}
      >
        <ImagePlus className="size-4" aria-hidden />
        Pilih foto
      </Button>

      <p className="text-xs text-muted-foreground">
        {hint ??
          'Foto hanya disimpan di peramban ini untuk dicetak ke laporan — tidak diunggah ke server, dan hilang bila halaman dimuat ulang.'}
      </p>

      {photos.length > 0 ? (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((photo) => (
            <li key={photo.id} className="space-y-1">
              <div className="relative overflow-hidden rounded-md border bg-muted">
                {/*
                  A plain <img>: next/image optimises remote and bundled files,
                  and an object URL is neither — it points at a file that only
                  this tab can see.
                */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={photo.caption || photo.name}
                  className="aspect-square w-full object-cover"
                />
                <button
                  type="button"
                  aria-label={`Hapus ${photo.name}`}
                  onClick={() => remove(stashKey, photo.id)}
                  className="absolute top-1 right-1 rounded-full bg-background/90 p-1 text-muted-foreground shadow-sm hover:text-destructive"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </div>
              {captions ? (
                <Input
                  aria-label={`Keterangan ${photo.name}`}
                  value={photo.caption}
                  onChange={(e) => setCaption(stashKey, photo.id, e.target.value)}
                  placeholder="Keterangan"
                  className="h-7 px-1.5 text-xs"
                />
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
