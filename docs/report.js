/** Ecoplant — reports render measured model outputs, never an invented health score. */
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const text = (value, fallback = 'Não informado') => escapeHTML(String(value ?? '').trim() || fallback);
const clamp = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));
const percent = value => (clamp(value) * 100).toLocaleString('pt-BR', {minimumFractionDigits: 1, maximumFractionDigits: 1}) + '%';
const dateLabel = value => {
  const d = new Date(value || Date.now());
  return Number.isNaN(d.getTime()) ? 'Data não informada' : new Intl.DateTimeFormat('pt-BR', {dateStyle:'long', timeStyle:'short', timeZone:'America/Sao_Paulo'}).format(d);
};
const picture = value => /^data:image\/(?:jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(String(value ?? '')) ? String(value) : '';
const modelAddress = value => { try { const u = new URL(value); return u.protocol === 'https:' ? u.href : ''; } catch { return ''; } };
const icon = name => {
  const paths = {
    leaf:'<path d="M20 4c-9-2-16 3-15 10s9 7 12 2 3-12 3-12Z"/><path d="M4 21 15 10"/>',
    check:'<path d="m5 12 4 4 10-10"/>',
    camera:'<rect x="3" y="6" width="18" height="15" rx="3"/><path d="m8 6 2-3h4l2 3"/><circle cx="12" cy="13" r="4"/>',
    download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    print:'<path d="M6 9V3h12v6M6 17H3V9h18v8h-3M6 14h12v7H6z"/><path d="M17 11h1"/>',
    info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
    clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    save:'<path d="M5 3h12l4 4v14H3V3h2Z"/><path d="M7 3v6h9V3M7 21v-8h10v8"/>',
    trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>'
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.leaf}</svg>`;
};
const SYMPTOM_NAMES = {spots:'Manchas nas folhas', yellow:'Folhas amareladas', powder:'Pó branco na superfície', pests:'Insetos ou teias', holes:'Furos ou partes comidas', wilt:'Folhas murchas', dry:'Pontas secas', mold:'Mofo ou apodrecimento', healthy:'Nenhum sinal visível'};

const CSS = `<style>
.eco-report{--rp-green:#173e32;--rp-light:#e7ecdd;--rp-line:#e1e5d8;color:var(--rp-green);animation:rp-appear .4s ease both}.eco-report *{box-sizing:border-box}.rp-toolbar{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.rp-toolbar .eyebrow{font-size:9px;letter-spacing:.15em;color:#809074}.rp-toolbar h1{font-family:'Libre Caslon Display',Georgia,serif;font-size:42px;font-weight:400;line-height:1.1;margin-top:7px}.rp-toolbar p{font-size:11px;color:#7c8771;margin-top:8px}.rp-toolbar-actions{display:flex;gap:8px;flex-wrap:wrap}.rp-sheet{border:1px solid var(--rp-line);border-radius:19px;background:#fffefa;overflow:hidden;box-shadow:0 12px 40px #173e3206}.rp-masthead{padding:24px 28px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--rp-line);gap:18px}.rp-wordmark{font-family:'Libre Caslon Display',Georgia,serif;font-size:31px;display:flex;align-items:center;gap:8px}.rp-brand-logo{display:block;width:34px;height:34px;object-fit:contain;border-radius:7px;flex-shrink:0}.rp-wordmark>.icon{width:27px;height:27px}.rp-kicker{font-size:8px;letter-spacing:.18em;color:#849078;text-transform:uppercase;margin-top:4px}.rp-reportid{text-align:right;font-size:10px;color:#85917c;line-height:1.8}.rp-reportid strong{display:block;font-size:10px;letter-spacing:.08em;color:#455b3e}.rp-overview{display:grid;grid-template-columns:.86fr 1.35fr;border-bottom:1px solid var(--rp-line)}.rp-photo-wrap{padding:25px;background:#f1f4e9}.rp-photo{display:block;width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:13px;background:#e1e8d6}.rp-no-photo{aspect-ratio:1/1;display:grid;place-items:center;border-radius:13px;background:#e1e8d6;color:#8ba17d}.rp-no-photo .icon{width:65px;height:65px;stroke-width:1}.rp-photo-note{font-size:9px;line-height:1.8;color:#859078;margin-top:12px}.rp-summary{padding:28px 30px;display:flex;flex-direction:column;justify-content:center}.rp-status{display:inline-flex;align-self:flex-start;gap:6px;align-items:center;border-radius:30px;padding:6px 10px;background:#e9eedf;color:#6a815c;font-size:9px;font-weight:600}.rp-status .icon{width:12px;height:12px}.rp-status.amber{background:#f7eddc;color:#a37632}.rp-summary h2{font-family:'Libre Caslon Display',Georgia,serif;font-size:35px;line-height:1.12;font-weight:400;margin:13px 0 8px;overflow-wrap:anywhere;letter-spacing:-.025em}.rp-summary>.rp-plant{font-size:12px;color:#829074;line-height:1.8}.rp-metric{display:flex;align-items:center;gap:19px;margin:22px 0 14px}.rp-donut{width:91px;height:91px;position:relative;flex-shrink:0;display:grid;place-items:center}.rp-donut svg{position:absolute;inset:0;width:100%;height:100%;transform:rotate(-90deg);overflow:visible}.rp-donut circle{fill:none;stroke:#e4eadb;stroke-width:7}.rp-donut .rp-progress{stroke:#709564;stroke-linecap:round;stroke-dasharray:251.3274;stroke-dashoffset:var(--rp-dash);animation:rp-donut 1.3s cubic-bezier(.16,1,.3,1) both}.rp-donut strong{font-size:18px;letter-spacing:-.03em;font-weight:600}.rp-metric-label strong{display:block;font-size:12px;font-weight:600}.rp-metric-label p{font-size:10px;line-height:1.8;color:#8a957e;max-width:230px;margin-top:6px}.rp-model-note{border-top:1px solid var(--rp-line);padding-top:13px;font-size:10px;color:#809074;line-height:1.8}.rp-record-details{display:grid;grid-template-columns:repeat(4,1fr);gap:15px;padding:20px 28px;border-bottom:1px solid var(--rp-line);background:#fafbf5}.rp-record-details div{min-width:0}.rp-record-details dt{font-size:8px;letter-spacing:.12em;text-transform:uppercase;color:#8c967f;margin-bottom:7px}.rp-record-details dd{font-size:11px;line-height:1.7;margin:0;overflow-wrap:anywhere}.rp-body{padding:26px 28px;display:grid;grid-template-columns:1fr 1fr;gap:27px}.rp-section h3{font-family:'Libre Caslon Display',Georgia,serif;font-size:25px;font-weight:400;margin:0 0 16px;letter-spacing:-.02em}.rp-section .rp-section-note{font-size:10px;color:#87927c;line-height:1.8;margin:-7px 0 16px}.rp-prediction{margin:0 0 17px}.rp-prediction-label{display:flex;justify-content:space-between;gap:10px;align-items:baseline;font-size:11px;margin-bottom:8px}.rp-prediction-label span{overflow-wrap:anywhere}.rp-prediction-label strong{font-size:10px;font-weight:500;color:#7c906b;white-space:nowrap}.rp-track{height:7px;border-radius:20px;background:#edf1e6;overflow:hidden}.rp-bar{height:100%;width:var(--rp-width);background:#7c9b6b;border-radius:20px;transform-origin:left;animation:rp-bar 1s .15s cubic-bezier(.16,1,.3,1) both}.rp-prediction:first-of-type .rp-bar{background:#285442}.rp-checks{list-style:none;padding:0;margin:0;display:grid;gap:13px}.rp-checks li{display:flex;align-items:flex-start;gap:9px;font-size:11px;line-height:1.8;color:#6f7e63}.rp-checks .icon{width:16px;height:16px;margin-top:2px;flex-shrink:0;color:#73915f}.rp-observation{border:1px solid var(--rp-line);border-radius:11px;padding:15px;background:#fafbf6;min-height:83px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;color:#6f7e63;line-height:1.85}.rp-chips{display:flex;flex-wrap:wrap;gap:7px;margin-top:12px}.rp-chip{font-size:9px;color:#738369;background:#edf1e4;padding:5px 8px;border-radius:20px}.rp-guided-card{padding:13px 15px;border:1px solid var(--rp-line);border-radius:10px;margin-bottom:10px}.rp-guided-card h4{font-size:11px;font-weight:600;margin:0 0 6px}.rp-guided-card p{font-size:10px;color:#87927c;line-height:1.85;margin:0}.rp-metadata{grid-column:1/-1;padding-top:19px;border-top:1px solid var(--rp-line);display:grid;grid-template-columns:1fr 1fr;gap:15px}.rp-metadata h3{font-family:inherit;font-size:10px;font-weight:600;letter-spacing:0;margin-bottom:9px}.rp-metadata p{font-size:9px;line-height:1.9;color:#8b947f;overflow-wrap:anywhere}.rp-disclaimer{display:flex;gap:9px;background:#f0f3e8;border-top:1px solid var(--rp-line);padding:18px 28px;font-size:10px;line-height:1.9;color:#7a896e}.rp-disclaimer .icon{width:17px;height:17px;flex-shrink:0;margin-top:2px}.rp-bottom{padding:17px 28px;display:flex;align-items:center;justify-content:space-between;gap:15px;font-size:8px;color:#9ba38f;letter-spacing:.04em}.rp-after-actions{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}.rp-draft-banner{padding:13px 16px;background:#eaf0df;border:1px solid #dfe9cf;border-radius:11px;font-size:11px;color:#63804e;line-height:1.8;margin-bottom:17px;display:flex;gap:9px;align-items:center}.rp-draft-banner .icon{width:18px;height:18px;flex-shrink:0}.rp-print-title{display:none}@keyframes rp-appear{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@keyframes rp-donut{from{stroke-dashoffset:251.3274}to{stroke-dashoffset:var(--rp-dash)}}@keyframes rp-bar{from{transform:scaleX(0)}to{transform:scaleX(1)}}
@media(max-width:760px){.rp-toolbar{display:block;margin-bottom:20px}.rp-toolbar h1{font-size:34px}.rp-toolbar-actions{margin-top:17px}.rp-toolbar-actions .btn{font-size:10px;padding:10px 12px;min-height:38px}.rp-masthead{padding:20px}.rp-wordmark{font-size:27px}.rp-reportid{font-size:8px}.rp-reportid strong{font-size:8px}.rp-overview{grid-template-columns:1fr}.rp-photo-wrap{padding:18px}.rp-photo,.rp-no-photo{aspect-ratio:1.35;max-height:280px}.rp-photo-note{font-size:9px}.rp-summary{padding:23px 20px}.rp-summary h2{font-size:33px}.rp-metric{margin-top:20px}.rp-record-details{grid-template-columns:1fr 1fr;padding:20px;gap:18px}.rp-body{grid-template-columns:1fr;padding:23px 20px;gap:25px}.rp-metadata{grid-template-columns:1fr}.rp-disclaimer{padding:17px 20px;font-size:9px}.rp-bottom{padding:16px 20px;align-items:flex-start;font-size:7px}.rp-after-actions .btn{flex:1}.rp-metric-label p{font-size:10px}.rp-section h3{font-size:25px}.rp-sheet{border-radius:15px}}
@media(prefers-reduced-motion:reduce){.eco-report,.rp-progress,.rp-bar{animation:none!important}}
@media print{@page{size:A4 portrait;margin:12mm}html,body{background:#fff!important;color:#173e32!important;height:auto!important}.shell{padding:0!important;min-height:0!important}.sidebar,.topbar,.mobile-nav,.no-print,.footer-caption,.app-banner,#toast,dialog,.rp-toolbar,.rp-after-actions,.rp-draft-banner{display:none!important}.content{padding:0!important;margin:0!important;max-width:none!important}.eco-report{animation:none!important;font-size:10pt}.rp-sheet{box-shadow:none!important;border:1px solid #dce3d3;border-radius:0;overflow:visible}.rp-masthead{padding:5mm 6mm}.rp-wordmark{font-size:26pt}.rp-overview{grid-template-columns:.8fr 1.4fr}.rp-photo-wrap{padding:5mm}.rp-photo{max-height:61mm;aspect-ratio:1;object-fit:cover}.rp-no-photo{height:61mm}.rp-summary{padding:5mm 6mm}.rp-summary h2{font-size:23pt;margin:3mm 0 2mm}.rp-metric{margin:4mm 0 3mm}.rp-donut{height:65px;width:65px}.rp-donut strong{font-size:12px}.rp-metric-label strong{font-size:9px}.rp-metric-label p,.rp-model-note,.rp-photo-note{font-size:8px}.rp-record-details{grid-template-columns:repeat(4,1fr);padding:4mm 6mm;gap:3mm}.rp-record-details dt{font-size:7px}.rp-record-details dd{font-size:8px}.rp-body{grid-template-columns:1fr 1fr;padding:5mm 6mm;gap:5mm}.rp-section{break-inside:avoid}.rp-section h3{font-size:17pt;margin-bottom:3mm}.rp-section-note,.rp-prediction-label,.rp-checks li,.rp-observation{font-size:8px!important}.rp-section .rp-section-note{margin-top:0;margin-bottom:3mm}.rp-checks{gap:2mm}.rp-observation{padding:3mm;min-height:17mm}.rp-prediction{margin-bottom:3mm}.rp-track{height:5px}.rp-bar{animation:none!important;transform:none!important}.rp-donut .rp-progress{animation:none!important;stroke-dashoffset:var(--rp-dash)!important}.rp-chips{gap:1.5mm;margin-top:2mm}.rp-chip{font-size:7px;padding:1mm 2mm}.rp-metadata{grid-template-columns:1fr 1fr;padding-top:3mm;gap:4mm}.rp-metadata h3{font-size:8px}.rp-metadata p{font-size:7px}.rp-disclaimer{padding:3mm 6mm;font-size:7px;break-inside:avoid}.rp-bottom{padding:3mm 6mm;font-size:6px}.rp-guided-card{padding:3mm;break-inside:avoid}.rp-guided-card h4{font-size:8px}.rp-guided-card p{font-size:7px}*{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}}
</style>`;

/** @returns {string} Sanitized report content, ready for the application's content container. */
export function reportHTML(record = {}, plant = {}, profile = {}, {draft = false} = {}) {
  const result = record.result && typeof record.result === 'object' ? record.result : {};
  const isTM = result.method === 'teachable-machine';
  const predictions = (Array.isArray(result.predictions) ? result.predictions : [])
    .filter(p => p && typeof p.className === 'string' && Number.isFinite(Number(p.probability)))
    .map(p => ({className:p.className, probability:clamp(p.probability)}))
    .sort((a,b) => b.probability - a.probability);
  const topClass = String(result.topClass || predictions[0]?.className || 'Classe não informada');
  const suppliedConfidence = result.confidence !== null && result.confidence !== undefined && result.confidence !== '' && Number.isFinite(Number(result.confidence));
  const hasConfidence = suppliedConfidence || predictions.length > 0;
  const confidence = suppliedConfidence ? clamp(result.confidence) : predictions[0]?.probability ?? 0;
  const healthy = isTM && Boolean(profile.healthyClass) && topClass === String(profile.healthyClass);
  const photo = picture(record.photo) || picture(plant.photo);
  const plantName = String(plant.name || 'Planta sem cadastro');
  const title = isTM ? topClass : String(result.title || 'Registro de observação');
  const modelURL = modelAddress(result.modelURL);
  const modelName = String(result.modelName || 'Modelo Teachable Machine');
  const reportId = String(record.id || 'rascunho').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,12).toUpperCase() || 'RASCUNHO';
  const reportDate = dateLabel(record.date || result.analyzedAt || record.createdAt);
  const author = String(profile.displayName || profile.name || 'Usuário Ecoplant');
  const symptoms = (Array.isArray(record.symptoms) ? record.symptoms : []).filter(v => typeof v === 'string');
  const possibilities = (Array.isArray(result.possibilities) ? result.possibilities : []).filter(v => v && typeof v === 'object');
  const care = !isTM && Array.isArray(result.care) && result.care.length ? result.care : [
    'Observe o verso das folhas, o caule e o substrato. Registre alterações que a foto não mostra.',
    'Fotografe novamente a mesma região, com iluminação e enquadramento semelhantes, para comparar a evolução.',
    'Anote mudanças recentes de rega, luz, local e adubação antes de decidir pelos próximos cuidados.',
    'Se as alterações avançarem, procure orientação agronômica e leve este registro.'
  ];
  const scope = Array.isArray(result.modelLabels) ? result.modelLabels.length : predictions.length;
  const modelSummary = isTM
    ? `O modelo escolheu a classe de maior probabilidade entre ${scope || 'as'} classes disponíveis. O resultado depende das imagens e das condições utilizadas no treinamento.`
    : 'Esta triagem organiza os sinais que você informou. A fotografia foi usada como registro e não foi classificada automaticamente.';
  const disclaimer = isTM
    ? 'Identificação preliminar por imagem. O modelo compara a foto apenas com as classes em que foi treinado; uma planta fora desse conjunto também recebe uma classificação. A confiança não confirma a doença nem informa sua gravidade. Confirme alterações com um profissional antes de iniciar tratamentos.'
    : String(result.disclaimer || 'Registro baseado nas observações informadas. Esta avaliação não confirma a presença ou ausência de doença. Procure orientação especializada para interpretar alterações persistentes.');
  const safePlantId = encodeURIComponent(String(plant.id || record.plantId || ''));
  const status = isTM ? (healthy ? 'Classe saudável no modelo' : 'Classe identificada pelo modelo') : 'Triagem por sinais informados';
  const bars = predictions.slice(0,3).map(p => `<div class="rp-prediction"><div class="rp-prediction-label"><span>${text(p.className)}</span><strong>${percent(p.probability)}</strong></div><div class="rp-track" role="meter" aria-label="${text(p.className)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${(p.probability * 100).toFixed(1)}"><div class="rp-bar" style="--rp-width:${(p.probability * 100).toFixed(2)}%"></div></div></div>`).join('');
  const guidedCards = possibilities.slice(0,3).map(p => `<article class="rp-guided-card"><h4>${text(p.name)}</h4><p>${text(p.reason)}</p></article>`).join('');
  return `${CSS}<article class="eco-report" aria-label="Relatório Ecoplant de ${text(plantName)}">
    <header class="rp-toolbar no-print"><div><div class="eyebrow">ECOPLANT / ACOMPANHAMENTO</div><h1>Relatório da planta</h1><p>Leia o relatório aqui e exporte quando precisar.</p></div><div class="rp-toolbar-actions"><button type="button" class="btn secondary small" data-action="export-report">${icon('download')}Exportar relatório</button></div></header>
    ${draft ? `<div class="rp-draft-banner no-print">${icon('save')}<span>Relatório gerado. Salve para incluí-lo no histórico da planta.</span></div>` : ''}
    <div class="rp-sheet">
      <div class="rp-masthead"><div><div class="rp-wordmark"><img class="rp-brand-logo" src="./assets/ecoplant-logo.png" width="34" height="34" alt="Logo Ecoplant">Ecoplant</div><div class="rp-kicker">Relatório de acompanhamento vegetal</div></div><div class="rp-reportid"><strong>REGISTRO ${text(reportId)}</strong>${text(reportDate)}</div></div>
      <section class="rp-overview" aria-label="Resumo da avaliação">
        <div class="rp-photo-wrap">${photo ? `<img class="rp-photo" src="${escapeHTML(photo)}" alt="Foto registrada de ${text(plantName)}">` : `<div class="rp-no-photo" role="img" aria-label="Registro sem fotografia">${icon('leaf')}</div>`}<p class="rp-photo-note">${photo ? 'Fotografia vinculada a este registro. Compare com novas fotos da mesma região.' : 'Nenhuma fotografia foi vinculada a este registro.'}</p></div>
        <div class="rp-summary"><span class="rp-status${healthy ? '' : ' amber'}">${icon(healthy ? 'check' : 'info')}${text(status)}</span><h2>${text(title)}</h2><p class="rp-plant">${text(plantName)}${plant.species ? ` · <i>${text(plant.species)}</i>` : ''}</p>
          ${isTM && hasConfidence ? `<div class="rp-metric"><div class="rp-donut" role="img" aria-label="Confiança do modelo: ${percent(confidence)}" style="--rp-dash:${(251.3274 * (1-confidence)).toFixed(4)}"><svg viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="40"/><circle class="rp-progress" cx="48" cy="48" r="40"/></svg><strong>${percent(confidence)}</strong></div><div class="rp-metric-label"><strong>Confiança do modelo</strong><p>Probabilidade atribuída à classe. Este valor não mede a saúde ou a gravidade da doença.</p></div></div>` : `<p class="rp-model-note">${isTM ? 'A confiança do modelo não está disponível neste registro.' : text(result.summary, 'Observações registradas para acompanhar a evolução da planta.')}</p>`}
          <p class="rp-model-note">${text(modelSummary)}</p>
        </div>
      </section>
      <dl class="rp-record-details"><div><dt>Planta</dt><dd>${text(plantName)}</dd></div><div><dt>Espécie</dt><dd>${text(plant.species)}</dd></div><div><dt>Local</dt><dd>${text(plant.location)}</dd></div><div><dt>Responsável</dt><dd>${text(author)}</dd></div></dl>
      <div class="rp-body">
        <section class="rp-section"><h3>${isTM ? 'O que o modelo encontrou' : 'Possibilidades observadas'}</h3><p class="rp-section-note">${isTM ? 'As classes mais prováveis para esta imagem.' : 'Hipóteses baseadas nos sinais que você selecionou.'}</p>${isTM ? (bars || '<p class="rp-section-note">Não há probabilidades disponíveis neste registro.</p>') : (guidedCards || '<p class="rp-section-note">Não foram sugeridas hipóteses para este registro.</p>')}</section>
        <section class="rp-section"><h3>Próximos cuidados</h3><ul class="rp-checks">${care.slice(0,6).map(item => `<li>${icon('check')}<span>${text(item)}</span></li>`).join('')}</ul></section>
        <section class="rp-section"><h3>Suas observações</h3><div class="rp-observation">${text(record.notes, 'Nenhuma observação adicional foi informada neste registro.')}</div>${symptoms.length ? `<div class="rp-chips" aria-label="Sinais informados">${symptoms.slice(0,12).map(v => `<span class="rp-chip">${text(SYMPTOM_NAMES[v] || v)}</span>`).join('')}</div>` : ''}</section>
        <section class="rp-section"><h3>Como acompanhar</h3><ul class="rp-checks"><li>${icon('camera')}<span>Use esta foto como referência. Uma nova avaliação cria um registro separado e preserva este resultado.</span></li><li>${icon('clock')}<span>Compare o aspecto das folhas e suas anotações ao longo do tempo. Não use a variação da confiança como medida de melhora.</span></li></ul></section>
        <section class="rp-metadata"><div><h3>Método de avaliação</h3><p>${isTM ? 'Classificação de imagem · Teachable Machine' : 'Triagem guiada · sinais informados'}<br>${isTM ? text(modelName) : 'A foto não foi analisada automaticamente.'}${isTM && scope ? `<br>${scope} classes no resultado do modelo` : ''}</p></div><div><h3>${isTM ? 'Origem do modelo' : 'Sobre este registro'}</h3><p>${isTM ? (modelURL ? text(modelURL) : 'Endereço do modelo não informado neste registro.') : 'As hipóteses são orientativas e dependem da precisão dos sinais informados.'}</p></div></section>
      </div>
      <aside class="rp-disclaimer">${icon('info')}<span>${text(disclaimer)}</span></aside>
      <footer class="rp-bottom"><span>ECOPLANT · CUIDAR É ACOMPANHAR</span><span>Registro pessoal de acompanhamento · ${text(reportId)}</span></footer>
    </div>
    <div class="rp-after-actions no-print">${draft ? `<button type="button" class="btn" data-action="save-report">${icon('save')}Salvar no histórico</button>` : ''}<a class="btn ${draft ? 'secondary' : ''}" href="#scan${safePlantId ? `?plant=${safePlantId}` : ''}">${icon('camera')}Nova avaliação</a><a class="btn secondary" href="#history">Ver histórico</a>${!draft ? `<button type="button" class="btn danger" data-action="delete-report">${icon('trash')}Excluir relatório</button>` : ''}</div>
  </article>`;
}

/** Download the report's actual stored values, never rendered or executable HTML. */
export function downloadReport(record = {}, plant = {}) {
  const envelope = {
    app:'Ecoplant', formatVersion:1, exportedAt:new Date().toISOString(),
    note:'Confiança do modelo não mede saúde ou gravidade. Registro de acompanhamento, não diagnóstico confirmado.',
    plant:{id:plant.id || record.plantId || null, name:plant.name || '', species:plant.species || '', location:plant.location || '', notes:plant.notes || ''},
    report:record
  };
  const body = JSON.stringify(envelope, null, 2);
  const blob = new Blob([body], {type:'application/json;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const name = String(plant.name || 'planta').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55) || 'planta';
  a.href = url;
  a.download = `ecoplant-relatorio-${name}-${new Date().toISOString().slice(0,10)}.json`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return {fileName:a.download, size:blob.size};
}
