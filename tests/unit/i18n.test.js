const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const LOCALES = ['de', 'en', 'es', 'fr', 'pt-BR', 'ja', 'zh-CN', 'zh-TW', 'ko'];
const ROOT = path.join(__dirname, '..', '..');

function loadLocale(name) {
  // Locale files use `export default {...}`; strip the ESM wrapper for CJS tests.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'i18n', 'locales', `${name}.js`), 'utf8');
  const cjs = src.replace(/^export default/, 'module.exports =');
  const module = { exports: {} };
  new Function('module', 'exports', cjs)(module, module.exports);
  return module.exports;
}

test('all 9 locales expose identical key sets', () => {
  const tables = LOCALES.map(loadLocale);
  const enKeys = Object.keys(tables[1]).sort();
  assert.ok(enKeys.length > 200, `expected a full key set, got ${enKeys.length}`);
  LOCALES.forEach((name, i) => {
    const keys = Object.keys(tables[i]).sort();
    const missing = enKeys.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !enKeys.includes(k));
    assert.deepStrictEqual(
      { missing, extra },
      { missing: [], extra: [] },
      `${name} locale key mismatch`
    );
  });
});

test('every t(...) key used in the renderer exists in the locale tables', () => {
  const en = loadLocale('en');
  const used = new Set();

  const scan = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(p);
      } else if (/\.(jsx?|mjs)$/.test(entry.name)) {
        const src = fs.readFileSync(p, 'utf8');
        // t('key'), t(`key`), t("key") and template-literal static keys
        for (const m of src.matchAll(/\bt\(\s*['"`]([^'"`$\n{}]+)['"`]/g)) {
          used.add(m[1]);
        }
        // t(`${op.id}`) style dynamic keys resolved from ops.js ids
        for (const m of src.matchAll(/\bt\(\s*`([^`]*\$\{[^}]+\}[^`]*)`\s*\)/g)) {
          // dynamic template keys — validated separately below
        }
      }
    }
  };
  scan(path.join(ROOT, 'src'));

  // Dynamic keys: op names/descriptions from the registry.
  const opsSrc = fs.readFileSync(path.join(ROOT, 'src', 'ops.js'), 'utf8');
  for (const m of opsSrc.matchAll(/id:\s*'([^']+)'/g)) used.add(m[1]);
  for (const m of opsSrc.matchAll(/id:\s*'([^']+)'/g)) used.add(`${m[1]}.desc`);
  // Group labels referenced by OperationGrid.
  for (const m of opsSrc.matchAll(/group:\s*'([^']+)'/g)) used.add(`group.${m[1]}`);

  // Keys the app composes dynamically.
  for (const k of ['common.queued', 'common.running', 'common.done', 'common.error', 'common.canceled',
    'nav.video', 'nav.audio', 'nav.subtitle', 'preset.compat', 'preset.balanced', 'preset.quality', 'preset.small']) {
    used.add(k);
  }
  for (const p of ['compat', 'balanced', 'quality', 'small']) used.add(`preset.${p}.desc`);

  const missing = [...used].filter((k) => !(k in en));
  assert.deepStrictEqual(missing, [], `keys missing from locales: ${missing.join(', ')}`);
});

test('common.or exists in every locale (previously missing)', () => {
  for (const name of LOCALES) {
    const t = loadLocale(name);
    assert.ok(t['common.or'], `common.or missing in ${name}`);
    assert.ok(typeof t['common.or'] === 'string' && t['common.or'].length > 0);
  }
});

// Every param label key the UI can construct dynamically must exist in the
// locale tables. This is the regression test for the "param.startSec" bug:
// labels resolve as `param.<key>` unless a labelKey is declared, and the
// static t('...') scan cannot see them.
test('every op param resolves to a translated label key', async () => {
  const en = loadLocale('en');
  const ops = await import('../../src/ops.js');

  const missing = [];
  for (const op of ops.OPS) {
    for (const p of op.params) {
      // Effective label key, mirroring ParamPanel's rendering rules.
      let key;
      switch (p.type) {
        case 'preset': key = 'param.quality'; break;
        case 'codec': key = 'param.videoCodec'; break;
        case 'size': key = 'param.ratio'; break;
        case 'stream': key = 'param.stream'; break;
        default: key = p.labelKey || `param.${p.key}`;
      }
      if (p.type === 'stream') continue; // rendered with a dynamic picker
      if (!(key in en)) missing.push(`${op.id}.${p.key} -> ${key}`);

      // Option label keys must exist too.
      if (p.optionLabelKeys) {
        for (const labelKey of Object.values(p.optionLabelKeys)) {
          if (!(labelKey in en)) missing.push(`${op.id}.${p.key} option -> ${labelKey}`);
        }
      }
      for (const o of p.options || []) {
        if (typeof o === 'object' && o.labelKey && !(o.labelKey in en)) {
          missing.push(`${op.id}.${p.key} option -> ${o.labelKey}`);
        }
      }
    }
  }
  assert.deepStrictEqual(missing, [], `param label keys missing from locales:\n  ${missing.join('\n  ')}`);
});
