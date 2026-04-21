'use client';

import { Suspense } from 'react';
import { AuthProvider, useAuth } from '@/lib/auth';
import { Sidebar } from '@/components/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';

function DashboardShell({ children }: { children: React.ReactNode }) {
  const { auth, loading, error } = useAuth();

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  if (error || !auth) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-destructive">{error || 'Unauthorized'}</p>
          <p className="mt-2 text-sm text-muted-foreground">Check your dashboard URL and key.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Suspense>
        <Sidebar />
      </Suspense>
      <div className="flex flex-1 flex-col overflow-hidden">
        <header className="flex h-14 items-center justify-end border-b px-6">
          <ThemeToggle />
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense>
      <AuthProvider>
        <DashboardShell>{children}</DashboardShell>
      </AuthProvider>
    </Suspense>
  );
}
