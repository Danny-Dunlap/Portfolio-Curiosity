import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();
// Also load .env.local if present, allowing it to override .env
dotenv.config({ path: '.env.local', override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json({ limit: '2mb' }));

// Serve static files (index.html, game.js, images, etc.)
// Serve static files from the project root
app.use(express.static(__dirname));

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Proxy endpoint to generate an image with OpenAI and return a data URL
app.post('/api/generate-image', async (req, res) => {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'OPENAI_API_KEY not configured on server' });
    }

    const { prompt, size } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const openai = new OpenAI({ apiKey });
    // sanitize/normalize size to allowed values for gpt-image-1 and dall-e-3
    const allowedSizes = new Set(['1024x1024', '1024x1536', '1536x1024', 'auto']);
    const sizeParam = allowedSizes.has(size) ? size : '1024x1024';

    async function tryGenerate(model) {
      console.log(`Attempting image generation with model: ${model}, size: ${sizeParam}`);
      const result = await openai.images.generate({ model, prompt, size: sizeParam });
      const data = result?.data?.[0];
      const b64 = data?.b64_json;
      const url = data?.url;
      if (!b64 && !url) {
        throw Object.assign(new Error('No image returned from model'), { status: 502 });
      }
      return { imageUrl: b64 ? `data:image/png;base64,${b64}` : url, modelUsed: model };
    }

    let out;
    try {
      out = await tryGenerate('gpt-image-1');
    } catch (err) {
      const status = err?.status || err?.response?.status;
      const code = err?.code || err?.response?.data?.error?.code;
      const msg = (err?.message || '').toLowerCase();
      const forbidden = status === 403 || code === 'forbidden' || msg.includes('must be verified') || msg.includes('access') || msg.includes('forbidden');
      if (forbidden) {
        console.warn('gpt-image-1 not available, falling back to dall-e-3');
        out = await tryGenerate('dall-e-3');
      } else {
        throw err;
      }
    }

    return res.json(out);
  } catch (err) {
    console.error('Image generation error', err);
    const status = err?.status || err?.response?.status || 500;
    const message = err?.message || 'Image generation failed';
    const details = err?.response?.data || undefined;
    return res.status(status).json({ error: 'Image generation failed', message, details });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  if (process.env.OPENAI_API_KEY) {
    const tail = process.env.OPENAI_API_KEY.slice(-4);
    console.log(`OpenAI API key detected (ending with ${tail}).`);
  } else {
    console.warn('OPENAI_API_KEY not set. /api/generate-image will return 400.');
  }
});
