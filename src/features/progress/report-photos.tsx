'use client';

import { PhotoField } from './photo-field';
import { inspectionKey, reportKey, usePhotoStash } from './photo-stash';

/**
 * The photograph half of the report: a picker while composing, plates when
 * printed.
 *
 * Photographs attached during an inspection appear here without being picked
 * again — same stash, keyed by work item and period.
 */

export function ReportPhotoPicker({ periodId }: { periodId: string }) {
  return (
    <div data-print="hide" className="rounded-lg border p-3">
      <PhotoField
        stashKey={reportKey(periodId)}
        label="Foto dokumentasi laporan"
        hint="Ditempatkan di lampiran laporan. Hanya tersimpan di peramban ini dan hilang bila halaman dimuat ulang, jadi cetak sebelum menutup atau me-refresh."
      />
    </div>
  );
}

export function PhotoCount({ periodId, workItemIds }: { periodId: string; workItemIds: string[] }) {
  const { photosFor } = usePhotoStash();
  const total =
    photosFor(reportKey(periodId)).length +
    workItemIds.reduce((acc, id) => acc + photosFor(inspectionKey(id, periodId)).length, 0);

  if (total === 0) return null;
  return <span className="text-xs text-muted-foreground">{total} foto terlampir</span>;
}

/**
 * The printed plates.
 *
 * Each photograph is kept whole on one sheet; a plate split across a page
 * break is worse than a smaller plate. Inspection photographs are grouped
 * under the work item they belong to, so the reader can tie a picture to a row
 * in the table above it.
 */
export function ReportPhotoPlates({
  periodId,
  workItems,
}: {
  periodId: string;
  workItems: { id: string; code: string; name: string }[];
}) {
  const { photosFor } = usePhotoStash();

  const general = photosFor(reportKey(periodId));
  const perItem = workItems
    .map((item) => ({ item, photos: photosFor(inspectionKey(item.id, periodId)) }))
    .filter((group) => group.photos.length > 0);

  if (general.length === 0 && perItem.length === 0) {
    return (
      <p data-print="hide" className="text-sm text-muted-foreground">
        Belum ada foto terlampir. Tambahkan lewat kotak di atas, atau lewat dialog Checklist mutu
        pada halaman Input Progres.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {general.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Dokumentasi umum</h3>
          <PlateGrid photos={general} fallbackCaption="Dokumentasi lapangan" />
        </section>
      ) : null}

      {perItem.map(({ item, photos }) => (
        <section key={item.id} className="space-y-2">
          <h3 className="text-sm font-semibold">
            <span className="font-mono text-xs text-muted-foreground">{item.code}</span> {item.name}
          </h3>
          {/*
            Untitled inspection photographs are captioned with the work item
            they were taken against. A file name like IMG_20260816_112233.jpg
            tells the reader of a printed report nothing at all.
          */}
          <PlateGrid photos={photos} fallbackCaption={`${item.code} — ${item.name}`} />
        </section>
      ))}
    </div>
  );
}

function PlateGrid({
  photos,
  fallbackCaption,
}: {
  photos: { id: string; name: string; url: string; caption: string }[];
  /** Used when the user typed no caption of their own. */
  fallbackCaption: string;
}) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {photos.map((photo, index) => {
        const title = photo.caption.trim() || fallbackCaption;
        // Numbered only when there are several, so a lone photograph is not
        // captioned "… (1 dari 1)".
        const label = photos.length > 1 ? `${title} (${index + 1}/${photos.length})` : title;

        return (
          <li key={photo.id} data-print="keep-together" className="space-y-1">
            <div className="overflow-hidden rounded-md border bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo.url} alt={label} className="aspect-[4/3] w-full object-cover" />
            </div>
            <p className="text-xs text-muted-foreground">{label}</p>
          </li>
        );
      })}
    </ul>
  );
}
