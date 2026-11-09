import { chromium } from 'playwright';
const B = 'http://localhost:8080', problems = [];
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage();
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('response', r => { if (r.url().includes('/speech/')) console.log('LOAD', r.status(), r.url().split('/').pop(), r.headers()['content-type'], r.headers()['content-encoding'] || ''); });
await page.goto(B + '/'); await page.click('#authSwitch'); await page.fill('#u', 'Gemstone'); await page.fill('#p', 'secret-pass'); await page.click('#authSubmit'); await page.waitForSelector('#inView:not([hidden])');
const ids = await page.evaluate(async () => {
  const j = (u, b, m = 'POST') => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  const w = await j('/rune/api/worlds', { name: 'Arda' });
  const p = await j('/rune/api/languages', { worldId: w.id, name: 'Quenya' });
  const b = await j('/rune/api/languages', { worldId: w.id, name: 'Sindarin', parentId: p.id, splitYear: 500 });
  await j('/rune/api/languages/' + p.id, { ipaMap: 'hl=ɬ\nny=ɲ\nr=r\nth=θ', speechVoice: 'qya' }, 'PUT');
  await j('/rune/api/languages/' + p.id + '/edit', { entity: 'word', action: 'CREATE', payload: { gloss: 'star', form: 'elen', year: 1 } });
  await j('/rune/api/languages/' + p.id + '/edit', { entity: 'word', action: 'CREATE', payload: { gloss: 'tear', form: 'nyeni', year: 1 } });
  await j('/rune/api/languages/' + p.id + '/edit', { entity: 'rule', action: 'CREATE', payload: { year: 600, pattern: 'e', replacement: 'i' } });
  return { p: p.id, b: b.id };
});
// record what gets played
await page.addInitScript(() => {});
await page.goto(B + '/rune/?lang=' + ids.p);
await page.waitForSelector('#wbody button.say');
await page.evaluate(() => { window.__played = []; const o = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { const a = this; a.addEventListener('loadedmetadata', () => window.__played.push({ src: a.src.slice(0, 5), dur: a.duration })); return o.call(this); }; });
console.log('buttons in dictionary:', await page.locator('#wbody button.say').count());
const t0 = Date.now();
await page.locator('#wbody button.say').first().click();
await page.waitForFunction(() => window.__played.length > 0, null, { timeout: 60000 });
console.log('first play after', Date.now() - t0, 'ms', JSON.stringify(await page.evaluate(() => window.__played)), '| msg:', await page.textContent('#msg'));
const t1 = Date.now();
await page.locator('#wbody button.say').nth(1).click();
await page.waitForFunction(() => window.__played.length > 1, null, { timeout: 20000 });
console.log('second play after', Date.now() - t1, 'ms');
// word window history
await page.click('#wbody a[data-act=openWord]'); await page.waitForSelector('#modal:not([hidden]) button.say');
console.log('word window buttons:', await page.locator('#modal button.say').count());
await page.keyboard.press('Escape');
// settings try box
await page.click('[data-act=tab][data-t=settings]'); await page.waitForSelector('#g_voice');
console.log('voice selected:', await page.inputValue('#g_voice'), '| stress opt:', await page.textContent('#g_stress option'));
for (const [t, v] of [['hlotha nyarna', ''], ['thalion', 'sjn'], ['øːlˈʏbɐ', 'de']]) {
  await page.fill('#g_try', t); await page.selectOption('#g_voice', v); await page.click('[data-act=sayTry]');
  await page.waitForFunction(() => document.querySelector('#g_tryout').textContent.includes('eSpeak'), null, { timeout: 20000 });
  console.log('TRY', t, v || '(qya)', '=>', await page.textContent('#g_tryout'), '| msg:', (await page.textContent('#msg')).trim());
  await page.evaluate(() => { document.querySelector('#g_tryout').textContent = ''; });
}
await page.screenshot({ path: 'settings.png', fullPage: true });
// branch inherits the voice and map
await page.goto(B + '/rune/?lang=' + ids.b); await page.waitForSelector('#wbody');
console.log('branch profile:', JSON.stringify(await page.evaluate(id => speechProfile(id), ids.b)));
await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS'); process.exit(problems.length ? 1 : 0);
