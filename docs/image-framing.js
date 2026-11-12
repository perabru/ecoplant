/** User-controlled framing. This module never classifies or changes a verdict. */
const clamp = (value, min, max, fallback) => Number.isFinite(Number(value))
  ? Math.max(min, Math.min(max, Number(value))) : fallback;

export function cropBounds(width, height, { zoom = 1, x = 50, y = 50 } = {}) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('Não foi possível abrir a imagem para ajustar o enquadramento.');
  }
  const side = Math.min(width, height) / clamp(zoom, 1, 4, 1);
  return {
    x: (width - side) * clamp(x, 0, 100, 50) / 100,
    y: (height - side) * clamp(y, 0, 100, 50) / 100,
    width: side, height: side
  };
}

export function framedCanvas(image, settings, ownerDocument = document) {
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  const area = cropBounds(width, height, settings), canvas = ownerDocument.createElement('canvas');
  canvas.width = canvas.height = Math.max(1, Math.min(850, Math.round(area.width)));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('O navegador não conseguiu preparar o recorte. Tente enviar outra foto.');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function mountFramingEditor(container, image) {
  const canvas = container.querySelector('[data-framing-preview]'), context = canvas.getContext('2d');
  if (!context) throw new Error('O navegador não conseguiu abrir a prévia do enquadramento.');
  const controls = Object.fromEntries(['zoom', 'x', 'y'].map(key => [key, container.querySelector(`[data-framing="${key}"]`)]));
  const settings = { zoom: 1, x: 50, y: 50 }, listeners = [];
  const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
  let drag = null;
  const listen = (element, type, handler) => { element.addEventListener(type, handler); listeners.push(() => element.removeEventListener(type, handler)); };
  function paint() {
    const area = cropBounds(width, height, settings), size = canvas.width, margin = size / 16;
    context.clearRect(0, 0, size, size);
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = 'high';
    context.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, size, size);
    // Keep the leaf inside this safe area: the default model uses a center crop.
    // The mask is preview-only and is never included in the image or prediction.
    context.fillStyle = 'rgba(10,30,22,.4)';
    context.fillRect(0, 0, size, margin); context.fillRect(0, size - margin, size, margin);
    context.fillRect(0, margin, margin, size - 2 * margin); context.fillRect(size - margin, margin, margin, size - 2 * margin);
    context.strokeStyle = '#ffffff'; context.lineWidth = 2;
    context.strokeRect(margin, margin, size - 2 * margin, size - 2 * margin);
    for (const key of ['zoom', 'x', 'y']) controls[key].value = String(settings[key]);
    container.querySelector('[data-framing-value="zoom"]').textContent = `${settings.zoom.toFixed(2).replace('.', ',')}×`;
    controls.x.disabled = width - area.width < .01;
    controls.y.disabled = height - area.height < .01;
  }
  for (const key of ['zoom', 'x', 'y']) listen(controls[key], 'input', () => {
    settings[key] = clamp(controls[key].value, key === 'zoom' ? 1 : 0, key === 'zoom' ? 4 : 100, key === 'zoom' ? 1 : 50);
    paint();
  });
  listen(canvas, 'pointerdown', event => {
    if (event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    drag = { clientX: event.clientX, clientY: event.clientY, area: cropBounds(width, height, settings), size: rect.width };
    canvas.setPointerCapture(event.pointerId);
  });
  listen(canvas, 'pointermove', event => {
    if (!drag || !drag.size) return;
    const scale = drag.area.width / drag.size;
    settings.x = width > drag.area.width ? clamp((drag.area.x - (event.clientX - drag.clientX) * scale) / (width - drag.area.width) * 100, 0, 100, 50) : 50;
    settings.y = height > drag.area.height ? clamp((drag.area.y - (event.clientY - drag.clientY) * scale) / (height - drag.area.height) * 100, 0, 100, 50) : 50;
    paint();
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(canvas, event, () => { drag = null; });
  listen(container.querySelector('[data-framing-reset]'), 'click', () => { Object.assign(settings, { zoom: 1, x: 50, y: 50 }); paint(); });
  paint();
  return { getCanvas: () => framedCanvas(image, settings, container.ownerDocument), dispose: () => listeners.forEach(remove => remove()) };
}
