import OpenAI from 'openai';
import dotenv from 'dotenv';

// Load environment variables for Vercel dev
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

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
}
