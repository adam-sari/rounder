import type { APIRoute } from 'astro';
import { tools } from '@/tools/registry';
import { categoryById } from '@/tools/categories';

// The ⌘K palette's index, fetched once when it first opens instead of being embedded in every page
export const GET: APIRoute = () =>
  new Response(
    JSON.stringify(
      tools.map((t) => ({
        slug: t.slug,
        name: t.name,
        tagline: t.tagline,
        category: categoryById[t.category].name,
        kind: t.category,
        keywords: t.keywords.join(' '),
      })),
    ),
    { headers: { 'Content-Type': 'application/json' } },
  );
