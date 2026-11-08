import { chromium } from 'playwright';
const B = 'http://localhost:8080', problems = [];
const browser = await chromium.launch(); const page = await browser.newPage();
page.on('pageerror', e => problems.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
page.on('response', r => { if (r.status() >= 400 && r.url().startsWith(B) && !r.url().endsWith('/api/auth/me')) problems.push('HTTP ' + r.status() + ' ' + r.url()); });
page.on('dialog', d => d.accept());
const text = async sel => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();
for (const u of ['Gemstone', 'Claude']) {
  await page.goto(B + '/'); if (await page.isVisible('#logoutBtn')) await page.click('#logoutBtn');
  await page.click('#authSwitch'); await page.fill('#u', u); await page.fill('#p', 'secret-pass'); await page.click('#authSubmit'); await page.waitForSelector('#inView:not([hidden])');
}
await page.click('#logoutBtn'); await page.fill('#u', 'Gemstone'); await page.fill('#p', 'secret-pass'); await page.click('#authSubmit'); await page.waitForSelector('#inView:not([hidden])');
await page.goto(B + '/rune/'); await page.waitForSelector('[data-act=page][data-p=connector]'); await page.click('[data-act=page][data-p=connector]');
await page.waitForSelector('#cn_user'); console.log('PAGE:', (await text('#app')).slice(0, 260));
console.log('PRESELECTED:', await page.inputValue('#cn_user'));
await page.fill('#cn_label', 'claude.ai'); await page.click('[data-act=connectorCreate]'); await page.waitForSelector('#cn_url');
const url = await page.inputValue('#cn_url'); console.log('URL:', url.replace(/rr[\w-]+$/, 'rr…'));
const r = await page.evaluate(async u => (await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json(), url);
console.log('TOOLS:', r.result.tools.length, r.result.tools.map(t => t.name).join(' '));
await page.click('[data-act=page][data-p=work]'); await page.waitForTimeout(300); await page.click('[data-act=page][data-p=connector]'); await page.waitForSelector('[data-act=connectorRevoke]');
console.log('TABLE:', await text('table'), '| url box gone:', !(await page.isVisible('#cn_url')));
await page.click('[data-act=connectorRevoke]'); await page.waitForTimeout(800); console.log('AFTER REVOKE:', await text('#msg'), '|', (await text('#app')).includes('None yet.'));
await browser.close();
console.log(problems.length ? 'PROBLEMS:\n' + problems.join('\n') : 'NO PROBLEMS'); process.exit(problems.length ? 1 : 0);
