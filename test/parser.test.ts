import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import AdmZip from "adm-zip";
import { parseEpubToChapters, slugify } from "../src/parser";

type EpubChapter = {
  id: string;
  href: string;
  html: string;
};

type EpubFixtureOptions = {
  metadataXml?: string;
  chapters: EpubChapter[];
  ncxTitles?: string[];
  navTitles?: string[];
};

function createEpub(epubPath: string, options: EpubFixtureOptions): void {
  const zip = new AdmZip();
  const metadataXml =
    options.metadataXml ||
    `<dc:title>Sample Book</dc:title><dc:creator>Test Author</dc:creator><dc:language>en</dc:language><dc:publisher>Test Press</dc:publisher>`;

  zip.addFile(
    "META-INF/container.xml",
    Buffer.from(
      `<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`
    )
  );

  const manifestItems = options.chapters
    .map((chapter) => `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml" />`)
    .join("\n    ");
  const spineItems = options.chapters.map((chapter) => `<itemref idref="${chapter.id}" />`).join("\n    ");
  const ncxManifest = options.ncxTitles ? `<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />` : "";
  const navManifest = options.navTitles ? `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />` : "";
  const tocAttr = options.ncxTitles ? ` toc="ncx"` : "";

  zip.addFile(
    "OEBPS/content.opf",
    Buffer.from(
      `<?xml version="1.0"?><package version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata>${metadataXml}</metadata>
  <manifest>
    ${ncxManifest}
    ${navManifest}
    ${manifestItems}
  </manifest><spine${tocAttr}>
    ${spineItems}
  </spine></package>`
    )
  );

  if (options.ncxTitles) {
    const navPoints = options.ncxTitles
      .map((title, index) => {
        const chapter = options.chapters[index];
        if (!chapter) {
          return "";
        }
        return `<navPoint id="p${index + 1}" playOrder="${index + 1}"><navLabel><text>${title}</text></navLabel><content src="${chapter.href}" /></navPoint>`;
      })
      .join("");
    zip.addFile("OEBPS/toc.ncx", Buffer.from(`<?xml version="1.0"?><ncx><navMap>${navPoints}</navMap></ncx>`));
  }

  if (options.navTitles) {
    const links = options.chapters
      .map((chapter, index) => `<li><a href="${chapter.href}">${options.navTitles?.[index] || chapter.href}</a></li>`)
      .join("");
    zip.addFile(
      "OEBPS/nav.xhtml",
      Buffer.from(`<!doctype html><html><body><nav epub:type="toc"><ol>${links}</ol></nav></body></html>`)
    );
  }

  for (const chapter of options.chapters) {
    zip.addFile(`OEBPS/${chapter.href}`, Buffer.from(chapter.html));
  }

  zip.writeZip(epubPath);
}

