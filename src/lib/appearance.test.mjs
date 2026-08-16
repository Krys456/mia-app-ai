/**
 * #270 User Copy + Appearance typography
 * Run: node --experimental-strip-types src/lib/appearance.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const appearancePath = path.resolve('src/lib/appearance.ts')
const typesPath = path.resolve('src/types.ts')

async function loadTsModule(entryPath) {
  try {
    const esbuild = await import('esbuild')
    const outfile = path.join(os.tmpdir(), `appearance-${Date.now()}.mjs`)
    await esbuild.build({
      entryPoints: [entryPath],
      outfile,
      bundle: true,
      format: 'esm',
      platform: 'neutral',
      target: 'es2022',
    })
    return await import(pathToFileURL(outfile).href)
  } catch {
    // fall through
  }

  const ts = await import('typescript')
  const source = fs.readFileSync(entryPath, 'utf8')
  // appearance.ts imports ../types — transpile both into one temp dir is messy;
  // prefer esbuild. If unavailable, read types inline via strip + rewrite.
  const typesSource = fs.readFileSync(typesPath, 'utf8')
  const typesOut = ts.transpileModule(typesSource, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'types.ts',
  }).outputText
  const appearanceOut = ts.transpileModule(
    source.replace(/from '\.\.\/types'/g, "from './types.mjs'"),
    {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: 'appearance.ts',
    },
  ).outputText
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'appearance-'))
  fs.writeFileSync(path.join(dir, 'types.mjs'), typesOut)
  fs.writeFileSync(path.join(dir, 'appearance.mjs'), appearanceOut)
  return await import(pathToFileURL(path.join(dir, 'appearance.mjs')).href)
}

const mod = await loadTsModule(appearancePath)
const {
  normalizeAppearance,
  FONT_SIZE_SCALE,
  FONT_FAMILY_STACK,
  applyAppearanceToDocument,
} = mod

// D–F: normalize + scales
assert.deepEqual(normalizeAppearance(undefined), {
  fontSize: 'default',
  fontFamily: 'outfit',
})
assert.deepEqual(normalizeAppearance(null), {
  fontSize: 'default',
  fontFamily: 'outfit',
})
assert.deepEqual(normalizeAppearance({}), {
  fontSize: 'default',
  fontFamily: 'outfit',
})
assert.deepEqual(normalizeAppearance({ fontSize: 'huge', fontFamily: 'Inter' }), {
  fontSize: 'default',
  fontFamily: 'outfit',
})
assert.deepEqual(normalizeAppearance({ fontSize: 'small', fontFamily: 'system' }), {
  fontSize: 'small',
  fontFamily: 'system',
})
assert.deepEqual(normalizeAppearance({ fontSize: 'large', fontFamily: 'outfit' }), {
  fontSize: 'large',
  fontFamily: 'outfit',
})

assert.equal(FONT_SIZE_SCALE.small, 0.92)
assert.equal(FONT_SIZE_SCALE.default, 1)
assert.equal(FONT_SIZE_SCALE.large, 1.12)
assert.match(FONT_FAMILY_STACK.outfit, /Outfit/)
assert.match(FONT_FAMILY_STACK.system, /system-ui/)
assert.doesNotMatch(FONT_FAMILY_STACK.system, /Inter/)

// applyAppearanceToDocument sets CSS vars
const props = new Map()
const dataset = /** @type {Record<string, string>} */ ({})
globalThis.document = {
  documentElement: {
    style: {
      setProperty(k, v) {
        props.set(k, v)
      },
    },
    dataset,
  },
}
applyAppearanceToDocument({ fontSize: 'large', fontFamily: 'system' })
assert.equal(props.get('--chat-font-scale'), '1.12')
assert.equal(props.get('--font-sans'), FONT_FAMILY_STACK.system)
assert.equal(dataset.fontSize, 'large')
assert.equal(dataset.fontFamily, 'system')

applyAppearanceToDocument({ fontSize: 'small', fontFamily: 'outfit' })
assert.equal(props.get('--chat-font-scale'), '0.92')
assert.equal(props.get('--font-sans'), FONT_FAMILY_STACK.outfit)

console.log('ok: appearance normalize + CSS vars')
