// Rendering contracts only. All predictions below are fixtures, not plant recognition.
import assert from 'node:assert/strict';
import { reportHTML as fullReportHTML, formatPlantAIClassLabel, downloadReport } from '../dist/report.js';
import { evaluateSymptoms } from '../dist/triage.js';
const reportHTML = (...args) => fullReportHTML(...args).replace(/<style>[\s\S]*?<\/style>/g, '');

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
assert.doesNotMatch(reportHTML(hostedTM, plant, { healthyClass: 'Classe A' }), /Classe saudável no modelo/);
// Changing a profile/model must never rewrite the interpretation of old reports.
for (const modelURL of ['local:ecoplant-model', hostedTM.result.modelURL]) {
  const snapshot = structuredClone(record);
  snapshot.result.modelURL = modelURL;
  snapshot.result.title = 'Classe saudável no modelo';
  snapshot.result.summary = 'A classe saudável configurada nesta análise foi Classe A.';
  const captured = reportHTML(snapshot, plant, {});
  assert.match(captured, /Classe saudável no modelo/);
  assert.match(captured, /A classe saudável configurada nesta análise foi Classe A/);
  assert.equal(captured, reportHTML(snapshot, plant, {healthyClass:'Classe B'}));
  snapshot.result.severity = 'observe';
  snapshot.result.title = 'Análise inconclusiva';
  assert.doesNotMatch(reportHTML(snapshot, plant), /Classe saudável no modelo/);
  assert.match(reportHTML(snapshot, plant), /Classificação inconclusiva/);
}

// Confident negative classes retain the measured label without a health verdict.
for (const label of ['Desconhecidas', 'Planta de plastico']) {
  const neutral = structuredClone(record);
  neutral.photo = 'data:image/jpeg;base64,AA==';
  Object.assign(neutral.result, { modelURL: 'https://example.test/ecoplant/my_model/', modelLabels: [label, 'Plantas_Saudaveis'], topClass: label,
    confidence: 0.96, predictions: [{className: label, probability: 0.96}], title: 'Classe fora da avaliação de saúde',
    summary: `O modelo escolheu “${label}”. Essa classe não recebe avaliação de saúde.` });
  const html = reportHTML(neutral, plant);
  assert.match(html, new RegExp(`<h2>${label}</h2>`));
  assert.match(html, /Classe fora da avaliação de saúde/);
  assert.match(html, /rp-verdict-neutral/);
  assert.match(html, /Essa classe não recebe avaliação de saúde/);
  assert.match(html, /<div class="rp-donut"/);
  assert.match(html, /data-action="adjust-report-photo"/);
  assert.match(html, /Para tentar novamente/);
  assert.doesNotMatch(html, /rp-verdict-healthy|rp-verdict-danger|Classe saudável no modelo|Classificação inconclusiva/);
  assert.equal(html, reportHTML(neutral, plant, {healthyClass:label}), 'A changed profile cannot turn a recorded negative class into healthy.');
}

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

// All 38 original classes use Portuguese presentation; stored labels remain untouched.
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


