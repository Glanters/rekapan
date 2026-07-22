'use client';

import { Loader2, LogOut, ShieldAlert } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Full-screen notice shown when the caller's address is off the IP allowlist.
 *
 * The one action offered is sign-out, which reaches an `ipExempt` route, so a
 * user stranded by a newly-tightened list is never trapped on this screen.
 */
export function IpBlockedNotice({ ip }: { ip: string }) {
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 p-6 text-center">
      <div className="bg-destructive/10 text-destructive flex size-14 items-center justify-center rounded-full">
        <ShieldAlert className="size-7" />
      </div>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold tracking-tight">Akses ditolak</h1>
        <p className="text-muted-foreground max-w-md text-sm">
          Alamat IP Anda tidak termasuk dalam daftar yang diizinkan untuk mengakses
          aplikasi ini. Hubungi administrator bila menurut Anda ini keliru.
        </p>
        <p className="text-muted-foreground text-xs">
          IP Anda: <span className="font-mono">{ip}</span>
        </p>
      </div>
      <Button variant="outline" onClick={signOut} disabled={signingOut}>
        {signingOut ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <LogOut className="size-4" />
        )}
        Keluar
      </Button>
    </div>
  );
}
