import fs from 'node:fs'
import { spawn, spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline/promises'
import { CALIBRE, calibreInfoMessage } from '../config/calibre'
import { parseEpubToChapters, slugify } from '../parser'
import { writeSkill } from '../skill-writer'
import { CliError } from '../types'
import { distance } from 'fastest-levenshtein'

type ConvertOptions = {
  outDir?: string
  outParentDir?: string
  skillName?: string
  description?: string
  includeFullBook: boolean
  chapterPrefix: string
  install?: boolean
  installDir?: string
  maxChapterWords: number
  filterBoilerplate: boolean
  stripImages: boolean
  stripInternalLinks: boolean
  calibreArgs?: string[]
  keepTemp?: boolean
  overwrite?: boolean
  verbose?: boolean
}

function deriveDefaults(
  title: string | undefined,
  authors: string[],
): { skillName: string; description: string } {
  const safeTitle = title?.trim() || 'Untitled Book'
  const authorText = authors.length > 0 ? authors.join(', ') : 'Unknown Author'
  return {
    skillName: `${safeTitle} Skill`,
    description: `Reference skill generated from "${safeTitle}" by ${authorText}`,
  }
}

/**
 * Normalize a filename for fuzzy matching by:
 * - Unicode NFC normalization
 * - Folding smart quotes to straight quotes
 * - Folding en-dash/em-dash to hyphen
 */
export function normalizeMatchKey(name: string): string {
  return name
    .normalize('NFC')
    .replace(/[\u2018\u2019]/g, "'") // ‘ ’ → '
    .replace(/[\u201C\u201D]/g, '"') // " " → "
    .replace(/[\u2013\u2014]/g, '-') // – — → -
}

/**
 * Find similar filenames in parent directory for "did you mean?" suggestions.
 * Returns entries that match when normalized (ignoring case).
 */
export function findSimilarPaths(inputPath: string): string[] {
  const resolved = path.resolve(inputPath)
  const parentDir = path.dirname(resolved)
  const basename = path.basename(resolved)
  const normalizedBasename = normalizeMatchKey(basename).toLowerCase()

  if (!fs.existsSync(parentDir)) {
    return []
  }

  const entries = fs.readdirSync(parentDir)
  const matches: string[] = []

  for (const entry of entries) {
    if (normalizeMatchKey(entry).toLowerCase() === normalizedBasename) {
      matches.push(path.join(parentDir, entry))
    }
  }

  // Also include close matches (Levenshtein) if no exact normalized match
  if (matches.length === 0) {
    for (const entry of entries) {
      const normalizedEntry = normalizeMatchKey(entry).toLowerCase()

      // If strings are extremely short, allow max 1 typo. Otherwise roughly 30% typo rate.
      const threshold = Math.max(
        1,
        Math.floor(
          Math.min(normalizedEntry.length, normalizedBasename.length) * 0.3,
        ),
      )

      if (distance(normalizedEntry, normalizedBasename) <= threshold) {
        matches.push(path.join(parentDir, entry))
      }
    }
  }

  return matches.sort()
}

/**
 * Build a detailed error message for missing/unreadable files,
 * including suggestions for similar paths.
 */
function buildReadableFileError(
  inputPath: string,
  errorCode?: string,
): CliError {
  const resolved = path.resolve(inputPath)
  const isEnoent = errorCode === 'ENOENT'

  let message = `Input file is missing or not readable: ${inputPath}\n`
  message += `  cwd: ${process.cwd()}\n`
  message += `  resolved: ${resolved}`

  if (isEnoent) {
    const similar = findSimilarPaths(inputPath)

    // Check for smart quotes mismatch
    const hasSmartQuote = /[\u2018\u2019\u201C\u201D]/.test(inputPath)
    const looksLikeQuoteIssue =
      hasSmartQuote || inputPath.includes("'") || inputPath.includes('"')

    if (similar.length > 0) {
      message += `\n\nDid you mean one of these?`
      for (const suggestion of similar.slice(0, 3)) {
        message += `\n  - ${path.relative(process.cwd(), suggestion)}`
      }
    }

    if (looksLikeQuoteIssue) {
      message += `\n\nHint: The path contains quote characters. Make sure you're using the correct type of quotes (straight ' vs curly ') and consider using tab completion to avoid typing errors.`
    }
  }

  return new CliError(message, 2)
}

function assertReadableFile(filePath: string): void {
  try {
    const stats = fs.statSync(filePath)
    if (!stats.isFile()) {
      throw new CliError(`Input path is not a file: ${filePath}`, 2)
    }
    fs.accessSync(filePath, fs.constants.R_OK)
  } catch (err) {
    const errorCode =
      err && typeof err === 'object' && 'code' in err
        ? String(err.code)
        : undefined
    if (errorCode === 'ENOENT') {
      throw buildReadableFileError(filePath, errorCode)
    }
    if (err instanceof CliError) {
      throw err
    }
    throw new CliError(`Input file is missing or not readable: ${filePath}`, 2)
  }
}

function hasExecutable(
  command: string,
  args: string[] = ['--version'],
): boolean {
  const result = spawnSync(command, args, { stdio: 'ignore', shell: false })
  return result.status === 0
}

function resolveCalibreCommand(): string | undefined {
  const envPath = process.env.EBOOK_CONVERT_PATH
  if (envPath && hasExecutable(envPath)) {
    return envPath
  }

  if (hasExecutable('ebook-convert')) {
    return 'ebook-convert'
  }

  const macCandidates = [
    '/Applications/calibre.app/Contents/MacOS/ebook-convert',
    path.join(
      process.env.HOME || '',
      'Applications/calibre.app/Contents/MacOS/ebook-convert',
    ),
  ]

  for (const candidate of macCandidates) {
    if (candidate && hasExecutable(candidate)) {
      return candidate
    }
  }

  return undefined
}

async function ensureCalibreAvailable(verbose = false): Promise<string> {
  const existing = resolveCalibreCommand()
  if (existing) {
    return existing
  }

  if (verbose) {
    console.error(calibreInfoMessage())
  }

  const { brewInstallHint } = CALIBRE
  if (
    !process.stdin.isTTY ||
    !process.stdout.isTTY ||
    process.platform !== 'darwin'
  ) {
    throw new CliError(
      `Calibre is required but not found. ${calibreInfoMessage()} Install it and retry: ${brewInstallHint}`,
      3,
    )
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await rl.question(
    `${calibreInfoMessage()}\nCalibre is not installed. Install it now with Homebrew (${brewInstallHint})? [Y/n] `,
  )
  rl.close()

  if (answer.trim().toLowerCase().startsWith('n')) {
    throw new CliError(
      'Calibre installation declined. Please install Calibre and retry.',
      3,
    )
  }

  if (!hasExecutable('brew')) {
    throw new CliError(
      'Homebrew is required for automatic install. Install Homebrew or install Calibre manually.',
      3,
    )
  }

  const install = spawnSync('brew', ['install', '--cask', 'calibre'], {
    stdio: 'inherit',
  })
  const resolved = resolveCalibreCommand()
  if (install.status !== 0 || !resolved) {
    throw new CliError(
      'Calibre installation failed. Please install it manually and retry.',
      3,
    )
  }

  return resolved
}

async function runCalibreCommand(
  command: string,
  args: string[],
  options: { verbose: boolean; showBasicStatus: boolean; basicLabel: string },
): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const outputChunks: string[] = []
    let heartbeat: ReturnType<typeof setInterval> | undefined
    let startedAt = Date.now()

    if (!options.verbose && options.showBasicStatus) {
      console.log(
        `${options.basicLabel} (this can take a while for large books)...`,
      )
      heartbeat = setInterval(() => {
        const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
        console.log(
          `${options.basicLabel} still running (${elapsedSeconds}s elapsed)...`,
        )
      }, 20000)
    }

    const onData = (chunk: Buffer, target: 'stdout' | 'stderr'): void => {
      const text = chunk.toString('utf8')
      outputChunks.push(text)
      if (options.verbose) {
        if (target === 'stdout') {
          process.stdout.write(text)
        } else {
          process.stderr.write(text)
        }
      }
    }

    child.stdout.on('data', (chunk: Buffer) => onData(chunk, 'stdout'))
    child.stderr.on('data', (chunk: Buffer) => onData(chunk, 'stderr'))

    child.on('error', (error) => {
      if (heartbeat) {
        clearInterval(heartbeat)
      }
      reject(error)
    })

    child.on('close', (status) => {
      if (heartbeat) {
        clearInterval(heartbeat)
      }
      if (!options.verbose && options.showBasicStatus) {
        const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000)
        if (status === 0) {
          console.log(`${options.basicLabel} completed (${elapsedSeconds}s).`)
        } else {
          console.log(`${options.basicLabel} failed (${elapsedSeconds}s).`)
        }
      }
      resolve({ status, output: outputChunks.join('') })
    })
  })
}

