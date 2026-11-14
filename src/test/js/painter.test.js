// The painter's limits for forest (heightpaint.js): not on water, not above the tree line; and the texts (i18n.js).
const test = require("node:test"), assert = require("node:assert/strict");
const { load, read, stubCanvas } = require("./load.js");
load("heightpaint.js");
const P = FieldMap.prototype;
/** A painter over a 4 × 1 height map: under water, 2 000 m, 5 000 m, 10 000 m. */
function painter(target, settings, climate) {
  const fm = Object.create(P);
  fm.seaLevel = 100; fm.metersPerStep = 100; fm.opts = climate ? { treeClimate: () => climate } : {};
  fm.heightGrid = () => ({ w: 4, h: 1, d: Uint8Array.from([50, 120, 150, 200]), sea: 100, mps: 100, key: "k" });
  fm.hpSet = settings; fm.draw = () => {}; fm._hpOutliersSoon = fm._hpDividesSoon = fm._hpCommitWind = () => {};
  fm.hp = { w: 4, h: 1, target, data: Uint8Array.from([60, 60, 60, 60]), before: new Uint8Array(4), bbox: [0, 0, 4, 1], undo: [], lut: new Uint32Array(256), view: stubCanvas(), grey: stubCanvas() };
  return fm;
}
const painted = (fm) => { P._hpRefresh.call(fm, 0, 0, 4, 1); return Array.from(fm.hp.data); };

test("forest is not painted on water or above the tree line", () => {
  assert.deepEqual(painted(painter("forest", { treeLine: 3000, treeTemp: false })), [0, 60, 0, 0]);
  assert.deepEqual(painted(painter("forest", { treeLine: 0 })), [0, 60, 60, 60], "0: no tree line");
});
test("the tree line is lower where the warmest month is colder", () => {
  // 10 °C at the tree line, 6.5° per km: a warmest month of 16.5° at sea level puts it at 1 000 m
  assert.deepEqual(painted(painter("forest", { treeLine: 3000 }, () => ({ warm: 16.5 }))), [0, 0, 0, 0]);
  assert.deepEqual(painted(painter("forest", { treeLine: 3000 }, () => ({ warm: 40 }))), [0, 60, 0, 0], "never above the limit in metres");
});
test("marshland stops at the water but not at the tree line; ice goes anywhere", () => {
  assert.deepEqual(painted(painter("marsh", { treeLine: 3000 })), [0, 60, 60, 60]);
  assert.deepEqual(painted(painter("ice", { treeLine: 3000 })), [60, 60, 60, 60]);
});
test("removing the forest above the tree line", () => {
  const fm = painter("forest", { treeLine: 3000, treeTemp: false });
  fm.hp.bbox = null;
  assert.equal(P.hpClearAboveTreeLine.call(fm), 2);
  assert.deepEqual(Array.from(fm.hp.data), [60, 60, 0, 0]);
});
test("every text exists in both languages", () => {
  const sandbox = {}; new Function("window", read("i18n.js"))(sandbox);
  const I = sandbox.EonI18n || sandbox.I18N || Object.values(sandbox)[0];
  const langs = Object.keys(I).filter((k) => I[k] && typeof I[k] === "object");
  assert.ok(langs.length >= 2, "two languages found");
  const [a, b] = langs.map((l) => new Set(Object.keys(I[l])));
  assert.deepEqual([...a].filter((k) => !b.has(k)), [], "only in " + langs[0]);
  assert.deepEqual([...b].filter((k) => !a.has(k)), [], "only in " + langs[1]);
});
