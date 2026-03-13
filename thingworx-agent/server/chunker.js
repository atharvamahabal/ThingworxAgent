/**
 * ThingWorx RAG Chunker (Node.js)
 * =================================
 * Splits parsed PDF pages into overlapping chunks with metadata.
 * Input:  ./AI_KnowledgeBase/processed_json/all_docs_parsed.json
 * Output: ./AI_KnowledgeBase/chunks/all_chunks.json
 *
 * Install dependencies:
 *   npm install fs-extra uuid
 */

const fs = require("fs-extra");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

// ─────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────

const INPUT_FILE = "./AI_KnowledgeBase/processed_json/all_docs_parsed.json";
const OUTPUT_DIR = "./AI_KnowledgeBase/chunks";

const CONFIG = {
  chunkSize: 500,       // target words per chunk
  chunkOverlap: 100,    // words overlap between consecutive chunks
  minChunkSize: 50,     // discard chunks smaller than this (words)
  preserveCodeBlocks: true, // never split mid-code-block
};

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Split text into words (preserving whitespace structure for rejoining)
 */
function tokenize(text) {
  return text.split(/\s+/).filter(Boolean);
}

/**
 * Rejoin word tokens back into readable text
 */
function detokenize(words) {
  return words.join(" ");
}

/**
 * Detect if a text block contains a code snippet
 */
function containsCode(text) {
  return (
    /(?:GET|POST|PUT|DELETE|PATCH)\s+\//.test(text) ||
    /\{[\s\S]{10,}\}/.test(text) ||
    /function\s+\w+\s*\(/.test(text) ||
    /var\s+\w+\s*=/.test(text) ||
    /=>\s*\{/.test(text)
  );
}

/**
 * Find the current heading context for a page
 * (returns the most recent heading seen so far)
 */
function resolveHeading(headings, chunkIndex, totalChunks) {
  if (!headings || headings.length === 0) return null;
  // Distribute headings across chunks proportionally
  const headingIndex = Math.floor((chunkIndex / totalChunks) * headings.length);
  return headings[Math.min(headingIndex, headings.length - 1)];
}

// ─────────────────────────────────────────────
// CORE CHUNKER
// ─────────────────────────────────────────────

/**
 * Chunk a single page's text into overlapping segments.
 * Preserves code blocks intact — never splits mid-code.
 */
function chunkPage(page, docMeta) {
  const { text, headings, code_blocks, page_number } = page;
  const words = tokenize(text);
  const chunks = [];

  if (words.length < CONFIG.minChunkSize) {
    // Page too short — treat whole page as one chunk
    chunks.push(buildChunk(text, page_number, 0, 1, headings, code_blocks, docMeta));
    return chunks;
  }

  let start = 0;
  let chunkIndex = 0;
  const estimatedTotal = Math.ceil(words.length / (CONFIG.chunkSize - CONFIG.chunkOverlap));

  while (start < words.length) {
    let end = Math.min(start + CONFIG.chunkSize, words.length);
    let chunkWords = words.slice(start, end);
    let chunkText = detokenize(chunkWords);
    
    // Store previous start for loop protection
    const prevStart = start;

    // ── Code block protection ──────────────────────────────────────
    // If this chunk ends mid-code-block, extend until block ends
    if (CONFIG.preserveCodeBlocks && containsCode(chunkText)) {
      const openBraces = (chunkText.match(/\{/g) || []).length;
      const closeBraces = (chunkText.match(/\}/g) || []).length;

      if (openBraces > closeBraces && end < words.length) {
        // Extend chunk to balance braces (max 200 extra words)
        const extension = Math.min(200, words.length - end);
        end += extension;
        chunkWords = words.slice(start, end);
        chunkText = detokenize(chunkWords);
      }
    }

    // ── Build chunk ────────────────────────────────────────────────
    if (chunkWords.length >= CONFIG.minChunkSize) {
      chunks.push(
        buildChunk(
          chunkText,
          page_number,
          chunkIndex,
          estimatedTotal,
          headings,
          code_blocks,
          docMeta
        )
      );
      chunkIndex++;
    }

    // ── Advance with overlap ───────────────────────────────────────
    // If we reached the end of the text, stop
    if (end >= words.length) break;

    start = end - CONFIG.chunkOverlap;
    
    // Safety check to prevent infinite loops if something goes wrong
    if (start <= prevStart) { 
       start = prevStart + 1; 
    }
  }

  return chunks;
}

/**
 * Build a single chunk object with full metadata
 */
function buildChunk(text, pageNumber, chunkIndex, totalChunks, headings, codeBlocks, docMeta) {
  const heading = resolveHeading(headings, chunkIndex, totalChunks);

  return {
    id: uuidv4(),                          // unique ID for vector DB
    text,                                  // the actual text to embed
    metadata: {
      source: docMeta.source,              // original PDF filename
      file_path: docMeta.file_path,
      page_number: pageNumber,
      chunk_index: chunkIndex,
      heading: heading || null,            // nearest section heading
      has_code: containsCode(text),        // flag for code-heavy chunks
      word_count: tokenize(text).length,
      char_count: text.length,
      // PDF-level metadata
      doc_title: docMeta.pdf_info?.title || null,
      doc_author: docMeta.pdf_info?.author || null,
    },
  };
}

// ─────────────────────────────────────────────
// BATCH PROCESSING
// ─────────────────────────────────────────────

async function chunkAllDocs() {
  await fs.ensureDir(OUTPUT_DIR);

  // Load parsed docs
  if (!(await fs.pathExists(INPUT_FILE))) {
    console.error(`❌ Input file not found: ${INPUT_FILE}`);
    console.error(`   Run parsePdfs.js first.`);
    process.exit(1);
  }

  const allDocs = await fs.readJson(INPUT_FILE);
  console.log(`Loaded ${allDocs.length} document(s). Chunking...\n`);

  // Write result using stream to avoid OOM
  const outputFile = path.join(OUTPUT_DIR, "all_chunks.json");
  const writeStream = fs.createWriteStream(outputFile);
  writeStream.write('[\n');
  
  const stats = { docs: 0, pages: 0, chunks: 0, codeChunks: 0 };
  let firstChunk = true;
  
  for (const doc of allDocs) {
    if (!doc.pages) continue;

    for (const page of doc.pages) {
      // Basic check: skip if page text is empty
      if (!page.text || page.text.trim().length === 0) continue;

      const pageChunks = chunkPage(page, doc); // pass whole doc as metadata
      
      // Write chunks immediately to stream
      for (const chunk of pageChunks) {
         if (!firstChunk) {
             writeStream.write(',\n');
         }
         writeStream.write(JSON.stringify(chunk));
         firstChunk = false;
      }
      
      // Update stats
      stats.chunks += pageChunks.length;
      stats.codeChunks += pageChunks.filter(c => c.metadata.has_code).length;
    }
    
    // Update doc stats
    stats.docs++;
    if (doc.pages) {
      stats.pages += doc.pages.length;
    }
    
    // Force garbage collection hint (not strictly possible in JS, but clearing refs helps)
  }
  
  writeStream.write('\n]');
  writeStream.end();
  
  // Wait for stream to finish
  await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
  });
  
  console.log(`\n✅ Done! Stats:`);
  console.log(`   Documents: ${stats.docs}`);
  console.log(`   Pages:     ${stats.pages}`);
  console.log(`   Chunks:    ${stats.chunks}`);
  console.log(`   Code Chunks: ${stats.codeChunks}`);
  console.log(`   Output:    ${outputFile}\n`);
}

chunkAllDocs().catch(console.error);
