// Root and Rune's word list: the arrow beside words that have forms by rule, and the sub ids (word = .0, forms .1, .2 ...).
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "../../main/resources/static/rune/js/graphs.js"), "utf8");
const ctx = { S: { lang: { id: 1, name: "Old" }, expanded: new Set() }, esc: s => String(s ?? ""), lines: x => JSON.stringify(x || ""), sayBtn: () => "",
  canSuggest: () => false, defForm: w => (w.forms || []).find(f => f.label.toLowerCase() === "definite") };
vm.createContext(ctx);
// only the word list part: from "// sub ids" to the end of drawDict's predecessor
const from = src.indexOf("// sub ids"), to = src.indexOf("function drawDict");
vm.runInContext(src.slice(from, to), ctx);
const word = { id: 7, gloss: "tree", pos: "noun", build: "x", year: 0, form: "im", length: 2, pronunciation: "", forms: [
  { label: "plural", form: "imka", virtual: true, latest: {} }, { label: "definite", form: "imtou", virtual: true, latest: {} }, { label: "past", form: "imi", latest: {} }] };

test("a word with forms by rule gets an arrow and id .0", () => {
  const h = ctx.wordRow(word);
  assert.match(h, /data-act="toggleForms"/);
  assert.match(h, /7\.0/);
  assert.doesNotMatch(h, /subrow/);
});
test("expanded: the forms follow with sub ids in label order", () => {
  ctx.S.expanded.add(7);
  const h = ctx.wordRow(word);
  const ids = [...h.matchAll(/(?:>|\s)(7\.\d)</g)].map(m => m[1]);
  assert.deepStrictEqual(ids, ["7.0", "7.1", "7.2", "7.3"]);
  assert.ok(h.indexOf("definite") < h.indexOf("past") && h.indexOf("past") < h.indexOf("plural"));
});
test("a word without forms by rule has no arrow and a plain id", () => {
  const h = ctx.wordRow({ ...word, forms: [{ label: "past", form: "imi", latest: {} }] });
  assert.doesNotMatch(h, /toggleForms/);
  assert.doesNotMatch(h, /7\.0/);
});