describe("parser", () => {
  test("slugify normalizes text", () => {
    assert.equal(slugify(" Chapter: One! "), "chapter-one");
  });

  test("parses minimal epub to chapters", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-"));
    const epubPath = path.join(tmp, "sample.epub");
    createEpub(epubPath, {
      chapters: [{ id: "ch1", href: "ch1.xhtml", html: `<!doctype html><html><body><h1>Ignored Title</h1><p>Hello chapter text.</p></body></html>` }],
      ncxTitles: ["Chapter One"]
    });

    const result = parseEpubToChapters(epubPath);

    assert.equal(result.metadata.title, "Sample Book");
    assert.deepEqual(result.metadata.authors, ["Test Author"]);
    assert.equal(result.chapters.length, 1);
    assert.equal(result.chapters[0]?.title, "Chapter One");
    assert.equal(result.chapters[0]?.slug, "chapter-one");
    assert.match(result.chapters[0]?.markdown || "", /Hello chapter text\./);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("normalizes creator objects into author names", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-creator-"));
    const epubPath = path.join(tmp, "sample.epub");
    createEpub(epubPath, {
      metadataXml:
        `<dc:title>Sample Book</dc:title><dc:creator opf:file-as="Author, Test" xmlns:opf="urn">Test Author</dc:creator><dc:subject opf:scheme="tag" xmlns:opf="urn">Philosophy</dc:subject>`,
      chapters: [{ id: "ch1", href: "ch1.xhtml", html: `<!doctype html><html><body><h1>Chapter</h1><p>Body.</p></body></html>` }]
    });

    const result = parseEpubToChapters(epubPath);
    assert.deepEqual(result.metadata.authors, ["Test Author"]);
    assert.deepEqual(result.metadata.tags, ["Philosophy"]);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("prefers epub3 nav labels over ncx and headings", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-nav-"));
    const epubPath = path.join(tmp, "sample.epub");

    createEpub(epubPath, {
      chapters: [{ id: "ch1", href: "ch1.xhtml", html: `<!doctype html><html><body><h1>Heading Title</h1><p>Body text.</p></body></html>` }],
      ncxTitles: ["NCX Title [123]"],
      navTitles: ["Nav Title [456]"]
    });

    const result = parseEpubToChapters(epubPath);
    assert.equal(result.chapters[0]?.title, "Nav Title");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("strips xml lines, images, and internal links by default", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-cleanup-"));
    const epubPath = path.join(tmp, "sample.epub");

    createEpub(epubPath, {
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<?xml version="1.0" encoding="utf-8"?><html><body><h1>Chapter</h1><p>![Pic](cover.jpg) Read [\[146\]](chapter.xhtml#fn146) and [site](https://example.com)</p></body></html>`
        }
      ]
    });

    const result = parseEpubToChapters(epubPath);
    const markdown = result.chapters[0]?.markdown || "";
    assert.doesNotMatch(markdown, /<\?xml/);
    assert.doesNotMatch(markdown, /!\[/);
    assert.doesNotMatch(markdown, /\.xhtml#/i);
    assert.match(markdown, /\[\[146\]\]/);
    assert.match(markdown, /\[site\]\(https:\/\/example\.com\)/);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("filters boilerplate sections by default", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-filter-"));
    const epubPath = path.join(tmp, "sample.epub");

    createEpub(epubPath, {
      chapters: [
        { id: "ch1", href: "ch1.xhtml", html: `<!doctype html><html><body><h1>Table of Contents</h1><p>Intro.</p></body></html>` },
        { id: "ch2", href: "ch2.xhtml", html: `<!doctype html><html><body><h1>The Essay</h1><p>Main body text.</p></body></html>` },
        {
          id: "ch3",
          href: "ch3.xhtml",
          html: `<!doctype html><html><body><h1>THE FULL PROJECT GUTENBERG LICENSE</h1><p>Project Gutenberg license terms.</p></body></html>`
        }
      ]
    });

    const result = parseEpubToChapters(epubPath);
    assert.equal(result.chapters.length, 1);
    assert.equal(result.chapters[0]?.title, "The Essay");

    const unfiltered = parseEpubToChapters(epubPath, { filterBoilerplate: false });
    assert.equal(unfiltered.chapters.length, 3);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("keeps long chapters that contain incidental legal keywords", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-legal-keyword-"));
    const epubPath = path.join(tmp, "sample.epub");
    const largeBody = Array.from({ length: 4500 }, () => "alpha").join(" ");

    createEpub(epubPath, {
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<!doctype html><html><body><h1>Main Essay</h1><p>${largeBody}</p><p>Copyright notice for archival scan only.</p></body></html>`
        }
      ]
    });

    const result = parseEpubToChapters(epubPath);
    assert.equal(result.chapters.length, 1);
    assert.equal(result.chapters[0]?.title, "Main Essay");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("filters note-dense sections even when title is generic", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-note-dense-"));
    const epubPath = path.join(tmp, "sample.epub");
    const noteLines = Array.from({ length: 120 }, (_, index) => `${index + 1}. Source note content.`).join(" ");

    createEpub(epubPath, {
      chapters: [
        { id: "ch1", href: "ch1.xhtml", html: `<!doctype html><html><body><h1>Main Chapter</h1><p>Substantive text.</p></body></html>` },
        { id: "ch2", href: "ch2.xhtml", html: `<!doctype html><html><body><h1>Appendix</h1><p>${noteLines}</p></body></html>` }
      ]
    });

    const result = parseEpubToChapters(epubPath);
    assert.equal(result.chapters.length, 1);
    assert.equal(result.chapters[0]?.title, "Main Chapter");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("uses TOC-referenced spine items when TOC is present", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-toc-only-"));
    const epubPath = path.join(tmp, "sample.epub");

    createEpub(epubPath, {
      chapters: [
        { id: "ch1", href: "ch1.xhtml", html: `<!doctype html><html><body><h1>Real Chapter One</h1><p>Body one.</p></body></html>` },
        { id: "ch2", href: "ch2.xhtml", html: `<!doctype html><html><body><h1>Real Chapter Two</h1><p>Body two.</p></body></html>` },
        { id: "junk", href: "junk.xhtml", html: `<!doctype html><html><body><h1>Chapter 99</h1><p>Noise fragment.</p></body></html>` }
      ],
      ncxTitles: ["Chapter One", "Chapter Two"]
    });

    const result = parseEpubToChapters(epubPath);
    assert.equal(result.chapters.length, 2);
    assert.equal(result.chapters[0]?.title, "Chapter One");
    assert.equal(result.chapters[1]?.title, "Chapter Two");
    assert.doesNotMatch(result.chapters.map((chapter) => chapter.title).join("\n"), /Chapter 99/);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("splits oversized chapters by headings", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-split-"));
    const epubPath = path.join(tmp, "sample.epub");
    const sectionA = Array.from({ length: 60 }, () => "alpha").join(" ");
    const sectionB = Array.from({ length: 60 }, () => "beta").join(" ");

    createEpub(epubPath, {
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<!doctype html><html><body><h1>Part A</h1><p>${sectionA}</p><h1>Part B</h1><p>${sectionB}</p></body></html>`
        }
      ]
    });

    const result = parseEpubToChapters(epubPath, { maxChapterWords: 40, minSectionWords: 10 });
    assert.equal(result.chapters.length, 2);
    assert.equal(result.chapters[0]?.title, "Part A");
    assert.equal(result.chapters[1]?.title, "Part B");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("normalizes numeric split headings to chapter titles", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-numeric-heading-"));
    const epubPath = path.join(tmp, "sample.epub");
    const sectionA = Array.from({ length: 80 }, () => "alpha").join(" ");
    const sectionB = Array.from({ length: 80 }, () => "beta").join(" ");

    createEpub(epubPath, {
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<!doctype html><html><body><h1>1</h1><p>${sectionA}</p><h1>2</h1><p>${sectionB}</p></body></html>`
        }
      ]
    });

    const result = parseEpubToChapters(epubPath, { maxChapterWords: 50, minSectionWords: 10 });
    assert.equal(result.chapters[0]?.title, "Chapter 1");
    assert.equal(result.chapters[1]?.title, "Chapter 2");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("preserves chapter subtitle when heading omits punctuation", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-chapter-subtitle-"));
    const epubPath = path.join(tmp, "sample.epub");

    createEpub(epubPath, {
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<!doctype html><html><body><h1>Chapter 7 The Trial</h1><p>Body text.</p></body></html>`
        }
      ]
    });

    const result = parseEpubToChapters(epubPath);
    assert.equal(result.chapters[0]?.title, "Chapter 7: The Trial");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("falls back to part title when split heading is noisy", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-noisy-heading-"));
    const epubPath = path.join(tmp, "sample.epub");
    const sectionA = Array.from({ length: 80 }, () => "alpha").join(" ");
    const sectionB = Array.from({ length: 80 }, () => "beta").join(" ");

    createEpub(epubPath, {
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<!doctype html><html><body><h1>This heading is very long, contains commas, and reads like a sentence from body copy, not a real chapter title.</h1><p>${sectionA}</p><h1>Clean Heading</h1><p>${sectionB}</p></body></html>`
        }
      ]
    });

    const result = parseEpubToChapters(epubPath, { maxChapterWords: 50, minSectionWords: 10 });
    assert.equal(result.chapters[0]?.title, "Chapter 1 Part 1");
    assert.equal(result.chapters[1]?.title, "Clean Heading");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("splits oversized chapters by word chunks when headings are missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-word-split-"));
    const epubPath = path.join(tmp, "sample.epub");
    const partA = Array.from({ length: 45 }, () => "alpha").join(" ");
    const partB = Array.from({ length: 45 }, () => "beta").join(" ");
    const partC = Array.from({ length: 45 }, () => "gamma").join(" ");

    createEpub(epubPath, {
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<!doctype html><html><body><p>${partA}</p><p>${partB}</p><p>${partC}</p></body></html>`
        }
      ]
    });

    const result = parseEpubToChapters(epubPath, { maxChapterWords: 40, minSectionWords: 10 });
    assert.ok(result.chapters.length > 1);
    assert.equal(result.chapters[0]?.title, "Chapter 1 Part 1");
    assert.match(result.chapters[1]?.title || "", /Part 2$/);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("throws OCR guidance for image-only converted content", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-image-only-"));
    const epubPath = path.join(tmp, "sample.epub");

    createEpub(epubPath, {
      chapters: [
        {
          id: "ch1",
          href: "ch1.xhtml",
          html: `<!doctype html><html><body><img src="scan-page-1.png" /><img src="scan-page-2.png" /></body></html>`
        }
      ]
    });

    assert.throws(() => parseEpubToChapters(epubPath), /image-only|scanned|ocr/i);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("keeps Index chapter regardless of title case", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-index-case-"));
    const epubPath = path.join(tmp, "sample.epub");

    createEpub(epubPath, {
      chapters: [
        { id: "ch1", href: "ch1.xhtml", html: `<!doctype html><html><body><h1>Main Chapter</h1><p>Body text.</p></body></html>` },
        { id: "ch2", href: "ch2.xhtml", html: `<!doctype html><html><body><h1>Index</h1><p>A 1 B 2 C 3</p></body></html>` }
      ]
    });

    const result = parseEpubToChapters(epubPath);
    assert.ok(result.chapters.some((chapter) => chapter.title === "Index"));

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
