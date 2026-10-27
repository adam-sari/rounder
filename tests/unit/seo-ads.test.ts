import { describe, expect, it } from 'vitest';
import { adsTxt } from '@/seo/ads';

describe('ads.txt', () => {
  it("authorizes Google with the publisher id from the AdSense client id", () => {
    expect(adsTxt('ca-pub-1234567890123456')).toContain('\ngoogle.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
  });

  it('has no seller lines while the id is empty or malformed', () => {
    for (const client of ['', 'pub-1234567890123456', 'ca-pub-12', 'ca-pub-123456789012345x']) {
      expect(adsTxt(client).split('\n').filter((l) => l && !l.startsWith('#'))).toEqual([]);
    }
  });
});
