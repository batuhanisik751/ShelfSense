import { Nav } from '@/components/common/Nav';
import { Toaster } from '@/components/ui/sonner';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <Nav />
      <main className="mx-auto w-full max-w-5xl px-6 py-8">{children}</main>
      <Toaster />
    </div>
  );
}
