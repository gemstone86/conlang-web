// Root and Rune's evolution tree: changes that come close (or at the same time) must not sit on top of each other.
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "../../main/resources/static/rune/js/graphs.js"), "utf8");
const ctx = { S: { worlds: [{ languages: [{ id: 1, parent_id: null }, { id: 2, parent_id: 1 }] }] }, esc: s => String(s ?? "") };
vm.createContext(ctx);
vm.runInContext(src.slice(src.indexOf("function svgText"), src.indexOf("function lineChart")), ctx);
vm.runInContext(src.slice(src.indexOf("function wordTree"), src.indexOf("function sentView")), ctx);

const row = (lang_id, lang, year, form, source, rule) => ({ lang_id, lang, year, form, source, rule });
// the circles in the order drawn, and the text labels with their x and content
const circles = svg => [...svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)"/g)].map(m => ({ x: +m[1], y: +m[2] }));
const forms = svg => [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)" font-size="13"[^>]*>([^<]*)</g)].map(m => ({ x: +m[1], y: +m[2], t: m[3] }));

test("two changes in the same year in one language get places of their own", () => {
  const svg = ctx.wordTree([row(1, "Proto", 0, "atgangana", "ENTRY"), row(1, "Proto", 300, "atgangan", "RULE", "lose a"), row(1, "Proto", 300, "atgang", "RULE", "lose n"), row(1, "Proto", 310, "atgan", "RULE", "x")]);
  const xs = circles(svg).map(c => c.x);
  assert.strictEqual(new Set(xs).size, xs.length, "no two circles at the same place: " + xs);
  assert.ok(xs.every((x, i) => i === 0 || x > xs[i - 1]), "in order from left to right");
});

test("long forms next to each other leave room for each other", () => {
  const long1 = "ēþmijanąidaiþanaz", long2 = "ēþmijanąidaiþanuz";
  const svg = ctx.wordTree([row(1, "Proto", 0, long1, "ENTRY"), row(1, "Proto", 5, long2, "RULE", "a rule")]);
  const f = forms(svg);
  assert.strictEqual(f.length, 2);
  const need = (long1.length + long2.length) / 2 * 7.8;      // half of each, at the width of the font (13 px mono is about 7.8 px a letter)
  assert.ok(f[1].x - f[0].x >= need, `centres ${f[1].x - f[0].x} apart, the two forms need ${need}`);
});

test("a branch's rows line up with the parent's by year", () => {
  const svg = ctx.wordTree([row(1, "Proto", 0, "ab", "ENTRY"), row(1, "Proto", 100, "a", "RULE", "r"), row(2, "Daughter", 100, "a", "SPLIT"), row(2, "Daughter", 200, "o", "RULE", "s")]);
  const c = circles(svg);
  const at100 = c.filter(p => p.x === c[1].x);
  assert.strictEqual(at100.length, 2, "the parent's and the daughter's change at 100 share a column");
});
