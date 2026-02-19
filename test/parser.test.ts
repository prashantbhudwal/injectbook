import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import AdmZip from "adm-zip";
import { parseEpubToChapters, slugify } from "../src/parser";

function createMinimalEpub(epubPath: string): void {
  const zip = new AdmZip();

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

  zip.addFile(
    "OEBPS/content.opf",
    Buffer.from(
      `<?xml version="1.0"?>
<package version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <metadata>
    <dc:title>Sample Book</dc:title>
    <dc:creator>Test Author</dc:creator>
    <dc:language>en</dc:language>
    <dc:publisher>Test Press</dc:publisher>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine toc="ncx">
    <itemref idref="ch1" />
  </spine>
</package>`
    )
  );

  zip.addFile(
    "OEBPS/toc.ncx",
    Buffer.from(
      `<?xml version="1.0"?>
<ncx>
  <navMap>
    <navPoint id="p1" playOrder="1">
      <navLabel><text>Chapter One</text></navLabel>
      <content src="ch1.xhtml" />
    </navPoint>
  </navMap>
</ncx>`
    )
  );

  zip.addFile(
    "OEBPS/ch1.xhtml",
    Buffer.from(
      `<!doctype html><html><body><h1>Ignored Title</h1><p>Hello chapter text.</p></body></html>`
    )
  );

  zip.writeZip(epubPath);
}

describe("parser", () => {
  test("slugify normalizes text", () => {
    assert.equal(slugify(" Chapter: One! "), "chapter-one");
  });

  test("parses minimal epub to chapters", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "injectbook-epub-"));
    const epubPath = path.join(tmp, "sample.epub");
    createMinimalEpub(epubPath);

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
    const zip = new AdmZip();

    zip.addFile(
      "META-INF/container.xml",
      Buffer.from(
        `<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" /></rootfiles></container>`
      )
    );
    zip.addFile(
      "OEBPS/content.opf",
      Buffer.from(
        `<?xml version="1.0"?><package version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/"><metadata><dc:title>Sample Book</dc:title><dc:creator opf:file-as="Author, Test" xmlns:opf="urn">Test Author</dc:creator></metadata><manifest><item id="ch1" href="ch1.xhtml" media-type="application/xhtml+xml" /></manifest><spine><itemref idref="ch1" /></spine></package>`
      )
    );
    zip.addFile("OEBPS/ch1.xhtml", Buffer.from(`<!doctype html><html><body><h1>Chapter</h1><p>Body.</p></body></html>`));
    zip.writeZip(epubPath);

    const result = parseEpubToChapters(epubPath);
    assert.deepEqual(result.metadata.authors, ["Test Author"]);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
