import { chromium } from 'playwright';
const B = 'http://localhost:8080', problems = [];
const browser = await chromium.launch(); const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(B) && !r.url().endsWith('/api/auth/me')) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
const text = async sel => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
await page.goto(B + '/'); await page.click('#authSwitch'); await page.fill('#u', 'Gemstone'); await page.fill('#p', 'secret-pass'); await page.click('#authSubmit'); await page.waitForSelector('#inView:not([hidden])');
await page.evaluate(async () => {
  const j = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  const w = await j('/rune/api/worlds', { name: 'Ygg' }); const l = await j('/rune/api/languages', { worldId: w.id, name: 'Proto' });
  await j('/rune/api/languages/' + l.id + '/edit', { entity: 'word', action: 'CREATE', payload: { gloss: 'water', form: 'ata', year: 0 } });
});
await page.goto(B + '/rune/'); await page.waitForSelector('#side'); await page.click('#side >> text=Proto');
await page.waitForSelector('[data-act=openWord]'); await page.click('[data-act=openWord]'); await page.waitForSelector('[data-act=toggleLoss]');
console.log('POPUP before:', await text('#modal h3:has-text("Lost") + *'));
await page.click('[data-act=toggleLoss]'); await page.fill('#lo_year', '800'); await page.fill('#lo_note', 'replaced by sea'); await page.click('[data-act=addLoss]'); await page.waitForTimeout(900);
console.log('POPUP after:', await text('#msg'), '|', await text('#modal h3:has-text("Lost") + *'));
await page.keyboard.press('Escape'); await page.evaluate(() => { const m = document.querySelector('#modal'); if (m) m.hidden = true; });
await page.click('[data-act=tab][data-t=dict]'); await page.waitForSelector('tr.lostword');
console.log('DICT:', await text('tr.lostword td:nth-child(2)'));
await page.click('[data-act=tab][data-t=sentences]'); await page.waitForSelector('#s_src');
console.log('LABEL:', await text('label:has-text("built as spoken")'));
for (const y of ['700', '850']) { await page.fill('#s_src', '(water)'); await page.fill('#s_year', y); await page.click('[data-act=sentBuild]'); await page.waitForTimeout(700); console.log('BUILD ' + y + ':', (await text('#s_out')).slice(0, 140)); }
await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS'); process.exit(problems.length ? 1 : 0);
