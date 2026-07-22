'use client';

import {
  BarChart3,
  Check,
  ChevronsUpDown,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

import { isActive, visibleSections } from './nav';

export interface ShellSite {
  id: string;
  code: string;
  name: string;
}

export interface ShellUser {
  id: string;
  email: string;
  name: string;
  role: string | null;
  isRoot: boolean;
}

interface AppShellProps {
  user: ShellUser;
  permissions: string[];
  sites: ShellSite[];
  children: React.ReactNode;
}

export function AppShell({ user, permissions, sites, children }: AppShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const sections = visibleSections(new Set(permissions));

  // Close the mobile drawer on navigation; leaving it open over the new page is
  // a common and irritating oversight.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="bg-muted/20 flex min-h-svh">
      {/* Desktop sidebar */}
      {/* Pinned to the viewport, not carried along by the page scroll.
          `h-svh` bounds it to exactly one screen so the nav's own ScrollArea
          takes over when the menu is taller than the window — without a fixed
          height, sticky has nothing to hold the element against and the bottom
          of the list becomes unreachable. */}
      <aside
        className={cn(
          'bg-background sticky top-0 hidden h-svh shrink-0 border-r transition-[width] duration-200 md:flex md:flex-col',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <SidebarContent sections={sections} pathname={pathname} collapsed={collapsed} />
        <div className="border-t p-2">
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-center"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Perluas sidebar' : 'Ciutkan sidebar'}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-4" />
            ) : (
              <>
                <PanelLeftClose className="size-4" />
                <span>Ciutkan</span>
              </>
            )}
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="bg-background/80 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="md:hidden"
                  aria-label="Menu"
                />
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="left" className="w-64 p-0">
              <SheetTitle className="sr-only">Navigasi</SheetTitle>
              <SidebarContent
                sections={sections}
                pathname={pathname}
                collapsed={false}
              />
            </SheetContent>
          </Sheet>

          <SiteSwitcher sites={sites} isRoot={user.isRoot} />

          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <UserMenu user={user} />
          </div>
        </header>

        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

function SidebarContent({
  sections,
  pathname,
  collapsed,
}: {
  sections: ReturnType<typeof visibleSections>;
  pathname: string;
  collapsed: boolean;
}) {
  return (
    <>
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
          <BarChart3 className="size-4" />
        </div>
        {!collapsed && (
          <span className="truncate text-sm font-semibold tracking-tight">
            Monthly &amp; Turnover
          </span>
        )}
      </div>

      <ScrollArea className="flex-1">
        <nav className="space-y-4 p-2">
          {sections.map((section, index) => (
            <div key={section.label ?? `section-${index}`} className="space-y-1">
              {section.label && !collapsed && (
                <p className="text-muted-foreground px-3 pt-2 text-[11px] font-medium tracking-wider uppercase">
                  {section.label}
                </p>
              )}
              {section.items.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
                      collapsed && 'justify-center px-0',
                      active
                        ? 'bg-primary/10 text-primary font-medium'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    <item.icon className="size-4 shrink-0" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </ScrollArea>
    </>
  );
}

function SiteSwitcher({ sites, isRoot }: { sites: ShellSite[]; isRoot: boolean }) {
  const [selected, setSelected] = useState<string | null>(null);

  if (sites.length === 0) {
    return (
      <Badge variant="outline" className="text-muted-foreground gap-1.5 font-normal">
        Belum ada site
      </Badge>
    );
  }

  const current = sites.find((s) => s.id === selected);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="sm" className="gap-2 font-normal" />}
      >
        <span className="truncate">
          {current ? current.name : isRoot ? 'Semua site' : 'Semua site saya'}
        </span>
        <ChevronsUpDown className="text-muted-foreground size-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">
          {isRoot
            ? `${sites.length} site (akses penuh)`
            : `${sites.length} site ditugaskan`}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setSelected(null)}>
          <Check className={cn('size-4', selected !== null && 'invisible')} />
          {isRoot ? 'Semua site' : 'Semua site saya'}
        </DropdownMenuItem>
        {sites.map((site) => (
          <DropdownMenuItem key={site.id} onClick={() => setSelected(site.id)}>
            <Check className={cn('size-4', selected !== site.id && 'invisible')} />
            <span className="truncate">{site.name}</span>
            <span className="text-muted-foreground ml-auto text-xs">{site.code}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The active theme is unknown until the client reads it, so render a stable
  // placeholder rather than a wrong icon that flips after hydration.
  useEffect(() => setMounted(true), []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon" aria-label="Ubah tema" />}
      >
        {!mounted ? (
          <Monitor className="size-4" />
        ) : theme === 'dark' ? (
          <Moon className="size-4" />
        ) : theme === 'light' ? (
          <Sun className="size-4" />
        ) : (
          <Monitor className="size-4" />
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme('light')}>
          <Sun className="size-4" /> Terang
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('dark')}>
          <Moon className="size-4" /> Gelap
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme('system')}>
          <Monitor className="size-4" /> Sistem
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  const initials = user.name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.replace('/login');
      router.refresh();
    } catch {
      toast.error('Gagal keluar. Coba lagi.');
      setSigningOut(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full"
            aria-label="Akun"
          />
        }
      >
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initials || '?'}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col gap-1">
            <span className="truncate text-sm font-medium">{user.name}</span>
            <span className="text-muted-foreground truncate text-xs">{user.email}</span>
          </div>
        </DropdownMenuLabel>
        <Separator className="my-1" />
        <div className="px-2 py-1.5">
          <Badge variant="secondary" className="font-normal">
            {user.role ?? 'Tanpa role'}
          </Badge>
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={signOut} disabled={signingOut} variant="destructive">
          <LogOut className="size-4" />
          {signingOut ? 'Keluar…' : 'Keluar'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