async function normalizeInputWithCalibre(
  ebookConvertCmd: string,
  inputBook: string,
  normalizedPath: string,
  calibreArgs: string[] = [],
  verbose = false,
): Promise<void> {
  const conversionArgs = [
    inputBook,
    normalizedPath,
    '--dont-split-on-page-breaks',
    '--flow-size',
    '0',
    ...calibreArgs,
  ]
  const conversion = await runCalibreCommand(ebookConvertCmd, conversionArgs, {
    verbose,
    showBasicStatus: true,
    basicLabel: 'Calibre conversion',
  })

  const looksLikeQtNeonError = (text: string): boolean => {
    const normalized = text.toLowerCase()
    return (
      normalized.includes('this qt build requires the following features:') &&
      normalized.includes('neon')
    )
  }

  if (conversion.status !== 0) {
    const details = conversion.output.trim() || 'unknown conversion failure'

    // Workaround for some Calibre/Qt ARM builds on Apple Silicon that abort with a bogus NEON requirement.
    // Retrying under Rosetta (x86_64 slice) is often successful.
    if (
      process.platform === 'darwin' &&
      process.arch === 'arm64' &&
      looksLikeQtNeonError(details)
    ) {
      const rosetta = await runCalibreCommand(
        '/usr/bin/arch',
        ['-x86_64', ebookConvertCmd, ...conversionArgs],
        {
          verbose,
          showBasicStatus: true,
          basicLabel: 'Calibre Rosetta retry',
        },
      )

      if (rosetta.status === 0) {
        console.log(
          'Retried Calibre under Rosetta (x86_64) after Qt NEON error.',
        )
        return
      }

      const rosettaDetails = rosetta.output.trim() || details
      throw new CliError(
        `Calibre conversion failed (Qt NEON error; Rosetta retry also failed): ${rosettaDetails}`,
        4,
      )
    }

    throw new CliError(`Calibre conversion failed: ${details}`, 4)
  }

  if (verbose) {
    console.log(`Calibre normalized input to: ${normalizedPath}`)
    console.log(`Calibre args: ${conversionArgs.slice(2).join(' ')}`)
  }
}

