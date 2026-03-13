/**
 * ThingWorx PDF Parser for RAG Pipeline (Node.js)
 * =================================================
 * Extracts structured text + metadata from ThingWorx PDF docs.
 * Output: JSON files ready for chunking + embedding.
 *
 * Install dependencies:
 *   npm install pdf-parse fs-extra glob
 */

const fs = require("fs-extra");
const path = require("path");
const pdfParse = require("pdf-parse");
const { glob } = require("glob");

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const INPUT_DIR = "./thingworx docs";                   // folder with your ThingWorx PDFs
const OUTPUT_DIR = "./AI_KnowledgeBase/processed_json"; // parsed output goes here
const MIN_TEXT_LENGTH = 30;            // skip near-empty pages

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Clean raw PDF text — fix common extraction artifacts
 */
function cleanText(text) {
  return text
    .replace(/\n{3,}/g, "\n\n")          // collapse multiple blank lines
    .replace(/[ \t]+/g, " ")             // collapse spaces/tabs
    .replace(/(\w)-\n(\w)/g, "$1$2")     // fix hyphenated line breaks
    .trim();
}

/**
 * Extract likely section headings from text.
 * ThingWorx docs use short Title Case or ALL-CAPS lines as headings.
 */
function extractHeadings(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[A-Z][A-Za-z0-9 \-:]{3,60}$/.test(line) && line.split(" ").length <= 10);
}

/**
 * Extract code snippets: REST endpoints, JSON blocks, JS snippets
 */
function extractCodeBlocks(text) {
  const patterns = [
    /(?:GET|POST|PUT|DELETE|PATCH)\s+\/\S+.*/g,  // REST API calls
    /\{[\s\S]{10,300}\}/g,                         // JSON objects
    /var\s+\w+\s*=.*/g,                            // JS variables
    /function\s+\w+\s*\(/g,                        // JS functions
  ];

  const blocks = [];
  for (const pattern of patterns) {
    const matches = text.match(pattern) || [];
    blocks.push(...matches);
  }
  return [...new Set(blocks)]; // deduplicate
}

/**
 * Split full doc text into per-page approximations.
 * pdf-parse doesn't split by page natively, so we chunk by form-feed or estimated page size.
 */
function splitIntoPages(text) {
  // PDFs often use \f (form feed) as page separator
  const byFormFeed = text.split("\f");
  if (byFormFeed.length > 1) return byFormFeed;

  // Fallback: split into ~3000 char chunks as page approximations
  const chunkSize = 3000;
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    chunks.push(text.slice(i, i + chunkSize));
  }
  return chunks;
}

// ─────────────────────────────────────────────
// CORE PARSER
// ─────────────────────────────────────────────

/**
 * Parse a single ThingWorx PDF file.
 * Returns structured JSON with pages, headings, code blocks, metadata.
 */
async function parsePdf(pdfPath) {
  const buffer = await fs.readFile(pdfPath);
  const filename = path.basename(pdfPath);

  let data;
  try {
    data = await pdfParse(buffer);
  } catch (err) {
    throw new Error(`pdf-parse failed on ${filename}: ${err.message}`);
  }

  const rawPages = splitIntoPages(data.text);
  const pages = [];

  rawPages.forEach((rawText, index) => {
    const cleaned = cleanText(rawText);
    if (cleaned.length < MIN_TEXT_LENGTH) return; // skip near-empty pages

    pages.push({
      page_number: index + 1,
      text: cleaned,
      headings: extractHeadings(cleaned),
      code_blocks: extractCodeBlocks(cleaned),
      char_count: cleaned.length,
      word_count: cleaned.split(/\s+/).length,
    });
  });

  return {
    source: filename,
    file_path: pdfPath,
    total_pages: rawPages.length,
    parsed_pages: pages.length,
    pdf_info: {
      title: data.info?.Title || null,
      author: data.info?.Author || null,
      subject: data.info?.Subject || null,
      num_pages: data.numpages,
    },
    pages,
  };
}

// ─────────────────────────────────────────────
// BATCH PROCESSING
// ─────────────────────────────────────────────

async function parseAllPdfs() {
  await fs.ensureDir(OUTPUT_DIR);

  const pdfFiles = await glob(`${INPUT_DIR}/**/*.pdf`);

  if (pdfFiles.length === 0) {
    console.log(`No PDF files found in: ${INPUT_DIR}`);
    return;
  }

  console.log(`Found ${pdfFiles.length} PDF(s). Parsing...\n`);

  const allDocs = [];

  for (const pdfPath of pdfFiles) {
    try {
      const parsed = await parsePdf(pdfPath);
      allDocs.push(parsed);

      // Save individual parsed file
      const outName = path.basename(pdfPath, ".pdf") + "_parsed.json";
      const outPath = path.join(OUTPUT_DIR, outName);
      await fs.writeJson(outPath, parsed, { spaces: 2 });

      console.log(
        `  ✓ ${parsed.source} → ${parsed.total_pages} pages, ${parsed.parsed_pages} non-empty`
      );
    } catch (err) {
      console.error(`  ✗ Failed: ${path.basename(pdfPath)} — ${err.message}`);
    }
  }

  // Save combined output
  const combinedPath = path.join(OUTPUT_DIR, "all_docs_parsed.json");
  await fs.writeJson(combinedPath, allDocs, { spaces: 2 });

  console.log(`\n✅ Done! Combined output saved to: ${combinedPath}`);
  console.log(`\nNext step: run chunker.js to split pages into overlapping chunks for embedding.`);

  return allDocs;
}

// ─────────────────────────────────────────────
// PREVIEW (optional debug helper)
// ─────────────────────────────────────────────

function previewDoc(parsedDoc) {
  console.log(`\nPreview: ${parsedDoc.source}`);
  console.log("=".repeat(60));
  parsedDoc.pages.slice(0, 3).forEach((page) => {
    console.log(`\n[Page ${page.page_number}] — ${page.word_count} words`);
    if (page.headings.length) console.log(`  Headings: ${page.headings.join(", ")}`);
    console.log(`  Preview: ${page.text.slice(0, 200)}...`);
  });
}

// ─────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────

(async () => {
  const docs = await parseAllPdfs();
  if (docs && docs.length > 0) {
    previewDoc(docs[0]);
  }
})();