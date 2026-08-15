import { FileQuestion } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/empty-state';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <div className="mx-auto w-full max-w-2xl p-6">
      <EmptyState
        icon={FileQuestion}
        title="Halaman tidak ditemukan"
        description="Alamat yang Anda buka tidak ada, atau Anda tidak memiliki akses ke data tersebut."
        action={
          <Button render={<Link href="/projects" />}>Kembali ke daftar proyek</Button>
        }
      />
    </div>
  );
}
