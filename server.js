import express from 'express';
import dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json({ limit: '2mb' }));

// Serve static files (index.html, game.js, images, etc.)
app.use(express.static('.'));

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

    const result = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: size || '512x512'
    });

    const data = result?.data?.[0];
    const b64 = data?.b64_json;
    if (!b64) {
      return res.status(502).json({ error: 'No image returned from model' });
    }

    const imageUrl = `data:image/png;base64,${b64}`;
    return res.json({ imageUrl });
  } catch (err) {
    console.error('Image generation error', err);
    return res.status(500).json({ error: 'Image generation failed' });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