/**
 * Check if a directory looks like an injectbook skill directory.
 */
function looksLikeSkillDir(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) {
    return false
  }
  const skillMdPath = path.join(dirPath, 'SKILL.md')
  const refsDir = path.join(dirPath, 'references')
  return fs.existsSync(skillMdPath) || fs.existsSync(refsDir)
}

/**
 * Warn if overwriting a non-skill directory, and require confirmation.
 */
async function ensureSafeOverwrite(
  outDir: string,
  overwrite?: boolean,
): Promise<void> {
  if (!overwrite || !fs.existsSync(outDir)) {
    return
  }

  const isSkillDir = looksLikeSkillDir(outDir)
  if (!isSkillDir) {
    console.warn(
      `\n⚠️  Warning: --overwrite will replace a non-skill directory: ${outDir}`,
    )
    console.warn(
      '   This directory does not appear to be an injectbook skill (no SKILL.md or references/ found).',
    )

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new CliError(
        'Target directory is not a skill. Cannot prompt for confirmation in non-interactve environment.',
        2,
      )
    }

    const rl = createInterface({ input: process.stdin, output: process.stdout })
    const answer = await rl.question(
      '   Are you sure you want to completely overwrite this directory? [y/N] ',
    )
    rl.close()

    if (!answer.trim().toLowerCase().startsWith('y')) {
      throw new CliError('Overwrite cancelled by user.', 2)
    }
  }
}

