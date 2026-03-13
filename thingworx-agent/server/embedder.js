/**
 * ThingWorx RAG Embedder - Ollama + LanceDB (Node.js)
 * No API key needed - runs 100% locally!
 *
 * SETUP:
 *   1. Install Ollama:        https://ollama.com/download
 *   2. Pull embedding model:  ollama pull nomic-embed-text
 *   3. Start Ollama:          ollama serve
 *   4. Install deps:          npm install @lancedb/lancedb fs-extra
 *   5. Run:                   node embedder.js
 */

const lancedb = require("@lancedb/lancedb");
const fs = require("fs-extra");

const INPUT_FILE  = "./AI_KnowledgeBase/chunks/all_chunks.json";
const LANCEDB_DIR = "./AI_KnowledgeBase/lancedb";
const TABLE_NAME  = "thingworx_docs";

const CONFIG = {
  ollamaUrl:      "http://localhost:11434",
  embeddingModel: "nomic-embed-text",   // free, local, 768 dims
  // Other free models (ollama pull <name>):
  //   "mxbai-embed-large"  -> more accurate, slower
  //   "all-minilm"         -> fastest, smallest
  batchSize:  50,
  maxRetries:  3,
  retryDelay: 1000,
};

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function batchArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function checkOllama() {
  try {
    const res  = await fetch(`${CONFIG.ollamaUrl}/api/tags`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);
    const found  = models.some((m) => m.startsWith(CONFIG.embeddingModel));
    if (!found) {
      console.error(`Model not found. Fix: ollama pull ${CONFIG.embeddingModel}`);
      console.error(`Available: ${models.join(", ") || "none"}`);
      process.exit(1);
    }
    console.log(`Ollama OK. Model: ${CONFIG.embeddingModel}\n`);
  } catch (err) {
    console.error("Cannot reach Ollama. Fix: run 'ollama serve' in a terminal");
    console.error(err.message);
    process.exit(1);
  }
}

async function embedText(text, attempt = 1) {
  try {
    const res = await fetch(`${CONFIG.ollamaUrl}/api/embeddings`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ model: CONFIG.embeddingModel, prompt: text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.embedding;
  } catch (err) {
    if (attempt <= CONFIG.maxRetries) {
      await sleep(CONFIG.retryDelay * attempt);
      return embedText(text, attempt + 1);
    }
    // Return empty array or throw error based on your preference
    console.error(`Embed failed after retries: ${err.message}`);
    return [];
  }
}

async function embedBatch(texts) {
  const results = [];
  for (const text of texts) results.push(await embedText(text));
  return results;
}

function formatRow(chunk, embedding) {
  return {
    id:          chunk.id,
    vector:      embedding,
    text:        chunk.text,
    source:      chunk.metadata.source,
    file_path:   chunk.metadata.file_path   || "",
    page_number: chunk.metadata.page_number,
    chunk_index: chunk.metadata.chunk_index,
    heading:     chunk.metadata.heading     || "",
    has_code:    chunk.metadata.has_code ? 1 : 0,
    word_count:  chunk.metadata.word_count,
    char_count:  chunk.metadata.char_count,
    doc_title:   chunk.metadata.doc_title   || "",
    doc_author:  chunk.metadata.doc_author  || "",
  };
}

async function embedAndStore() {
  await checkOllama();

  if (!(await fs.pathExists(INPUT_FILE))) {
    console.error(`Not found: ${INPUT_FILE} - run chunker.js first.`);
    process.exit(1);
  }

  const chunks = await fs.readJson(INPUT_FILE);
  console.log(`Loaded ${chunks.length} chunks.\n`);

  await fs.ensureDir(LANCEDB_DIR);
  const db = await lancedb.connect(LANCEDB_DIR);

  // Resume support - skip already-embedded chunks
  const existingTables = await db.tableNames();
  let table = null;
  let done  = new Set();

  if (existingTables.includes(TABLE_NAME)) {
    table = await db.openTable(TABLE_NAME);
    const rows = await table.query().select(["id"]).toArray();
    done  = new Set(rows.map((r) => r.id));
    console.log(`Resuming - already embedded: ${done.size} chunks\n`);
  }

  const remaining = chunks.filter((c) => !done.has(c.id));
  if (!remaining.length) {
    console.log("Nothing to embed - all chunks already in DB.");
    return;
  }

  console.log(`Embedding ${remaining.length} chunks...\n`);

  const batches   = batchArray(remaining, CONFIG.batchSize);
  let embedded    = 0;
  const startTime = Date.now();

  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    process.stdout.write(`  Batch ${i+1}/${batches.length} (${batch.length} chunks)... `);

    const t0         = Date.now();
    const embeddings = await embedBatch(batch.map((c) => c.text));
    const rows       = batch.map((c, idx) => formatRow(c, embeddings[idx]));

    if (!table) {
      table = await db.createTable(TABLE_NAME, rows);
    } else {
      await table.add(rows);
    }

    embedded += batch.length;
    console.log(`done in ${((Date.now()-t0)/1000).toFixed(1)}s  [total: ${embedded}]`);
  }

  console.log("\nBuilding vector index...");
  try {
    await table.createIndex("vector", {
      config: lancedb.Index.ivfPq({
        numPartitions: Math.min(64, Math.floor(embedded / 10)),
        numSubVectors: 32,
      }),
    });
    console.log("Index ready.\n");
  } catch (e) {
    console.log(`Index skipped (flat search will be used): ${e.message}\n`);
  }

  const totalSec = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`Done! Embedded ${embedded} chunks in ${totalSec}s → ${LANCEDB_DIR}/`);
  console.log("Next step: run retriever.js to query your docs!");
}

async function testSearch(query) {
  query = query || "How do I authenticate with ThingWorx REST API?";
  console.log(`\nTest search: "${query}"\n`);
  const db    = await lancedb.connect(LANCEDB_DIR);
  const table = await db.openTable(TABLE_NAME);
  const [vec] = await embedBatch([query]);
  const results = await table.query().nearestTo(vec).limit(3)
    .select(["text", "source", "page_number", "heading"]).toArray();
  results.forEach((r, i) => {
    console.log(`Result #${i+1} — ${r.source} p.${r.page_number}`);
    console.log(`  Heading: ${r.heading || "-"}`);
    console.log(`  ${r.text.slice(0, 200)}...\n`);
  });
}

(async () => {
  if (process.argv.includes("--test")) {
    const queryIndex = process.argv.indexOf("--test") + 1;
    const query = process.argv.slice(queryIndex).join(" ");

    if (!query || query.startsWith("--")) {
       console.error("Please provide a search query after --test");
       return;
    }

    try {
        const db = await lancedb.connect(LANCEDB_DIR);
        const table = await db.openTable(TABLE_NAME);

        console.log(`\nSearching for: "${query}"...`);
        const qVec = await embedText(query);
        const results = await table.vectorSearch(qVec).limit(3).toArray();

        if (results.length === 0) {
            console.log("No results found.");
        }

        results.forEach((r, i) => {
            console.log(`\n[${i + 1}] ${r.doc_title || 'Untitled'} (p. ${r.page_number})`);
            console.log(`    ${r.text.slice(0, 150)}...`);
        });
    } catch (error) {
        console.error("Search failed:", error.message);
    }
    return;
  }

  await checkOllama();
  await embedAndStore();
})();