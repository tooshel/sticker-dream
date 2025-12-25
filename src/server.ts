import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { cors } from 'hono/cors';
import { GoogleGenAI } from "@google/genai";
import { printToUSB, watchAndResumePrinters } from './print.ts';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const app = new Hono();
const PORT = 3000;
const SAVE_DIR = './generated-stickers';

// Ensure save directory exists
await mkdir(SAVE_DIR, { recursive: true });

// Enable CORS for Vite dev server
app.use('/*', cors());

watchAndResumePrinters();

// Initialize Google AI
const ai = new GoogleGenAI({
  apiKey: process.env["GEMINI_API_KEY"],
});

/**
 * Generate an image using Imagen AI
 */

const imageGen4 = "imagen-4.0-generate-001";
const imageGen3 = "imagen-3.0-generate-002";
const imageGen4Fast = "imagen-4.0-fast-generate-001";
const imageGen4Ultra = "imagen-4.0-ultra-generate-001";

async function generateImage(prompt: string): Promise<Buffer | null> {
  console.log(`🎨 Generating image: "${prompt}"`);
  console.time('generation');

  const response = await ai.models.generateImages({
    model: imageGen4,
    prompt: `A black and white kids coloring page.
    <image-description>
    ${prompt}
    </image-description>
    ${prompt}`,
    config: {
      numberOfImages: 1,
      aspectRatio: "9:16"
    },
  });

  console.timeEnd('generation');

  if (!response.generatedImages || response.generatedImages.length === 0) {
    console.error('No images generated');
    return null;
  }

  const imgBytes = response.generatedImages[0].image?.imageBytes;
  if (!imgBytes) {
    console.error('No image bytes returned');
    return null;
  }

  return Buffer.from(imgBytes, "base64");
}

/**
 * Save image and metadata to disk
 */
async function saveImageWithPrompt(buffer: Buffer, prompt: string): Promise<string> {
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const sanitizedPrompt = prompt
    .substring(0, 50)
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();

  const filename = `${timestamp}_${sanitizedPrompt}`;
  const imagePath = join(SAVE_DIR, `${filename}.png`);
  const metadataPath = join(SAVE_DIR, `${filename}.json`);

  // Save image
  await writeFile(imagePath, buffer);

  // Save metadata
  await writeFile(metadataPath, JSON.stringify({
    prompt,
    timestamp: new Date().toISOString(),
    filename: `${filename}.png`
  }, null, 2));

  console.log(`💾 Saved: ${filename}.png`);
  return imagePath;
}

/**
 * API endpoint to generate and print image
 */
app.post('/api/generate', async (c) => {
  const { prompt } = await c.req.json();

  if (!prompt) {
    return c.json({ error: 'Prompt is required' }, 400);
  }

  try {
    // Generate the image
    const buffer = await generateImage(prompt);

    if (!buffer) {
      return c.json({ error: 'Failed to generate image' }, 500);
    }

    // Save the image and prompt
    await saveImageWithPrompt(buffer, prompt);

    // Print the image
    try {
      const printResult = await printToUSB(buffer, {
        fitToPage: true,
        copies: 1
      });
      console.log(`✅ Print job submitted to ${printResult.printerName}`);
    } catch (printError) {
      console.warn('⚠️ Printing failed:', printError);
      // Continue even if printing fails - still return the image
    }

    // Send the image back to the client
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
      },
    });

  } catch (error) {
    console.error('Error:', error);
    return c.json({
      error: error instanceof Error ? error.message : 'Unknown error'
    }, 500);
  }
});

serve({
  fetch: app.fetch,
  port: PORT,
}, (info) => {
  console.log(`🚀 Server running at http://localhost:${info.port}`);
});

