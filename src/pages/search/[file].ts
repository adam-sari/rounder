import type { APIRoute, GetStaticPaths } from 'astro';
import { searchAssets } from '@/search/build';

// The search box's lean index and tool vectors, content-hashed (immutable cache, see public/_headers).
// /search-index.json stays as it is: the ratings Worker reads it to check slugs.
export const getStaticPaths: GetStaticPaths = () => [...searchAssets().files.keys()].map((file) => ({ params: { file } }));

export const GET: APIRoute = ({ params }) => {
  const f = searchAssets().files.get(params.file!)!;
  return new Response(f.body as BodyInit, { headers: { 'Content-Type': f.type } });
};
