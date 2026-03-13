const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');

const BASE_URL = 'http://localhost:3001/api';

async function testCount() {
    console.log('\n--- Testing Count API ---');
    try {
        const res = await axios.post(`${BASE_URL}/count-entities`, {
            project: 'all',
            type: 'all'
        });
        console.log('Count Response:', res.data);
    } catch (error) {
        console.error('Count Error:', error.response?.data || error.message);
    }
}

async function testModifyXML() {
    console.log('\n--- Testing Modify XML API ---');
    const xmlContent = `
<Entities>
    <Things>
        <Thing name="TestThing" description="Original Description">
            <PropertyDefinitions>
                <PropertyDefinition name="Prop1" baseType="STRING"/>
            </PropertyDefinitions>
        </Thing>
    </Things>
</Entities>`;
    
    const tempFile = path.join(__dirname, 'temp_test.xml');
    fs.writeFileSync(tempFile, xmlContent);

    const form = new FormData();
    form.append('file', fs.createReadStream(tempFile));
    form.append('instruction', 'Add a new property called "Status" of type "BOOLEAN"');
    form.append('model', 'gemma3:1b'); // Using faster model for test

    try {
        const res = await axios.post(`${BASE_URL}/modify-xml`, form, {
            headers: {
                ...form.getHeaders()
            }
        });
        console.log('Modified XML:\n', res.data.modifiedXML);
    } catch (error) {
        console.error('Modify XML Error:', error.response?.data || error.message);
    } finally {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    }
}

async function runTests() {
    await testCount();
    // Skipping modify test to save time unless requested, or run it if needed. 
    // The user wants verification.
    await testModifyXML(); 
}

runTests();
