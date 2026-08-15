import { HardHat } from 'lucide-react';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted/30 px-4 py-12">
      <div className="mb-8 flex items-center gap-2">
        <div className="flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground">
          <HardHat className="size-5" aria-hidden />
        </div>
        <span className="text-lg font-semibold tracking-tight">Project Control</span>
      </div>
      {children}
      <p className="mt-8 max-w-sm text-center text-xs text-muted-foreground">
        Pengendalian biaya, jadwal, material, dan kas untuk proyek konstruksi.
      </p>
    </div>
  );
}
