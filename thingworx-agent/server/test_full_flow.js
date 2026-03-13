const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = 'http://localhost:3001/api';

async function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runFullTest() {
    console.log('--- Starting Full System Test ---');

    // 1. Scan KB
    console.log('\n1. Scanning Knowledge Base...');
    try {
        const scanRes = await axios.post(`${BASE_URL}/scan-kb`, {
            folderPath: path.join(__dirname, 'knowledge_base')
        });
        console.log('Scan Result:', scanRes.data);
    } catch (error) {
        console.error('Scan Error:', error.response?.data || error.message);
    }

    // Wait for embedding to finish (simple delay, in real world we'd poll or wait for confirmation)
    // The scan-kb endpoint returns after processing, so we should be good.
    // But let's give it a second.
    await delay(1000);

    // 2. Count Entities
    console.log('\n2. Counting Entities...');
    try {
        const countRes = await axios.post(`${BASE_URL}/count-entities`, {
            project: 'TestThing', // Since we used TestThing.xml
            type: 'Thing'
        });
        console.log('Count Result (Expected 1):', countRes.data);
    } catch (error) {
        console.error('Count Error:', error.response?.data || error.message);
    }

    // 3. Modify XML
    console.log('\n3. Modifying XML...');
    const tempFile = path.join(__dirname, 'temp_modify.xml');
    fs.writeFileSync(tempFile, `<Entities><Things><Thing name="MyThing"></Thing></Things></Entities>`);
    
    const form = new FormData();
    form.append('file', fs.createReadStream(tempFile));
    form.append('instruction', 'Add a description "Modified by AI" to the Thing');
    form.append('model', 'gemma3:1b');

    try {
        const modifyRes = await axios.post(`${BASE_URL}/modify-xml`, form, {
            headers: form.getHeaders()
        });
        console.log('Modify Result:\n', modifyRes.data.modifiedXML);
    } catch (error) {
        console.error('Modify Error:', error.response?.data || error.message);
    } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
}

runFullTest();
