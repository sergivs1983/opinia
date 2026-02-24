'use client';

import Logo from '@/components/ui/Logo';
import { useRouter } from 'next/navigation';

export default function LegalShell({
  title,
  lastUpdated,
  children,
}: {
  title: string;
  lastUpdated: string;
  children: React.ReactNode;
}) {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-surface-100 px-6 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <button onClick={() => router.push('/')} className="hover:opacity-80">
            <Logo size="sm" />
          </button>
          <nav className="flex gap-4 text-xs text-surface-400">
            <a href="/terms" className="hover:text-surface-700">Termes</a>
            <a href="/privacy" className="hover:text-surface-700">Privacitat</a>
            <a href="/security" className="hover:text-surface-700">Seguretat</a>
            <a href="/support" className="hover:text-surface-700">Suport</a>
          </nav>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="font-display text-3xl font-bold text-surface-900 mb-2">{title}</h1>
        <p className="text-sm text-surface-400 mb-10">Última actualització: {lastUpdated}</p>
        <div className="prose prose-sm prose-surface max-w-none text-surface-700 leading-relaxed space-y-6">
          {children}
        </div>
      </main>

      <footer className="border-t border-surface-100 py-6 text-center text-xs text-surface-400">
        © 2026 OpinIA — Tots els drets reservats
      </footer>
    </div>
  );
}
