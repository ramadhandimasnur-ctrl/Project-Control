'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { admitPhotos } from '@/lib/upload/photo';

/**
 * Site photographs, held in the browser and nowhere else.
 *
 * Nothing is uploaded and nothing is stored: each photograph is an object URL
 * pointing at a file the user picked, which the report renders and the printer
 * rasterises. Server storage stays at zero.
 *
 * The price is that a reload loses them, so every surface that offers the
 * picker says so plainly. This lives at the project layout rather than inside a
 * dialog so a photograph attached during an inspection is still there when the
 * report page is opened — client-side navigation keeps the provider mounted.
 *
 * Object URLs are revoked on removal and on unmount; without that, every photo
 * ever picked would be pinned in memory for the life of the tab.
 */

export type StashedPhoto = {
  id: string;
  name: string;
  url: string;
  caption: string;
};

type Stash = Record<string, StashedPhoto[]>;

type PhotoStashValue = {
  photosFor: (key: string) => StashedPhoto[];
  add: (key: string, files: File[]) => { rejected: string[] };
  remove: (key: string, id: string) => void;
  setCaption: (key: string, id: string, caption: string) => void;
  clear: (key: string) => void;
  totalCount: number;
};

const PhotoStashContext = createContext<PhotoStashValue | null>(null);

/** Key for photos taken against one work item in one period. */
export function inspectionKey(workItemId: string, periodId: string): string {
  return `inspection:${workItemId}:${periodId}`;
}

/** Key for photos attached to a period's report as a whole. */
export function reportKey(periodId: string): string {
  return `report:${periodId}`;
}

const EMPTY: StashedPhoto[] = [];

export function PhotoStashProvider({ children }: { children: React.ReactNode }) {
  const [stash, setStash] = useState<Stash>({});

  // Read by the unmount cleanup, which must not re-run whenever a photo is
  // added — the effect below deliberately has no dependency on the stash.
  const latest = useRef<Stash>(stash);
  latest.current = stash;

  useEffect(
    () => () => {
      for (const photos of Object.values(latest.current)) {
        for (const photo of photos) URL.revokeObjectURL(photo.url);
      }
    },
    [],
  );

  const photosFor = useCallback((key: string) => stash[key] ?? EMPTY, [stash]);

  const add = useCallback((key: string, files: File[]) => {
    let rejected: string[] = [];

    setStash((current) => {
      const existing = current[key] ?? [];
      const verdict = admitPhotos(existing.length, files);
      rejected = verdict.rejected;

      if (verdict.accepted.length === 0) return current;

      const added = verdict.accepted.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        name: file.name,
        url: URL.createObjectURL(file),
        caption: '',
      }));

      return { ...current, [key]: [...existing, ...added] };
    });

    return { rejected };
  }, []);

  const remove = useCallback((key: string, id: string) => {
    setStash((current) => {
      const existing = current[key] ?? [];
      const target = existing.find((photo) => photo.id === id);
      if (target) URL.revokeObjectURL(target.url);
      return { ...current, [key]: existing.filter((photo) => photo.id !== id) };
    });
  }, []);

  const setCaption = useCallback((key: string, id: string, caption: string) => {
    setStash((current) => ({
      ...current,
      [key]: (current[key] ?? []).map((photo) =>
        photo.id === id ? { ...photo, caption } : photo,
      ),
    }));
  }, []);

  const clear = useCallback((key: string) => {
    setStash((current) => {
      for (const photo of current[key] ?? []) URL.revokeObjectURL(photo.url);
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const totalCount = useMemo(
    () => Object.values(stash).reduce((acc, photos) => acc + photos.length, 0),
    [stash],
  );

  const value = useMemo(
    () => ({ photosFor, add, remove, setCaption, clear, totalCount }),
    [photosFor, add, remove, setCaption, clear, totalCount],
  );

  return <PhotoStashContext.Provider value={value}>{children}</PhotoStashContext.Provider>;
}

export function usePhotoStash(): PhotoStashValue {
  const value = useContext(PhotoStashContext);
  if (!value) {
    throw new Error('usePhotoStash harus dipakai di dalam PhotoStashProvider.');
  }
  return value;
}
