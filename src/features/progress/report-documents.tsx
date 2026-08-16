'use client';

import { DocumentUploader, type StoredDocument } from './document-uploader';

/**
 * The photograph half of a report, reading from storage instead of the tab.
 *
 * Inspection photographs group under the work item they were taken against,
 * and the report's own documentation sits in its own section. Grouping is by
 * work item id — matching on name would file a photograph under the wrong item
 * as soon as two share a name, which on a printed report is a false claim.
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
    .filter((group) => group.photos.length > 0 || canEdit);

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
            canEdit={canEdit}
            label={`Foto ${item.code}`}
          />
        </div>
      ))}

      {general.length === 0 && documents.length === 0 && !canEdit ? (
        <p className="text-sm text-muted-foreground">Belum ada foto terlampir.</p>
      ) : null}
    </div>
  );
}
