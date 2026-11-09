'use strict';
/* Notification bell shared by the start page and Root and Rune: Bell.mount(element) adds the bell to it.
   Shows the number of unread notifications; clicking opens a list; opening one marks it read. */
(() => {
  const css = `.bell{position:relative;display:inline-block}
.bell>button{position:relative;font:inherit;padding:.3rem .6rem;border:1px solid #d8d3c8;background:#fff;border-radius:6px;cursor:pointer;color:#222}
.bell .n{position:absolute;top:-.45rem;right:-.45rem;min-width:1.1rem;padding:0 .25rem;border-radius:9px;background:#b3261e;color:#fff;font-size:.7rem;line-height:1.1rem;text-align:center}
.bell .box{position:absolute;right:0;top:2.2rem;z-index:50;width:min(380px,90vw);max-height:70vh;overflow:auto;background:#fff;color:#222;border:1px solid #d8d3c8;border-radius:8px;box-shadow:0 6px 24px rgba(0,0,0,.18);text-align:left;font-size:.9rem}
.bell .head{display:flex;justify-content:space-between;align-items:center;padding:.45rem .7rem;border-bottom:1px solid #eee;font-weight:600}
.bell .head button{font:inherit;font-size:.8rem;font-weight:400;border:0;background:none;color:#2f6f4f;cursor:pointer}
.bell .it{display:block;padding:.45rem .7rem;border-bottom:1px solid #f0ede6;color:inherit;text-decoration:none}
.bell .it:hover{background:#f6f4ef}
.bell .it.new{background:#fff8e1}
.bell .it small{display:block;color:#777;margin-top:.15rem}
.bell .empty{padding:.8rem;color:#777}`;
  let styled = false, timer = null;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const when = t => { const d = new Date(String(t).replace(' ', 'T')); return isNaN(d) ? '' : d.toLocaleString(); };
  async function call(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error('notifications ' + r.status);
    return r.json();
  }
  function mount(host) {
    if (!host) return;
    if (!styled) { const s = document.createElement('style'); s.textContent = css; document.head.appendChild(s); styled = true; }
    const el = document.createElement('span');
    el.className = 'bell';
    el.innerHTML = '<button type="button" title="Notifications">&#128276;<span class="n" hidden></span></button><div class="box" hidden></div>';
    host.appendChild(el);
    const btn = el.querySelector('button'), n = el.querySelector('.n'), box = el.querySelector('.box');
    let data = { unread: 0, items: [] };
    const draw = () => {
      n.hidden = !data.unread; n.textContent = data.unread > 99 ? '99+' : data.unread;
      box.innerHTML = '<div class="head">Notifications' + (data.unread ? ' <button type="button" data-all="1">Mark all read</button>' : '') + '</div>' +
        (data.items.length ? data.items.map(i => `<a class="it${i.seen ? '' : ' new'}" href="${esc(i.link || '#')}" data-id="${i.id}">${esc(i.text)}${i.times > 1 ? ` <strong>(×${i.times})</strong>` : ''}<small>${esc(when(i.created))}</small></a>`).join('')
          : '<div class="empty">Nothing yet. You hear here when someone suggests or makes changes to your languages, when your suggestions are approved or turned down, and when something is shared with you.</div>');
    };
    const load = async () => { try { data = await call('GET', '/api/notifications'); draw(); } catch (e) { /* logged out or offline */ } };
    btn.onclick = e => { e.stopPropagation(); box.hidden = !box.hidden; if (!box.hidden) load(); };
    box.onclick = async e => {
      e.stopPropagation();
      if (e.target.dataset.all) { await call('POST', '/api/notifications/seen', {}); await load(); return; }
      const a = e.target.closest('a.it'); if (!a) return;
      e.preventDefault();
      try { await call('POST', '/api/notifications/seen', { id: Number(a.dataset.id) }); } catch (err) { /* still follow the link */ }
      const href = a.getAttribute('href');
      if (href && href !== '#') location.href = href; else load();
    };
    document.addEventListener('click', () => { box.hidden = true; });
    load();
    if (timer) clearInterval(timer);
    timer = setInterval(() => { if (document.body.contains(el)) load(); }, 60000);
  }
  window.Bell = { mount };
})();
