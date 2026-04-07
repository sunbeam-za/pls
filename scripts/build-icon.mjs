#!/usr/bin/env node
// Normalize a raw brand asset into a proper macOS app icon.
//
// Apple's convention: 1024×1024 canvas with the visual content sized at
// about 824×824 (≈80%) and transparent padding on every side. Drop a
// fresh raw square PNG at `--input` and we scale → pad → write to
// resources/icon.png.
//
// Usage:
//   node scripts/build-icon.mjs               # uses ~/Downloads/512-rounded.png
//   node scripts/build-icon.mjs --input path  # any other source
//   node scripts/build-icon.mjs --canvas 1024 --content 824
//
// Keeps sharp-cli as an npx call so we don't add it to deps permanently.

import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const OUT = join(REPO_ROOT, 'resources', 'icon.png')

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : fallback
}

const input = resolve(arg('input', join(homedir(), 'Downloads', '512-rounded.png')))
const canvas = Number(arg('canvas', '1024'))
const content = Number(arg('content', '824'))
const padding = Math.floor((canvas - content) / 2)

if (!existsSync(input)) {
  console.error(`build-icon: input not found — ${input}`)
  process.exit(1)
}

const tmpScaled = join(REPO_ROOT, '.icon-scaled.tmp.png')
const tmpPadded = join(REPO_ROOT, '.icon-padded.tmp.png')

function run(label, args) {
  const result = spawnSync('npx', ['-y', 'sharp-cli', ...args], {
    stdio: ['ignore', 'inherit', 'inherit']
  })
  if (result.status !== 0) {
    console.error(`build-icon: ${label} failed`)
    process.exit(result.status ?? 1)
  }
}

console.log(`build-icon: ${input} → ${content}×${content} centred on ${canvas}×${canvas}`)

run('resize', ['-i', input, '-o', tmpScaled, 'resize', String(content), String(content)])
run('extend', [
  '-i',
  tmpScaled,
  '-o',
  tmpPadded,
  'extend',
  String(padding),
  String(padding),
  String(padding),
  String(padding),
  '--background',
  '#00000000'
])

mkdirSync(dirname(OUT), { recursive: true })
renameSync(tmpPadded, OUT)
// Best-effort cleanup; intermediate file doesn't hurt if it lingers.
try {
  const { unlinkSync } = await import('node:fs')
  unlinkSync(tmpScaled)
} catch {}

console.log(`build-icon: wrote ${OUT}`)
