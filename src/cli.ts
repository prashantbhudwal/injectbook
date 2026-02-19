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
