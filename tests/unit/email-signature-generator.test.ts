import { describe, expect, it } from 'vitest';
import { TEMPLATES, blankSignature, esc, imageSrc, parseSignature, signatureHtml, signaturePlain, socialUrl, telHref, textOn, webUrl, type Signature } from '@/tools/lib/email-signature/render';

const jane = (): Signature => ({
  ...blankSignature(),
  name: 'Jane Doe',
  title: 'Design Lead',
  company: 'Acme & Co',
  phone: '+1 (555) 010-2000',
  email: 'jane@acme.test',
  website: 'acme.test',
  address: '1 Main St\nSpringfield',
  image: 'https://acme.test/jane.jpg',
  socials: { ...blankSignature().socials, linkedin: 'janedoe', x: '@jane' },
});

describe('links', () => {
  it('normalizes web addresses and refuses other schemes', () => {
    expect(webUrl('acme.test/about')).toBe('https://acme.test/about');
    expect(webUrl('http://acme.test')).toBe('http://acme.test/');
    expect(webUrl('javascript:alert(1)')).toBe('');
    expect(webUrl('localhost')).toBe('');
    expect(webUrl('')).toBe('');
  });

  it('turns handles into profile links', () => {
    expect(socialUrl('linkedin', 'janedoe')).toBe('https://www.linkedin.com/in/janedoe');
    expect(socialUrl('x', '@jane')).toBe('https://x.com/jane');
    expect(socialUrl('youtube', 'acme')).toBe('https://www.youtube.com/@acme');
    expect(socialUrl('github', 'github.com/jane')).toBe('https://github.com/jane');
  });

  it('builds tel links and accepts only loadable images', () => {
    expect(telHref('+1 (555) 010-2000')).toBe('tel:+15550102000');
    expect(telHref('n/a')).toBe('');
    expect(imageSrc('https://a.test/p.png')).toBe('https://a.test/p.png');
    expect(imageSrc('data:image/png;base64,AAAA')).toBe('data:image/png;base64,AAAA');
    expect(imageSrc('data:text/html;base64,AAAA')).toBe('');
    expect(imageSrc('C:\\photos\\me.jpg')).toBe('');
  });
});

describe('signatureHtml', () => {
  it('renders every template as inline-styled tables with the details', () => {
    for (const { id } of TEMPLATES) {
      const html = signatureHtml({ ...jane(), template: id });
      expect(html.startsWith('<table')).toBe(true);
      expect(html).not.toMatch(/<style|class=/);
      expect(html).toContain('Jane Doe');
      expect(html).toContain('href="mailto:jane@acme.test"');
      expect(html).toContain('href="https://acme.test/"');
      expect(html).toContain('https://www.linkedin.com/in/janedoe');
    }
  });

  it('escapes what people type', () => {
    const html = signatureHtml({ ...jane(), name: '<img src=x onerror=alert(1)>', template: 'classic' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('Acme &amp; Co');
    expect(signatureHtml({ ...jane(), title: 'R&D', template: 'bold' })).toContain('R&amp;D');
  });

  it('sizes the image by its proportions and keeps round frames for square images', () => {
    const square = signatureHtml({ ...jane(), template: 'photo', imageSize: 80 });
    expect(square).toContain('width="80" height="80"');
    expect(square).toContain('border-radius:50%');
    const wide = signatureHtml({ ...jane(), template: 'photo', imageSize: 80, imageRatio: 0.5 });
    expect(wide).toContain('width="80" height="40"');
    expect(wide).not.toContain('border-radius:50%');
  });

  it('leaves out an invalid email and an unloadable image', () => {
    const html = signatureHtml({ ...jane(), email: 'not-an-email', image: 'file:///me.jpg' });
    expect(html).not.toContain('mailto:');
    expect(html).not.toContain('<img');
  });
});

describe('helpers', () => {
  it('escapes all HTML-significant characters', () => {
    expect(esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('picks readable badge text', () => {
    expect(textOn('#1f6feb')).toBe('#ffffff');
    expect(textOn('#ffd25e')).toBe('#1a1a1a');
  });

  it('writes a plain-text version', () => {
    expect(signaturePlain(jane())).toBe('Jane Doe\nDesign Lead, Acme & Co\nP +1 (555) 010-2000\njane@acme.test\nacme.test\n1 Main St\nSpringfield\nhttps://www.linkedin.com/in/janedoe\nhttps://x.com/jane');
  });

  it('restores saved fields and ignores junk', () => {
    expect(parseSignature('nope')).toBeNull();
    const s = parseSignature(JSON.stringify({ name: 'A', template: 'weird', color: 'red', font: 'comic', socials: { x: 'a' } }))!;
    expect(s.name).toBe('A');
    expect(s.template).toBe('photo');
    expect(s.color).toBe('#1f6feb');
    expect(s.font).toBe('arial');
    expect(s.socials.x).toBe('a');
    expect(s.socials.github).toBe('');
  });
});
