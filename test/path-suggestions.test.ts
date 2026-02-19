import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { normalizeMatchKey, findSimilarPaths } from '../src/commands/convert'
import { CliError } from '../src/types'

describe('path-suggestions', () => {
  test('normalizeMatchKey folds smart quotes', () => {
    // Test that curly/smart quotes are folded to straight quotes
    assert.equal(normalizeMatchKey('O\u2018Reilly.epub'), "O'Reilly.epub") // U+2018 → '
    assert.equal(normalizeMatchKey('O\u2019Reilly.epub'), "O'Reilly.epub") // U+2019 → '
    assert.equal(normalizeMatchKey('\u201Cquoted\u201D.txt'), '"quoted".txt') // U+201C/D → "
    // Test that straight quotes remain unchanged
    assert.equal(normalizeMatchKey("O'Reilly.epub"), "O'Reilly.epub") // already straight
    // Test dash folding
    assert.equal(normalizeMatchKey('en\u2013dash.txt'), 'en-dash.txt') // U+2013 → -
    assert.equal(normalizeMatchKey('em\u2014dash.txt'), 'em-dash.txt') // U+2014 → -
  })

  test('findSimilarPaths suggests exact match with different quotes', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'injectbook-suggest-'))

    try {
      // Create file with curly apostrophe (U+2019)
      const actualFile = path.join(tmp, 'O\u2019Reilly.epub')
      fs.writeFileSync(actualFile, 'dummy content')

      // Try to find it with straight apostrophe (U+0027)
      const wrongPath = path.join(tmp, "O'Reilly.epub")
      const similar = findSimilarPaths(wrongPath)

      assert.ok(similar.length > 0, 'Should find similar path')
      assert.equal(similar[0], actualFile)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('findSimilarPaths suggests close matches based on common prefix', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'injectbook-prefix-'))

    try {
      // Use longer filenames to ensure sufficient prefix overlap
      fs.writeFileSync(
        path.join(tmp, 'javascript-the-good-parts.epub'),
        'dummy',
      )

      // Very close match with slight variation (typo in the middle)
      const wrongPath = path.join(tmp, 'javascript-the-goob-parts.epub')
      const similar = findSimilarPaths(wrongPath)

      assert.ok(
        similar.length > 0,
        'Should suggest similar path based on common prefix',
      )
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('findSimilarPaths returns empty for non-existent parent', () => {
    const similar = findSimilarPaths('/nonexistent/path/file.txt')
    assert.deepEqual(similar, [])
  })
})

describe('cli-error-types', () => {
  test('CliError stores exit code', () => {
    const err = new CliError('test message', 2)
    assert.equal(err.message, 'test message')
    assert.equal(err.code, 2)
    assert.equal(err.name, 'CliError')
  })
})
