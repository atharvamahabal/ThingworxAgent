
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const bodyParser = require('body-parser');
const { pipeline } = require('@xenova/transformers');
const { initLangChain, processPDFWithLangChain, chatWithLangChain, streamChatWithLangChain, searchLangChain, embeddings } = require('./langchain_utils');
const lancedb = require('vectordb');
const ollama = require('ollama').default;
const { XMLParser } = require('fast-xml-parser');
const pdf = require('pdf-parse');
const AdmZip = require('adm-zip');
const fs = require('fs');
const path = require('path');

const app = express();
const port = 3001;

// Constants
const KNOWLEDGE_BASE_DIR = path.join(__dirname, 'AI_KnowledgeBase');
const DOCS_TABLE_NAME = 'thingworx_docs_v1';
const PROJECTS_TABLE_NAME = 'thingworx_projects_v1';

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
let docsTable = null;
let projectsTable = null;
let embedder = null;

let vectorStoreDocs = null;
let vectorStoreProjects = null;

async function init() {
  try {
    console.log('Initializing RAG system (LangChain Powered)...');
    
    // Connect to LanceDB and Initialize LangChain
    const dbPath = './data/lancedb_v2';
    const { vectorStoreDocs: vsd, vectorStoreProjects: vsp } = await initLangChain(DOCS_TABLE_NAME, PROJECTS_TABLE_NAME, dbPath);
    
    vectorStoreDocs = vsd;
    vectorStoreProjects = vsp;
    
    // Backward compatibility for raw table access (if needed for listing sources)
    // We can access the underlying table via vectorStore.table? Or just reopen raw connection.
    // For simplicity, let's keep the raw connection for auxiliary tasks
    db = await lancedb.connect(dbPath);
    const existingTables = await db.tableNames();
    if (existingTables.includes(DOCS_TABLE_NAME)) docsTable = await db.openTable(DOCS_TABLE_NAME);
    if (existingTables.includes(PROJECTS_TABLE_NAME)) projectsTable = await db.openTable(PROJECTS_TABLE_NAME);
    
    // Embedder is now handled inside langchain_utils via the exported 'embeddings' object
    // But we keep the global 'embedder' function for legacy code compatibility
    embedder = async (text) => {
        return await embeddings.embedQuery(text);
    };

    console.log('RAG system ready.');
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

function escapeFilterValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function detectCategory(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  if (normalized.includes('/documentation/')) return 'Documentation';
  if (normalized.includes('/projects/')) return 'Project';
  return 'Unknown';
}

function deriveProjectFromPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const parts = normalized.split('/');
  const projectIndex = parts.indexOf('projects');
  
  if (projectIndex >= 0 && parts.length > projectIndex + 1) {
    let projName = parts[projectIndex + 1];
    if (projName.toLowerCase().endsWith('.zip')) {
      return projName.slice(0, -4);
    }
    return projName;
  }
  return 'Uncategorized';
}

function deriveEntityFolder(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/');
  const idx = normalized.indexOf('Entities/');
  if (idx === -1) return '';
  const after = normalized.slice(idx + 'Entities/'.length);
  const folder = after.split('/')[0] || '';
  return folder;
}

function extractXmlFromModelOutput(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:xml)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('<');
  const end = candidate.lastIndexOf('>');
  if (start === -1 || end === -1 || end <= start) return candidate.trim();
  return candidate.slice(start, end + 1).trim();
}

// Helper: Get Embedding
async function getEmbedding(text) {
  // Use LangChain embeddings wrapper
  return await embeddings.embedQuery(text);
}

// Helper: Process PDF (LangChain)
async function processPDF(filePath) {
  // Use LangChain PDF Loader
  const chunks = await processPDFWithLangChain(filePath);
  
  // Add our specific metadata fields that LangChain might not have
  const category = detectCategory(filePath);
  const project = category === 'Project' ? deriveProjectFromPath(filePath) : 'Global';
  
  return chunks.map(chunk => ({
      content: chunk.pageContent,
      textToEmbed: chunk.pageContent,
      type: 'Documentation',
      name: path.basename(filePath),
      source: path.basename(filePath),
      project: project,
      category: category,
      filePath: filePath,
      entityFolder: 'Docs',
      isDocumentation: true
  }));
}

