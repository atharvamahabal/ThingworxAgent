
const { ChatOllama, OllamaEmbeddings } = require("@langchain/ollama");
const { LanceDB } = require("@langchain/community/vectorstores/lancedb");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
// const { pipeline } = require('@xenova/transformers'); // Removed Xenova
const fs = require('fs');
const path = require('path');
const lancedb = require('@lancedb/lancedb');

// Global instances
let vectorStoreDocs = null;
let vectorStoreProjects = null;

// Initialize Ollama Embeddings (nomic-embed-text)
const embeddings = new OllamaEmbeddings({
  model: "nomic-embed-text", // Must match embedder.js
  baseUrl: "http://localhost:11434",
});

// Initialize LangChain components
async function initLangChain(docsTableName, projectsTableName, dbPath) {
  try {
    // Ensure DB directory exists
    if (!fs.existsSync(path.dirname(dbPath))) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }

    // Connect to LanceDB
    const db = await lancedb.connect(dbPath);
    
    // Initialize Embeddings
    // await embeddings.init(); // Not needed for OllamaEmbeddings

    // Initialize VectorStores
    // Note: LangChain's LanceDB wrapper expects an existing table or creates one.
    // We reuse the existing table names from index.js
    
    // Check if tables exist, if not create dummy schema
    const existingTables = await db.tableNames();
    
    // Helper to get or create table wrapper
    const getTable = async (tableName) => {
        let table;
        if (existingTables.includes(tableName)) {
            table = await db.openTable(tableName);
        } else {
            // Define schema matching index.js
             const schema = [
                { vector: Array(768).fill(0), content: 'init', type: 'init', name: 'init', source: 'init', project: 'init', category: 'init', filePath: 'init', entityFolder: 'init', isDocumentation: false }
            ];
            table = await db.createTable(tableName, schema);
        }
        return new LanceDB(embeddings, { table, textKey: 'content' });
    };

    vectorStoreDocs = await getTable(docsTableName);
    vectorStoreProjects = await getTable(projectsTableName);

    console.log("LangChain initialized successfully.");
    return { vectorStoreDocs, vectorStoreProjects };
  } catch (error) {
    console.error("LangChain initialization error:", error);
    throw error;
  }
}

// Process PDF using LangChain PDFLoader
async function processPDFWithLangChain(filePath) {
  try {
    const loader = new PDFLoader(filePath, {
      splitPages: false, // We want full text to split semantically
    });
    const docs = await loader.load();
    
    // Split text
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });
    
    const splitDocs = await splitter.splitDocuments(docs);
    
    // Map to our metadata structure
    return splitDocs.map(doc => ({
      pageContent: doc.pageContent,
      metadata: {
        source: path.basename(filePath),
        filePath: filePath,
        ...doc.metadata
      }
    }));
  } catch (error) {
    console.error("Error processing PDF with LangChain:", error);
    return [];
  }
}

// Chat with Ollama using LangChain
async function chatWithLangChain(prompt, modelName, contextDocs = []) {
  try {
    const chat = new ChatOllama({
      baseUrl: "http://localhost:11434", // Default Ollama URL
      model: modelName || "gemma3:1b",
      temperature: 0.7,
    });

    // Create system message
    const contextText = contextDocs.map(d => d.content || d.pageContent).join("\n\n");
    
    // Check if XML request (reuse logic from index.js)
    const isXmlRequest = /create|generate|build|make|write/i.test(prompt) && /(xml|datashape|thing|mashup|template)/i.test(prompt);
    
    const role = isXmlRequest 
      ? "You are a ThingWorx AI Architect. You must output valid XML for ThingWorx entities." 
      : "You are a helpful ThingWorx AI Assistant. Answer the user's question clearly and concisely.";

    const messages = [
      ["system", `${role}\nUse the provided context to guide your answer.\n\nContext:\n${contextText}`],
      ["human", prompt]
    ];

    const response = await chat.invoke(messages);
    return response.content;
  } catch (error) {
    console.error("LangChain Chat Error:", error);
    throw error;
  }
}

// Stream Chat with Ollama using LangChain
async function* streamChatWithLangChain(prompt, modelName, contextDocs = []) {
  try {
    const chat = new ChatOllama({
      baseUrl: "http://localhost:11434", // Default Ollama URL
      model: modelName || "gemma3:1b",
      temperature: 0.7,
    });

    // Create system message
    const contextText = contextDocs.map(d => d.content || d.pageContent).join("\n\n");
    
    // Check if XML request (reuse logic from index.js)
    const isXmlRequest = /create|generate|build|make|write/i.test(prompt) && /(xml|datashape|thing|mashup|template)/i.test(prompt);
    
    const role = isXmlRequest 
      ? "You are a ThingWorx AI Architect. You must output valid XML for ThingWorx entities." 
      : "You are a helpful ThingWorx AI Assistant. Answer the user's question clearly and concisely.";

    const messages = [
      ["system", `${role}\nUse the provided context to guide your answer.\n\nContext:\n${contextText}`],
      ["human", prompt]
    ];

    const stream = await chat.stream(messages);
    for await (const chunk of stream) {
      yield chunk.content;
    }
  } catch (error) {
    console.error("LangChain Stream Error:", error);
    throw error;
  }
}

// Search
async function searchLangChain(query, type = 'docs', k = 3) {
  const store = type === 'projects' ? vectorStoreProjects : vectorStoreDocs;
  if (!store) return [];
  
  // Perform similarity search
  // Note: LangChain's similaritySearch returns Document objects
  const results = await store.similaritySearch(query, k);
  
  // Map back to our format, filtering out 'init' dummy records
  return results
    .filter(doc => doc.pageContent !== 'init' && doc.metadata?.source !== 'init')
    .map(doc => ({
      content: doc.pageContent,
      metadata: doc.metadata
    }));
}

module.exports = {
  initLangChain,
  processPDFWithLangChain,
  chatWithLangChain,
  streamChatWithLangChain,
  searchLangChain,
  embeddings // Export for direct usage if needed
};
