#!/usr/bin/env node
import { Command } from "commander";
import { convertBook } from "./commands/convert";
import { CliError } from "./types";
import pkg from "../package.json";

const program = new Command();

program
  .name("injectbook")
  .description("Convert books into Codex-compatible skills")
  .version(pkg.version)
  .showHelpAfterError()
  .showSuggestionAfterError();

program
  .command("convert")
  .description("Convert a book file into a skill folder")
  .argument("<input-book>", "Path to input book file")
  .option("--out-dir <path>", "Output directory (final skill folder, writes SKILL.md + references/ here)")
  .option("-o, --output <path>", "Alias for --out-dir")
  .option("--output-dir <path>", "Alias for --out-dir")
  .option("--skill-dir <path>", "Alias for --out-dir")
  .option("--out-parent-dir <path>", "Parent directory; creates <slug>-skill/ under it")
  .option("--output-parent-dir <path>", "Alias for --out-parent-dir")
  .option("--skill-name <name>", "Override skill name")
  .option("-n, --name <name>", "Alias for --skill-name")
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
  .option(
    "--calibre-arg <arg>",
    "Append one raw argument token to ebook-convert (repeatable)",
    (value: string, previous: string[]) => [...previous, value],
    []
  )
  .option("--keep-temp", "Keep temporary normalized files when conversion fails")
  .option("--overwrite", "Replace existing output directory")
  .option("--verbose", "Verbose output")
  .addHelpText("after", `
Examples:
  injectbook convert ./my-book.epub
  injectbook convert ./book.pdf -o ./output/my-skill
  injectbook convert ./book.pdf --out-parent-dir ./skills
  injectbook convert ./book.epub --install --install-dir .agents/skills
`)
  .action(async (inputBook: string, options) => {
    try {
      // Coalesce aliases: prefer explicit --out-dir, then aliases
      const outDir = options.outDir ?? options.output ?? options.outputDir ?? options.skillDir;
      const outParentDir = options.outParentDir ?? options.outputParentDir;
      const skillName = options.skillName ?? options.name;

      // Check for conflicting output flags
      const outputSelectors = [
        outDir ? "--out-dir (or alias)" : undefined,
        outParentDir ? "--out-parent-dir (or alias)" : undefined,
        options.install ? "--install" : undefined
      ].filter(Boolean);
      
      if (outputSelectors.length > 1) {
        throw new CliError(
          `Conflicting output options: ${outputSelectors.join(", ")}. Use only one of: --out-dir, --out-parent-dir, --install`,
          2
        );
      }

      const result = await convertBook(inputBook, {
        outDir,
        outParentDir,
        skillName,
        description: options.description,
        includeFullBook: options.includeFullBook,
        chapterPrefix: options.chapterPrefix,
        install: options.install,
        installDir: options.installDir,
        maxChapterWords: Number.parseInt(options.maxChapterWords, 10),
        filterBoilerplate: options.filterBoilerplate,
        stripImages: options.stripImages,
        stripInternalLinks: options.stripInternalLinks,
        calibreArgs: options.calibreArg,
        keepTemp: options.keepTemp,
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

program.addHelpText("after", `
Quick start:
  injectbook convert ./my-book.epub
  injectbook convert ./book.pdf --install --install-dir .agents/skills
`);

program.parse(process.argv);
