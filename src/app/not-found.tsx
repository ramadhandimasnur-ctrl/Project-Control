import { FileQuestion } from 'lucide-react';

import { EmptyState } from '@/components/empty-state';
import { ButtonLink } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <EmptyState
        icon={FileQuestion}
        title="Halaman tidak ditemukan"
        description="Alamat yang Anda buka tidak ada, atau Anda tidak memiliki akses ke data tersebut."
        action={
          <ButtonLink href="/projects">Kembali ke daftar proyek</ButtonLink>
        }
      />
    </div>
  );
}
