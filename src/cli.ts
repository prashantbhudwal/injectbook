#!/usr/bin/env node
import { Command } from "commander";
import { convertBook } from "./commands/convert";
import { CliError } from "./types";
import pkg from "../package.json";

const program = new Command();

program
  .name("injectbook")
  .description("Convert books into Codex-compatible skills")
  .version(pkg.version);

program
  .command("convert")
  .description("Convert a book file into a skill folder")
  .argument("<input-book>", "Path to input book file")
  .option("--out-dir <path>", "Output directory (default: ./<book-slug>-skill)")
  .option("--skill-name <name>", "Override skill name")
  .option("--description <text>", "Override skill description")
  .option("--include-full-book", "Include references/book_full.md", true)
  .option("--no-include-full-book", "Skip references/book_full.md")
  .option("--chapter-prefix <string>", "Prefix for chapter reference files", "chapter-")
  .option("--install", "Write output to --install-dir/<book-slug>-skill")
  .option("--install-dir <path>", "Skill install directory", ".agents/skills")
  .option("--max-chapter-words <n>", "Split chapters larger than this word count", "15000")
  .option("--filter-boilerplate", "Drop license/cover/contents boilerplate", true)
  .option("--no-filter-boilerplate", "Keep boilerplate sections")
  .option("--strip-images", "Strip image references from markdown", true)
  .option("--no-strip-images", "Keep image references in markdown")
  .option("--strip-internal-links", "Strip internal EPUB links, keep link text", true)
  .option("--no-strip-internal-links", "Keep internal EPUB links in markdown")
  .option("--overwrite", "Replace existing output directory")
  .option("--verbose", "Verbose output")
  .action(async (inputBook: string, options) => {
    try {
      const result = await convertBook(inputBook, {
        outDir: options.outDir,
        skillName: options.skillName,
        description: options.description,
        includeFullBook: options.includeFullBook,
        chapterPrefix: options.chapterPrefix,
        install: options.install,
        installDir: options.installDir,
        maxChapterWords: Number.parseInt(options.maxChapterWords, 10),
        filterBoilerplate: options.filterBoilerplate,
        stripImages: options.stripImages,
        stripInternalLinks: options.stripInternalLinks,
        overwrite: options.overwrite,
        verbose: options.verbose
      });

      console.log(`Generated skill at ${result.outDir}`);
      console.log(`Extracted ${result.chapters} chapter(s)`);
      process.exit(0);
    } catch (error) {
      if (error instanceof CliError) {
        console.error(error.message);
        process.exit(error.code);
      }

      const message = error instanceof Error ? error.message : "unknown error";
      console.error(`Unexpected error: ${message}`);
      process.exit(4);
    }
  });

program.parse(process.argv);
