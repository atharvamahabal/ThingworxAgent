
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bodyParser = require('body-parser');
const { pipeline } = require('@xenova/transformers');
const lancedb = require('vectordb');
const ollama = require('ollama').default;
const { XMLParser } = require('fast-xml-parser');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = './uploads';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir);
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage: storage });

// Database and Model setup
let db = null;
let table = null;
let embedder = null;

async function init() {
  try {
    console.log('Initializing RAG system...');
    
    // Connect to LanceDB
    const dbPath = './data/lancedb';
    if (!fs.existsSync('./data')) fs.mkdirSync('./data');
    db = await lancedb.connect(dbPath);
    
    // Create or open table
    const tableName = 'thingworx_assets';
    const existingTables = await db.tableNames();
    
    if (existingTables.includes(tableName)) {
      table = await db.openTable(tableName);
    } else {
      // Create with dummy data to establish schema
      // 384 dim for all-MiniLM-L6-v2
      table = await db.createTable(tableName, [
        { vector: Array(384).fill(0), content: 'init', type: 'init', name: 'init' }
      ]);
    }
    
    // Load Embedding Model
    console.log('Loading embedding model...');
    embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    console.log('RAG system ready.');
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

// Helper: Get Embedding
async function getEmbedding(text) {
  if (!embedder) throw new Error('Embedder not initialized');
  const output = await embedder(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

// Helper: Process PDF
async function processPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);
  const data = await pdf(dataBuffer);
  
  const text = data.text;
  const chunks = [];
  const chunkSize = 1000;
  const overlap = 200;
  
  for (let i = 0; i < text.length; i += (chunkSize - overlap)) {
    const chunkText = text.slice(i, i + chunkSize).replace(/\s+/g, ' ').trim();
    if (chunkText.length > 50) {
      chunks.push({
        content: `Source: ${path.basename(filePath)}\n\n${chunkText}`,
        textToEmbed: chunkText,
        type: 'Documentation',
        name: path.basename(filePath)
      });
    }
  }
  return chunks;
}

// Helper: Parse and Chunk XML
async function processXML(filePath) {
  const xmlData = fs.readFileSync(filePath, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const jsonObj = parser.parse(xmlData);
  
  const chunks = [];
  
  // Extract ThingTemplates
  const templates = jsonObj.Entities?.ThingTemplates?.ThingTemplate;
  if (templates) {
    const list = Array.isArray(templates) ? templates : [templates];
    for (const item of list) {
      const name = item['@_name'];
      const desc = item['@_description'] || '';
      const textToEmbed = `ThingTemplate: ${name}. Description: ${desc}. BaseThingTemplate: ${item['@_baseThingTemplate']}`;
      chunks.push({
        content: `<!-- ThingTemplate: ${name} -->\n${xmlData}`, // Store full XML or snippet? Ideally snippet. For now full file context if small.
        textToEmbed,
        type: 'ThingTemplate',
        name
      });
    }
  }

  // Extract Things
  const things = jsonObj.Entities?.Things?.Thing;
  if (things) {
    const list = Array.isArray(things) ? things : [things];
    for (const item of list) {
      const name = item['@_name'];
      const desc = item['@_description'] || '';
      const template = item['@_thingTemplate'] || '';
      const textToEmbed = `Thing: ${name}. Description: ${desc}. Template: ${template}`;
      chunks.push({
        content: `<!-- Thing: ${name} -->\n${xmlData}`, 
        textToEmbed,
        type: 'Thing',
        name
      });
    }
  }

  // Extract Mashups
  const mashups = jsonObj.Entities?.Mashups?.Mashup;
  if (mashups) {
    const list = Array.isArray(mashups) ? mashups : [mashups];
    for (const item of list) {
      const name = item['@_name'];
      const desc = item['@_description'] || '';
      const textToEmbed = `Mashup: ${name}. Description: ${desc}`;
      chunks.push({
        content: `<!-- Mashup: ${name} -->\n${xmlData}`, 
        textToEmbed,
        type: 'Mashup',
        name
      });
    }
  }
  
  return chunks;
}

// API: Ingest XML
app.post('/api/ingest', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded');
    
    console.log(`Processing ${req.file.originalname}...`);
    
    let chunks = [];
    if (req.file.originalname.toLowerCase().endsWith('.pdf')) {
      chunks = await processPDF(req.file.path);
    } else {
      chunks = await processXML(req.file.path);
    }
    
    const data = [];
    for (const chunk of chunks) {
      const vector = await getEmbedding(chunk.textToEmbed);
      data.push({
        vector,
        content: chunk.content,
        type: chunk.type,
        name: chunk.name
      });
    }
    
    if (data.length > 0) {
      await table.add(data);
    }
    
    // Cleanup
    fs.unlinkSync(req.file.path);
    
    res.json({ success: true, count: data.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// API: Scan Folder
app.post('/api/scan', async (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath || !fs.existsSync(folderPath)) {
    return res.status(400).json({ error: 'Valid folder path required' });
  }

  try {
    console.log(`Scanning folder: ${folderPath}`);
    const files = [];
    
    function scan(dir) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          scan(fullPath);
        } else if (item.toLowerCase().endsWith('.pdf') || item.toLowerCase().endsWith('.xml')) {
          files.push(fullPath);
        }
      }
    }
    scan(folderPath);
    
    console.log(`Found ${files.length} files. Processing...`);
    let totalChunks = 0;
    
    for (const file of files) {
      let chunks = [];
      try {
        if (file.toLowerCase().endsWith('.pdf')) chunks = await processPDF(file);
        else chunks = await processXML(file);
        
        const data = [];
        for (const chunk of chunks) {
          const vector = await getEmbedding(chunk.textToEmbed);
          data.push({
            vector,
            content: chunk.content,
            type: chunk.type,
            name: chunk.name
          });
        }
        
        if (data.length > 0) {
          await table.add(data);
          totalChunks += data.length;
        }
        console.log(`Ingested ${file} (${chunks.length} chunks)`);
      } catch (err) {
        console.error(`Error processing ${file}:`, err.message);
      }
    }
    
    res.json({ success: true, filesFound: files.length, chunksIngested: totalChunks });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// API: Chat
app.post('/api/chat', async (req, res) => {
  const { prompt, model } = req.body;
  const useModel = model || 'gemma3:1b';
  
  try {
    // 1. Vector Search
    const queryVector = await getEmbedding(prompt);
    const results = await table.search(queryVector)
      .limit(3)
      .execute();
      
    const context = results.map(r => r.content).join('\n\n');
    
    // 2. Chat with Ollama
    const response = await ollama.chat({
      model: useModel,
      messages: [
        {
          role: 'user',
          content: `You are a ThingWorx AI Architect. You must output valid XML for ThingWorx entities.
Use the provided context to guide your structure.

Context:
${context}

Task: ${prompt}`
        }
      ]
    });
    
    res.json({ 
      response: response.message.content,
      context: results.map(r => ({ name: r.name, type: r.type }))
    });
    
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`ThingWorx AI Server running on http://localhost:${port}`);
  init();
});