// Helper: Parse and Chunk XML Content
async function parseXMLContent(xmlData, sourceName, projectName = 'Unknown', filePath = sourceName) {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  let jsonObj;
  try {
    jsonObj = parser.parse(xmlData);
  } catch (e) {
    console.error(`Failed to parse XML for ${sourceName}:`, e.message);
    return [];
  }
  
  const chunks = [];
  const entityFolder = deriveEntityFolder(filePath);
  const category = detectCategory(filePath);
  
  // Extract ThingTemplates
  const templates = jsonObj.Entities?.ThingTemplates?.ThingTemplate;
  if (templates) {
    const list = Array.isArray(templates) ? templates : [templates];
    for (const item of list) {
      const name = item['@_name'];
      const desc = item['@_description'] || '';
      const textToEmbed = `ThingTemplate: ${name}. Description: ${desc}. BaseThingTemplate: ${item['@_baseThingTemplate']}`;
      chunks.push({
        content: `<!-- Source: ${sourceName} -->\n${xmlData}`, 
        textToEmbed,
        type: 'ThingTemplate',
        name,
        source: sourceName,
        project: projectName,
        filePath: filePath,
        category: category,
        entityFolder,
        isDocumentation: false
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
        content: `<!-- Source: ${sourceName} -->\n${xmlData}`, 
        textToEmbed,
        type: 'Thing',
        name,
        source: sourceName,
        project: projectName,
        filePath: filePath,
        category: category,
        entityFolder,
        isDocumentation: false
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
        content: `<!-- Source: ${sourceName} -->\n${xmlData}`, 
        textToEmbed,
        type: 'Mashup',
        name,
        source: sourceName,
        project: projectName,
        filePath: filePath,
        category: category,
        entityFolder,
        isDocumentation: false
      });
    }
  }

  // Extract DataShapes
  const datashapes = jsonObj.Entities?.DataShapes?.DataShape;
  if (datashapes) {
    const list = Array.isArray(datashapes) ? datashapes : [datashapes];
    for (const item of list) {
      const name = item['@_name'];
      const desc = item['@_description'] || '';
      const textToEmbed = `DataShape: ${name}. Description: ${desc}`;
      chunks.push({
        content: `<!-- Source: ${sourceName} -->\n${xmlData}`, 
        textToEmbed,
        type: 'DataShape',
        name,
        source: sourceName,
        project: projectName,
        filePath: filePath,
        category: category,
        entityFolder,
        isDocumentation: false
      });
    }
  }
  
  return chunks;
}

// Helper: Process Zip File
async function processZip(filePath) {
  const zip = new AdmZip(filePath);
  const zipEntries = zip.getEntries();
  
  // If we are processing a zip that was just uploaded, we might want to infer project name from zip name
  // But if it's in the folder structure, detectCategory logic applies to the zip path itself
  // However, contents of zip are virtual.
  // We'll use the zip file path to determine project context.
  
  const category = detectCategory(filePath);
  const derivedProject = category === 'Project' ? deriveProjectFromPath(filePath) : path.basename(filePath, '.zip');
  
  let allChunks = [];
  
  console.log(`Extracting ZIP with ${zipEntries.length} entries for project ${derivedProject}...`);

  for (const entry of zipEntries) {
    if (entry.isDirectory) continue;
    const entryName = entry.entryName;
    
    // We care about metadata.xml and anything in Entities/ that is an XML
    if (entryName.toLowerCase().endsWith('.xml') && (entryName.includes('Entities/') || entryName.endsWith('metadata.xml'))) {
        try {
          const xmlContent = entry.getData().toString('utf8');
          // Construct a virtual path for the entry inside the zip for consistent metadata
          const virtualPath = path.join(path.dirname(filePath), entryName);
          const chunks = await parseXMLContent(xmlContent, entryName, derivedProject, virtualPath);
          allChunks = allChunks.concat(chunks);
        } catch (err) {
          console.error(`Error processing entry ${entryName}:`, err.message);
        }
    }
  }
  return allChunks;
}

// Helper: Parse and Chunk XML File
async function processXML(filePath) {
  const xmlData = fs.readFileSync(filePath, 'utf8');
  const category = detectCategory(filePath);
  const projectName = category === 'Project' ? deriveProjectFromPath(filePath) : 'Uncategorized';
  return parseXMLContent(xmlData, path.basename(filePath), projectName, filePath);
}

async function storeChunks(chunks) {
  const docsData = [];
  const projectsData = [];

  for (const chunk of chunks) {
    const vector = await getEmbedding(chunk.textToEmbed);
    const record = {
      vector,
      content: chunk.content,
      type: chunk.type,
      name: chunk.name,
      source: chunk.source,
      project: chunk.project || 'Uncategorized',
      category: chunk.category || 'Unknown',
      filePath: chunk.filePath || chunk.source,
      entityFolder: chunk.entityFolder || deriveEntityFolder(chunk.filePath || chunk.source) || '',
      isDocumentation: typeof chunk.isDocumentation === 'boolean' ? chunk.isDocumentation : (chunk.type === 'Documentation')
    };

    if (record.category === 'Documentation' || record.type === 'Documentation') {
      docsData.push(record);
    } else {
      projectsData.push(record);
    }
  }

  if (docsData.length > 0 && docsTable) {
    await docsTable.add(docsData);
  }
  if (projectsData.length > 0 && projectsTable) {
    await projectsTable.add(projectsData);
  }
  
  return chunks.length;
}

