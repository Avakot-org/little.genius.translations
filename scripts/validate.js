#!/usr/bin/env node
/**
 * Translation file validator
 *
 * Usage: node validate.js <lang>.json [<lang2>.json ...]
 *
 * Checks run per file:
 *  1.  Valid JSON
 *  2.  No forbidden files modified (en.json, report.json)
 *  3.  All keys from en.json are present (none missing)
 *  4.  No extra keys not present in en.json
 *  5.  All values are non-empty strings
 *  6.  No HTML / script injection attempts
 *  7.  No JS protocol / event-handler injection
 *  8.  No non-printable control characters
 *  9.  Template placeholders ({{var}}) preserved from English source
 *  10. Value length is not absurdly longer than the English source
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ── Config ─────────────────────────────────────────────────────────────────

const MAX_LENGTH = 2000          // hard cap per value
const MAX_LENGTH_RATIO = 10      // translation can be at most 10× the English length

// Patterns we flat-out refuse
const BLOCKED_PATTERNS = [
  { re: /<script/i,                     label: 'script tag' },
  { re: /<\/script/i,                   label: 'closing script tag' },
  { re: /javascript\s*:/i,              label: 'javascript: URI' },
  { re: /on[a-z]{2,}\s*=/i,            label: 'inline event handler (onX=)' },
  { re: /<iframe/i,                     label: 'iframe tag' },
  { re: /<img[^>]+onerror/i,            label: 'img onerror injection' },
  { re: /data:[^,]*base64/i,            label: 'base64 data URI' },
  { re: /&#x?[0-9a-f]+;/i,             label: 'HTML numeric entity (potential obfuscation)' },
  { re: /\u202e/,                       label: 'right-to-left override character (U+202E)' },
]

// ── Helpers ─────────────────────────────────────────────────────────────────

function extractPlaceholders(str) {
  return (str.match(/\{\{[^}]+\}\}/g) ?? []).sort()
}

function hasControlChars(str) {
  // Allow tab (\x09), newline (\x0a), carriage return (\x0d)
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(str)
}

// ── Validator ───────────────────────────────────────────────────────────────

function validate(file, enContent) {
  const errors = []
  const warnings = []
  const label = path.basename(file)

  // 1. Forbidden file names
  if (label === 'en.json') {
    errors.push('en.json is the source of truth — do not submit it as a translation.')
    return { errors, warnings }
  }
  if (label === 'report.json') {
    errors.push('report.json is auto-generated — do not submit it in a PR.')
    return { errors, warnings }
  }

  // Language code sanity (must be 2–5 lowercase alpha chars)
  const langCode = label.replace('.json', '')
  if (!/^[a-z]{2,5}$/.test(langCode)) {
    errors.push(`File name "${label}" is not a valid language code (expected e.g. "de.json").`)
  }

  // 2. Valid JSON
  let content
  try {
    content = JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch (e) {
    errors.push(`Invalid JSON: ${e.message}`)
    return { errors, warnings }
  }

  if (typeof content !== 'object' || Array.isArray(content) || content === null) {
    errors.push('Root value must be a JSON object.')
    return { errors, warnings }
  }

  const enKeys = new Set(Object.keys(enContent))
  const langKeys = new Set(Object.keys(content))

  // 3. Missing keys
  for (const key of enKeys) {
    if (!langKeys.has(key)) {
      errors.push(`Missing key: "${key}"`)
    }
  }

  // 4. Extra keys
  for (const key of langKeys) {
    if (!enKeys.has(key)) {
      errors.push(`Unknown key not in en.json: "${key}"`)
    }
  }

  // Per-value checks
  for (const [key, value] of Object.entries(content)) {
    if (!enKeys.has(key)) continue // already flagged above

    // 5. Must be a string
    if (typeof value !== 'string') {
      errors.push(`[${key}] Value must be a string, got ${typeof value}.`)
      continue
    }

    // 5b. Non-empty (unless English is also empty)
    const enValue = enContent[key]
    if (value.trim() === '' && enValue.trim() !== '') {
      warnings.push(`[${key}] Value is empty (English is not).`)
    }

    // 6 & 7. Injection checks
    for (const { re, label: patLabel } of BLOCKED_PATTERNS) {
      if (re.test(value)) {
        errors.push(`[${key}] Contains blocked content: ${patLabel}.`)
      }
    }

    // 8. Control characters
    if (hasControlChars(value)) {
      errors.push(`[${key}] Contains non-printable control characters.`)
    }

    // 9. Placeholder consistency
    const enPlaceholders = extractPlaceholders(enValue)
    const langPlaceholders = extractPlaceholders(value)
    const missing = enPlaceholders.filter(p => !langPlaceholders.includes(p))
    const extra = langPlaceholders.filter(p => !enPlaceholders.includes(p))
    if (missing.length) {
      errors.push(`[${key}] Missing template placeholder(s): ${missing.join(', ')}`)
    }
    if (extra.length) {
      errors.push(`[${key}] Extra template placeholder(s) not in English: ${extra.join(', ')}`)
    }

    // 10. Length sanity
    if (value.length > MAX_LENGTH) {
      errors.push(`[${key}] Value exceeds hard cap of ${MAX_LENGTH} characters (got ${value.length}).`)
    } else if (enValue.length > 0 && value.length > enValue.length * MAX_LENGTH_RATIO) {
      warnings.push(`[${key}] Value is ${Math.round(value.length / enValue.length)}× longer than English — looks suspicious.`)
    }
  }

  return { errors, warnings }
}

// ── Main ─────────────────────────────────────────────────────────────────────

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('Usage: node validate.js <lang>.json [...]')
  process.exit(1)
}

const enFile = path.join(__dirname, '..', 'en.json')
if (!fs.existsSync(enFile)) {
  console.error('❌ en.json not found — cannot validate without a source file.')
  process.exit(1)
}

const enContent = JSON.parse(fs.readFileSync(enFile, 'utf-8'))
let totalErrors = 0
let totalWarnings = 0

for (const file of files) {
  const absFile = path.isAbsolute(file) ? file : path.join(__dirname, '..', file)
  console.log(`\n🔍 Validating: ${path.basename(absFile)}`)

  if (!fs.existsSync(absFile)) {
    console.error(`  ❌ File not found: ${absFile}`)
    totalErrors++
    continue
  }

  const { errors, warnings } = validate(absFile, enContent)

  for (const w of warnings) console.warn(`  ⚠️  ${w}`)
  for (const e of errors)   console.error(`  ❌ ${e}`)

  if (errors.length === 0 && warnings.length === 0) {
    console.log('  ✅ All checks passed.')
  }

  totalErrors += errors.length
  totalWarnings += warnings.length
}

console.log(`\n─────────────────────────────────────────`)
console.log(`Results: ${totalErrors} error(s), ${totalWarnings} warning(s) across ${files.length} file(s).`)

if (totalErrors > 0) {
  console.error('\n❌ Validation failed — please fix the errors above.')
  process.exit(1)
}

if (totalWarnings > 0) {
  console.warn('\n⚠️  Validation passed with warnings.')
}

console.log('\n✅ All translation files are valid.')
