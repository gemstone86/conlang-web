'use strict';
// Root and Rune: version check and start. The files in js/ are loaded in order by index.html and share one scope.
const UI_VERSION = '1.19.0';   // keep equal to the version in pom.xml
api('GET', '/rune/api/version').then(v => {
  $('#ver').textContent = 'v' + v.version + (v.built ? ' · built ' + v.built.replace('T', ' ').replace('Z', ' UTC') : '');
  if (v.version !== UI_VERSION) {
    const b = document.createElement('div');
    b.style.cssText = 'background:#b3261e;color:#fff;padding:8px 14px;font-size:14px';
    b.textContent = 'The page is version ' + UI_VERSION + ' but the running server is ' + v.version + '. Stop the app completely, then in Eclipse do Maven > Update Project (Force Update), Project > Clean, and start it again. Until then some features will fail.';
    document.body.insertBefore(b, document.body.firstChild);
  }
}).catch(() => {});
boot().catch(e => say(e.message, true));
