
const lancedb = require('vectordb');
const path = require('path');

async function checkTables() {
    const dbPath = path.join(__dirname, 'thingworx-agent', 'server', 'data', 'lancedb_v2');
    console.log('Checking DB at:', dbPath);
    try {
        const db = await lancedb.connect(dbPath);
        const tables = await db.tableNames();
        console.log('Tables:', tables);
    } catch (error) {
        console.error('Error:', error);
    }
}

checkTables();
