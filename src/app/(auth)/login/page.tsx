import { BarChart3 } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { resolveSession } from '@/server/auth/session';

import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Masuk' };

export default async function LoginPage() {
  // An already-signed-in visitor landing here is sent on rather than shown a
  // form that would only redirect them a moment later.
  const access = await resolveSession();
  if (access) redirect('/dashboard');

  return (
    <div className="bg-muted/30 relative flex min-h-svh items-center justify-center overflow-hidden p-4">
      {/* Ambient wash — kept very low contrast so it reads as depth, not decoration. */}
      <div
        aria-hidden
        className="from-primary/8 pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full bg-gradient-to-b to-transparent blur-3xl"
      />

      <div className="relative w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <div className="bg-primary text-primary-foreground flex size-11 items-center justify-center rounded-xl shadow-sm">
            <BarChart3 className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Monthly &amp; Turnover
            </h1>
            <p className="text-muted-foreground text-sm">Sistem Manajemen Laporan</p>
          </div>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle>Masuk ke akun Anda</CardTitle>
            <CardDescription>Gunakan kredensial Account Center Anda.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
