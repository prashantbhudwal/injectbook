import fs from "node:fs";
import path from "node:path";
import { CliError, type BookMetadata, type Chapter, type SkillWriteOptions } from "./types";

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function readTemplate(): string {
  const templatePath = path.resolve(__dirname, "../templates/SKILL.md.tpl");
  return fs.readFileSync(templatePath, "utf8");
}

function safeValue(value: string | undefined, fallback = "Unknown"): string {
  return value && value.trim() ? value.trim() : fallback;
}

function renderTemplate(template: string, pairs: Record<string, string>): string {
  let rendered = template;
  for (const [key, value] of Object.entries(pairs)) {
    rendered = rendered.replaceAll(`{{${key}}}`, value);
  }
  return rendered;
}

function chapterFileName(chapterPrefix: string, chapter: Chapter): string {
  const padded = String(chapter.index).padStart(3, "0");
  return `${chapterPrefix}${padded}-${chapter.slug}.md`;
}

function chapterFrontmatter(chapter: Chapter): string {
  return `---\ntitle: ${yamlScalar(chapter.title)}\nindex: ${chapter.index}\nsource_file: ${yamlScalar(chapter.sourceFile)}\nword_count: ${chapter.wordCount}\n---\n\n`;
}

function fullBookFrontmatter(metadata: BookMetadata, chapterCount: number): string {
  const authors = metadata.authors.length > 0 ? metadata.authors.join(", ") : "Unknown";
  return `---\ntitle: ${yamlScalar(safeValue(metadata.title))}\nauthors: ${yamlScalar(authors)}\nchapter_count: ${chapterCount}\n---\n\n`;
}

function ensureOutputDirectory(outDir: string, overwrite: boolean): void {
  if (fs.existsSync(outDir)) {
    if (!overwrite) {
      throw new CliError(`Output directory already exists: ${outDir}. Use --overwrite to replace it.`, 5);
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  fs.mkdirSync(outDir, { recursive: true });
}

export function writeSkill(
  metadata: BookMetadata,
  chapters: Chapter[],
  options: SkillWriteOptions
): { outDir: string; skillFilePath: string } {
  ensureOutputDirectory(options.outDir, options.overwrite);

  const refsDir = path.join(options.outDir, "references");
  fs.mkdirSync(refsDir, { recursive: true });

  const chapterRows = chapters.map((chapter) => {
    const fileName = chapterFileName(options.chapterPrefix, chapter);
    const chapterContent = `${chapterFrontmatter(chapter)}${chapter.markdown}\n`;
    fs.writeFileSync(path.join(refsDir, fileName), chapterContent, "utf8");
    return `- ${chapter.index}. [${chapter.title}](references/${fileName}) (${chapter.wordCount} words)`;
  });

  if (options.includeFullBook) {
    const all = chapters
      .map((chapter) => `\n## ${chapter.index}. ${chapter.title}\n\n${chapter.markdown}\n`)
      .join("\n");
    const fullBook = `${fullBookFrontmatter(metadata, chapters.length)}${all}`;
    fs.writeFileSync(path.join(refsDir, "book_full.md"), fullBook, "utf8");
  }

  const template = readTemplate();
  const skillMd = renderTemplate(template, {
    name: options.skillName,
    description: options.description,
    book_title: safeValue(metadata.title),
    book_authors: metadata.authors.length > 0 ? metadata.authors.join(", ") : "Unknown",
    book_language: safeValue(metadata.language),
    book_publisher: safeValue(metadata.publisher),
    book_tags: metadata.tags.length > 0 ? metadata.tags.join(", ") : "None",
    chapter_index: chapterRows.join("\n")
  });

  const skillFilePath = path.join(options.outDir, "SKILL.md");
  fs.writeFileSync(skillFilePath, `${skillMd.trim()}\n`, "utf8");

  return {
    outDir: options.outDir,
    skillFilePath
  };
}

export function createChapterFileName(chapterPrefix: string, chapter: Chapter): string {
  return chapterFileName(chapterPrefix, chapter);
}
