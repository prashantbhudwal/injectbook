import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { convertBook } from "../src/commands/convert";

const SAMPLE_COUNT = 5;
const CONVERSION_TIMEOUT_MS = 30 * 60 * 1000;

function listSampleBooks(dirPath: string, extension: string, count: number): string[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  return fs
    .readdirSync(dirPath)
    .filter((entry) => entry.toLowerCase().endsWith(extension))
    .sort((first, second) => first.localeCompare(second))
    .slice(0, count)
    .map((entry) => path.join(dirPath, entry));
}

function chapterFileCount(referencesDir: string): number {
  if (!fs.existsSync(referencesDir)) {
    return 0;
  }

  return fs
    .readdirSync(referencesDir)
    .filter((entry) => /^chapter-\d{3}-.+\.md$/i.test(entry))
    .length;
}

describe("conversion corpus", () => {
  const pdfSamples = listSampleBooks(path.resolve(process.cwd(), "local-pdfs"), ".pdf", SAMPLE_COUNT);
  const epubSamples = listSampleBooks(path.resolve(process.cwd(), "local-epubs"), ".epub", SAMPLE_COUNT);
  const skipReason =
    pdfSamples.length < SAMPLE_COUNT || epubSamples.length < SAMPLE_COUNT
      ? `Need at least ${SAMPLE_COUNT} PDFs and ${SAMPLE_COUNT} EPUBs in local-pdfs/local-epubs (found ${pdfSamples.length} PDFs and ${epubSamples.length} EPUBs).`
      : false;

  test(
    "converts 5 PDFs and 5 EPUBs",
    {
      skip: skipReason,
      timeout: CONVERSION_TIMEOUT_MS
    },
    async () => {
      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-corpus-"));
      const inputs = [...pdfSamples, ...epubSamples];

      try {
        for (const inputPath of inputs) {
          const baseName = path.basename(inputPath, path.extname(inputPath));
          const outDir = path.join(tmpRoot, `${baseName}-skill`);
          const result = await convertBook(inputPath, {
            outDir,
            includeFullBook: false,
            chapterPrefix: "chapter-",
            maxChapterWords: 15000,
            filterBoilerplate: true,
            stripImages: true,
            stripInternalLinks: true,
            verbose: true,
            overwrite: true
          });

          assert.ok(result.chapters > 0, `${baseName} produced no chapters`);
          assert.ok(fs.existsSync(path.join(outDir, "SKILL.md")), `${baseName} is missing SKILL.md`);
          assert.ok(chapterFileCount(path.join(outDir, "references")) > 0, `${baseName} is missing chapter files`);
        }
      } finally {
        fs.rmSync(tmpRoot, { recursive: true, force: true });
      }
    }
  );
});
