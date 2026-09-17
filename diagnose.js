import 'dotenv/config';

const apiKey = process.env.GEMINI_API_KEY || '';
const model = process.env.ANALYSIS_MODEL || 'gemini-flash-latest';

if (!apiKey) {
  console.log('No GEMINI_API_KEY found in .env - nothing to test.');
  process.exit(1);
}

console.log(`Using key: ${apiKey.slice(0, 6)}...${apiKey.slice(-4)} (masked)`);
console.log(`Using model: ${model}\n`);

async function callGemini(label, body) {
  console.log(`--- ${label} ---`);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (res.ok) {
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '(no text in response)';
      console.log(`RESULT: SUCCESS (${res.status})`);
      console.log(`Response text: ${text.slice(0, 200)}`);
    } else {
      console.log(`RESULT: FAILED (${res.status})`);
      console.log(`Error message: ${data?.error?.message || JSON.stringify(data)}`);
    }
  } catch (err) {
    console.log(`RESULT: NETWORK ERROR - ${err.message}`);
  }
  console.log('');
}

await callGemini('Test A: plain generation, no tools', {
  contents: [{ role: 'user', parts: [{ text: 'Say hello in one word.' }] }],
});

await callGemini('Test B: with Google Search grounding', {
  contents: [{ role: 'user', parts: [{ text: 'What year is it?' }] }],
  tools: [{ google_search: {} }],
});

console.log('Done. Compare the two RESULT lines above.');
