// Root and Rune's word list: the arrow beside words that have forms by rule, and the sub ids (word = .0, forms .1, .2 ...).
const test = require("node:test"), assert = require("node:assert");
const fs = require("fs"), path = require("path"), vm = require("vm");
const src = fs.readFileSync(path.join(__dirname, "../../main/resources/static/rune/js/graphs.js"), "utf8");
const ctx = { S: { lang: { id: 1, name: "Old" }, expanded: new Set() }, esc: s => String(s ?? ""), lines: x => JSON.stringify(x || ""), sayBtn: () => "",
  canSuggest: () => false, defForm: w => (w.forms || []).find(f => f.label.toLowerCase() === "definite") };
vm.createContext(ctx);
// only the word list part: from "// a word's forms" to the end of drawDict's predecessor
const from = src.indexOf("// a word's forms, listed"), to = src.indexOf("function drawDict");
vm.runInContext(src.slice(src.indexOf("// the tags of a word"), src.indexOf("function fieldFilter")), ctx);   // the tag helpers
vm.runInContext(src.slice(from, to), ctx);
const word = { id: 7, gloss: "tree", pos: "noun", build: "x", year: 0, form: "im", length: 2, pronunciation: "", forms: [
  { label: "plural", form: "imka", virtual: true, latest: {} }, { label: "definite", form: "imtou", virtual: true, latest: {} }, { label: "past", form: "imi", latest: {} }] };

test("a word with forms by rule gets an arrow, and keeps its plain id", () => {
  const h = ctx.wordRow(word);
  assert.match(h, /data-act="toggleForms"/);
  assert.match(h, /<\/button> 7<\/td>/);
  assert.doesNotMatch(h, /subrow/);
});
test("expanded: the forms follow in label order, the label where the id is", () => {
  ctx.S.expanded.add(7);
  const h = ctx.wordRow(word);
  const labels = [...h.matchAll(/class="subrow[^"]*"><td[^>]*>([^<]*)</g)].map(m => m[1]);
  assert.deepStrictEqual(labels, ["definite", "past", "plural"]);
  assert.match(h, /by rule/);
  ctx.S.expanded.clear();
});
test("a word without forms by rule has no arrow", () => {
  const h = ctx.wordRow({ ...word, forms: [{ label: "past", form: "imi", latest: {} }] });
  assert.doesNotMatch(h, /toggleForms/);
});

const tagMatches = vm.runInContext("tagMatches", ctx);   // a const, so not a property of the context
test("tags: shown as chips, and the filter wants all the tags given", () => {
  const h = ctx.wordRow({ ...word, forms: [], tags: "bird, old" });
  assert.match(h, /data-tag="bird"/);
  assert.match(h, /data-tag="old"/);
  assert.ok(tagMatches("bird", "bird, old"));
  assert.ok(tagMatches("OLD, bird", "bird, old"), "any letter case, any order");
  assert.ok(!tagMatches("bird, new", "bird, old"));
  assert.ok(tagMatches("", null), "no filter lets every word through");
  assert.ok(!tagMatches("bird", null));
});
