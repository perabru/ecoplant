// Rendering contracts only. All predictions below are fixtures, not plant recognition.
import assert from 'node:assert/strict';
import { reportHTML, formatPlantAIClassLabel } from '../dist/report.js';
import { evaluateSymptoms } from '../dist/triage.js';

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
assert.match(withoutModel, /data-action="print-report"/);
assert.match(withoutModel, /Imprimir \/ PDF/);
assert.match(withoutModel, /data-action="export-report"/);
assert.match(withoutModel, /data-action="new-plant-analysis" data-id="fixture-plant"/);
assert.match(withoutModel, /Analisar outra foto/);
assert.doesNotMatch(withoutModel, /href="#scan/);
assert.match(reportHTML(record, { id: 'id"&with?marks', name: 'Teste' }), /data-id="id&quot;&amp;with\?marks"/);

// Existing TM reports may contain only their predictions as measured confidence.
const tmPredictionsOnly = structuredClone(record);
delete tmPredictionsOnly.result.confidence;
assert.match(reportHTML(tmPredictionsOnly, plant), /<div class="rp-donut"/);
const hostedTM = structuredClone(record);
hostedTM.result.modelURL = 'https://teachablemachine.withgoogle.com/models/fixture/';
assert.match(reportHTML(hostedTM, plant, { healthyClass: 'Classe A' }), /Classe saudável no modelo/);

// An uploaded photo without supplied signs is a record, never a health verdict.
const observation = evaluateSymptoms([]);
assert.equal(observation.method, 'guided');
assert.equal(observation.title, 'Registro fotográfico');
assert.deepEqual(observation.possibilities, []);
assert.equal(observation.confidence, undefined);
assert.match(observation.summary, /não foi analisada automaticamente/);
assert.doesNotMatch(JSON.stringify(observation), /saudável|sem sinais relatados/i);
const photoRecord = { ...record, symptoms: [], result: observation };
const observationHTML = reportHTML(photoRecord, null, null, { draft: true });
assert.match(observationHTML, /Planta da foto/);
assert.match(observationHTML, /Registro fotográfico · sem análise por IA/);
assert.match(observationHTML, /Nenhum sinal foi informado/);
assert.match(observationHTML, /data-action="save-report"/);
assert.doesNotMatch(observationHTML, /<div class="rp-donut"|role="meter"|Classe saudável no modelo/);

const guidedHTML = reportHTML({ ...record, symptoms: ['spots'], result: evaluateSymptoms(['spots']) }, plant);
assert.match(guidedHTML, /Triagem guiada · sinais informados/);
assert.match(guidedHTML, /Possível mancha foliar/);
assert.doesNotMatch(guidedHTML, /<div class="rp-donut"|role="meter"/);

// Plant AI must identify its own method and source, and display only supplied scores.
const aiRecord = {
  ...record,
  result: {
    method: 'plant-ai', title: 'Classe botânica de teste', topClass: 'Classe A',
    confidence: 0.82, severity: 'observe',
    modelName: 'Modelo de IA · fixture',
    modelURL: 'https://huggingface.co/rodynaemad/plant-disease-dinov2-small',
    modelLabels: ['Classe A', 'Classe B', 'Classe C'],
    predictions: [{ className: 'Classe A', probability: 0.82 }, { className: 'Classe B', probability: 0.12 }, { className: 'Classe C', probability: 0.06 }],
    summary: 'Resumo recebido da análise de teste.',
    care: ['Orientação recebida da análise de teste.'],
    disclaimer: 'Fixture: este registro não representa reconhecimento real.',
    analyzedAt: '2026-11-10T12:00:00Z'
  }
};
const aiHTML = reportHTML(aiRecord, plant);
assert.match(aiHTML, /Análise de imagem por IA/);
assert.match(aiHTML, /Classe botânica de teste/);
assert.match(aiHTML, /Modelo de IA · fixture/);
assert.match(aiHTML, /https:\/\/huggingface\.co\/rodynaemad\/plant-disease-dinov2-small/);
assert.match(aiHTML, /Resumo recebido da análise de teste/);
assert.match(aiHTML, /Orientação recebida da análise de teste/);
assert.match(aiHTML, /Fixture: este registro não representa reconhecimento real/);
assert.match(aiHTML, /<div class="rp-donut"/);
assert.match(aiHTML, /aria-valuenow="82\.0"/);
assert.equal((aiHTML.match(/role="meter"/g) || []).length, 3);
assert.doesNotMatch(aiHTML, /Teachable Machine|Triagem guiada/);
const unknownScope = structuredClone(aiRecord);
delete unknownScope.result.modelLabels;
assert.doesNotMatch(reportHTML(unknownScope, plant), /3 classes no treinamento/);

// Coverage of the original DINOv2 config id2label list, independent of model execution.
const plantVillageLabels = [
  'Apple___Apple_scab', 'Apple___Black_rot', 'Apple___Cedar_apple_rust', 'Apple___healthy',
  'Blueberry___healthy', 'Cherry_(including_sour)___Powdery_mildew', 'Cherry_(including_sour)___healthy',
  'Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot', 'Corn_(maize)___Common_rust_',
  'Corn_(maize)___Northern_Leaf_Blight', 'Corn_(maize)___healthy', 'Grape___Black_rot',
  'Grape___Esca_(Black_Measles)', 'Grape___Leaf_blight_(Isariopsis_Leaf_Spot)', 'Grape___healthy',
  'Orange___Haunglongbing_(Citrus_greening)', 'Peach___Bacterial_spot', 'Peach___healthy',
  'Pepper,_bell___Bacterial_spot', 'Pepper,_bell___healthy', 'Potato___Early_blight',
  'Potato___Late_blight', 'Potato___healthy', 'Raspberry___healthy', 'Soybean___healthy',
  'Squash___Powdery_mildew', 'Strawberry___Leaf_scorch', 'Strawberry___healthy',
  'Tomato___Bacterial_spot', 'Tomato___Early_blight', 'Tomato___Late_blight', 'Tomato___Leaf_Mold',
  'Tomato___Septoria_leaf_spot', 'Tomato___Spider_mites Two-spotted_spider_mite', 'Tomato___Target_Spot',
  'Tomato___Tomato_Yellow_Leaf_Curl_Virus', 'Tomato___Tomato_mosaic_virus', 'Tomato___healthy'
];
const cropPrefixes = { Apple:'Macieira', Blueberry:'Mirtilo', 'Cherry_(including_sour)':'Cerejeira', 'Corn_(maize)':'Milho', Grape:'Videira', Orange:'Laranjeira', Peach:'Pessegueiro', 'Pepper,_bell':'Pimentão', Potato:'Batateira', Raspberry:'Framboeseira', Soybean:'Soja', Squash:'Abóbora', Strawberry:'Morangueiro', Tomato:'Tomateiro' };
assert.equal(plantVillageLabels.length, 38);
for (const original of plantVillageLabels) {
  const label = formatPlantAIClassLabel(original);
  assert(label.startsWith(cropPrefixes[original.split('___')[0]] + ' · '), original);
  assert.doesNotMatch(label, /_/);
  if (original.endsWith('___healthy')) assert(label.endsWith('classe saudável'));
}
assert.equal(formatPlantAIClassLabel('Tomato___Late_blight'), 'Tomateiro · requeima');
assert.equal(formatPlantAIClassLabel('Potato___Early_blight'), 'Batateira · pinta preta');
assert.equal(formatPlantAIClassLabel('Cultivo_novo___Classe_nova'), 'Cultivo novo · Classe nova');

const localizedRecord = structuredClone(aiRecord);
localizedRecord.result.topClass = 'Tomato___healthy';
localizedRecord.result.title = 'Semelhança visual — tomateiro: folha saudável';
localizedRecord.result.predictions = [
  { className: 'Tomato___healthy', probability: 0.82 },
  { className: 'Tomato___Late_blight', probability: 0.12 },
  { className: 'Potato___Early_blight', probability: 0.06 }
];
localizedRecord.result.modelLabels = plantVillageLabels;
const dataBeforeRendering = structuredClone(localizedRecord);
const localizedHTML = reportHTML(localizedRecord, plant);
assert.match(localizedHTML, /<h2>Semelhança visual — tomateiro: folha saudável<\/h2>/);
assert.match(localizedHTML, /aria-label="Tomateiro · classe saudável"/);
assert.match(localizedHTML, /Tomateiro · requeima/);
assert.match(localizedHTML, /<small class="rp-class-original">Classe original: Tomato___healthy<\/small>/);
assert.match(localizedHTML, /aria-valuenow="82\.0"/);
assert.deepEqual(localizedRecord, dataBeforeRendering, 'Presentation must not rewrite original classes or probabilities saved/exported as JSON.');
const rawTitle = { ...localizedRecord, result: { ...localizedRecord.result, title: 'Tomato___healthy' } };
assert.match(reportHTML(rawTitle, plant), /<h2>Classe sugerida: Tomateiro · classe saudável<\/h2>/);
const customTM = { ...localizedRecord, result: { ...localizedRecord.result, method: 'teachable-machine' } };
const customTMHTML = reportHTML(customTM, plant);
assert.match(customTMHTML, /<h2>Tomato___healthy<\/h2>/);
assert.match(customTMHTML, /aria-label="Tomato___healthy"/);
assert.doesNotMatch(customTMHTML, /Tomateiro · classe saudável|rp-class-original">Classe original:/);

const assertInconclusive = result => {
  const html = reportHTML({ ...aiRecord, result }, plant);
  assert.match(html, /<h2>Análise inconclusiva<\/h2>/);
  assert.match(html, /IA · análise inconclusiva/);
  assert.doesNotMatch(html, /<div class="rp-donut"|role="meter"|Classe botânica de teste|Classe A/);
};
const omittedScores = { ...aiRecord.result, title: 'Análise inconclusiva', topClass: 'Análise inconclusiva' };
delete omittedScores.confidence;
delete omittedScores.predictions;
assertInconclusive(omittedScores);
assertInconclusive({ ...aiRecord.result, severity: 'inconclusive' });
assertInconclusive({ ...aiRecord.result, predictions: [] });
for (const confidence of [undefined, null, '', '   ', NaN, Infinity, -1, 1.01, true]) {
  assertInconclusive({ ...aiRecord.result, confidence });
}
assertInconclusive({ ...aiRecord.result, predictions: [{ className: 'Classe A', probability: null }] });
const neutralLocalized = reportHTML({ ...localizedRecord, result: { ...localizedRecord.result, confidence: undefined } }, plant);
assert.match(neutralLocalized, /<h2>Análise inconclusiva<\/h2>/);
assert.doesNotMatch(neutralLocalized, /<div class="rp-donut"|role="meter"|Classe original:|Tomato___healthy|Tomateiro · requeima/);

// Nullable records/plant references are safe even after a plant was removed.
assert.doesNotThrow(() => reportHTML());
assert.doesNotThrow(() => reportHTML(null, null, null, null));
assert.doesNotThrow(() => reportHTML({ result: null }, null, null));
assert.match(reportHTML(null, null, null), /Planta da foto/);

// Photos must remain local, safe raster data URLs; SVG/external/script URLs are excluded.
const raster = 'data:image/png;base64,AA==';
assert.match(reportHTML({ ...photoRecord, photo: raster }, null), /<img class="rp-photo" src="data:image\/png;base64,AA=="/);
for (const unsafePhoto of ['javascript:alert(1)', 'https://example.com/track.png', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AA==" onerror="alert(1)']) {
  assert.doesNotMatch(reportHTML({ ...photoRecord, photo: unsafePhoto }, { photo: unsafePhoto }), /<img class="rp-photo"/);
}

const untrusted = structuredClone(record);
untrusted.result.topClass = '<img src=x onerror=alert(1)>';
untrusted.result.modelName = '<script>alert(1)</script>';
const escaped = reportHTML(untrusted, plant, {});
assert(!escaped.includes('<img src=x'));
assert(!escaped.includes('<script>alert(1)</script>'));
assert(escaped.includes('&lt;img'));

const unsafeAI = structuredClone(aiRecord);
unsafeAI.result.title = '<svg onload=alert(1)>';
unsafeAI.result.summary = '<img src=x onerror=alert(1)>';
unsafeAI.result.care = ['<script>alert(1)</script>'];
unsafeAI.result.disclaimer = '<iframe src=javascript:alert(1)>';
unsafeAI.result.modelURL = 'javascript:alert(1)';
unsafeAI.result.predictions[0].className = '<img src=x onerror=alert(1)>';
const escapedAI = reportHTML(unsafeAI, { name: '<script>name</script>' }, { displayName: '<img src=x>' });
assert.doesNotMatch(escapedAI, /<svg onload=|<img src=x|<script>|<iframe /);
assert.match(escapedAI, /&lt;svg onload=/);
assert.match(escapedAI, /&lt;script&gt;alert/);
assert.match(escapedAI, /Endereço do modelo não informado/);

console.log('Report checks passed: photographic records, nullable data, AI provenance, 38 Portuguese labels with raw data preserved, inconclusive outputs, PDF/new-photo actions, TM history and escaping. Fixture data only; no recognition test.');
