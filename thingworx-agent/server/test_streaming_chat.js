
const axios = require('axios');

async function testStreaming() {
  console.log("--- Starting Streaming Test ---");
  
  try {
    const response = await axios({
      method: 'post',
      url: 'http://localhost:3001/api/chat',
      data: { 
        prompt: "What is a ThingTemplate?",
        model: "gemma3:1b",
        useKB: true
      },
      responseType: 'stream'
    });

    const stream = response.data;
    
    let buffer = '';
    let isContextLoaded = false;
    let chunkCount = 0;

    stream.on('data', (chunk) => {
        const text = chunk.toString();
        chunkCount++;
        
        if (!isContextLoaded) {
            buffer += text;
            const splitIndex = buffer.indexOf('__CTX_END__');
            if (splitIndex !== -1) {
                const contextStr = buffer.substring(0, splitIndex);
                // console.log("\n[HEADER] Raw Context Header:", contextStr); // Debug
                try {
                    const context = JSON.parse(contextStr);
                    console.log("\n[HEADER] Context Docs Count:", context.length);
                    if(context.length > 0) {
                        console.log("[HEADER] First Doc Source:", context[0].metadata?.source || context[0].source);
                    }
                } catch (e) {
                    console.error("\n[HEADER] Failed to parse context JSON:", e.message);
                }
                
                const remainder = buffer.substring(splitIndex + "__CTX_END__".length).trimStart();
                if (remainder) {
                    process.stdout.write("\n[STREAM START]\n" + remainder);
                } else {
                    process.stdout.write("\n[STREAM START]\n");
                }
                isContextLoaded = true;
                buffer = ''; // Clear buffer
            } else {
                // Buffer accumulating context header...
                // console.log("[BUFFER] Accumulating header...");
            }
        } else {
            // Pure streaming content
            process.stdout.write(text);
        }
    });

    stream.on('end', () => {
        console.log("\n\n--- Stream Ended ---");
    });

  } catch (error) {
    console.error("Test failed:", error.message);
    if (error.response) {
        console.error("Status:", error.response.status);
        error.response.data.on('data', (chunk) => console.log(chunk.toString()));
    }
  }
}

testStreaming();