// Real label names with fixture scores only: this tests presentation, not recognition.
const aiRecord = {
  ...record,
  result: {
    method: 'plant-ai', title: 'Antigo título da classe', topClass: 'Tomato___healthy',
    confidence: 0.82, severity: 'observe',
    modelName: 'Modelo de IA · fixture',
    modelURL: 'https://huggingface.co/rodynaemad/plant-disease-dinov2-small',
    modelLabels: plantVillageLabels,
    predictions: [{ className: 'Tomato___healthy', probability: 0.82 }, { className: 'Tomato___Late_blight', probability: 0.12 }, { className: 'Potato___Early_blight', probability: 0.06 }],
    summary: 'Resumo antigo não deve substituir o parecer atual.',
    care: ['Orientação antiga não deve substituir o parecer atual.'],
    disclaimer: 'Fixture: este registro não representa reconhecimento real.',
    analyzedAt: '2026-11-10T12:00:00Z'
  }
};
const dataBeforeRendering = structuredClone(aiRecord);
const aiHTML = reportHTML(aiRecord, plant);
assert.match(aiHTML, /Análise de imagem por IA/);
assert.match(aiHTML, /data-health-status="healthy"/);
assert.match(aiHTML, /<h2>Aparência saudável<\/h2>/);
assert.match(aiHTML, /rp-verdict-healthy/);
assert.match(aiHTML, /rp-status-healthy/);
assert.match(aiHTML, /Planta reconhecida pelo modelo/);
assert.match(aiHTML, /Compatível com a classe saudável/);
assert.match(aiHTML, /Confiança na classificação/);
assert.match(aiHTML, /Modelo de IA · fixture/);
assert.match(aiHTML, /https:\/\/huggingface\.co\/rodynaemad\/plant-disease-dinov2-small/);
assert.match(aiHTML, /Fixture: este registro não representa reconhecimento real/);
assert.match(aiHTML, /<div class="rp-donut"/);
assert.match(aiHTML, /aria-valuenow="82\.0"/);
assert.equal((aiHTML.match(/role="meter"/g) || []).length, 3);
assert.doesNotMatch(aiHTML, /Teachable Machine|Triagem guiada|Antigo título|Resumo antigo|Orientação antiga/);
assert.match(aiHTML, /aria-label="Tomateiro · classe saudável"/);
assert.match(aiHTML, /Tomateiro · requeima/);
assert.match(aiHTML, /<small class="rp-class-original">Classe original: Tomato___healthy<\/small>/);
assert.deepEqual(aiRecord, dataBeforeRendering, 'Rendering must preserve original values in the record.');

// Known labels all produce the appropriate verdict rather than interpreting label text heuristically.
for (const original of plantVillageLabels) {
  const alternatives = plantVillageLabels.filter(label => label !== original).slice(0, 2);
  const result = { ...aiRecord.result, topClass: original, confidence: 0.9, predictions: [{className: original, probability: 0.9}, {className: alternatives[0], probability: 0.06}, {className: alternatives[1], probability: 0.04}] };
  const html = reportHTML({ ...aiRecord, result }, plant);
  const status = original.endsWith('___healthy') ? 'healthy' : original.includes('Spider_mites') ? 'pest' : 'disease';
  assert.match(html, new RegExp('data-health-status="' + status + '"'), original);
  if (status === 'healthy') assert.match(html, /<h2>Aparência saudável<\/h2>/, original);
  else if (status === 'pest') assert.match(html, /<h2>Sinais de possível praga<\/h2>/, original);
  else assert.match(html, /<h2>Sinais de possível doença<\/h2>/, original);
}
const diseasedRecord = structuredClone(aiRecord);
diseasedRecord.result.topClass = 'Apple___Apple_scab';
diseasedRecord.result.confidence = 0.96;
diseasedRecord.result.predictions = [{className:'Apple___Apple_scab',probability:0.96},{className:'Apple___healthy',probability:0.03},{className:'Apple___Black_rot',probability:0.01}];
const diseaseHTML = reportHTML(diseasedRecord, plant);
assert.match(diseaseHTML, /rp-verdict-danger/);
assert.match(diseaseHTML, /rp-status-danger/);
assert.match(diseaseHTML, /<dt>Possível doença<\/dt>/);
assert.match(diseaseHTML, /sarna/i);
assert.match(diseaseHTML, /macieira/i);
assert.doesNotMatch(diseaseHTML, /<h2>Aparência saudável|doença confirmada|diagnóstico confirmado/i);

