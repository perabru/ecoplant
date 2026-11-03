/**
 * Triagem guiada por sinais informados pelo usuário.
 * Não interpreta a foto, não é um classificador de imagens e não confirma doenças.
 */
export const SYMPTOMS = Object.freeze([
  { id: 'spots', label: 'Manchas nas folhas', description: 'Pontos ou áreas marrons, escuras ou com halo.' },
  { id: 'yellow', label: 'Folhas amareladas', description: 'Mudança de cor em parte ou em toda a folha.' },
  { id: 'powder', label: 'Pó branco na superfície', description: 'Camada esbranquiçada semelhante a farinha.' },
  { id: 'pests', label: 'Insetos ou teias', description: 'Pequenos animais, teias ou resíduos visíveis.' },
  { id: 'holes', label: 'Furos ou partes comidas', description: 'Bordas ou partes da folha ausentes.' },
  { id: 'wilt', label: 'Folhas murchas', description: 'Folhas caídas ou perda de firmeza.' },
  { id: 'dry', label: 'Pontas secas', description: 'Bordas ou pontas ressecadas.' },
  { id: 'mold', label: 'Mofo ou apodrecimento', description: 'Tecido amolecido ou crescimento semelhante a mofo.' },
  { id: 'healthy', label: 'Nenhum sinal visível', description: 'Não observei alterações nesta avaliação.' }
]);

const DISCLAIMER = 'Triagem baseada nos sinais que você informou. A foto serve para registro e não é analisada automaticamente. Hipóteses semelhantes exigem avaliação de um profissional.';
const BASE_CARE = [
  'Registre a data e fotografe a mesma folha com boa iluminação para comparar a evolução.',
  'Observe o verso das folhas, o caule e o substrato antes de mudar os cuidados.',
  'Se os sinais aumentarem ou atingirem outras partes da planta, procure orientação agronômica.'
];
const RULES = [
  {
    name: 'Presença de pragas',
    score: s => (s.has('pests') ? 7 : 0) + (s.has('holes') ? 3 : 0),
    reason: s => s.has('pests')
      ? 'Insetos ou teias foram informados. Observe o verso da folha para registrar o organismo antes de escolher qualquer controle.'
      : 'Furos e partes comidas podem ser danos de animais; danos mecânicos também podem ter aparência semelhante.',
    care: 'Fotografe de perto os insetos, teias e danos, sem tocar em organismos desconhecidos.'
  },
  {
    name: 'Possível oídio ou resíduo na folha',
    score: s => s.has('powder') ? 7 : 0,
    reason: () => 'O pó branco informado pode ser compatível com oídio, mas resíduos de produtos ou de água também podem produzir manchas claras.',
    care: 'Registre se a camada branca aparece em várias folhas e se aumenta entre as observações.'
  },
  {
    name: 'Possível mancha foliar',
    score: s => (s.has('spots') ? 6 : 0) + (s.has('spots') && s.has('yellow') ? 2 : 0),
    reason: s => s.has('yellow')
      ? 'Manchas e amarelecimento foram informados. Fungos, bactérias e danos ambientais podem produzir esse conjunto de sinais.'
      : 'Manchas foram informadas. Sua forma e evolução ajudam a diferenciar possíveis agentes de danos ambientais.',
    care: 'Anote se as manchas crescem, mudam de cor ou surgem em novas folhas.'
  },
  {
    name: 'Possível deterioração de tecido',
    score: s => s.has('mold') ? 9 : 0,
    reason: () => 'Mofo ou apodrecimento foram informados. O local atingido e as condições de umidade precisam ser avaliados para distinguir as causas.',
    care: 'Registre exatamente onde há tecido amolecido e procure orientação se o caule ou a base estiverem envolvidos.'
  },
  {
    name: 'Possível estresse hídrico ou radicular',
    score: s => (s.has('wilt') ? 5 : 0) + (s.has('wilt') && s.has('yellow') ? 2 : 0),
    reason: s => s.has('yellow')
      ? 'Murcha e amarelecimento foram informados. Excesso ou falta de água e alterações nas raízes podem se parecer; é necessário verificar o substrato.'
      : 'Murcha foi informada. Não é possível distinguir excesso de água, falta de água e outras causas apenas por esse sinal.',
    care: 'Confira a umidade do substrato e a drenagem do recipiente antes de alterar a rega.'
  },
  {
    name: 'Possível estresse ambiental ou nutricional',
    score: s => (s.has('dry') ? 4 : 0) + (s.has('yellow') ? 3 : 0),
    reason: s => s.has('dry') && s.has('yellow')
      ? 'Pontas secas e amarelecimento foram informados. Luz, umidade, raízes e nutrição precisam ser considerados em conjunto.'
      : s.has('dry')
        ? 'Pontas secas foram informadas. Calor, vento, umidade e condições do substrato podem contribuir.'
        : 'Amarelecimento foi informado. Idade da folha, luz, água, raízes e nutrição são causas possíveis; o sinal isolado não confirma deficiência.',
    care: 'Anote mudanças recentes de local, exposição ao sol, rega e adubação para orientar a avaliação.'
  }
];

export function evaluateSymptoms(selectedIds) {
  const allowed = new Set(SYMPTOMS.map(item => item.id));
  const selected = new Set((Array.isArray(selectedIds) ? selectedIds : []).filter(id => allowed.has(id)));
  const common = { method: 'guided', disclaimer: DISCLAIMER };

  if (selected.size === 0) {
    return {
      ...common,
      title: 'Sinais insuficientes',
      summary: 'Selecione os sinais que observou para receber uma triagem guiada.',
      possibilities: [], care: BASE_CARE, severity: 'observe'
    };
  }

  if (selected.size === 1 && selected.has('healthy')) {
    return {
      ...common,
      title: 'Sem sinais relatados',
      summary: 'Você não informou alterações visíveis. Este registro não confirma que a planta esteja livre de doenças.',
      possibilities: [],
      care: [
        'Mantenha o registro como referência para comparar fotos futuras.',
        'Observe periodicamente folhas novas, verso das folhas e caule.',
        'Se aparecer alguma alteração, faça um novo registro e informe os sinais observados.'
      ],
      severity: 'observe'
    };
  }

  // In contradictory input, observed symptoms take precedence over "healthy".
  selected.delete('healthy');
  const matched = RULES.map((rule, order) => ({ rule, order, score: rule.score(selected) }))
    .filter(item => item.score >= 3)
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, 3);

  if (!matched.length) {
    return {
      ...common, title: 'Sinais insuficientes',
      summary: 'Os sinais informados ainda não permitem sugerir uma hipótese útil. Faça novas observações.',
      possibilities: [], care: BASE_CARE, severity: 'observe'
    };
  }

  return {
    ...common,
    title: matched[0].rule.name,
    summary: selected.size === 1
      ? 'Uma alteração foi informada. Veja as possibilidades e registre a evolução antes de concluir a causa.'
      : `${selected.size} alterações foram informadas. Estas possibilidades podem se sobrepor e precisam ser confirmadas.`,
    possibilities: matched.map(({ rule }) => ({ name: rule.name, reason: rule.reason(selected) })),
    care: [...new Set([...matched.map(({ rule }) => rule.care), ...BASE_CARE])].slice(0, 6),
    severity: selected.has('mold') || selected.has('pests') || (selected.has('wilt') && selected.has('yellow')) ? 'attention' : 'observe'
  };
}
