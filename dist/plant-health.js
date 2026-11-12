/**
 * Shared interpretation of EcoPlant's measured PlantVillage predictions.
 * It does not run a model, inspect pixels, or replace the inference-time OOD check.
 * Classes/source: https://huggingface.co/rodynaemad/plant-disease-dinov2-small
 * The source model was trained on isolated leaves; this is a screening result,
 * not a diagnosis of the entire plant or a probability that it is healthy.
 */

// Conservative display policy chosen by EcoPlant. These cutoffs have not been
// calibrated as diagnostic accuracy, sensitivity, or field performance.
export const PLANT_HEALTH_POLICY = Object.freeze({ minConfidence: 0.75, minMargin: 0.15 });
export const PLANT_HEALTH_POLICY_VERSION = 'ecoplant-health-v1';
const SCORE_TOLERANCE = 1e-6;

// Exact allowlist. Never infer a verdict from an arbitrary label containing
// "healthy", or assume every custom Teachable Machine class is a disease.
const CLASS_INFO = Object.freeze({
  'Apple___Apple_scab': ['Macieira', 'Sarna', 'disease'],
  'Apple___Black_rot': ['Macieira', 'Podridão negra', 'disease'],
  'Apple___Cedar_apple_rust': ['Macieira', 'Ferrugem', 'disease'],
  'Apple___healthy': ['Macieira', 'Folha com aparência saudável', 'healthy'],
  'Blueberry___healthy': ['Mirtilo', 'Folha com aparência saudável', 'healthy'],
  'Cherry_(including_sour)___Powdery_mildew': ['Cerejeira', 'Oídio', 'disease'],
  'Cherry_(including_sour)___healthy': ['Cerejeira', 'Folha com aparência saudável', 'healthy'],
  'Corn_(maize)___Cercospora_leaf_spot Gray_leaf_spot': ['Milho', 'Cercosporiose', 'disease'],
  'Corn_(maize)___Common_rust_': ['Milho', 'Ferrugem comum', 'disease'],
  'Corn_(maize)___Northern_Leaf_Blight': ['Milho', 'Helmintosporiose', 'disease'],
  'Corn_(maize)___healthy': ['Milho', 'Folha com aparência saudável', 'healthy'],
  'Grape___Black_rot': ['Videira', 'Podridão negra', 'disease'],
  'Grape___Esca_(Black_Measles)': ['Videira', 'Esca', 'disease'],
  'Grape___Leaf_blight_(Isariopsis_Leaf_Spot)': ['Videira', 'Mancha foliar por Isariopsis', 'disease'],
  'Grape___healthy': ['Videira', 'Folha com aparência saudável', 'healthy'],
  'Orange___Haunglongbing_(Citrus_greening)': ['Laranjeira', 'Huanglongbing (greening)', 'disease'],
  'Peach___Bacterial_spot': ['Pessegueiro', 'Mancha bacteriana', 'disease'],
  'Peach___healthy': ['Pessegueiro', 'Folha com aparência saudável', 'healthy'],
  'Pepper,_bell___Bacterial_spot': ['Pimentão', 'Mancha bacteriana', 'disease'],
  'Pepper,_bell___healthy': ['Pimentão', 'Folha com aparência saudável', 'healthy'],
  'Potato___Early_blight': ['Batateira', 'Pinta preta', 'disease'],
  'Potato___Late_blight': ['Batateira', 'Requeima', 'disease'],
  'Potato___healthy': ['Batateira', 'Folha com aparência saudável', 'healthy'],
  'Raspberry___healthy': ['Framboeseira', 'Folha com aparência saudável', 'healthy'],
  'Soybean___healthy': ['Soja', 'Folha com aparência saudável', 'healthy'],
  'Squash___Powdery_mildew': ['Abóbora', 'Oídio', 'disease'],
  'Strawberry___Leaf_scorch': ['Morangueiro', 'Queima das folhas', 'disease'],
  'Strawberry___healthy': ['Morangueiro', 'Folha com aparência saudável', 'healthy'],
  'Tomato___Bacterial_spot': ['Tomateiro', 'Mancha bacteriana', 'disease'],
  'Tomato___Early_blight': ['Tomateiro', 'Pinta preta', 'disease'],
  'Tomato___Late_blight': ['Tomateiro', 'Requeima', 'disease'],
  'Tomato___Leaf_Mold': ['Tomateiro', 'Mofo das folhas', 'disease'],
  'Tomato___Septoria_leaf_spot': ['Tomateiro', 'Septoriose', 'disease'],
  'Tomato___Spider_mites Two-spotted_spider_mite': ['Tomateiro', 'Ácaro rajado', 'pest'],
  'Tomato___Target_Spot': ['Tomateiro', 'Mancha alvo', 'disease'],
  'Tomato___Tomato_Yellow_Leaf_Curl_Virus': ['Tomateiro', 'Vírus do enrolamento amarelo das folhas', 'disease'],
  'Tomato___Tomato_mosaic_virus': ['Tomateiro', 'Vírus do mosaico do tomateiro', 'disease'],
  'Tomato___healthy': ['Tomateiro', 'Folha com aparência saudável', 'healthy']
});

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const isProbability = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const knownClass = value => typeof value === 'string' && Object.hasOwn(CLASS_INFO, value);
const lowerFirst = value => value.charAt(0).toLocaleLowerCase('pt-BR') + value.slice(1);
const HEALTHY_ONLY_CROPS = new Set(['Mirtilo', 'Framboeseira', 'Soja']);
const DISEASE_ONLY_CROPS = new Set(['Laranjeira', 'Abóbora']);

