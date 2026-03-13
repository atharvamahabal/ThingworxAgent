/**
 * ThingWorx RAG Retriever - Ollama + LanceDB (Node.js)
 * ======================================================
 * Takes a question, searches LanceDB for relevant chunks,
 * then sends them to a local Ollama LLM for a final answer.
 *
 * SETUP:
 *   1. Pull a chat model:  ollama pull llama3
 *   2. Install deps:       npm install @lancedb/lancedb fs-extra readline
 *   3. Run interactive:    node retriever.js
 *   4. Run single query:   node retriever.js --query "How does ThingWorx auth work?"
 */

const lancedb = require("@lancedb/lancedb");
const fs = require("fs-extra");
const readline = require("readline");

// ── CONFIG ────────────────────────────────────────────────────────

const LANCEDB_DIR = "./AI_KnowledgeBase/lancedb";
const TABLE_NAME  = "thingworx_docs";

const CONFIG = {
  ollamaUrl:      "http://localhost:11434",

  // Model used for generating answers (chat/instruct model)
  chatModel:      "gemma3:1b",
  // Alternatives (ollama pull <name>):
  //   "mistral"       -> fast, great for technical docs
  //   "gemma2"        -> good balance
  //   "phi3"          -> lightweight, good on low-end hardware

  // Model used for embedding the query (must match embedder.js)
  embeddingModel: "nomic-embed-text",

  topK:           5,     // number of chunks to retrieve
  maxTokens:      1024,  // max tokens in LLM response
};

// ── HELPERS ───────────────────────────────────────────────────────

async function embedQuery(query) {
  const res = await fetch(`${CONFIG.ollamaUrl}/api/embeddings`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ model: CONFIG.embeddingModel, prompt: query }),
  });
  if (!res.ok) throw new Error("Embed failed: HTTP " + res.status);
  const data = await res.json();
  return data.embedding;
}

async function searchChunks(query) {
  const db    = await lancedb.connect(LANCEDB_DIR);
  const table = await db.openTable(TABLE_NAME);
  const vec   = await embedQuery(query);

  const results = await table
    .query()
    .nearestTo(vec)
    .limit(CONFIG.topK)
    .select(["text", "source", "page_number", "heading", "has_code"])
    .toArray();

  return results;
}

function buildPrompt(query, chunks) {
  const context = chunks
    .map((c, i) => {
      const label = `[${i+1}] ${c.source} (page ${c.page_number})${c.heading ? " - " + c.heading : ""}`;
      return label + "\n" + c.text;
    })
    .join("\n\n---\n\n");

  return `You are a helpful ThingWorx technical assistant.
Answer the user's question using ONLY the context provided below.
If the answer is not in the context, say "I could not find this in the ThingWorx documentation."
Always mention which source/page your answer comes from.

CONTEXT:
${context}

QUESTION:
${query}

ANSWER:`;
}

/** Stream the LLM response token by token */
async function streamAnswer(prompt) {
  const res = await fetch(`${CONFIG.ollamaUrl}/api/generate`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      model:  CONFIG.chatModel,
      prompt: prompt,
      stream: true,
      options: { num_predict: CONFIG.maxTokens },
    }),
  });

  if (!res.ok) {
    throw new Error("LLM call failed: HTTP " + res.status + ". Is " + CONFIG.chatModel + " pulled? Run: ollama pull " + CONFIG.chatModel);
  }

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText  = "";

  process.stdout.write("\nAnswer: ");

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const lines = decoder.decode(value).split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const json = JSON.parse(line);
        if (json.response) {
          process.stdout.write(json.response);
          fullText += json.response;
        }
        if (json.done) break;
      } catch (_) {}
    }
  }

  console.log("\n");
  return fullText;
}

// ── CORE ──────────────────────────────────────────────────────────

async function ask(query) {
  console.log("\nSearching ThingWorx docs...");
  const chunks = await searchChunks(query);

  if (!chunks.length) {
    console.log("No relevant chunks found in the vector DB.");
    return;
  }

  // Show retrieved sources
  console.log("\nTop " + chunks.length + " sources retrieved:");
  chunks.forEach((c, i) => {
    console.log("  [" + (i+1) + "] " + c.source + " p." + c.page_number + (c.heading ? " - " + c.heading : ""));
  });

  const prompt = buildPrompt(query, chunks);
  await streamAnswer(prompt);
}

async function checkOllama() {
  try {
    const res  = await fetch(`${CONFIG.ollamaUrl}/api/tags`);
    const data = await res.json();
    const models = (data.models || []).map((m) => m.name);

    const hasChat  = models.some((m) => m.startsWith(CONFIG.chatModel));
    const hasEmbed = models.some((m) => m.startsWith(CONFIG.embeddingModel));

    if (!hasEmbed) {
      console.error("Embedding model not found. Run: ollama pull " + CONFIG.embeddingModel);
      process.exit(1);
    }
    if (!hasChat) {
      console.error("Chat model not found. Run: ollama pull " + CONFIG.chatModel);
      process.exit(1);
    }
    console.log("Ollama OK.");
    console.log("  Embedding : " + CONFIG.embeddingModel);
    console.log("  Chat LLM  : " + CONFIG.chatModel + "\n");
  } catch (err) {
    console.error("Cannot reach Ollama. Run: ollama serve");
    process.exit(1);
  }
}

// ── INTERACTIVE CHAT LOOP ─────────────────────────────────────────

async function interactiveMode() {
  const rl = readline.createInterface({
    input:  process.stdin,
    output: process.stdout,
  });

  console.log("=".repeat(50));
  console.log("  ThingWorx RAG Assistant (local, offline)");
  console.log("=".repeat(50));
  console.log('Type your question and press Enter. Type "exit" to quit.\n');

  const askQuestion = () => {
    rl.question("You: ", async (input) => {
      input = input.trim();
      if (!input || input.toLowerCase() === "exit") {
        console.log("Goodbye!");
        rl.close();
        return;
      }
      try {
        await ask(input);
      } catch (err) {
        console.error("Error: " + err.message);
      }
      askQuestion(); // loop
    });
  };

  askQuestion();
}

// ── ENTRY POINT ───────────────────────────────────────────────────

(async () => {
  await checkOllama();

  // Check DB exists
  if (!(await fs.pathExists(LANCEDB_DIR))) {
    console.error("LanceDB not found at " + LANCEDB_DIR);
    console.error("Run embedder.js first.");
    process.exit(1);
  }

  // Single query mode: node retriever.js --query "your question"
  if (process.argv.includes("--query")) {
    const queryIndex = process.argv.indexOf("--query") + 1;
    const query = process.argv.slice(queryIndex).join(" ");
    
    if (!query || query.startsWith("--")) {
      console.error('Usage: node retriever.js --query "your question here"');
      process.exit(1);
    }
    await ask(query);
    process.exit(0);
  }

  // Default: interactive chat mode
  await interactiveMode();
})();