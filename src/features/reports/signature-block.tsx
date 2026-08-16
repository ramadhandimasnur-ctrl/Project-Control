import {
  SIGNATORY_SLOTS,
  SIGNATORY_SLOT_LABELS,
  type SignatorySlot,
} from '@/lib/reports/signatories';

export type SignatoryView = {
  slot: SignatorySlot;
  name: string;
  position: string;
  signatureUrl: string | null;
};

/**
 * The three columns at the foot of a printed report.
 *
 * The signature image is optional and the layout does not change when it is
 * absent — the space above the line is reserved either way, so a sheet printed
 * for wet signatures has a clean box and one printed with images has the image
 * sitting in exactly the same place. A block that collapsed when unsigned
 * would give two versions of the same document different page breaks.
 *
 * Name and position always print. An unfilled slot still shows its heading and
 * an empty line, because a report handed over with a missing column looks like
 * a mistake rather than a document awaiting a signature.
 */
export function SignatureBlock({ signatories }: { signatories: SignatoryView[] }) {
  const bySlot = new Map(signatories.map((row) => [row.slot, row]));

  return (
    <section data-print="keep-together" className="grid gap-8 pt-8 sm:grid-cols-3">
      {SIGNATORY_SLOTS.map((slot) => {
        const row = bySlot.get(slot);
        const name = row?.name?.trim() ?? '';
        const position = row?.position?.trim() ?? '';

        return (
          <div key={slot} className="text-center text-sm">
            <p>{SIGNATORY_SLOT_LABELS[slot]}</p>

            {/*
              Fixed height whether or not an image lands in it. This is what
              keeps the signed and unsigned versions of the same report on the
              same page.
            */}
            <div className="flex h-20 items-end justify-center">
              {row?.signatureUrl ? (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={row.signatureUrl}
                  alt={`Tanda tangan ${name || SIGNATORY_SLOT_LABELS[slot]}`}
                  className="max-h-20 max-w-full object-contain"
                />
              ) : null}
            </div>

            <p className="border-t pt-1 font-medium">
              {name === '' ? <span className="text-muted-foreground">(&nbsp;&nbsp;&nbsp;&nbsp;)</span> : name}
            </p>
            {position === '' ? null : (
              <p className="text-xs text-muted-foreground">{position}</p>
            )}
          </div>
        );
      })}
    </section>
  );
}
