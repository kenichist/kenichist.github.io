// @ts-check
import { defineConfig } from 'astro/config';

export default defineConfig({
  // Set SITE_URL (or src/content/site.ts) once a domain exists; used for canonical sitemap URLs.
  site: process.env.SITE_URL || undefined,
  output: 'static',
  trailingSlash: 'ignore',
  devToolbar: { enabled: false },
  build: { format: 'directory' },
});
