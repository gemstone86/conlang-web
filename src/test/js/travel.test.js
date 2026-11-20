// The travel calculator's rules (travel.js), on small made-up maps. Run: node --test src/test/js/
const test = require("node:test"), assert = require("node:assert/strict");
const { load, map } = require("./load.js");
load("travel.js");
load("ranges.js");
const T = window.Travel, cfg = () => JSON.parse(JSON.stringify(T._defaults));
const world = (fm) => { const G = T._buildGrid(fm, null); G.rivers = T._riverIndex(fm); return { fm, G, RD: T._buildRoads(fm, G, null) }; };
const route = (w, a, b, mode = "fast", opt = {}, c = cfg()) => T._findRoute(w.fm, w.G, w.RD, a, b, mode, c, 4, opt);
const road = [{ kind: "road", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] }];

test("a horse is faster everywhere, a wagon slower off the roads", () => {
  const w = world(map({ roads: road })), on = [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }], off = [{ x: 0.1, y: 0.2 }, { x: 0.9, y: 0.2 }];
  const h = (pts, mount) => route(w, pts[0], pts[1], "fast", { mount }).hours;
  const horse = { mul: 1.5, off: 1 }, wagon = { mul: 1, off: 0.8 };
  assert.ok(Math.abs(h(off, horse) - h(off, null) / 1.5) < 1);
  assert.ok(Math.abs(h(off, wagon) - h(off, null) / 0.8) < 1);
  assert.ok(Math.abs(h(on, wagon) - h(on, null)) < 5, "on the road a wagon keeps the walking pace");
});

test("a party stays the night in a city it reaches late in the day, and pushes on a little to reach one", () => {
  const cities = [{ id: 1, kind: "city", name: "A", x: 0.1205, y: 0.5 }, { id: 2, kind: "city", name: "B", x: 0.1465, y: 0.5 }];
  const w = world(map({ roads: road, cities })), r = route(w, { x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 });
  const trip = () => ({ route: r.pts.map((p) => [p.x, p.y, p.k]), startT: 1000 + 7 / 24, pace: 4, dayStart: 7, offset: 0, delays: [], hoursPerDay: 10 });
  const sim = (c) => T._simulate(w.fm, trip(), c, () => null, () => () => null);
  assert.deepEqual(sim(cfg()).nights, ["A", "B"]);
  assert.deepEqual(sim(Object.assign(cfg(), { cityStop: -1, cityPush: 0 })).nights, []);
});

test("a bridge or an open ford saves the fording; a flooded ford doesn't", () => {
  const rivers = [{ id: 1, name: "R", size: 8, points: [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }] }];
  const hours = (cities, month) => { T._setPlanMonth(month); return route(world(map({ rivers, cities })), { x: 0.3, y: 0.3 }, { x: 0.7, y: 0.3 }).hours; };
  const ford = [{ id: 1, kind: "ford", x: 0.5, y: 0.3, floodFrom: 3, floodTo: 4 }];
  const plain = hours([], 5);
  assert.equal(hours([{ id: 1, kind: "bridge", x: 0.5, y: 0.3 }], 5), plain - 2);
  assert.equal(hours(ford, 5), plain - 2);
  assert.equal(hours(ford, 3), plain);
  T._setPlanMonth(null);
});

test("full marshland is gone round", () => {
  const marsh = (k, x, y) => (k === "marsh" && y > 0.4 && y < 0.6 && x > 0.1 && x < 0.9 ? 100 : 0);
  const a = { x: 0.5, y: 0.2 }, b = { x: 0.5, y: 0.8 };
  const dry = route(world(map({})), a, b).km, wet = route(world(map({ layerAt: marsh })), a, b);
  assert.ok(wet.km > dry * 1.5);
  assert.ok(wet.pts.every((p) => !(p.y > 0.45 && p.y < 0.55 && p.x > 0.15 && p.x < 0.85)), "no point inside the marsh");
});

test("ships set out from and come ashore at harbours; landing anywhere costs the landing hours", () => {
  const sea = (x) => (x > 0.6 && x < 0.85 ? -10 : 50), a = { x: 0.3, y: 0.5 }, b = { x: 0.95, y: 0.5 };
  const go = (cities, opt) => route(world(map({ groundM: sea, cities })), a, b, "fast", Object.assign({ sea: true }, opt));
  const north = { id: 1, kind: "city", x: 0.59, y: 0.15, harbour: true }, far = { id: 2, kind: "city", x: 0.86, y: 0.8, harbour: true };
  assert.ok(go([], {}), "no harbours on the map: any coast will do");
  assert.equal(go([north], {}), null, "no harbour on the far side");
  assert.ok(go([north, far], {}));
  const anywhere = go([north], { landAnywhere: true });
  assert.ok(anywhere && anywhere.hours > 0);
  assert.ok(go([Object.assign({}, north, { harbour: false })], {}), "a city without a harbour changes nothing");
});

