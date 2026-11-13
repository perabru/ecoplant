// Interpretation contracts with explicit fixtures, not recognition/accuracy tests.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describePlantHealth, describeInconclusiveReason, PLANT_HEALTH_POLICY, PLANT_HEALTH_POLICY_VERSION } from '../dist/plant-health.js';

const healthyClass = 'Tomato___healthy';
const diseaseClass = 'Apple___Apple_scab';
const pestClass = 'Tomato___Spider_mites Two-spotted_spider_mite';
function fixture(topClass = healthyClass, confidence = 0.98) {
  const others = [healthyClass, diseaseClass, pestClass].filter(name => name !== topClass).slice(0, 2);
  return {
    method: 'plant-ai', topClass, confidence, severity: 'observe',
    predictions: [{ className: topClass, probability: confidence },
      { className: others[0], probability: (1 - confidence) * 0.7 },
      { className: others[1], probability: (1 - confidence) * 0.2 }]
  };
}
let checks = 0;
function test(name, fn) { fn(); checks++; console.log(`✓ ${name}`); }
function assertInconclusive(input) {
  const verdict = describePlantHealth(input);
  assert.equal(verdict.status, 'inconclusive');
  assert.equal(verdict.title, 'Análise inconclusiva');
  assert.equal(verdict.tone, 'neutral');
  assert.equal(verdict.crop, '');
  assert.equal(verdict.condition, '');
  assert.equal(Object.hasOwn(verdict, 'confidence'), false);
  assert.equal(Object.hasOwn(verdict, 'predictions'), false);
  assert(verdict.care.length > 0);
  return verdict;
}

