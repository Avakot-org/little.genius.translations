#!/usr/bin/env node
/**
 * i18n Auto-Sync Script (i18n submodule edition)
 *
 * This script:
 * 1. Reads en.json as the source of truth
 * 2. For each language file, adds any missing keys (with English as placeholder)
 * 3. Preserves existing translations in other language files
 * 4. Maintains consistent key structure across all languages
 * 5. Generates report.json with per-language translation completion stats
 *
 * Usage: node scripts/sync-i18n.js
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// JSON files live at the repository root (one level up from scripts/)
const I18N_DIR = path.join(__dirname, '..')
const LANGUAGES = ['de', 'es', 'fr', 'it', 'ja', 'ko', 'pl', 'pt', 'ru', 'tr', 'zh']

/**
 * Sync a language file against en.json.
 * Returns a stats object for the report.
 */
function syncLanguage(lang, enContent) {
  const langFile = path.join(I18N_DIR, `${lang}.json`)

  // Read or create language file
  let langContent = {}
  if (fs.existsSync(langFile)) {
    try {
      langContent = JSON.parse(fs.readFileSync(langFile, 'utf-8'))
    } catch (e) {
      console.warn(`⚠️  Could not parse ${lang}.json, starting fresh`)
      langContent = {}
    }
  }

  const enKeys = Object.keys(enContent).sort()

  // Merge: keep existing, add missing from English
  const merged = {}
  const untranslatedKeys = []
  const missingKeys = []

  for (const key of enKeys) {
    if (Object.hasOwn(langContent, key)) {
      merged[key] = langContent[key]
      // Same value as English = still a placeholder, not yet translated
      if (langContent[key] === enContent[key]) {
        untranslatedKeys.push(key)
      }
    } else {
      // Key missing entirely — backfill with English
      merged[key] = enContent[key]
      missingKeys.push(key)
      untranslatedKeys.push(key)
    }
  }

  // Write back
  fs.writeFileSync(langFile, JSON.stringify(merged, null, 2) + '\n')

  const totalKeys = enKeys.length
  const translatedKeys = totalKeys - untranslatedKeys.length
  const completion = totalKeys > 0 ? Math.round((translatedKeys / totalKeys) * 1000) / 10 : 100

  const bar = progressBar(completion)
  console.log(`✅ ${lang.padEnd(3)}  ${bar}  ${completion.toFixed(1).padStart(5)}%  (${translatedKeys}/${totalKeys} keys)`)

  return {
    translated: translatedKeys,
    untranslated: untranslatedKeys.length,
    missing: missingKeys.length,
    completion,
  }
}

/** Render a simple ASCII progress bar (20 chars wide). */
function progressBar(pct) {
  const filled = Math.round(pct / 5)
  return '[' + '█'.repeat(filled) + '░'.repeat(20 - filled) + ']'
}

function main() {
  console.log('🌍 Starting i18n sync...\n')

  // Verify source file exists
  const enFile = path.join(I18N_DIR, 'en.json')
  if (!fs.existsSync(enFile)) {
    console.error(`❌ Source file not found: ${enFile}`)
    process.exit(1)
  }

  const enContent = JSON.parse(fs.readFileSync(enFile, 'utf-8'))
  const totalKeys = Object.keys(enContent).length

  console.log(`📖 English source: ${totalKeys} keys\n`)

  const report = {
    generated: new Date().toISOString(),
    totalKeys,
    languages: {},
  }

  for (const lang of LANGUAGES) {
    report.languages[lang] = syncLanguage(lang, enContent)
  }

  // Write report.json at the repository root
  const reportFile = path.join(I18N_DIR, 'report.json')
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n')

  // Summary table
  console.log('\n📊 Translation report:\n')
  const sorted = Object.entries(report.languages).sort((a, b) => b[1].completion - a[1].completion)
  for (const [lang, stats] of sorted) {
    const status = stats.completion === 100 ? '🟢' : stats.completion >= 80 ? '🟡' : '🔴'
    console.log(`  ${status} ${lang.padEnd(3)}  ${stats.completion.toFixed(1).padStart(5)}%  — ${stats.untranslated} key(s) still in English`)
  }

  console.log('\n✨ Sync complete!')
  console.log(`📝 Translation files: ${I18N_DIR}`)
  console.log(`📄 Report written to: ${reportFile}`)
  console.log(`💡 Add new keys to en.json, then run this script to populate other languages\n`)
}

main()
