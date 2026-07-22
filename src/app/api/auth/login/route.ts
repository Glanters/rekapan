import { z } from 'zod';

import { login } from '@/server/auth/login';
import { ok } from '@/server/http/envelope';
import { route } from '@/server/http/handler';
import { RATE_LIMITS } from '@/server/http/rate-limit';

const LoginSchema = z.object({
  email: z.email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

/**
 * POST /api/auth/login
 *
 * Verifies the credential at Account Center, then applies this application's
 * activation gate. A first-time authenticator is recorded as PENDING and
 * refused — see `src/server/auth/login.ts`.
 *
 * The rate limit is keyed on the client address rather than the submitted
 * email. Keying on email would let anyone lock a known account out by
 * submitting bad passwords for it; the address bucket costs an attacker their
 * own throughput instead of their target's access.
 */
export const POST = route({
  auth: false,
  bodySchema: LoginSchema,
  rateLimit: {
    ...RATE_LIMITS.login,
    key: (_request, ip) => `login:${ip}`,
  },
  handler: async ({ body, ip, userAgent }) => {
    const result = await login({
      email: body.email,
      password: body.password,
      request: { ip, userAgent },
    });

    return ok(result, { message: 'Signed in.' });
  },
});