const INCONCLUSIVE_GUIDANCE = Object.freeze([
  'Envie uma nova foto de uma única folha inteira, nítida, com luz natural e fundo simples.',
  'Confira se a planta está entre as culturas reconhecidas. Outras espécies podem ficar sem conclusão.',
  'Se houver alterações persistentes, registre outras folhas e a planta inteira e procure orientação agronômica.'
]);
const INCONCLUSIVE_COPY = Object.freeze({
  'low-confidence': Object.freeze({
    summary: 'A IA não diferenciou as classes com segurança suficiente nesta foto. Não foi possível informar se a folha tem aparência saudável ou apresenta sinais de doença.',
    care: INCONCLUSIVE_GUIDANCE
  }),
  'model-compatibility': Object.freeze({
    summary: 'A foto não ficou suficientemente semelhante às folhas conhecidas pelo modelo. O enquadramento, o fundo ou diferenças em relação às plantas e condições do treinamento podem explicar essa diferença. Nenhuma doença nem condição saudável foi atribuída a esta foto.',
    care: Object.freeze([
      'Ajuste o enquadramento para mostrar uma única folha inteira e centralizada, com pouco fundo ao redor.',
      'Confira se a espécie aparece entre as 14 culturas atendidas. Para outra planta, conecte um modelo treinado para ela.',
      'Se a folha já estiver bem enquadrada, experimente outra foto nítida com luz natural. Uma folha legível também pode ficar sem conclusão quando a foto ou a condição difere dos exemplos do modelo.'
    ])
  })
});
// Old releases wrote this neutral explanation before the shared copy helper.
const LEGACY_OOD_SUMMARY = 'A imagem não foi suficientemente compatível com as folhas e classes conhecidas pela IA, ou a classificação ficou incerta. Nenhuma doença nem condição saudável foi atribuída a esta foto.';

/** Neutral, reusable inference feedback. It does not assign a plant or disease. */
export function describeInconclusiveReason(reason = 'explicit-inconclusive') {
  const copyKey = reason === 'close-predictions' ? 'low-confidence' : reason;
  const copy = Object.hasOwn(INCONCLUSIVE_COPY, copyKey) ? INCONCLUSIVE_COPY[copyKey] : null;
  return {
    status: 'inconclusive', title: 'Análise inconclusiva', shortLabel: 'Inconclusivo',
    crop: '', condition: '', tone: 'neutral', reason,
    summary: copy?.summary || 'A imagem está fora do conjunto reconhecido, ou a análise não trouxe dados suficientes para uma conclusão. Não foi possível informar se a folha tem aparência saudável ou apresenta sinais de doença.',
    care: [...(copy?.care || INCONCLUSIVE_GUIDANCE)]
  };
}
function inconclusive(reason) { return describeInconclusiveReason(reason); }

function recordedInconclusive(result) {
  // Preserve specific explanations emitted by our neutral result pipeline.
  // Never revive an old disease summary just because a result was rejected at
  // display time, or accept a neutral title alongside stale measured scores.
  if (result.title !== 'Análise inconclusiva' || result.topClass !== 'Análise inconclusiva'
      || Object.hasOwn(result, 'confidence') || Object.hasOwn(result, 'predictions')
      || typeof result.summary !== 'string') return null;
  const summary = result.summary.trim();
  const reason = summary === LEGACY_OOD_SUMMARY ? 'model-compatibility'
    : Object.keys(INCONCLUSIVE_COPY).find(key => INCONCLUSIVE_COPY[key].summary === summary);
  if (!reason) return null;
  const assessment = describeInconclusiveReason(reason);
  const care = Array.isArray(result.care) ? result.care
    .filter(item => typeof item === 'string' && item.trim() && item.length <= 4000)
    .slice(0, 6).map(item => item.trim()) : [];
  return { ...assessment, summary, care: care.length ? care : assessment.care };
}

/**
 * Derive user-facing text without mutating or adding fields to stored records.
 * The caller must pass the original result, including its measured predictions.
 * Inference-time rejection is represented by the absence of valid scores or an
 * explicit inconclusive title/class; this function never recovers that verdict.
 *
 * @returns {{status:'healthy'|'disease'|'pest'|'inconclusive'|'unassessed', title:string,
 * shortLabel:string, crop:string, condition:string, summary:string, care:string[],
 * tone:'healthy'|'danger'|'neutral', reason:string}}
 */
