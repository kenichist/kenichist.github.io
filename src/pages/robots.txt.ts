import type { APIRoute } from 'astro';
import { content } from '../lib/site-content';
import { site } from '../content/site';

export const GET: APIRoute = () => {
  const lines = content.demo
    ? ['User-agent: *', 'Disallow: /']
    : ['User-agent: *', 'Allow: /', ...(site.siteUrl ? [`Sitemap: ${site.siteUrl.replace(/\/+$/, '')}/sitemap.xml`] : [])];
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