// API: Ingest Upload
app.post('/api/ingest', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).send('No file uploaded');
    
    console.log(`Processing ${req.file.originalname}...`);
    
    // Determine destination folder based on file type for "smart drop" behavior simulation
    // Since this is a temporary upload, we process it directly but assign metadata as if it were in the right place
    // Or we could move it to the right place and then scan it.
    // Let's process it in-memory but assign metadata.
    
    let chunks = [];
    if (req.file.originalname.toLowerCase().endsWith('.pdf')) {
      // Treat as Documentation
      chunks = await processPDF(req.file.path);
      chunks.forEach(c => { c.category = 'Documentation'; c.project = 'Global'; });
    } else if (req.file.originalname.toLowerCase().endsWith('.zip')) {
      // Treat as Project
      chunks = await processZip(req.file.path);
      chunks.forEach(c => { c.category = 'Project'; });
    } else {
      // Treat as Project XML
      chunks = await processXML(req.file.path);
      chunks.forEach(c => { c.category = 'Project'; });
    }
    
    await storeChunks(chunks);
    
    // Cleanup
    if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    
    res.json({ success: true, count: chunks.length });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// API: Scan Folder (Generic)
app.post('/api/scan', async (req, res) => {
  // If folderPath is not provided, default to KNOWLEDGE_BASE_DIR
  let { folderPath } = req.body;
  if (!folderPath) folderPath = KNOWLEDGE_BASE_DIR;
  
  if (!fs.existsSync(folderPath)) {
    // If it doesn't exist, try creating it if it matches our KB dir
    if (path.resolve(folderPath) === path.resolve(KNOWLEDGE_BASE_DIR)) {
        fs.mkdirSync(KNOWLEDGE_BASE_DIR, { recursive: true });
        fs.mkdirSync(path.join(KNOWLEDGE_BASE_DIR, 'documentation'), { recursive: true });
        fs.mkdirSync(path.join(KNOWLEDGE_BASE_DIR, 'projects'), { recursive: true });
    } else {
        return res.status(400).json({ error: 'Valid folder path required' });
    }
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
        } else if (item.toLowerCase().endsWith('.pdf') || item.toLowerCase().endsWith('.xml') || item.toLowerCase().endsWith('.zip')) {
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
        else if (file.toLowerCase().endsWith('.zip')) chunks = await processZip(file);
        else chunks = await processXML(file);
        
        await storeChunks(chunks);
        totalChunks += chunks.length;
        
        console.log(`Ingested ${path.basename(file)} (${chunks.length} chunks)`);
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

// API: Get available models
app.get('/api/models', async (req, res) => {
  try {
    const list = await ollama.list();
    res.json(list.models || []);
  } catch (error) {
    console.error('Error fetching models:', error);
    res.status(500).json({ error: error.message });
  }
});

// API: Get available sources
app.get('/api/sources', async (req, res) => {
  try {
    const sources = new Set();
    const dummyVector = Array(768).fill(0);

    if (projectsTable) {
        const pResults = await projectsTable.search(dummyVector).limit(1000).execute();
        pResults.forEach(r => { if(r.source && r.source !== 'init') sources.add(r.source); });
    }
    if (docsTable) {
        const dResults = await docsTable.search(dummyVector).limit(1000).execute();
        dResults.forEach(r => { if(r.source && r.source !== 'init') sources.add(r.source); });
    }

    res.json([...sources]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects', async (req, res) => {
  try {
    if (!projectsTable) return res.json([]);
    const dummyVector = Array(768).fill(0);
    const results = await projectsTable.search(dummyVector).limit(10000).execute();
    const projects = [...new Set(
      results
        .map(r => r.project)
        .filter(p => p && p !== 'init' && p !== 'Uncategorized')
        .map(p => String(p).toLowerCase().endsWith('.zip') ? p.slice(0, -4) : p)
    )];
    res.json(projects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/documents', async (req, res) => {
  try {
    const docsDir = path.join(KNOWLEDGE_BASE_DIR, 'documentation');
    if (!fs.existsSync(docsDir)) {
      return res.json({ count: 0, documents: [] });
    }

    const documents = [];
    const allowedExt = new Set(['.pdf', '.xml', '.zip']);

    function scan(dir) {
      const items = fs.readdirSync(dir);
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) scan(fullPath);
        else {
          const ext = path.extname(item).toLowerCase();
          if (!allowedExt.has(ext)) continue;
          const rel = path.relative(docsDir, fullPath).replace(/\\/g, '/');
          documents.push(rel);
        }
      }
    }

    scan(docsDir);
    documents.sort((a, b) => a.localeCompare(b));
    res.json({ count: documents.length, documents });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/find-doc-folders', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query || !vectorStoreDocs) {
      return res.json({ folders: [], files: [] });
    }
    
    // Use LangChain Search
    const results = await searchLangChain(query, 'docs', 50);
    
    const docsRoot = path.join(KNOWLEDGE_BASE_DIR, 'documentation');
    const folders = new Set();
    const files = [];
    
    for (const r of results) {
      const fp = r.metadata.filePath || r.metadata.source;
      if (!fp) continue;
      
      const dir = path.dirname(fp);
      const relDir = path.relative(docsRoot, dir).replace(/\\/g, '/');
      const relFile = path.relative(docsRoot, fp).replace(/\\/g, '/');
      
      if (relDir && relDir !== '.') folders.add(relDir);
      if (relFile) files.push(relFile);
    }
    
    const uniqueFiles = [...new Set(files)];
    const uniqueFolders = [...folders];
    res.json({ folders: uniqueFolders, files: uniqueFiles });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// API: Chat
app.post('/api/chat', async (req, res) => {
  const { prompt, model, source, useKB } = req.body;
  const useModel = model || 'gemma3:1b';
  
  try {
    let contextDocs = [];

    // 1. Vector Search (Only if useKB is true)
    if (useKB) {
      // Use LangChain Search
      const qv = prompt;
      
      let docsResults = [];
      let projResults = [];

      // Search Documentation
      if (vectorStoreDocs) {
         docsResults = await searchLangChain(qv, 'docs', 3);
      }
      
      // Search Projects
      if (vectorStoreProjects) {
          projResults = await searchLangChain(qv, 'projects', 5);
      }
      
      contextDocs = [...docsResults, ...projResults];
      
      // Apply source filter if needed
      if (source && source !== 'all') {
         contextDocs = contextDocs.filter(r => r.metadata && r.metadata.source === source);
      }
    }
    
    // 2. Stream Chat with LangChain (Ollama)
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Transfer-Encoding', 'chunked');

    // Send context as first chunk with delimiter
    const contextHeader = JSON.stringify(contextDocs);
    res.write(contextHeader + "\n__CTX_END__\n");

    const stream = streamChatWithLangChain(prompt, useModel, contextDocs);
    for await (const chunk of stream) {
        res.write(chunk);
    }
    res.end();

  } catch (error) {
    console.error('Chat error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      res.end();
    }
  }
});

app.post('/api/count-entities', async (req, res) => {
  const { project, type } = req.body;

  try {
    if (!projectsTable) {
      return res.json({ count: 0 });
    }

    const dummyVector = Array(768).fill(0);

    let query = projectsTable.search(dummyVector).limit(10000);
    
    let filterParts = [];
    if (project && project !== 'all') filterParts.push(`project = '${escapeFilterValue(project)}'`);
    if (type && type !== 'all') filterParts.push(`type = '${escapeFilterValue(type)}'`);
    
    if (filterParts.length > 0) {
      query = query.filter(filterParts.join(' AND '));
    }

    const results = await query.execute();
    
    const cleanResults = results.filter(r => r.content !== 'init');

    res.json({
      project,
      type,
      count: cleanResults.length
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/modify-xml', upload.single('file'), async (req, res) => {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const { instruction, model } = req.body;
    const xmlContent = fs.readFileSync(req.file.path, 'utf8');

    const systemPrompt = `
You are a ThingWorx XML editor.
Modify the XML strictly according to the instruction.
Return ONLY valid XML.
Do not explain.

Instruction: ${instruction}

XML:
${xmlContent}
`;

    const response = await ollama.chat({
      model: model || 'gemma3:1b',
      messages: [{ role: 'user', content: systemPrompt }]
    });

    const modifiedXML = extractXmlFromModelOutput(response?.message?.content || '');
    parser.parse(modifiedXML);

    res.json({
      modifiedXML
    });
  } catch (error) {
    console.error('Modify XML Error:', error);
    if (String(error?.message || '').includes('Invalid XML') || String(error?.message || '').includes('Parse Error')) {
      return res.status(400).json({ error: 'Model returned invalid XML' });
    }
    res.status(500).json({ error: error.message });
  } finally {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
  }
});

// Start Server
app.listen(port, () => {
  console.log(`ThingWorx AI Server running on http://localhost:${port}`);
  init();
});
