// An imported model's saved report must not change with the next model or reload.
import assert from 'node:assert/strict';
import { reportHTML } from '../dist/report.js';

const record = {
  id: 'fixture-report', date: '2026-11-10T12:00:00Z', plantId: 'fixture-plant',
  result: {
    method: 'teachable-machine', modelURL: 'local:ecoplant-model',
    modelName: 'Fixture only', modelLabels: ['Classe A', 'Classe B'],
    predictions: [{ className: 'Classe A', probability: 0.75 }, { className: 'Classe B', probability: 0.25 }],
    topClass: 'Classe A', confidence: 0.75
  }
};
const plant = { id: 'fixture-plant', name: 'Planta de teste' };
const withoutModel = reportHTML(record, plant, {});
assert.equal(withoutModel, reportHTML(record, plant, { healthyClass: 'Classe A' }));
assert.equal(withoutModel, reportHTML(record, plant, { healthyClass: 'Classe B' }));
assert.match(withoutModel, /Arquivos do Teachable Machine importados nesta aba/);
assert.match(withoutModel, /Classe identificada pelo modelo/);
assert.match(withoutModel, /75/);

const untrusted = structuredClone(record);
untrusted.result.topClass = '<img src=x onerror=alert(1)>';
untrusted.result.modelName = '<script>alert(1)</script>';
const escaped = reportHTML(untrusted, plant, {});
assert(!escaped.includes('<img src=x'));
assert(!escaped.includes('<script>alert(1)</script>'));
assert(escaped.includes('&lt;img'));
console.log('Report checks passed: imported-model history stays stable and model labels are escaped. Fixture data only.');
