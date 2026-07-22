import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Packages Next.js must require at runtime instead of bundling.
   *
   * All three are CommonJS libraries that resolve files or native bindings
   * relative to their own location on disk. Bundling rewrites those paths, and
   * the failure does not surface at compile time: the build reports "Compiled
   * successfully" and then dies during "Collecting page data" with
   * `Cannot find module for page: /api/monthly/template` — naming the route
   * rather than the dependency that actually broke, which sends you looking in
   * the wrong file entirely.
   *
   *   exceljs  — CJS; pulls in its own file and stream helpers
   *   archiver — CJS; looks up its format plugins at require time
   *   sharp    — native binding loaded from its own package directory
   */
  serverExternalPackages: ['exceljs', 'archiver', 'sharp'],
};

export default nextConfig;
