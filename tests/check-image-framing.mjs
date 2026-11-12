import assert from 'node:assert/strict';
import { cropBounds, framedCanvas } from '../dist/image-framing.js';

// A horizontal image must allow an off-centre leaf to enter the square without
// changing its proportions or reading outside the original photograph.
assert.deepEqual(cropBounds(1600, 900, { x: 0 }), { x: 0, y: 0, width: 900, height: 900 });
assert.deepEqual(cropBounds(1600, 900, { x: 100 }), { x: 700, y: 0, width: 900, height: 900 });
assert.deepEqual(cropBounds(900, 1600, { zoom: 2, x: 50, y: 100 }), { x: 225, y: 1150, width: 450, height: 450 });
for (const [width, height] of [[1600, 900], [900, 1600], [256, 256], [1, 1]]) {
  for (const zoom of [1, 2, 4, 100, NaN]) for (const x of [-100, 0, 50, 100, Infinity]) for (const y of [-100, 0, 50, 100]) {
    const area = cropBounds(width, height, { zoom, x, y });
    assert.ok(area.width > 0 && area.width === area.height);
    assert.ok(area.x >= 0 && area.y >= 0);
    assert.ok(area.x + area.width <= width + 1e-9 && area.y + area.height <= height + 1e-9);
  }
}
assert.throws(() => cropBounds(0, 100));
assert.throws(() => cropBounds(Infinity, 100));
const image = { naturalWidth: 1600, naturalHeight: 900 }, calls = [];
const canvas = { getContext: () => ({ drawImage: (...args) => calls.push(args) }) };
assert.equal(framedCanvas(image, { zoom: 2, x: 100, y: 50 }, { createElement: () => canvas }), canvas);
assert.equal(canvas.width, 450); assert.equal(canvas.height, 450);
assert.deepEqual(calls, [[image, 1150, 225, 450, 450, 0, 0, 450, 450]]);
console.log('PASS framing keeps aspect ratio, supports off-centre leaves, bounds selections, and exports only the photo');
