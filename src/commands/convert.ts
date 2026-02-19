import fs from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { CALIBRE, calibreInfoMessage } from "../config/calibre";
import { parseEpubToChapters, slugify } from "../parser";
import { writeSkill } from "../skill-writer";
import { CliError } from "../types";

type ConvertOptions = {
  outDir?: string;
  skillName?: string;
  description?: string;
  includeFullBook: boolean;
  chapterPrefix: string;
  overwrite?: boolean;
  verbose?: boolean;
};

function deriveDefaults(title: string | undefined, authors: string[]): { skillName: string; description: string } {
  const safeTitle = title?.trim() || "Untitled Book";
  const authorText = authors.length > 0 ? authors.join(", ") : "Unknown Author";
  return {
    skillName: `${safeTitle} Skill`,
    description: `Reference skill generated from \"${safeTitle}\" by ${authorText}`
  };
}

function assertReadableFile(filePath: string): void {
  try {
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) {
      throw new CliError(`Input path is not a file: ${filePath}`, 2);
    }
    fs.accessSync(filePath, fs.constants.R_OK);
  } catch {
    throw new CliError(`Input file is missing or not readable: ${filePath}`, 2);
  }
}

function hasExecutable(command: string, args: string[] = ["--version"]): boolean {
  const result = spawnSync(command, args, { stdio: "ignore", shell: false });
  return result.status === 0;
}

function resolveCalibreCommand(): string | undefined {
  const envPath = process.env.EBOOK_CONVERT_PATH;
  if (envPath && hasExecutable(envPath)) {
    return envPath;
  }

  if (hasExecutable("ebook-convert")) {
    return "ebook-convert";
  }

  const macCandidates = [
    "/Applications/calibre.app/Contents/MacOS/ebook-convert",
    path.join(process.env.HOME || "", "Applications/calibre.app/Contents/MacOS/ebook-convert")
  ];

  for (const candidate of macCandidates) {
    if (candidate && hasExecutable(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function ensureCalibreAvailable(verbose = false): Promise<string> {
  const existing = resolveCalibreCommand();
  if (existing) {
    return existing;
  }

  if (verbose) {
    console.error(calibreInfoMessage());
  }

  const { brewInstallHint } = CALIBRE;
  if (!process.stdin.isTTY || !process.stdout.isTTY || process.platform !== "darwin") {
    throw new CliError(
      `Calibre is required but not found. ${calibreInfoMessage()} Install it and retry: ${brewInstallHint}`,
      3
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `${calibreInfoMessage()}\nCalibre is not installed. Install it now with Homebrew (${brewInstallHint})? [Y/n] `
  );
  rl.close();

  if (answer.trim().toLowerCase().startsWith("n")) {
    throw new CliError("Calibre installation declined. Please install Calibre and retry.", 3);
  }

  if (!hasExecutable("brew")) {
    throw new CliError("Homebrew is required for automatic install. Install Homebrew or install Calibre manually.", 3);
  }

  const install = spawnSync("brew", ["install", "--cask", "calibre"], { stdio: "inherit" });
  const resolved = resolveCalibreCommand();
  if (install.status !== 0 || !resolved) {
    throw new CliError("Calibre installation failed. Please install it manually and retry.", 3);
  }

  return resolved;
}

function normalizeInputWithCalibre(
  ebookConvertCmd: string,
  inputBook: string,
  verbose = false
): { normalizedPath: string; tempDir: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-calibre-"));
  const normalizedPath = path.join(tempDir, "normalized.epub");
  const conversion = spawnSync(ebookConvertCmd, [inputBook, normalizedPath], { encoding: "utf8", shell: false });

  if (conversion.status !== 0) {
    const details = conversion.stderr?.trim() || conversion.stdout?.trim() || "unknown conversion failure";
    throw new CliError(`Calibre conversion failed: ${details}`, 4);
  }

  if (verbose) {
    console.log(`Calibre normalized input to: ${normalizedPath}`);
  }

  return { normalizedPath, tempDir };
}

export async function convertBook(inputBook: string, options: ConvertOptions): Promise<{ outDir: string; chapters: number }> {
  assertReadableFile(inputBook);
  const ebookConvertCmd = await ensureCalibreAvailable(options.verbose);

  let tempDir: string | undefined;

  try {
    if (options.verbose) {
      console.log(`Converting with Calibre: ${inputBook}`);
    }

    const normalized = normalizeInputWithCalibre(ebookConvertCmd, inputBook, options.verbose);
    tempDir = normalized.tempDir;
    const { metadata, chapters } = parseEpubToChapters(normalized.normalizedPath);

    const defaults = deriveDefaults(metadata.title, metadata.authors);
    const outputDir = options.outDir || path.resolve(`${slugify(metadata.title || "book")}-skill`);

    writeSkill(metadata, chapters, {
      outDir: outputDir,
      skillName: options.skillName || defaults.skillName,
      description: options.description || defaults.description,
      chapterPrefix: options.chapterPrefix,
      includeFullBook: options.includeFullBook,
      overwrite: Boolean(options.overwrite)
    });

    return {
      outDir: outputDir,
      chapters: chapters.length
    };
  } catch (error) {
    if (error instanceof CliError) {
      throw error;
    }

    const message = error instanceof Error ? error.message : "unknown error";
    throw new CliError(`Book conversion failed: ${message}`, 4);
  } finally {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
