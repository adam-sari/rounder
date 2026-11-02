import { chromium } from 'playwright';
const [url, sel, chars = '40000'] = process.argv.slice(2);
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 412, height: 823 } });
const p = await ctx.newPage();
const cdp = await ctx.newCDPSession(p);
await p.addInitScript(() => { window.__ev = []; new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.interactionId) window.__ev.push({ n: e.name, d: Math.round(e.duration), inp: Math.round(e.processingStart - e.startTime), proc: Math.round(e.processingEnd - e.processingStart), pres: Math.round(e.startTime + e.duration - e.processingEnd) }); }).observe({ type: 'event', durationThreshold: 16, buffered: true }); });
await p.goto(url, { waitUntil: 'networkidle' });
await p.waitForTimeout(1500);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
const ta = p.locator(sel);
await ta.click();
// paste a long article in one go, like a visitor would
const para = 'The quick brown fox jumps over the lazy dog while the narrator reads every sentence aloud. ';
await p.evaluate(([s, t]) => { const el = document.querySelector(s); el.value = t; el.dispatchEvent(new Event('input', { bubbles: true })); }, [sel, (para.repeat(Math.ceil(+chars / para.length)) + '\n\n').slice(0, +chars)]);
await p.waitForTimeout(1500);
await p.evaluate(() => (window.__ev = []));
for (const k of 'hello') { await p.keyboard.press(k); await p.waitForTimeout(150); }
await p.waitForTimeout(800);
const ev = await p.evaluate(() => window.__ev);
const worst = ev.reduce((m, e) => (e.d > m.d ? e : m), { d: 0 });
console.log(`${chars} chars: ${ev.length} slow events; worst ${worst.n} ${worst.d}ms (input delay ${worst.inp}, handlers ${worst.proc}, presentation ${worst.pres})`);
await b.close();
