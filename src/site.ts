/**
 * Site-wide facts in one place. Empty values are unknowns the owner fills in later; every page that uses them
 * must still read well while they are empty.
 */
export const SITE = {
  name: 'Rounder',
  /** the off-site brand; the on-site wordmark stays "rounder" */
  alternateName: 'Rounder Tools',
  /** the public name shown on /about and in Organization JSON-LD */
  owner: { name: 'Adam Sari' },
  email: 'hello@roundertools.com',
  /** ca-pub-… from AdSense (.env.production); it also fills /ads.txt. Self-hosters leave it unset for no ads */
  adsenseClient: (import.meta.env.PUBLIC_ADSENSE_CLIENT ?? '') as string,
  /** ad slots render only once AdSense has approved the site */
  adsLive: import.meta.env.PUBLIC_ADS_LIVE === 'true',
  // TODO(owner): one AdSense ad unit id per slot, so earnings can be compared by placement. A slot without an id stays off.
  adSlots: {
    /** in the page, after "How it works" (tool pages) or between sections (home, category pages) */
    content: (import.meta.env.PUBLIC_AD_SLOT_CONTENT ?? '') as string,
    /** 300×600 rail beside the text below the tool, on wide screens only */
    rail: (import.meta.env.PUBLIC_AD_SLOT_RAIL ?? '') as string,
  },
  /** the owner's donation page, Ko-fi paying into PayPal (.env.production). Unset, every support link stays hidden */
  donate: (import.meta.env.PUBLIC_DONATE_URL ?? '') as string,
  github: 'https://github.com/adam-sari/rounder',
  // TODO(owner): public profile URLs (Mastodon, X, Product Hunt…), used as Organization sameAs
  sameAs: [] as string[],
  /** tools that never load ad or consent scripts (passwords, keys, protected documents). `noAds` in the tool defs is
   *  what pages use; this copy is what scripts/seo/check-ads.mjs checks the build against, so keep the two in step */
  adFree: ['file-encryptor', 'redact-pdf', 'protect-pdf', 'unlock-pdf', 'password-generator', 'password-strength-checker', 'jwt-decoder'],
};

/** an ad slot shows only once ads are live and the slot has its own unit id */
export const adSlotLive = (kind: keyof typeof SITE.adSlots) => SITE.adsLive && !!SITE.adsenseClient && !!SITE.adSlots[kind];

/** the desktop rail needs this much width beside the text column; keep in step with min-[1280px] in [slug].astro */
export const RAIL_MEDIA = '(min-width: 1280px)';
