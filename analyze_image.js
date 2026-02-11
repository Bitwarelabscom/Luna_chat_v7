
const fs = require('fs');
const http = require('http');

const imagePath = 'images/info1.png';
const model = 'qwen3-vl:30b-a3b-thinking';

const imageBase64 = fs.readFileSync(imagePath).toString('base64');

const data = JSON.stringify({
  model: model,
  prompt: "Analyze this image and tell me the content in detail.",
  images: [imageBase64],
  stream: false
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

const req = http.request(options, (res) => {
  let responseData = '';
  res.on('data', (chunk) => { responseData += chunk; });
  res.on('end', () => {
    const endTime = parseFloat(process.hrtime.bigint()) / 1e9;
    const duration = endTime - startTime;
    try {
      const jsonResponse = JSON.parse(responseData);
      console.log(`Response Time: ${duration.toFixed(4)} seconds`);
      console.log(`Analysis:
${jsonResponse.response}`);
    } catch (e) {
      console.error('Failed to parse response:', responseData);
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(data);
req.end();
