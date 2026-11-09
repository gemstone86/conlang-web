import { chromium } from 'playwright';
const B = 'http://localhost:8080', problems = [];
const browser = await chromium.launch();
const track = (page, who) => {
  page.on('pageerror', e => problems.push(who + ' pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/401|403|404/.test(m.text())) problems.push(who + ' console: ' + m.text()); });
  page.on('response', r => { if (r.status() >= 500 && r.url().startsWith(B)) problems.push(who + ' HTTP ' + r.status() + ' ' + r.url()); });
  page.on('dialog', d => d.accept());
};
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
async function account(name) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const page = await ctx.newPage(); track(page, name);
  await page.goto(B + '/'); await page.click('#authSwitch'); await page.fill('#u', name); await page.fill('#p', 'secret-pass'); await page.click('#authSubmit'); await page.waitForSelector('#inView:not([hidden])');
  return page;
}
const owner = await account('Gemstone');
const helper = await account('Helper');
const ids = await owner.evaluate(async () => {
  const j = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  const w = await j('/rune/api/worlds', { name: 'Ygg' });
  const p = await j('/rune/api/languages', { worldId: w.id, name: 'Proto' });
  const b = await j('/rune/api/languages', { worldId: w.id, name: 'Branch', parentId: p.id, splitYear: 500 });
  const e = (l, entity, payload) => j('/rune/api/languages/' + l + '/edit', { entity, action: 'CREATE', payload });
  await e(p.id, 'word', { gloss: 'water', form: 'ata', year: 0 });
  await e(p.id, 'word', { gloss: 'stone', form: 'ada', year: 0 });
  await e(p.id, 'word', { gloss: 'fire', form: 'pira', year: 0 });
  await e(p.id, 'rule', { year: 100, pattern: 't', replacement: 'd' });
  await e(p.id, 'rule', { year: 700, pattern: 'a$', replacement: 'e' });
  await e(p.id, 'rule', { year: 200, pattern: 'q', replacement: 'k' });
  await j('/rune/api/shares', { scope: 'LANGUAGE', targetId: p.id, username: 'Helper', level: 'EDITOR' });
  return { p: p.id, b: b.id };
});
// the start page bell for helper
await helper.reload(); await helper.waitForSelector('.bell');
console.log('HELPER bell count:', await text(helper, '.bell .n'));
await helper.click('.bell > button'); await helper.waitForSelector('.bell .it');
console.log('HELPER bell item:', await text(helper, '.bell .it'));
await helper.screenshot({ path: 'start-bell.png' });
await helper.click('.bell .it'); await helper.waitForURL(/\/rune\//); await helper.waitForSelector('#tabbody table');
console.log('HELPER deep link opened:', await text(helper, '#panelbody h2'), '| url:', helper.url());
await helper.evaluate(async p => { await fetch('/rune/api/languages/' + p + '/edit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entity: 'word', action: 'CREATE', payload: { gloss: 'sun', form: 'sol', year: 0 } }) }); }, ids.p);

// owner: Rune bell, Check, Etymology, Texts, word window
await owner.goto(B + '/rune/?lang=' + ids.p + '&tab=check'); await owner.waitForSelector('.checkbox');
console.log('OWNER bell count in rune:', await text(owner, '#who .bell .n'));
console.log('OWNER tabs:', (await owner.locator('.tabs button').allTextContents()).join(', '));
console.log('CHECK:', (await text(owner, '#tabbody')).slice(0, 600));
await owner.screenshot({ path: 'check.png', fullPage: true });

await owner.click('[data-act=tab][data-t=etymology]'); await owner.waitForSelector('#et_q');
await owner.fill('#et_q', 'water'); await owner.click('[data-act=etymGo]'); await owner.waitForSelector('.etree');
console.log('ETYMOLOGY:', await text(owner, '#et_out'));
await owner.screenshot({ path: 'etymology.png', fullPage: true });
await owner.click('#et_out .chip a >> nth=1'); await owner.waitForSelector('#modal:not([hidden]) #w_etym .etree');
console.log('WORD WINDOW elsewhere:', await text(owner, '#w_etym'));
await owner.keyboard.press('Escape');

await owner.click('[data-act=tab][data-t=texts]'); await owner.waitForSelector('[data-act=textNew]');
await owner.click('[data-act=textNew]'); await owner.fill('#tx_title', 'The flood'); await owner.fill('#tx_years', '50, 400, 800');
await owner.fill('#tx_body', '(water) | Water.\n(fire) (stone) | Fire stone.\n(ghost) | Ghost.'); await owner.click('[data-act=textSave]');
await owner.waitForSelector('.texttable');
console.log('TEXT:', await text(owner, '.texttable'));
await owner.fill('#tx_show', '0, 1000'); await owner.click('[data-act=textYears]'); await owner.waitForTimeout(800);
console.log('TEXT other years header:', await text(owner, '.texttable tr'));
await owner.screenshot({ path: 'texts.png', fullPage: true });
await owner.click('#who .bell > button'); await owner.waitForSelector('#who .bell .it');
console.log('OWNER bell:', await text(owner, '#who .bell .box'));

// visitor: no bell
const gctx = await browser.newContext(); const guest = await gctx.newPage(); track(guest, 'guest');
await guest.goto(B + '/'); console.log('GUEST bell on start page:', await guest.locator('.bell').count());
await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS'); process.exit(problems.length ? 1 : 0);
