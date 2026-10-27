// Checks a production build for ad code where it must never be: the privacy page (Google's consent message links
// to it), the legal, about and trust pages, 404, offline, and the ad-free tools listed in src/site.ts.
// Usage: node scripts/seo/check-ads.mjs [distDir] [--expect-ads]
//   --expect-ads: also require the AdSense account tag on the home page (for a build with PUBLIC_ADSENSE_CLIENT set)
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const dist = args.find((a) => !a.startsWith('--')) ?? 'dist';
const markers = /adsbygoogle|google-adsense-account|fundingchoicesmessages|class="ad /;

const adFree = [...readFileSync('src/site.ts', 'utf8').match(/adFree:\s*\[([^\]]*)\]/)?.[1].matchAll(/'([^']+)'/g) ?? []].map((m) => m[1]);
const pages = ['privacy', 'terms', 'credits', 'about', 'security', 'contact', 'press', 'why-free', '404', 'offline', ...adFree];

const bad = pages.filter((p) => existsSync(join(dist, `${p}.html`)) && markers.test(readFileSync(join(dist, `${p}.html`), 'utf8')));
const checked = pages.filter((p) => existsSync(join(dist, `${p}.html`)));
if (args.includes('--expect-ads') && !/google-adsense-account/.test(readFileSync(join(dist, 'index.html'), 'utf8'))) {
  bad.push('index (expected the AdSense account tag)');
}

console.log(`check-ads: ${checked.length} ad-free pages checked (${adFree.length} tools)`);
if (bad.length) {
  console.error(`✗ ad code found on: ${bad.join(', ')}`);
  process.exit(1);
}
console.log('✓ no ad code on ad-free pages');
