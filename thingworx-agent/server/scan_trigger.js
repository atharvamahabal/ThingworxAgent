
const http = require('http');

const data = JSON.stringify({
  folderPath: 'D:\\Android Projects\\GitHub\\ThingworxAgent\\thingworx-agent\\server\\AI_KnowledgeBase\\projects'
});

const options = {
  hostname: 'localhost',
  port: 3001,
  path: '/api/scan-thingworx-pdfs',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  res.on('end', () => {
    console.log('Scan Response:', responseData);
  });
});

req.on('error', (error) => {
  console.error('Error triggering scan:', error);
});

req.write(data);
req.end();
