import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { createChapterFileName, writeSkill } from "../src/skill-writer";
import type { Chapter } from "../src/types";

describe("skill-writer", () => {
  test("creates deterministic chapter file names", () => {
    const chapter: Chapter = {
      index: 2,
      title: "Context Windows",
      slug: "context-windows",
      sourceFile: "OEBPS/ch2.xhtml",
      markdown: "# Context Windows",
      wordCount: 2
    };

    assert.equal(createChapterFileName("chapter-", chapter), "chapter-002-context-windows.md");
  });

  test("writes expected skill structure", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-test-"));

    writeSkill(
      {
        title: "Example Book",
        authors: ["Jane Doe"],
        language: "en",
        publisher: "Acme Press",
        tags: ["ai", "agents"]
      },
      [
        {
          index: 1,
          title: "Introduction",
          slug: "introduction",
          sourceFile: "OEBPS/ch1.xhtml",
          markdown: "# Introduction\n\nHello world",
          wordCount: 3
        }
      ],
      {
        outDir,
        skillName: "Example Book Skill",
        description: "Reference skill for Example Book",
        chapterPrefix: "chapter-",
        includeFullBook: true,
        overwrite: true
      }
    );

    const skillPath = path.join(outDir, "SKILL.md");
    const chapterPath = path.join(outDir, "references", "chapter-001-introduction.md");
    const fullPath = path.join(outDir, "references", "book_full.md");

    assert.equal(fs.existsSync(skillPath), true);
    assert.equal(fs.existsSync(chapterPath), true);
    assert.equal(fs.existsSync(fullPath), true);

    const skillText = fs.readFileSync(skillPath, "utf8");
    assert.match(skillText, /name: Example Book Skill/);
    assert.match(skillText, /\[Introduction\]\(references\/chapter-001-introduction.md\)/);

    const chapterText = fs.readFileSync(chapterPath, "utf8");
    assert.match(chapterText, /title: "Introduction"/);

    fs.rmSync(outDir, { recursive: true, force: true });
  });

  test("quotes chapter titles with colons in frontmatter", () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-colon-test-"));

    writeSkill(
      { title: "Example", authors: [], tags: [] },
      [
        {
          index: 1,
          title: "Part 1: Intro",
          slug: "part-1-intro",
          sourceFile: "OEBPS/ch1.xhtml",
          markdown: "Hello",
          wordCount: 1
        }
      ],
      {
        outDir,
        skillName: "Example",
        description: "Example",
        chapterPrefix: "chapter-",
        includeFullBook: false,
        overwrite: true
      }
    );

    const chapterText = fs.readFileSync(path.join(outDir, "references", "chapter-001-part-1-intro.md"), "utf8");
    assert.match(chapterText, /title: "Part 1: Intro"/);

    fs.rmSync(outDir, { recursive: true, force: true });
  });
});
