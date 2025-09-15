import express from 'express';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';

dotenv.config();
// Also load .env.local if present, allowing it to override .env
dotenv.config({ path: '.env.local', override: true });

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json({ limit: '2mb' }));

// Serve static files (index.html, game.js, images, etc.)
app.use(express.static('public'));

// Health check
app.get('/api/health', (_req, res) => res.json({ ok: true }));

// Proxy endpoint to generate an image with Gemini and return a data URL
app.post('/api/generate-image', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'GEMINI_API_KEY not configured on server' });
    }

    const { prompt, size } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      return res.status(400).json({ error: 'Missing prompt' });
    }

    const genAI = new GoogleGenAI(apiKey);
    const model = 'gemini-2.5-flash-image-preview';

    console.log(`Attempting image generation with Gemini model: ${model}`);
    console.log(`Prompt: ${prompt}`);

    const response = await genAI.models.generateContent({
      model: model,
      contents: prompt,
    });

    // Process the response to extract image data
    let imageUrl = null;
    let textResponse = null;

    for (const part of response.candidates[0].content.parts) {
      if (part.text) {
        textResponse = part.text;
        console.log('Generated text:', part.text);
      } else if (part.inlineData) {
        const imageData = part.inlineData.data;
        imageUrl = `data:image/png;base64,${imageData}`;
        console.log('Generated image data received');
      }
    }

    if (!imageUrl) {
      throw Object.assign(new Error('No image returned from Gemini'), { status: 502 });
    }

    return res.json({ 
      imageUrl: imageUrl, 
      modelUsed: model,
      textResponse: textResponse 
    });

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
  if (process.env.GEMINI_API_KEY) {
    const tail = process.env.GEMINI_API_KEY.slice(-4);
    console.log(`Gemini API key detected (ending with ${tail}).`);
  } else {
    console.warn('GEMINI_API_KEY not set. /api/generate-image will return 400.');
  }
});
