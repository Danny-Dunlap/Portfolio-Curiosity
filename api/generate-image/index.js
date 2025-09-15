import { GoogleGenAI } from '@google/genai';
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
}
