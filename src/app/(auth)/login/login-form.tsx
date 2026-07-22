'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { AlertCircle, Clock, Loader2, LogIn } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const LoginSchema = z.object({
  email: z.email('Masukkan alamat email yang valid.'),
  password: z.string().min(1, 'Masukkan kata sandi Anda.'),
});

type LoginValues = z.infer<typeof LoginSchema>;

interface ApiError {
  message: string;
  code: string | undefined;
}

/**
 * Sign-in form.
 *
 * The activation gate gets its own presentation rather than being folded into
 * the generic error state: "menunggu persetujuan" is a status to wait on, not a
 * mistake to correct, and showing it in red next to the password field would
 * send people to re-type a credential that was already accepted.
 */
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  async function onSubmit(values: LoginValues) {
    setError(null);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      const payload = (await response.json()) as {
        success: boolean;
        message: string;
        meta?: { code?: string };
      };

      if (!payload.success) {
        setError({ message: payload.message, code: payload.meta?.code });
        return;
      }

      // refresh() re-runs the server components so the shell renders with the
      // new session already resolved.
      router.replace('/dashboard');
      router.refresh();
    } catch {
      setError({
        message: 'Tidak dapat menghubungi server. Periksa koneksi Anda.',
        code: 'NETWORK',
      });
    }
  }

  const isPending = error?.code === 'ACCOUNT_PENDING';
  const isNoSites = error?.code === 'ACCOUNT_NO_SITES';

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5" noValidate>
      {error && (isPending || isNoSites) && (
        <Alert>
          <Clock className="size-4" />
          <AlertTitle>{isPending ? 'Menunggu aktivasi' : 'Belum ada site'}</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      {error && !isPending && !isNoSites && (
        <Alert variant="destructive">
          <AlertCircle className="size-4" />
          <AlertTitle>Gagal masuk</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          placeholder="nama@perusahaan.com"
          autoFocus
          aria-invalid={errors.email ? true : undefined}
          {...register('email')}
        />
        {errors.email && (
          <p className="text-destructive text-sm">{errors.email.message}</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Kata sandi</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          aria-invalid={errors.password ? true : undefined}
          {...register('password')}
        />
        {errors.password && (
          <p className="text-destructive text-sm">{errors.password.message}</p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={isSubmitting}>
        {isSubmitting ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Memverifikasi…
          </>
        ) : (
          <>
            <LogIn className="size-4" />
            Masuk
          </>
        )}
      </Button>

      <p className="text-muted-foreground text-center text-xs leading-relaxed">
        Kredensial diverifikasi oleh Account Center.
        <br />
        Akun baru memerlukan persetujuan administrator sebelum dapat digunakan.
      </p>
    </form>
  );
}
