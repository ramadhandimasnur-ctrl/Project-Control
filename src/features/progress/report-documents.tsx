'use client';

import { DocumentUploader, type StoredDocument } from './document-uploader';

/**
 * The photograph half of a report, reading from storage instead of the tab.
 *
 * Inspection photographs group under the work item they were taken against,
 * and the report's own documentation sits in its own section. Grouping is by
 * work item id — matching on name would file a photograph under the wrong item
 * as soon as two share a name, which on a printed report is a false claim.
 *
 * Per-item photographs are shown here but not managed here. They are attached
 * while the work is being inspected, from Input Progres → Mutu, which is the
 * moment somebody is standing in front of the work with a camera. Offering a
 * second way in from the report meant every item without a photograph printed
 * an empty upload box, and the same photograph could be attached from two
 * places that each looked like the right one. The report's own documentation
 * is different — it belongs to the report rather than to any one item, so it
 * is uploaded where it belongs.
 */
export function ReportDocuments({
  projectId,
  periodId,
  documents,
  workItems,
  canEdit,
}: {
  projectId: string;
  periodId: string;
  documents: StoredDocument[];
  workItems: { id: string; code: string; name: string }[];
  canEdit: boolean;
}) {
  const general = documents.filter((doc) => doc.workItemId === null);

  const perItem = workItems
    .map((item) => ({
      item,
      photos: documents.filter((doc) => doc.workItemId === item.id),
    }))
    // Only items that actually have a photograph. Nothing can be added from
    // here, so an empty group would be a heading over nothing.
    .filter((group) => group.photos.length > 0);

  return (
    <div className="space-y-6">
      <DocumentUploader
        projectId={projectId}
        periodId={periodId}
        workItemId={null}
        documents={general}
        canEdit={canEdit}
        label="Dokumentasi umum"
        hint="Foto yang tidak terikat pada satu pekerjaan tertentu. Tersimpan permanen di server."
      />

      {perItem.map(({ item, photos }) => (
        <div key={item.id} className="space-y-2">
          <h3 className="text-sm font-semibold">
            <span className="font-mono text-xs text-muted-foreground">{item.code}</span> {item.name}
          </h3>
          <DocumentUploader
            projectId={projectId}
            periodId={periodId}
            workItemId={item.id}
            documents={photos.map((photo) => ({
              ...photo,
              // Untitled photographs are captioned with the work item they were
              // taken against; a file name tells a printed report nothing.
              caption: photo.caption ?? `${item.code} — ${item.name}`,
            }))}
            canEdit={false}
            label={`Foto ${item.code}`}
          />
        </div>
      ))}

      {/*
        Said once, to the only person who can act on it, and only when there is
        nothing to show — a report full of photographs does not need telling
        where they came from.
      */}
      {perItem.length === 0 && canEdit ? (
        <p className="text-sm text-muted-foreground">
          Foto per pekerjaan diambil dari Input Progres → Mutu. Belum ada yang terlampir untuk
          periode ini.
        </p>
      ) : null}

      {general.length === 0 && documents.length === 0 && !canEdit ? (
        <p className="text-sm text-muted-foreground">Belum ada foto terlampir.</p>
      ) : null}
    </div>
  );
}