test('healthy tomato fixture has an explicit qualified healthy verdict', () => {
  const verdict = describePlantHealth(fixture());
  assert.equal(verdict.status, 'healthy');
  assert.equal(verdict.title, 'Aparência saudável');
  assert.equal(verdict.shortLabel, verdict.title);
  assert.equal(verdict.crop, 'Tomateiro');
  assert.equal(verdict.tone, 'healthy');
  assert.match(verdict.summary, /não descarta outros problemas/);
});
test('apple scab fixture names the suspected disease and crop', () => {
  const verdict = describePlantHealth(fixture(diseaseClass));
  assert.equal(verdict.status, 'disease');
  assert.equal(verdict.title, 'Sinais de possível doença');
  assert.equal(verdict.condition, 'Sarna');
  assert.equal(verdict.crop, 'Macieira');
  assert.equal(verdict.tone, 'danger');
  assert.match(verdict.summary, /hipótese visual/);
});
test('spider mites are a possible pest, not a disease', () => {
  const verdict = describePlantHealth(fixture(pestClass));
  assert.equal(verdict.status, 'pest');
  assert.equal(verdict.condition, 'Ácaro rajado');
  assert.equal(verdict.title, 'Sinais de possível praga');
});
test('all 38 production classes map to valid Portuguese verdicts', () => {
  const source = readFileSync(new URL('../dist/plant-ai.js', import.meta.url), 'utf8');
  const labelsBlock = source.match(/const LABELS = Object\.freeze\(\[([\s\S]*?)\]\);/);
  assert(labelsBlock, 'production label list present');
  const labels = [...labelsBlock[1].matchAll(/'([^']+)'/g)].map(match => match[1]);
  assert.equal(labels.length, 38);
  const counts = { healthy: 0, disease: 0, pest: 0 };
  for (const label of labels) {
    const verdict = describePlantHealth(fixture(label));
    assert(['healthy', 'disease', 'pest'].includes(verdict.status), label);
    counts[verdict.status]++;
    assert(verdict.crop && verdict.condition && verdict.care.length >= 3, label);
    assert.doesNotMatch(verdict.condition, /___/);
    assert.equal(verdict.status === 'healthy', label.endsWith('___healthy'), label);
  }
  assert.deepEqual(counts, { healthy: 12, disease: 25, pest: 1 });
});
test('cutoffs are an explicit display policy with a supported lower boundary', () => {
  assert.equal(PLANT_HEALTH_POLICY_VERSION, 'ecoplant-health-v1');
  assert.deepEqual(PLANT_HEALTH_POLICY, { minConfidence: 0.75, minMargin: 0.15 });
  assert.equal(describePlantHealth(fixture(healthyClass, 0.75)).status, 'healthy');
  assert.equal(describePlantHealth(fixture(diseaseClass, 0.75)).status, 'disease');
  assert.equal(assertInconclusive(fixture(healthyClass, 0.749999)).reason, 'low-confidence');
  assert.equal(assertInconclusive(fixture(diseaseClass, 0.749999)).reason, 'low-confidence');
});
test('crops with only healthy examples cannot imply disease exclusion', () => {
  for (const label of ['Blueberry___healthy', 'Raspberry___healthy', 'Soybean___healthy']) {
    const verdict = describePlantHealth(fixture(label));
    assert.equal(verdict.status, 'healthy');
    assert.match(verdict.summary, /só tem exemplos saudáveis/);
    assert.match(verdict.summary, /não compara doenças específicas/);
    assert.doesNotMatch(verdict.summary, /descartou|livre de doença|nenhuma doença|sem doença/i);
  }
});
test('orange and squash disease hypotheses disclose missing healthy comparison', () => {
  for (const label of ['Orange___Haunglongbing_(Citrus_greening)', 'Squash___Powdery_mildew']) {
    const verdict = describePlantHealth(fixture(label));
    assert.equal(verdict.status, 'disease');
    assert.match(verdict.summary, /não inclui uma classe saudável/);
    assert.match(verdict.summary, /hipótese visual/);
  }
});
test('ambiguous close classes have no verdict even if the top class is healthy', () => {
  assertInconclusive({ ...fixture(), confidence: 0.51, predictions: [
    { className: healthyClass, probability: 0.51 },
    { className: diseaseClass, probability: 0.49 }
  ] });
});
test('inference-time OOD result remains inconclusive without scores', () => {
  assertInconclusive({ method: 'plant-ai', title: 'Análise inconclusiva', topClass: 'Análise inconclusiva', severity: 'observe' });
});
test('explicit inconclusive markers override apparently confident stale scores', () => {
  for (const field of ['title', 'topClass']) assertInconclusive({ ...fixture(), [field]: 'Análise inconclusiva' });
  for (const field of ['status', 'severity']) assertInconclusive({ ...fixture(), [field]: 'inconclusive' });
});
test('saved low-confidence feedback keeps its original explanation and recovery steps', () => {
  const original = describePlantHealth(fixture(healthyClass, 0.62));
  const stored = { method:'plant-ai', title:original.title, topClass:original.title,
    severity:'observe', summary:original.summary, care:[...original.care] };
  const before = JSON.stringify(stored);
  const restored = assertInconclusive(stored);
  assert.equal(restored.reason, 'low-confidence');
  assert.equal(restored.summary, original.summary);
  assert.deepEqual(restored.care, original.care);
  restored.care[0] = 'Changed only in the returned copy';
  assert.equal(JSON.stringify(stored), before);
});
test('new and legacy compatibility failures retain neutral scope/enframing feedback', () => {
  const feedback = describeInconclusiveReason('model-compatibility');
  const stored = { method:'plant-ai', title:feedback.title, topClass:feedback.title,
    severity:'observe', summary:feedback.summary, care:[...feedback.care] };
  const restored = assertInconclusive(stored);
  assert.equal(restored.reason, 'model-compatibility');
  assert.equal(restored.summary, feedback.summary);
  assert.deepEqual(restored.care, feedback.care);
  const legacy = { ...stored, summary:'A imagem não foi suficientemente compatível com as folhas e classes conhecidas pela IA, ou a classificação ficou incerta. Nenhuma doença nem condição saudável foi atribuída a esta foto.',
    care:['Fotografe uma única folha de perto, inteira no enquadramento, em boa luz e com fundo simples.'] };
  const oldResult = assertInconclusive(legacy);
  assert.equal(oldResult.reason, 'model-compatibility');
  assert.equal(oldResult.summary, legacy.summary);
  assert.deepEqual(oldResult.care, legacy.care);
});
test('disagreement between the models remains neutral when the report is restored', () => {
  const feedback = describeInconclusiveReason('model-disagreement');
  assert.equal(feedback.summary, 'Os dois modelos produziram avaliações diferentes sobre a saúde desta folha. Não foi atribuída uma condição saudável ou uma doença nesta análise.');
  const stored = { method: 'plant-ai', title: feedback.title, topClass: feedback.title,
    severity: 'observe', summary: feedback.summary, care: [...feedback.care] };
  const restored = assertInconclusive(stored);
  assert.equal(restored.reason, 'model-disagreement');
  assert.equal(restored.summary, feedback.summary);
  assert.deepEqual(restored.care, feedback.care);
  assert.match(restored.care.join(' '), /outra foto|outras folhas|profissional/);
  assert.equal(assertInconclusive({ ...stored, confidence: 0.99 }).reason, 'explicit-inconclusive');
});
test('neutral titles do not recover arbitrary disease summaries or stale scored records', () => {
  const feedback = describeInconclusiveReason('model-compatibility');
  const stored = { method:'plant-ai', title:feedback.title, topClass:feedback.title,
    severity:'observe', summary:feedback.summary, care:[...feedback.care] };
  for (const result of [
    { ...stored, summary:'A planta tem sarna. Trate agora.', care:['Tratar a sarna.'] },
    { ...stored, confidence:0.98 },
    { ...stored, predictions:fixture().predictions },
    { ...stored, topClass:diseaseClass }
  ]) {
    const restored = assertInconclusive(result);
    assert.equal(restored.reason, 'explicit-inconclusive');
    assert.doesNotMatch(restored.summary, /tem sarna|Trate agora/);
    assert.doesNotMatch(restored.care.join(' '), /Tratar a sarna/);
  }
});
test('guided/custom/missing results are never interpreted as plant AI', () => {
  for (const result of [null, undefined, false, [], 'healthy', {}, { ...fixture(), method: 'guided' }, { ...fixture(), method: 'teachable-machine' }]) {
    const verdict = describePlantHealth(result);
    assert.equal(verdict.status, 'unassessed');
    assert.equal(verdict.crop, '');
    assert.equal(verdict.condition, '');
  }
});
test('missing and nonnumeric confidence cannot produce a verdict', () => {
  for (const confidence of [undefined, null, '', '0.98', true, false, NaN, Infinity, -0.01, 1.01]) assertInconclusive({ ...fixture(), confidence });
});
test('unknown and prototype-like labels cannot imply health or disease', () => {
  for (const label of ['Rose___healthy', 'healthy', 'Tomato___unknown', 'constructor', '__proto__', 'Tomato___healthy ']) assertInconclusive(fixture(label));
});
test('unknown or malformed secondary predictions are also rejected', () => {
  for (const item of [null, [], { className: 'Rose___healthy', probability: 0.01 }, { className: diseaseClass, probability: '0.01' }, { className: diseaseClass, probability: NaN }]) {
    const input = fixture(); input.predictions[1] = item; assertInconclusive(input);
  }
});
test('missing predictions or a lone class cannot claim a confident result', () => {
  for (const predictions of [undefined, null, {}, [], [fixture().predictions[0]]]) assertInconclusive({ ...fixture(), predictions });
});
test('duplicate classes and impossible probability totals are rejected', () => {
  const duplicate = fixture(); duplicate.predictions[1] = { className: healthyClass, probability: 0.01 }; assertInconclusive(duplicate);
  const total = fixture(); total.predictions[1].probability = 0.3; assertInconclusive(total);
});
test('mismatched top class and confidence cannot relabel an existing score', () => {
  assertInconclusive({ ...fixture(), topClass: diseaseClass });
  assertInconclusive({ ...fixture(), confidence: 0.99 });
});
test('input order is irrelevant and source records are never mutated', () => {
  const input = fixture(); input.predictions.reverse();
  const before = JSON.stringify(input);
  assert.equal(describePlantHealth(input).status, 'healthy');
  assert.equal(JSON.stringify(input), before);
  const first = describePlantHealth(input); first.care[0] = 'changed';
  assert.notEqual(describePlantHealth(input).care[0], 'changed');
});
test('confidence is not copied into a synthetic health score', () => {
  const verdict = describePlantHealth(fixture());
  assert.equal(Object.hasOwn(verdict, 'confidence'), false);
  assert.equal(Object.hasOwn(verdict, 'healthScore'), false);
  assert.equal(Object.hasOwn(verdict, 'predictions'), false);
});

