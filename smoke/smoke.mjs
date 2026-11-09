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
const admin = await account('Gemstone');
await admin.evaluate(async () => {
  const j = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
  const w = await j('/rune/api/worlds', { name: 'Ygg' }); const l = await j('/rune/api/languages', { worldId: w.id, name: 'Elven' });
  await j('/rune/api/languages/' + l.id + '/edit', { entity: 'word', action: 'CREATE', payload: { gloss: 'water', form: 'ata', year: 1 } });
});
await admin.goto(B + '/rune/'); await admin.waitForSelector('#side'); await admin.click('#side >> text=Elven'); await admin.waitForSelector('[data-publish=public]');
await admin.check('[data-publish=public]'); await admin.waitForTimeout(800); await admin.waitForSelector('[data-publish=suggestions]:not([disabled])');
console.log('ADMIN public:', await text(admin, '#msg'));
await admin.check('[data-publish=suggestions]'); await admin.waitForTimeout(800);
console.log('ADMIN suggestions:', await text(admin, '#msg'), '| row:', await text(admin, '.publishrow'));

const gctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } }); const guest = await gctx.newPage(); track(guest, 'guest');
await guest.goto(B + '/rune/'); await guest.waitForSelector('#side');
console.log('GUEST url:', guest.url(), '| header:', await text(guest, '#who'), '| side:', await text(guest, '#side'));
await guest.click('#side >> text=Elven'); await guest.waitForSelector('#tabbody table');
console.log('GUEST tabs:', (await guest.locator('.tabs button').allTextContents()).join(', '));
console.log('GUEST dict has ata:', (await text(guest, '#tabbody')).includes('ata'), '| add form:', await guest.isVisible('#w_gloss'), '| note:', await text(guest, '#panelbody p.small').catch(() => '-'));

const fan = await account('Fan1');
await fan.goto(B + '/rune/'); await fan.waitForSelector('#side');
console.log('FAN side:', await text(fan, '#side'));
await fan.click('#side >> text=Elven'); await fan.waitForSelector('#w_gloss');
console.log('FAN note:', await text(fan, '.card.pending'));
await fan.fill('#w_gloss', 'fire'); await fan.fill('#w_form', 'pira'); await fan.fill('#w_year', '1'); await fan.click('[data-act=saveWord]'); await fan.waitForTimeout(900);
console.log('FAN saved:', await text(fan, '#msg'));
await fan.click('[data-act=tab][data-t=changes]'); await fan.waitForTimeout(700); console.log('FAN changes:', (await text(fan, '#tabbody')).slice(0, 120));

await admin.click('[data-act=tab][data-t=changes]'); await admin.waitForSelector('[data-act=approve]'); await admin.click('[data-act=approve]'); await admin.waitForTimeout(800);
await guest.reload(); await guest.waitForSelector('#side'); await guest.click('#side >> text=Elven'); await guest.waitForSelector('#tabbody table');
console.log('GUEST sees approved pira:', (await text(guest, '#tabbody')).includes('pira'));
await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS'); process.exit(problems.length ? 1 : 0);
