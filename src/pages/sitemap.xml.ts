import type { APIRoute } from 'astro';
import { content } from '../lib/site-content';
import { sitemapUrls } from '../lib/content';
import { site } from '../content/site';

/** Lists only published routes; empty in demo mode or before SITE_URL is set. */
export const GET: APIRoute = () => {
  const urls = sitemapUrls(content, site.siteUrl);
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
};
