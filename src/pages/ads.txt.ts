import type { APIRoute } from 'astro';
import { SITE } from '@/site';
import { adsTxt } from '@/seo/ads';

export const GET: APIRoute = () => new Response(adsTxt(SITE.adsenseClient), { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
