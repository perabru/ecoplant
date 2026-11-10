#!/usr/bin/env node
// Structural publication checks only. Temporary fixtures are not trained models.
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generatorSource = await fs.readFile(path.join(root, 'scripts/prepare-pages.mjs'));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ecoplant-model-config-'));
let checks = 0;

async function fixture(name) {
  const directory = path.join(temporary, name);
  await fs.mkdir(path.join(directory, 'scripts'), { recursive: true });
  await fs.mkdir(path.join(directory, 'dist/my_model'), { recursive: true });
  await fs.mkdir(path.join(directory, 'setup'), { recursive: true });
  await fs.writeFile(path.join(directory, 'scripts/prepare-pages.mjs'), generatorSource);
  for (const name of ['index.html', 'app.js', 'firebase.js', 'local-db.js', 'pwa.js', 'sw.js', 'styles.css']) {
    await fs.writeFile(path.join(directory, 'dist', name), '/* publication fixture */\n');
  }
  await fs.writeFile(path.join(directory, 'dist/manifest.webmanifest'), JSON.stringify({ start_url: './', scope: './', id: './', icons: [] }));
  await fs.writeFile(path.join(directory, 'setup/database.rules.json'), JSON.stringify({ rules: {} }));
  return directory;
}

function run(directory, expectedError) {
  const result = spawnSync(process.execPath, ['scripts/prepare-pages.mjs'], { cwd: directory, encoding: 'utf8' });
  assert.ifError(result.error);
  if (expectedError) {
    assert.equal(result.status, 1, `A publicação deveria falhar: ${result.stdout}`);
    assert.match(result.stderr, expectedError);
  } else {
    assert.equal(result.status, 0, result.stderr);
  }
  checks += 1;
}

async function configuration(directory, expected) {
  const source = await fs.readFile(path.join(directory, 'dist/model-config.js'), 'utf8');
  const published = await fs.readFile(path.join(directory, 'docs/model-config.js'), 'utf8');
  assert.equal(published, source, 'dist/ e docs/ devem anunciar a mesma disponibilidade.');
  const { MODEL_CONFIG } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  assert.deepEqual(MODEL_CONFIG, { bundledModelAvailable: expected });
  assert.equal(Object.isFrozen(MODEL_CONFIG), true);
}

const topology = () => ({ modelTopology: {}, weightsManifest: [{ paths: ['part-1.bin', 'part-2.bin'], weights: [] }] });
const metadata = () => ({ packageName: '@teachablemachine/image', labels: ['Saudável', 'Manchas'] });

async function addModel(directory, { model = topology(), labels = metadata(), weights = true } = {}) {
  const folder = path.join(directory, 'dist/my_model');
  if (model !== null) await fs.writeFile(path.join(folder, 'model.json'), typeof model === 'string' ? model : JSON.stringify(model));
  if (labels !== null) await fs.writeFile(path.join(folder, 'metadata.json'), typeof labels === 'string' ? labels : JSON.stringify(labels));
  if (weights) {
    // Dummy bytes exercise file presence, never inference or a deployable model.
    await fs.writeFile(path.join(folder, 'part-1.bin'), Buffer.from([0, 1]));
    await fs.writeFile(path.join(folder, 'part-2.bin'), Buffer.from([2, 3]));
  }
}

try {
  const transition = await fixture('availability-transitions');
  run(transition);
  await configuration(transition, false);
  await addModel(transition);
  run(transition);
  await configuration(transition, true);
  assert.deepEqual(await fs.readFile(path.join(transition, 'docs/my_model/part-2.bin')), Buffer.from([2, 3]));
  for (const name of ['model.json', 'metadata.json', 'part-1.bin', 'part-2.bin']) await fs.unlink(path.join(transition, 'dist/my_model', name));
  run(transition);
  await configuration(transition, false);
  await assert.rejects(fs.stat(path.join(transition, 'docs/my_model/model.json')), { code: 'ENOENT' });

  const invalidCases = [
    ['missing-metadata', { labels: null }, /falta dist\/my_model\/metadata\.json/],
    ['missing-model', { model: null }, /falta dist\/my_model\/model\.json/],
    ['missing-weights', { weights: false }, /peso dist\/my_model\/part-1\.bin/],
    ['malformed-model', { model: '{ invalid' }, /model\.json não contém JSON válido/],
    ['malformed-metadata', { labels: '{ invalid' }, /metadata\.json não contém JSON válido/],
    ['missing-topology', { model: { weightsManifest: [{ paths: ['part-1.bin'] }] } }, /modelTopology e weightsManifest/],
    ['invalid-labels', { labels: { labels: ['Só uma classe'] } }, /classes distintas e não vazias/],
    ['unsafe-weight-path', { model: { modelTopology: {}, weightsManifest: [{ paths: ['../part-1.bin'] }] } }, /somente nomes de arquivos/],
    ['invalid-manifest-group', { model: { modelTopology: {}, weightsManifest: [null] } }, /somente nomes de arquivos/]
  ];
  for (const [name, candidate, expectedError] of invalidCases) {
    const directory = await fixture(name);
    run(directory);
    const markerBefore = await fs.readFile(path.join(directory, 'docs/.generated-by-ecoplant'), 'utf8');
    await addModel(directory, candidate);
    run(directory, expectedError);
    await configuration(directory, false);
    assert.equal(await fs.readFile(path.join(directory, 'docs/.generated-by-ecoplant'), 'utf8'), markerBefore);
    await assert.rejects(fs.stat(path.join(directory, 'docs/my_model/model.json')), { code: 'ENOENT' });
  }

  const sourceLink = await fixture('source-config-symlink');
  const target = path.join(sourceLink, 'unmanaged.js');
  await fs.writeFile(target, 'unmanaged sentinel');
  await fs.symlink(target, path.join(sourceLink, 'dist/model-config.js'));
  run(sourceLink, /Links simbólicos não são copiados/);
  assert.equal(await fs.readFile(target, 'utf8'), 'unmanaged sentinel');

  const sourceUnowned = await fixture('source-config-unmanaged');
  await fs.writeFile(path.join(sourceUnowned, 'dist/model-config.js'), 'unmanaged source');
  run(sourceUnowned, /arquivo não gerenciado: dist\/model-config\.js/);
  assert.equal(await fs.readFile(path.join(sourceUnowned, 'dist/model-config.js'), 'utf8'), 'unmanaged source');

  const destinationUnowned = await fixture('destination-config-unmanaged');
  await fs.mkdir(path.join(destinationUnowned, 'docs'));
  await fs.writeFile(path.join(destinationUnowned, 'docs/.generated-by-ecoplant'), JSON.stringify({ generator: 'ecoplant-github-pages', schemaVersion: 1, files: [] }));
  await fs.writeFile(path.join(destinationUnowned, 'docs/model-config.js'), 'unmanaged destination');
  run(destinationUnowned, /arquivo não gerenciado: docs\/model-config\.js/);
  assert.equal(await fs.readFile(path.join(destinationUnowned, 'docs/model-config.js'), 'utf8'), 'unmanaged destination');
  await assert.rejects(fs.stat(path.join(destinationUnowned, 'dist/model-config.js')), { code: 'ENOENT' });

  process.stdout.write(`Modelo empacotado: ${checks} execuções de preparação verificadas em pastas temporárias. Nenhum teste de reconhecimento foi realizado.\n`);
} finally {
  await fs.rm(temporary, { recursive: true, force: true });
}
