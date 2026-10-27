// ads.txt, built from the same PUBLIC_ADSENSE_CLIENT the pages use, so the two can't disagree.
// f08c47fec0942fa0 is Google's fixed certification authority id (https://support.google.com/adsense/answer/12171612).

/** the ads.txt body for an AdSense client id ("ca-pub-123…"); comments only while the id is unknown or malformed */
export function adsTxt(client: string): string {
  const head = '# Authorized sellers for roundertools.com (https://iabtechlab.com/ads-txt/)\n';
  const pub = /^ca-(pub-\d{10,20})$/.exec(client.trim())?.[1];
  if (!pub) return `${head}# No sellers yet: set PUBLIC_ADSENSE_CLIENT (ca-pub-…) and rebuild to add Google's line.\n`;
  return `${head}google.com, ${pub}, DIRECT, f08c47fec0942fa0\n`;
}
