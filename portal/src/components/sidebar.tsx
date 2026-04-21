'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  MessageSquare,
  BarChart3,
  AlertTriangle,
  Users,
} from 'lucide-react';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/dashboard/conversations', label: 'Conversations', icon: MessageSquare },
  { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
  { href: '/dashboard/alerts', label: 'Alerts', icon: AlertTriangle },
  { href: '/dashboard/clients', label: 'Clients', icon: Users, ownerOnly: true },
];

export function Sidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { auth } = useAuth();
  const keyParam = searchParams.get('key');

  return (
    <aside className="flex h-full w-56 flex-col border-r bg-sidebar text-sidebar-foreground">
      <div className="flex h-14 items-center border-b px-4">
        <span className="text-lg font-semibold tracking-tight">Dashboard</span>
      </div>
      <nav className="flex-1 space-y-1 p-2">
        {navItems.map(item => {
          if (item.ownerOnly && auth?.role !== 'owner') return null;
          const isActive = pathname === item.href;
          const href = keyParam ? `${item.href}?key=${keyParam}` : item.href;
          return (
            <Link
              key={item.href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      {auth && (
        <div className="border-t p-4 text-xs text-muted-foreground">
          {auth.role === 'owner' ? 'Owner' : auth.clientName || 'Client'}
        </div>
      )}
    </aside>
  );
}
