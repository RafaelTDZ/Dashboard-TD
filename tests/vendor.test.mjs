import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

// Validação do vendor/ (T5). O manifesto já era conferido (hash e existência
// dos arquivos), mas a VERSÃO das libs vendorizadas não era: foi exatamente
// por isso que o SheetJS 0.18.5 (com CVE-2023-30533 e CVE-2024-22363)
// passou despercebido enquanto o package.json declarava 0.20.3.

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const vendorDir = join(root, 'vendor');
const manifestPath = join(vendorDir, 'manifest.json');
const manifestRaw = readFileSync(manifestPath, 'utf8');
const manifest = JSON.parse(manifestRaw);

// Arquivos que legitimamente NÃO têm entrada no manifesto:
//   - o próprio manifesto;
//   - os binários de fonte referenciados pelos CSS das bibliotecas
//     (o hash do CSS já cobre o conteúdo referenciado).
const IGNORED_FILES = ['vendor/manifest.json'];
const IGNORED_PREFIXES = ['vendor/fontawesome/webfonts/'];
const IGNORED_SUFFIXES = { 'vendor/fonts/': ['.woff2'] };

function isIgnored(relativePath) {
  if (IGNORED_FILES.includes(relativePath)) return true;
  if (IGNORED_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return true;
  return Object.entries(IGNORED_SUFFIXES).some(([prefix, suffixes]) => (
    relativePath.startsWith(prefix) && suffixes.some((suffix) => relativePath.endsWith(suffix))
  ));
}

// Caminhos sempre no formato posix (o `relative` do Windows usa "\").
function toPosix(value) {
  return value.split(sep).join('/');
}

function listFiles(directory) {
  const found = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full));
    else found.push(full);
  }
  return found;
}

