// Loads the weather page's scripts into Node for the tests: they are plain browser scripts that hang their
// functions on FieldMap.prototype and window.Travel, so a stand-in FieldMap and window are enough.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "../../main/resources/static/weather");
global.window = global;
global.FieldMap = global.FieldMap || function FieldMap() {};
const stubCanvas = () => ({ width: 0, height: 0, getContext: () => ({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData() {}, drawImage() {} }) });
global.document = global.document || { createElement: stubCanvas };
const loaded = new Set();
exports.load = (name) => { if (!loaded.has(name)) { loaded.add(name); (0, eval)(fs.readFileSync(path.join(dir, name), "utf8")); } };
exports.read = (name) => fs.readFileSync(path.join(dir, name), "utf8");
exports.stubCanvas = stubCanvas;
/** A flat 400 × 400 map (5 km per pixel) for the travel calculator, with whatever is given on top. */
exports.map = (o) => Object.assign({ imgW: 400, imgH: 400, kmPerMapPx: () => 5, heightGrid: () => ({}), groundM: () => 50, layerAt: () => 0,
  roads: [], nations: [], rivers: [], cities: [], riverFlows: () => {} }, o);
