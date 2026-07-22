import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';

import { Providers } from '@/components/providers';

import './globals.css';

// Exposed as --font-sans, which is the name globals.css resolves --color-* and
// --font-heading against. Publishing it as --font-geist-sans instead leaves
// --font-sans undefined and the whole app silently falls back to serif.
const geistSans = Geist({
  variable: '--font-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: 'Monthly & Turnover',
    template: '%s · Monthly & Turnover',
  },
  description: 'Enterprise Monthly & Turnover Management System',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: next-themes sets the class on <html> before
    // React hydrates, so server and client markup differ by design.
    <html lang="id" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