function compareVersions(left, right) {
  const a = String(left).split('.').map(Number);
  const b = String(right).split('.').map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

function libraryNamed(pattern) {
  return manifest.libraries.find((library) => pattern.test(library.entry));
}

test('o manifesto de dependências é um JSON válido e tem a nota de origem', () => {
  assert.equal(typeof manifest, 'object');
  assert.ok(Array.isArray(manifest.libraries), 'a chave libraries precisa ser uma lista');
  assert.ok(manifest.libraries.length >= 5, 'todas as bibliotecas vendorizadas precisam estar listadas');
  assert.equal(typeof manifest.note, 'string');
  assert.ok(manifest.note.length > 0, 'a nota do manifesto não pode estar vazia');
  assert.equal(manifest.strategy, 'offline-vendored');
});

test('a versão embutida do SheetJS é >= 0.20.2 e bate com o manifesto', () => {
  const entry = join(vendorDir, 'xlsx.full.min.js');
  const source = readFileSync(entry, 'utf8');

  // Versão extraída do próprio arquivo (o bundle minificado publica a
  // versão em `XLSX.version`).
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: entry });
  const runtimeVersion = context.XLSX && context.XLSX.version;
  assert.equal(typeof runtimeVersion, 'string', 'o bundle precisa publicar XLSX.version');

  // A mesma versão aparece no texto do arquivo (regex em version="x.y.z").
  const declared = [...source.matchAll(/version\s*=\s*["']([0-9]+\.[0-9]+\.[0-9]+)["']/g)].map((match) => match[1]);
  assert.ok(declared.includes(runtimeVersion), 'a versão publicada tem de estar no texto do bundle');

  assert.ok(
    compareVersions(runtimeVersion, '0.20.2') >= 0,
    `o SheetJS vendorizado precisa ser >= 0.20.2 (achou ${runtimeVersion})`
  );

  const library = libraryNamed(/xlsx\.full\.min\.js$/);
  assert.ok(library, 'o SheetJS precisa estar no manifesto');
  assert.equal(library.version, runtimeVersion, 'a versão do manifesto difere da versão embutida');
  assert.match(library.origin, /xlsx-0\.20\./);
});

test('a versão do SheetJS usada na URL de cache-busting bate com o manifesto', () => {
  // O import.js carrega a lib sob demanda com ?v=<versão> na URL. Se a versão
  // do manifesto mudar e a constante do import.js não, o navegador passa a
  // reaproveitar do cache a versão antiga (e possivelmente truncada) da lib.
  const importer = readFileSync(join(root, 'assets', 'js', 'import.js'), 'utf8');
  const declared = importer.match(/XLSX_LIB_VERSION\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(declared, 'import.js precisa declarar XLSX_LIB_VERSION');

  const library = libraryNamed(/xlsx\.full\.min\.js$/);
  assert.ok(library, 'o SheetJS precisa estar no manifesto');
  assert.equal(declared[1], library.version, 'XLSX_LIB_VERSION precisa acompanhar a versão do manifesto');

  // E a URL precisa realmente usar a constante (não uma string fixa).
  assert.match(importer, /vendor\/xlsx\.full\.min\.js\?v=/);
  assert.match(importer, /XLSX_LIB_VERSION/);
});

test('o sha256 de cada entrada do manifesto confere com o arquivo em disco', () => {
  for (const library of manifest.libraries) {
    const full = join(root, library.entry);
    assert.equal(existsSync(full), true, library.entry + ' não existe no disco');
    const hash = createHash('sha256').update(readFileSync(full)).digest('hex').toUpperCase();
    assert.equal(hash, library.sha256, 'hash divergente em ' + library.entry);
    assert.match(library.sha256, /^[0-9A-F]{64}$/);
    assert.match(library.origin, /^https:\/\//);
    assert.ok(library.name && library.name.length > 0, library.entry + ' precisa de um nome');
  }
});

test('toda entrada do diretório vendor/ tem registro no manifesto', () => {
  const registered = new Set(manifest.libraries.map((library) => toPosix(library.entry)));
  const files = listFiles(vendorDir)
    .map((file) => toPosix(relative(root, file)))
    .filter((file) => !isIgnored(file));

  assert.ok(files.length > 0);
  for (const file of files) {
    assert.ok(registered.has(file), file + ' está no vendor/ mas não está no manifesto');
  }

  // Nenhum registro do manifesto pode apontar para um arquivo ignorado
  // (o manifesto descreve as entradas de verdade).
  for (const library of manifest.libraries) {
    assert.equal(isIgnored(toPosix(library.entry)), false, library.entry + ' não deveria estar na lista de ignorados');
  }
});

test('o manifesto registra as libs vendorizadas com versão real (B11)', () => {
  // O Tailwind Play CDN foi substituído por CSS compilado e não é mais
  // vendorizado; o manifesto não deve voltar a apontar para ele.
  assert.equal(libraryNamed(/tailwind\.js$/), undefined, 'o Tailwind Play CDN não deve voltar ao vendor/');

  // A analytics do Vercel (que não era registrada) precisa estar no manifesto.
  const analytics = libraryNamed(/vercel-analytics\.mjs$/);
  assert.ok(analytics, 'a analytics do Vercel precisa estar no manifesto');
  assert.match(analytics.version, /^\d+\.\d+\.\d+$/);

  // B16 — nenhuma entrada pode declarar a versão como "unknown": a fonte
  // vendorizada é a release v12 do Google Fonts (os quatro woff2 conferem
  // byte a byte com fonts.gstatic.com/s/plusjakartasans/v12/).
  for (const library of manifest.libraries) {
    assert.ok(library.version && library.version !== 'unknown',
      library.name + ' precisa de uma versão real no manifesto');
  }
  const font = libraryNamed(/plus-jakarta-sans\.css$/);
  assert.ok(font, 'a fonte precisa estar no manifesto');
  assert.equal(font.version, 'v12', 'a fonte vendorizada é a release v12 do Google Fonts');

  // E nenhuma entrada pode apontar para fora do diretório vendor/.
  for (const library of manifest.libraries) {
    assert.ok(library.entry.startsWith('vendor/'), library.entry + ' precisa ficar dentro de vendor/');
    assert.equal(library.entry.includes('..'), false, library.entry + ' não pode sair de vendor/');
  }
});

test('as bibliotecas vendorizadas são as mesmas que o index.html usa', () => {
  const html = readFileSync(join(root, 'index.html'), 'utf8');
  const referenced = [...html.matchAll(/(?:src|href)="(vendor\/[^"#?]+)"/g)].map((match) => match[1]);
  assert.ok(referenced.length > 0);
  for (const reference of referenced) {
    assert.equal(existsSync(join(root, reference)), true, reference);
  }
  // O carregador sob demanda do SheetJS aponta para o bundle vendorizado.
  const importer = readFileSync(join(root, 'assets', 'js', 'import.js'), 'utf8');
  assert.match(importer, /vendor\/xlsx\.full\.min\.js/);
  assert.equal(libraryNamed(/xlsx\.full\.min\.js$/).entry, 'vendor/xlsx.full.min.js');
});

test('o manifesto não aponta para arquivos vazios ou ilegíveis', () => {
  for (const library of manifest.libraries) {
    const full = join(root, library.entry);
    assert.equal(statSync(full).size > 0, true, library.entry + ' está vazio');
  }
});
