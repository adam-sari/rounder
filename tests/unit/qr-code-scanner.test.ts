import { describe, expect, it } from 'vitest';
import { icsDate, parseContent, toVcard } from '@/tools/lib/qr-code-scanner/parse';
import { toCsv } from '@/tools/lib/qr-code-scanner/csv';

describe('links', () => {
  it('recognises http(s) links with their host', () => {
    expect(parseContent('https://example.com/a?b=1')).toMatchObject({ kind: 'url', host: 'example.com', warnings: [] });
  });

  it('warns about risky links', () => {
    const warn = (s: string) => {
      const c = parseContent(s);
      return c.kind === 'url' ? c.warnings.join(' ') : '';
    };
    expect(warn('http://example.com')).toMatch(/http, not https/);
    expect(warn('https://paypal.com@evil.example')).toMatch(/@/);
    expect(warn('https://аpple.com')).toMatch(/international characters/);
    expect(warn('https://192.168.0.1/login')).toMatch(/IP address/);
    expect(warn('https://bit.ly/abc')).toMatch(/short link/);
  });

  it('never treats other schemes as links', () => {
    expect(parseContent('javascript:alert(1)').kind).toBe('text');
    expect(parseContent('data:text/html,hi').kind).toBe('text');
  });

  it('reads MEBKM bookmarks', () => {
    expect(parseContent('MEBKM:TITLE:Rounder;URL:https\\://roundertools.com;;')).toMatchObject({ kind: 'url', host: 'roundertools.com' });
  });
});

describe('wi-fi', () => {
  it('parses fields in any order, with escapes', () => {
    expect(parseContent('WIFI:S:My\\;Net;T:WPA;P:pa\\:ss\\\\;H:true;;')).toEqual({ kind: 'wifi', ssid: 'My;Net', password: 'pa:ss\\', security: 'WPA', hidden: true });
  });
  it('treats nopass as an open network', () => {
    expect(parseContent('WIFI:T:nopass;S:Cafe;;')).toMatchObject({ security: 'none', password: '' });
  });
});

describe('contacts', () => {
  it('reads a vCard, including folded lines and grouped properties', () => {
    const c = parseContent('BEGIN:VCARD\r\nVERSION:3.0\r\nN:Doe;Jane;;;\r\nORG:Acme\\, Inc.\r\nitem1.TEL;TYPE=cell:+1 555 0100\r\nEMAIL:jane@\r\n example.com\r\nADR:;;1 Main St;Springfield;;12345;USA\r\nEND:VCARD');
    expect(c.kind).toBe('contact');
    if (c.kind !== 'contact') return;
    expect(c.contact).toMatchObject({ name: 'Jane Doe', org: 'Acme, Inc.', phones: ['+1 555 0100'], emails: ['jane@example.com'], address: '1 Main St, Springfield, 12345, USA' });
  });

  it('reads a MECARD and turns it into a vCard', () => {
    const c = parseContent('MECARD:N:Doe,John;TEL:5550100;EMAIL:john@example.com;;');
    expect(c.kind).toBe('contact');
    if (c.kind !== 'contact') return;
    expect(c.contact.name).toBe('John Doe');
    expect(c.vcard).toContain('FN:John Doe');
    expect(c.vcard).toContain('TEL:5550100');
  });

  it('escapes vCard values', () => {
    expect(toVcard({ name: 'A, B; C', org: '', title: '', phones: [], emails: [], urls: [], address: '', note: '' })).toContain('FN:A\\, B\\; C');
  });
});

describe('messages, phones and places', () => {
  it('reads email formats', () => {
    expect(parseContent('mailto:a@b.co?subject=Hi%20there&body=Yo')).toEqual({ kind: 'email', to: 'a@b.co', subject: 'Hi there', body: 'Yo' });
    expect(parseContent('MATMSG:TO:a@b.co;SUB:Hi;BODY:Yo;;')).toMatchObject({ kind: 'email', subject: 'Hi' });
    expect(parseContent('someone@example.org')).toMatchObject({ kind: 'email', to: 'someone@example.org' });
  });

  it('reads phone and sms', () => {
    expect(parseContent('tel:+15550100')).toEqual({ kind: 'phone', number: '+15550100' });
    expect(parseContent('SMSTO:+15550100:See you at 5:30')).toEqual({ kind: 'sms', number: '+15550100', body: 'See you at 5:30' });
    expect(parseContent('sms:+15550100?body=Hello')).toMatchObject({ kind: 'sms', body: 'Hello' });
  });

  it('reads geo, rejecting impossible coordinates', () => {
    expect(parseContent('geo:48.8584,2.2945?q=Eiffel Tower')).toMatchObject({ kind: 'geo', lat: 48.8584, lon: 2.2945, query: 'Eiffel Tower' });
    expect(parseContent('geo:123,456').kind).toBe('text');
  });

  it('reads calendar events and wraps them for download', () => {
    const c = parseContent('BEGIN:VEVENT\nSUMMARY:Launch\nDTSTART:20261026T150000Z\nDTEND:20261026T160000Z\nLOCATION:Studio\nEND:VEVENT');
    expect(c).toMatchObject({ kind: 'event', summary: 'Launch', start: '2026-10-26 15:00 UTC', location: 'Studio' });
    if (c.kind === 'event') expect(c.ics).toMatch(/^BEGIN:VCALENDAR\r\n[\s\S]*END:VCALENDAR$/);
    expect(icsDate('20261026')).toBe('2026-10-26');
  });
});

describe('products and plain text', () => {
  it('labels retail barcodes by format', () => {
    expect(parseContent('5901234123457', 'EAN13')).toEqual({ kind: 'product', code: '5901234123457', scheme: 'EAN-13' });
    expect(parseContent('9780141036144', 'ISBN')).toMatchObject({ scheme: 'ISBN' });
  });
  it('keeps other content as text, untouched', () => {
    expect(parseContent('  hello\nworld ', 'Code128')).toEqual({ kind: 'text', text: '  hello\nworld ' });
  });
});

describe('toCsv', () => {
  it('quotes where needed and defuses spreadsheet formulas', () => {
    expect(toCsv([['a', 'b,c', 'say "hi"'], ['=1+1', 'line\nbreak']])).toBe('a,"b,c","say ""hi"""\r\n\'=1+1,"line\nbreak"');
  });
});