const unknownScope = structuredClone(aiRecord);
delete unknownScope.result.modelLabels;
assert.doesNotMatch(reportHTML(unknownScope, plant), /38 classes no treinamento/);
const rawTitle = { ...aiRecord, result: { ...aiRecord.result, title: 'Tomato___healthy' } };
assert.match(reportHTML(rawTitle, plant), /<h2>Aparência saudável<\/h2>/);
const customTM = { ...aiRecord, result: { ...aiRecord.result, method: 'teachable-machine' } };
const customTMHTML = reportHTML(customTM, plant);
assert.match(customTMHTML, /<h2>Tomato___healthy<\/h2>/);
assert.match(customTMHTML, /aria-label="Tomato___healthy"/);
assert.doesNotMatch(customTMHTML, /data-health-status=|Tomateiro · classe saudável|rp-class-original">Classe original:/);

const assertInconclusive = result => {
  const html = reportHTML({ ...aiRecord, result }, plant);
  assert.match(html, /<h2>Análise inconclusiva<\/h2>/);
  assert.match(html, /data-health-status="inconclusive"/);
  assert.match(html, /IA · análise inconclusiva/);
  assert.match(html, /rp-status-neutral/);
  assert.doesNotMatch(html, /<div class="rp-donut"|role="meter"|Antigo título|Resumo antigo|Orientação antiga|Classe original:|<dt>Possível doença<\/dt>/);
};
const omittedScores = { ...aiRecord.result, title: 'Análise inconclusiva', topClass: 'Análise inconclusiva' };
delete omittedScores.confidence;
delete omittedScores.predictions;
assertInconclusive(omittedScores);
assertInconclusive({ ...aiRecord.result, severity: 'inconclusive' });
assertInconclusive({ ...aiRecord.result, predictions: [] });
for (const confidence of [undefined, null, '', '   ', NaN, Infinity, -1, 1.01, true]) assertInconclusive({ ...aiRecord.result, confidence });
assertInconclusive({ ...aiRecord.result, topClass:'Unknown___healthy', confidence:0.99, predictions:[{className:'Unknown___healthy', probability:0.99}] });
assertInconclusive({ ...aiRecord.result, confidence:0.6, predictions:[{className:'Tomato___healthy',probability:0.6},{className:'Tomato___Late_blight',probability:0.3},{className:'Tomato___Bacterial_spot',probability:0.1}] });
assertInconclusive({ ...aiRecord.result, predictions:[{className:'Tomato___Late_blight',probability:0.82},{className:'Tomato___healthy',probability:0.12},{className:'Potato___Early_blight',probability:0.06}] });
assertInconclusive({ ...aiRecord.result, predictions: [{ className: 'Tomato___healthy', probability: null }] });
const staleDisease = { ...diseasedRecord.result, title:'Sarna antiga', summary:'A planta está doente segundo a análise antiga.', care:['Tratar a sarna antiga.'], confidence:0.6, predictions:[{className:'Apple___Apple_scab',probability:0.6},{className:'Apple___healthy',probability:0.3},{className:'Apple___Black_rot',probability:0.1}] };
const staleHTML = reportHTML({...diseasedRecord,result:staleDisease}, plant);
assertInconclusive(staleDisease);
assert.doesNotMatch(staleHTML, /Sarna antiga|A planta está doente|Tratar a sarna|Apple___Apple_scab|<div class="rp-donut"|role="meter"/);

// A stored neutral explanation must survive rendering without revealing scores.
const uncertainSummary = 'A IA não diferenciou as classes com segurança suficiente nesta foto. Não foi possível informar se a folha tem aparência saudável ou apresenta sinais de doença.';
const uncertainPhotoRecord = { id:'uncertain-copy', photo:'data:image/png;base64,AA==', result:{
  method:'plant-ai', title:'Análise inconclusiva', topClass:'Análise inconclusiva', severity:'observe',
  summary:uncertainSummary, care:['Confira a folha inteira antes de tentar outra foto.']
} };
const uncertainCopyHTML = reportHTML(uncertainPhotoRecord, plant);
assert.match(uncertainCopyHTML, /A IA não diferenciou as classes com segurança suficiente nesta foto/);
assert.match(uncertainCopyHTML, /Confira a folha inteira antes de tentar outra foto/);
assert.match(uncertainCopyHTML, /data-action="adjust-report-photo"/);
assert.match(uncertainCopyHTML, /Ajustar foto e tentar novamente/);
assert.match(uncertainCopyHTML, /href="#profile\?model=files"/);
assert.match(uncertainCopyHTML, /Usar meu modelo treinado/);
assert.match(uncertainCopyHTML, /Para tentar novamente/);
assert.doesNotMatch(uncertainCopyHTML, /<div class="rp-donut"|role="meter"|<dt>Possível doença<\/dt>/);
const noPhotoRecovery = structuredClone(uncertainPhotoRecord); delete noPhotoRecovery.photo;
assert.doesNotMatch(reportHTML(noPhotoRecovery, {...plant,photo:'data:image/png;base64,AA=='}), /data-action="adjust-report-photo"/);
const tmUncertain = {...uncertainPhotoRecord,result:{method:'teachable-machine',title:'Análise inconclusiva',severity:'observe',topClass:'Classe A',confidence:0.55,predictions:[{className:'Classe A',probability:0.55},{className:'Classe B',probability:0.45}]}};
const tmRecoveryHTML = reportHTML(tmUncertain,plant);
assert.match(tmRecoveryHTML, /data-action="adjust-report-photo"/);
assert.match(tmRecoveryHTML, /O modelo próprio não diferenciou suas classes/);
assert.doesNotMatch(tmRecoveryHTML, /Usar meu modelo treinado|14 culturas|<div class="rp-donut"|role="meter"/);
assert.doesNotMatch(reportHTML(aiRecord,plant), /data-action="adjust-report-photo"/);
const escapedNeutralCare = structuredClone(uncertainPhotoRecord);
escapedNeutralCare.result.care=['Uma nova foto <img src=x onerror=alert(1)> deve ficar centralizada.'];
const escapedNeutralHTML = reportHTML(escapedNeutralCare,plant);
assert.doesNotMatch(escapedNeutralHTML, /<img src=x onerror/);
assert.match(escapedNeutralHTML, /&lt;img src=x onerror=alert\(1\)&gt;/);

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
assert.match(escapedAI, /&lt;script&gt;name/);
assert.match(escapedAI, /&lt;img src=x&gt;/);
assert.match(escapedAI, /&lt;iframe src=javascript:alert\(1\)&gt;/);
assert.match(escapedAI, /<h2>Análise inconclusiva<\/h2>/);
assert.match(escapedAI, /Endereço do modelo não informado/);

// JSON export keeps the original measurements while exposing the current interpretation.
let exportedBlob;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const originalDocument = globalThis.document;
URL.createObjectURL = blob => { exportedBlob = blob; return 'blob:report-fixture'; };
URL.revokeObjectURL = () => {};
globalThis.document = { createElement: () => ({ style: {}, click(){}, remove(){} }), body: { appendChild(){} } };
try {
  const staleRecord = {...diseasedRecord, result:staleDisease};
  const beforeExport = structuredClone(staleRecord);
  const downloaded = downloadReport(staleRecord, plant);
  const envelope = JSON.parse(await exportedBlob.text());
  assert.equal(envelope.assessment.status, 'inconclusive');
  assert.equal(envelope.assessment.condition, '');
  assert.equal(envelope.assessment.policy.version, 'ecoplant-health-v1');
  assert.equal(envelope.assessment.policy.minConfidence, 0.75);
  assert.equal(envelope.assessment.policy.minMargin, 0.15);
  assert.equal(envelope.report.result.topClass, 'Apple___Apple_scab');
  assert.equal(envelope.report.result.confidence, 0.6);
  assert.deepEqual(envelope.report, beforeExport);
  assert.deepEqual(staleRecord, beforeExport);
  assert(downloaded.fileName.endsWith('.json'));
  assert(downloaded.size > 0);
  downloadReport(record, plant);
  assert.equal('assessment' in JSON.parse(await exportedBlob.text()), false, 'TM export must not invent an EcoPlant health verdict.');
} finally {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
}

console.log('Report checks passed: clear healthy/disease/pest verdicts across 38 known classes, neutral abstention, safe stale records, consistent AI presentation, source and raw data preservation, photographic records, PDF/new-photo actions, TM legacy and escaping. Fixture scores only, not model recognition.');