// The bundled model supports a known healthy class and disease vocabulary,
// while personal Teachable Machine models keep their own interpretation.
const ecoMetadata = JSON.parse(readFileSync(new URL('../dist/my_model/metadata.json', import.meta.url), 'utf8'));
function ecoFixture(scores = [['Plantas_Saudaveis', 0.91], ['Ferrugem', 0.05], ['Desconhecidas', 0.02]]) {
  const predictions = scores.map(([className, probability]) => ({ className, probability }));
  return { method: 'teachable-machine', modelName: ecoMetadata.modelName,
    modelURL: new URL('../dist/my_model/', import.meta.url).href, modelLabels: [...ecoMetadata.labels],
    topClass: predictions[0].className, confidence: predictions[0].probability, predictions };
}
test('the bundled healthy model receives the same visible health verdict as image AI', () => {
  const verdict = describePlantHealth(ecoFixture());
  assert.equal(verdict.status, 'healthy');
  assert.equal(verdict.title, 'Aparência saudável');
  assert.equal(verdict.tone, 'healthy');
  assert.equal(verdict.crop, '', 'the disease model must not invent a species');
  assert.match(verdict.summary, /classe saudável do modelo EcoPlant/);
  assert.match(verdict.summary, /não descarta outros problemas/);
  assert.equal(describePlantHealth({ ...ecoFixture(), modelURL: './my_model/' }).status, 'healthy');
});
test('confident EcoPlant disease classes name a visual hypothesis', () => {
  for (const name of ['Antracnose', 'Ferrugem', 'Fumagina', 'Míldio', 'Oídio', 'Podridão_radicular']) {
    const verdict = describePlantHealth(ecoFixture([[name, 0.89], ['Plantas_Saudaveis', 0.06], ['Desconhecidas', 0.03]]));
    assert.equal(verdict.status, 'disease');
    assert.equal(verdict.condition, name.replaceAll('_', ' '));
    assert.equal(verdict.reason, 'accepted-classification');
    assert.match(verdict.summary, /hipótese visual/);
  }
});
test('split disease predictions produce an attention result without inventing the exact disease', () => {
  const result = { ...ecoFixture([['Ferrugem', 0.4], ['Míldio', 0.3], ['Oídio', 0.15]]), title: 'Análise inconclusiva' };
  const original = JSON.stringify(result);
  const verdict = describePlantHealth(result);
  assert.equal(verdict.status, 'disease');
  assert.equal(verdict.condition, '');
  assert.equal(verdict.crop, '');
  assert.equal(verdict.reason, 'disease-group');
  assert.match(verdict.summary, /não distinguem qual delas/);
  assert.equal(Object.hasOwn(verdict, 'confidence'), false);
  assert.equal(Object.hasOwn(verdict, 'healthScore'), false);
  assert.equal(JSON.stringify(result), original);
  assert.equal(describePlantHealth(ecoFixture([['Ferrugem', 0.35], ['Míldio', 0.25], ['Oídio', 0.15]])).status, 'disease');
});
test('truncated EcoPlant scores are never renormalized to cross the threshold', () => {
  const result = ecoFixture([['Ferrugem', 0.3], ['Míldio', 0.2], ['Oídio', 0.1]]);
  assert.equal(assertInconclusive(result).reason, 'low-confidence');
  assert.equal(assertInconclusive(ecoFixture([['Plantas_Saudaveis', 0.749999], ['Ferrugem', 0.15], ['Míldio', 0.08]])).reason, 'low-confidence');
  assert.equal(describePlantHealth(ecoFixture([['Plantas_Saudaveis', 0.75], ['Ferrugem', 0.15], ['Míldio', 0.08]])).status, 'healthy');
});
test('unknown, artificial plant and coloration labels never support a disease sum', () => {
  for (const name of ['Desconhecidas', 'Planta de plastico', 'Vitiligo']) {
    const verdict = assertInconclusive(ecoFixture([[name, 0.89], ['Ferrugem', 0.05], ['Plantas_Saudaveis', 0.03]]));
    assert.match(verdict.summary, /não avalia|não confirma doença/);
  }
  assertInconclusive(ecoFixture([['Ferrugem', 0.4], ['Vitiligo', 0.3], ['Míldio', 0.15]]));
  assertInconclusive(ecoFixture([['Ferrugem', 0.4], ['Desconhecidas', 0.3], ['Míldio', 0.15]]));
});
test('personal models cannot inherit the bundled EcoPlant interpretation by name alone', () => {
  for (const changed of [
    { modelURL: 'local:ecoplant-model' },
    { modelURL: 'https://teachablemachine.withgoogle.com/models/example/' },
    { modelURL: 'https://unrelated.example/my_model/' },
    { modelName: 'Meu treinamento' },
    { modelLabels: ['Plantas_Saudaveis', 'Ferrugem'] },
    { modelLabels: [...ecoMetadata.labels.slice(1), ecoMetadata.labels[1]] }
  ]) assert.equal(describePlantHealth({ ...ecoFixture(), ...changed }).status, 'unassessed');
});
test('malformed or stale EcoPlant scores cannot create a health verdict', () => {
  for (const changed of [
    { confidence: '0.91' }, { confidence: NaN }, { confidence: 0.92 },
    { topClass: 'Ferrugem' }, { severity: 'inconclusive' }, { status: 'inconclusive' },
    { title: 'Análise inconclusiva' },
    { predictions: [{ className: 'Plantas_Saudaveis', probability: 0.91 }] },
    { predictions: [{ className: 'Plantas_Saudaveis', probability: 0.91 }, { className: 'Plantas_Saudaveis', probability: 0.05 }] },
    { predictions: [{ className: 'Plantas_Saudaveis', probability: 0.91 }, { className: 'Ferrugem', probability: 0.3 }] },
    { predictions: [{ className: 'Plantas_Saudaveis', probability: 0.91 }, { className: 'constructor', probability: 0.05 }] }
  ]) assertInconclusive({ ...ecoFixture(), ...changed });
});

console.log(`${checks} plant-health interpretation checks passed.`);