test("Säkrast goes round by the road through the nation, within three times the fastest", () => {
  const fm = map({ roads: [{ kind: "road", points: [{ x: 0.1, y: 0.2 }, { x: 0.1, y: 0.8 }, { x: 0.9, y: 0.8 }, { x: 0.9, y: 0.2 }] }],
    nations: [{ parts: [[{ x: 0.05, y: 0.5 }, { x: 0.95, y: 0.5 }, { x: 0.95, y: 0.95 }, { x: 0.05, y: 0.95 }]] }] });
  const w = world(fm), a = { x: 0.15, y: 0.1 }, b = { x: 0.85, y: 0.1 };
  const fast = route(w, a, b, "fast"), safe = route(w, a, b, "safe");
  assert.ok(Math.max(...safe.pts.map((p) => p.y)) > 0.7, "down to the road");
  assert.ok(Math.max(...fast.pts.map((p) => p.y)) < 0.3, "the fastest goes straight");
  assert.ok(safe.hours <= 3 * fast.hours);
});

test("Lättast and Säkrast go round a mountain range, Snabbast goes straight over it", () => {
  const P = FieldMap.prototype;
  const range = { id: 1, name: "R", points: [{ x: 0.5, y: 0.45, l: 20, r: 20 }, { x: 0.5, y: 0.55, l: 20, r: 20 }] };
  const fm = map({ ranges: [range], _rgNormals: P._rgNormals, _rgWidths: P._rgWidths });
  const w = world(fm), a = { x: 0.2, y: 0.5 }, b = { x: 0.8, y: 0.5 };
  const inRange = (p) => Math.abs(p.x - 0.5) < 0.035 && p.y > 0.46 && p.y < 0.54;      // well inside the range (the edge is only brushed)
  assert.ok(route(w, a, b, "fast").pts.some(inRange), "the fastest goes straight over");
  for (const mode of ["easy", "safe"]) assert.ok(!route(w, a, b, mode).pts.some(inRange), mode + " goes round the range");
  const crest = w.G.rng.filter((v) => v === 2).length;
  assert.ok(crest >= 9 && crest <= 13, "the crest line is about ten cells long, was " + crest);
  // roads keep their passes: a road over the range is used as it is
  const over = world(map({ ranges: [range], _rgNormals: P._rgNormals, _rgWidths: P._rgWidths, roads: [{ kind: "road", points: [{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }] }] }));
  assert.ok(route(over, a, b, "easy").pts.some(inRange), "a road goes over the pass");
});

test("a journey travels from a daily start to a daily end, and the first day may start at its own time", () => {
  const w = world(map({})), r = route(w, { x: 0.1, y: 0.5 }, { x: 0.1 + 100 / 2000, y: 0.5 });     // about 100 km
  const sim = (extra) => T._simulate(w.fm, Object.assign({ route: r.pts.map((p) => [p.x, p.y, p.k]), startT: 1000 + 8 / 24, pace: 4, dayStart: 8, dayEnd: 18, offset: 0, delays: [] }, extra), cfg(), () => null, () => () => null);
  const plain = sim({}), late = sim({ startT: 1000 + 15 / 24, firstStart: 15 });
  assert.ok(plain.arriveT > 1000 && late.arriveT > plain.arriveT, "a late first day arrives later");
  // the first day only has 15:00-18:00: three hours of the walk, then a full day from 08:00
  const kmAt = (r2, hours) => r2.km[Math.min(r2.km.length - 1, Math.round(hours))];
  const day1 = kmAt(late, 3), still = kmAt(late, 10);
  assert.ok(day1 > 8 && Math.abs(still - day1) < 0.5, "it stops at 18:00 and stands until the next morning");
  const nextDay = kmAt(late, 17 + 1);
  assert.ok(nextDay > still, "and walks again from 08:00");
});

test("the daily hours are local time at the start: a start place two hours east leaves two hours earlier on the app's clock", () => {
  const w = world(map({})), r = route(w, { x: 0.1, y: 0.5 }, { x: 0.1 + 100 / 2000, y: 0.5 });
  const sim = (extra) => T._simulate(w.fm, Object.assign({ route: r.pts.map((p) => [p.x, p.y, p.k]), pace: 4, dayStart: 8, dayEnd: 18, delays: [] }, extra), cfg(), () => null, () => () => null);
  const here = sim({ offset: 0, startT: 1000 + 8 / 24 }), east = sim({ offset: 2, startT: 1000 + 6 / 24 });      // 08:00 local either way
  assert.ok(Math.abs(here.arriveT - east.arriveT + 2 / 24) < 0.01, "the same journey, two hours earlier by the clock");
  const first = sim({ offset: 2, startT: 1000 + 13 / 24, firstStart: 15 });                                       // 15:00 local on the first day
  assert.ok(first.km[3] > 8 && Math.abs(first.km[10] - first.km[3]) < 0.5, "three hours the first day, to 18:00 local");
});