export function describePlantHealth(result) {
  if (!isRecord(result) || result.method !== 'plant-ai') return {
    status: 'unassessed', title: 'Saúde não avaliada pela IA de imagem', shortLabel: 'Sem avaliação por IA',
    crop: '', condition: '', tone: 'neutral', reason: 'unsupported-method',
    summary: 'Este registro não usa a IA de imagem do EcoPlant para avaliar a aparência da folha.',
    care: ['Use a opção de análise por IA com uma foto nítida para obter uma avaliação preliminar.']
  };
  if (result.severity === 'inconclusive' || result.status === 'inconclusive'
    || result.topClass === 'Análise inconclusiva' || result.title === 'Análise inconclusiva') return recordedInconclusive(result) || inconclusive('explicit-inconclusive');
  if (!isProbability(result.confidence)) return inconclusive('missing-or-invalid-confidence');
  if (!knownClass(result.topClass)) return inconclusive('unknown-class');
  if (!Array.isArray(result.predictions) || result.predictions.length < 2 || result.predictions.length > 38) return inconclusive('missing-or-invalid-predictions');

  const predictions = [];
  const seen = new Set();
  let total = 0;
  for (const item of result.predictions) {
    if (!isRecord(item) || !knownClass(item.className) || !isProbability(item.probability) || seen.has(item.className)) return inconclusive('invalid-predictions');
    seen.add(item.className);
    total += item.probability;
    predictions.push({ className: item.className, probability: item.probability });
  }
  if (total > 1 + SCORE_TOLERANCE) return inconclusive('inconsistent-predictions');
  predictions.sort((a, b) => b.probability - a.probability);
  const best = predictions[0];
  if (best.className !== result.topClass || Math.abs(best.probability - result.confidence) > SCORE_TOLERANCE) return inconclusive('inconsistent-predictions');
  if (best.probability < PLANT_HEALTH_POLICY.minConfidence) return inconclusive('low-confidence');
  // With normalized probabilities and a >= 0.75 leader, the >= 0.15 margin
  // is already implied. Keep it as a defensive consistency rule, not an
  // independently validated source of diagnostic certainty.
  if (best.probability - predictions[1].probability + Number.EPSILON < PLANT_HEALTH_POLICY.minMargin) return inconclusive('close-predictions');

  const [crop, condition, status] = CLASS_INFO[best.className];
  if (status === 'healthy') return {
    status, title: 'Aparência saudável', shortLabel: 'Aparência saudável', crop, condition,
    tone: 'healthy', reason: 'accepted-classification',
    summary: `Nesta foto, a folha se parece com os exemplos saudáveis de ${lowerFirst(crop)} reconhecidos pela IA. ${HEALTHY_ONLY_CROPS.has(crop) ? 'O modelo só tem exemplos saudáveis para esta cultura; ele não compara doenças específicas dela. ' : ''}Isso não descarta outros problemas nem avalia a saúde da planta inteira.`,
    care: [
      'Mantenha o acompanhamento e fotografe a mesma folha novamente para comparar mudanças.',
      'Observe também o verso das folhas, o caule e o substrato; esta análise cobre apenas a foto enviada.',
      'Se surgirem manchas, murcha ou perda de vigor, faça um novo registro e procure orientação agronômica.'
    ]
  };
  if (status === 'pest') return {
    status, title: 'Sinais de possível praga', shortLabel: 'Possível praga', crop, condition,
    tone: 'danger', reason: 'accepted-classification',
    summary: `A foto se aproxima da classe de ${lowerFirst(condition)} em ${lowerFirst(crop)}. É uma suspeita de praga, distinta de uma doença, e precisa ser confirmada pela observação da planta.`,
    care: [
      'Examine os dois lados das folhas, procurando pequenos organismos, teias ou danos; registre o que observar.',
      'Fotografe outras folhas e anote se os sinais aumentam ou aparecem em outras plantas.',
      'Leve as fotos a um profissional para confirmar a praga e escolher os cuidados adequados antes de aplicar produtos.'
    ]
  };
  return {
    status, title: 'Sinais de possível doença', shortLabel: 'Possível doença', crop, condition,
    tone: 'danger', reason: 'accepted-classification',
    summary: `A aparência da folha é compatível com a classe “${lowerFirst(condition)}” do modelo para ${lowerFirst(crop)}. ${DISEASE_ONLY_CROPS.has(crop) ? 'O modelo não inclui uma classe saudável para esta cultura; ele não permite uma comparação completa entre saúde e doença. ' : ''}Essa é uma hipótese visual; outras doenças e condições de cultivo podem produzir sinais parecidos.`,
    care: [
      `Registre onde aparecem os sinais compatíveis com ${lowerFirst(condition)} e fotografe os dois lados das folhas.`,
      'Compare novas fotos e anote alterações de rega, iluminação e cultivo que possam ajudar na avaliação.',
      'Procure orientação agronômica para confirmar a causa antes de iniciar um tratamento ou aplicar produtos.'
    ]
  };
}
