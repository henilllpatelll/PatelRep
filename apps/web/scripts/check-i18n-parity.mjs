// FOUND-05: EN/ES i18n key-parity gate.
//
// Statically parses `i18n/locales/en.ts` and `es.ts` with the TypeScript
// compiler API (no module execution -- avoids needing tsx or running app
// code) to flatten each locale's exported object literal into a dot-path
// key set, then diffs the two sets. This is stronger than and separate
// from the `i18next/no-literal-string` eslint rule (verify-i18n-gate.mjs):
// that rule only proves no raw JSX literal exists, it says nothing about
// whether a translation key that exists in one locale is missing from the
// other. Exits 1 (naming every offending key + direction) on any drift,
// exits 0 when the two locales are in parity.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const localesDir = path.join(root, 'i18n', 'locales')

function propertyKeyText(node) {
  if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNumericLiteral(node)) {
    return node.text
  }
  if (ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text
  }
  return null
}

function flattenObjectLiteral(objectLiteral, prefix, keys) {
  for (const property of objectLiteral.properties) {
    let name = null
    if (ts.isPropertyAssignment(property)) {
      name = propertyKeyText(property.name)
    } else if (ts.isShorthandPropertyAssignment(property)) {
      name = propertyKeyText(property.name)
    }
    if (name === null) continue

    const dotPath = prefix ? `${prefix}.${name}` : name

    if (ts.isPropertyAssignment(property) && ts.isObjectLiteralExpression(property.initializer)) {
      flattenObjectLiteral(property.initializer, dotPath, keys)
    } else {
      keys.add(dotPath)
    }
  }
}

function findExportedObjectLiteral(sourceFile) {
  let rootIdentifierName = null
  let objectLiteral = null

  for (const statement of sourceFile.statements) {
    if (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.length === 1
    ) {
      const decl = statement.declarationList.declarations[0]
      if (
        ts.isIdentifier(decl.name) &&
        decl.initializer &&
        ts.isObjectLiteralExpression(decl.initializer)
      ) {
        rootIdentifierName = decl.name.text
        objectLiteral = decl.initializer
      }
    }
  }

  if (!objectLiteral) return null

  const hasMatchingDefaultExport = sourceFile.statements.some((statement) => {
    if (!ts.isExportAssignment(statement) || statement.isExportEquals) return false
    return ts.isIdentifier(statement.expression) && statement.expression.text === rootIdentifierName
  })

  return hasMatchingDefaultExport ? objectLiteral : null
}

function flattenLocaleFile(filePath) {
  const source = fs.readFileSync(filePath, 'utf8')
  const sourceFile = ts.createSourceFile(path.basename(filePath), source, ts.ScriptTarget.Latest, true)

  const objectLiteral = findExportedObjectLiteral(sourceFile)
  if (!objectLiteral) {
    throw new Error(`${path.basename(filePath)}: could not find a "const x = {...}; export default x" object literal`)
  }

  const keys = new Set()
  flattenObjectLiteral(objectLiteral, '', keys)
  return keys
}

function main() {
  const enPath = path.join(localesDir, 'en.ts')
  const esPath = path.join(localesDir, 'es.ts')

  const enKeys = flattenLocaleFile(enPath)
  const esKeys = flattenLocaleFile(esPath)

  const missingInEs = [...enKeys].filter((key) => !esKeys.has(key)).sort()
  const missingInEn = [...esKeys].filter((key) => !enKeys.has(key)).sort()

  if (missingInEs.length === 0 && missingInEn.length === 0) {
    console.log(`check-i18n-parity: en.ts and es.ts are in parity (${enKeys.size} keys).`)
    return
  }

  if (missingInEs.length > 0) {
    console.error(`FAIL: ${missingInEs.length} key(s) present in en.ts but missing from es.ts:`)
    for (const key of missingInEs) console.error(`  - ${key}`)
  }
  if (missingInEn.length > 0) {
    console.error(`FAIL: ${missingInEn.length} key(s) present in es.ts but missing from en.ts:`)
    for (const key of missingInEn) console.error(`  - ${key}`)
  }
  process.exit(1)
}

main()