export async function convertBook(
  inputBook: string,
  options: ConvertOptions,
): Promise<{ outDir: string; chapters: number }> {
  assertReadableFile(inputBook)
  if (
    !Number.isFinite(options.maxChapterWords) ||
    options.maxChapterWords <= 0
  ) {
    throw new CliError(
      `Invalid --max-chapter-words value: ${options.maxChapterWords}`,
      2,
    )
  }

  const ebookConvertCmd = await ensureCalibreAvailable(options.verbose)

  let tempDir: string | undefined
  let conversionSucceeded = false

  try {
    if (options.verbose) {
      console.log(`Converting with Calibre: ${inputBook}`)
    } else {
      console.log(`Starting conversion: ${path.basename(inputBook)}`)
    }

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'injectbook-calibre-'))
    const normalizedPath = path.join(tempDir, 'normalized.epub')

    await normalizeInputWithCalibre(
      ebookConvertCmd,
      inputBook,
      normalizedPath,
      options.calibreArgs,
      options.verbose,
    )
    if (!options.verbose) {
      console.log('Parsing normalized book content...')
    }

    const { metadata, chapters } = parseEpubToChapters(normalizedPath, {
      maxChapterWords: options.maxChapterWords,
      filterBoilerplate: options.filterBoilerplate,
      stripImages: options.stripImages,
      stripInternalLinks: options.stripInternalLinks,
    })
    if (!options.verbose) {
      console.log(
        `Parsed ${chapters.length} chapter(s). Writing skill files...`,
      )
    }

    const defaults = deriveDefaults(metadata.title, metadata.authors)
    const defaultSkillDirName = `${slugify(metadata.title || 'book')}-skill`

    // Resolve output directory based on options
    let outputDir: string
    if (options.outDir) {
      outputDir = path.resolve(options.outDir)
    } else if (options.outParentDir) {
      outputDir = path.resolve(options.outParentDir, defaultSkillDirName)
    } else if (options.install) {
      outputDir = path.resolve(
        options.installDir || '.agents/skills',
        defaultSkillDirName,
      )
    } else {
      outputDir = path.resolve(defaultSkillDirName)
    }

    // Warn if overwriting non-skill directory
    await ensureSafeOverwrite(outputDir, options.overwrite)

    writeSkill(metadata, chapters, {
      outDir: outputDir,
      skillName: options.skillName || defaults.skillName,
      description: options.description || defaults.description,
      chapterPrefix: options.chapterPrefix,
      includeFullBook: options.includeFullBook,
      overwrite: Boolean(options.overwrite),
    })
    if (!options.verbose) {
      console.log('Skill files written.')
    }

    conversionSucceeded = true

    return {
      outDir: outputDir,
      chapters: chapters.length,
    }
  } catch (error) {
    if (options.keepTemp && tempDir && fs.existsSync(tempDir)) {
      console.error(`Kept temporary conversion files at: ${tempDir}`)
    }

    if (error instanceof CliError) {
      throw error
    }

    const message = error instanceof Error ? error.message : 'unknown error'
    throw new CliError(`Book conversion failed: ${message}`, 4)
  } finally {
    if (
      tempDir &&
      fs.existsSync(tempDir) &&
      (conversionSucceeded || !options.keepTemp)
    ) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }
}
