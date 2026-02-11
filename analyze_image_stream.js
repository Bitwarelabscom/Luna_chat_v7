const fs = require('fs');
const http = require('http');

const imagePath = 'images/info1.png';
const model = 'qwen2.5vl:3b';

const imageBase64 = fs.readFileSync(imagePath).toString('base64');

const data = JSON.stringify({
  model: model,
  prompt: "Analyze this image and tell me the content in detail.",
  images: [imageBase64],
  stream: true
});

const options = {
  hostname: '172.29.0.3',
  port: 11434,
  path: '/api/generate',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const startTime = parseFloat(process.hrtime.bigint()) / 1e9;
let firstTokenTime = null;

console.log(`Starting analysis with ${model}...`);

const req = http.request(options, (res) => {
  let buffer = '';
  res.on('data', (chunk) => {
    if (firstTokenTime === null) {
      firstTokenTime = parseFloat(process.hrtime.bigint()) / 1e9;
      console.log(`Time to first token: ${(firstTokenTime - startTime).toFixed(4)} seconds\n`);
    }
    
    buffer += chunk.toString();
    let lines = buffer.split('\n');
    buffer = lines.pop(); // Keep the last partial line in the buffer

    for (const line of lines) {
      if (line.trim()) {
        try {
          const json = JSON.parse(line);
          if (json.response) {
            process.stdout.write(json.response);
          }
          if (json.done) {
            const endTime = parseFloat(process.hrtime.bigint()) / 1e9;
            console.log(`\n\nTotal Response Time: ${(endTime - startTime).toFixed(4)} seconds`);
          }
        } catch (e) {
          // console.error('Error parsing line:', line);
        }
      }
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();