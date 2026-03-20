import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { GoogleGenAI } from "@google/genai";
import Replicate from "replicate";
import OpenAI from "openai";
import { printToUSB } from "./print.ts";
import { writeFile, mkdir, readFile, readdir } from "fs/promises";
import { join } from "path";

const app = new Hono();
const PORT = 3000;
const SAVE_DIR = "./generated-stickers";

// Ensure save directory exists
await mkdir(SAVE_DIR, { recursive: true });

// Enable CORS for Vite dev server
app.use("/*", cors());

// Initialize Google AI
const ai = new GoogleGenAI({
  apiKey: process.env["GEMINI_API_KEY"],
});

// Initialize Replicate
const replicate = new Replicate({
  auth: process.env["REPLICATE_API_TOKEN"],
});

// Initialize OpenRouter
const openrouter = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  apiKey: process.env["OPENROUTER_API_KEY"],
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Sticker Dream",
  },
});

/**
 * Generate an image using Imagen AI
 */

const imageGen4 = "imagen-4.0-generate-001";
const imageGen3 = "imagen-3.0-generate-002";
const imageGen4Fast = "imagen-4.0-fast-generate-001";
const imageGen4Ultra = "imagen-4.0-ultra-generate-001";

async function generateImageGemini(
  prompt: string,
  forKids: boolean = true,
  lineStyle: string = 'default'
): Promise<Buffer> {
  console.log(`🎨 Generating image with Gemini: "${prompt}"`);
  console.log(`   For kids: ${forKids}, Line style: ${lineStyle}`);
  console.time("gemini-generation");

  const promptPrefix = forKids
    ? "A black and white kids coloring page."
    : "A black and white coloring page.";

  // Add line style modifiers
  const lineStyleModifiers: Record<string, string> = {
    'default': '',
    'sharpie': 'thick bold lines, sharpie marker drawing, vector art, monochrome, high contrast, no shading, no gray, 2D flat',
    'stencil': 'black and white stencil art, woodcut style, rubber stamp style, clean edges, negative space',
    'coloring-book': 'simple line art coloring page, low detail, minimalist, uncolored, outlines only'
  };

  const styleModifier = lineStyleModifiers[lineStyle] || '';
  const fullPrompt = styleModifier
    ? `${promptPrefix} ${styleModifier}`
    : promptPrefix;

  try {
    const response = await ai.models.generateImages({
      model: imageGen4,
      prompt: `${fullPrompt}
      <image-description>
      ${prompt}
      </image-description>
      ${prompt}`,
      config: {
        numberOfImages: 1,
        aspectRatio: "3:4", // Closest to 4:6 for portrait stickers (Gemini doesn't support 2:3)
      },
    });

    console.timeEnd("gemini-generation");

    if (!response.generatedImages || response.generatedImages.length === 0) {
      const errorMsg =
        "No images generated - the AI may have rejected the prompt due to safety filters";
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    const imgBytes = response.generatedImages[0].image?.imageBytes;
    if (!imgBytes) {
      const errorMsg = "No image bytes returned from the AI";
      console.error(errorMsg);
      throw new Error(errorMsg);
    }

    return Buffer.from(imgBytes, "base64");
  } catch (error) {
    console.timeEnd("gemini-generation");
    // Log the full error from the API
    console.error("❌ Gemini API Error Details:", error);
    throw error;
  }
}

async function generateImageFlux(
  prompt: string,
  enableSafetyChecker: boolean = true,
  safetyTolerance: number = 2,
  forKids: boolean = true,
  lineStyle: string = 'default'
): Promise<Buffer> {
  console.log(`🎨 Generating image with FLUX.1: "${prompt}"`);
  console.log(
    `   Safety checker: ${enableSafetyChecker}, Tolerance: ${safetyTolerance}, For kids: ${forKids}, Line style: ${lineStyle}`
  );
  console.time("flux-generation");

  // Adjust prompt based on forKids setting
  const promptPrefix = forKids
    ? "A black and white kids coloring page."
    : "A black and white coloring page.";

  // Add line style modifiers
  const lineStyleModifiers: Record<string, string> = {
    'default': '',
    'sharpie': 'thick bold lines, sharpie marker drawing, vector art, monochrome, high contrast, no shading, no gray, 2D flat',
    'stencil': 'black and white stencil art, woodcut style, rubber stamp style, clean edges, negative space',
    'coloring-book': 'simple line art coloring page, low detail, minimalist, uncolored, outlines only'
  };

  const styleModifier = lineStyleModifiers[lineStyle] || '';
  const fullPrompt = styleModifier
    ? `${promptPrefix} ${styleModifier}. ${prompt}`
    : `${promptPrefix} ${prompt}`;

  try {
    // const output = (await replicate.run("black-forest-labs/flux-1.1-pro", {
    const output = (await replicate.run("black-forest-labs/flux-schnell", {
      input: {
        prompt: fullPrompt,
        aspect_ratio: "2:3", // 4:6 ratio for portrait stickers
        output_format: "png",
        safety_tolerance: safetyTolerance,
        disable_safety_checker: !enableSafetyChecker,
        prompt_upsampling: false,
      },
    })) as any;

    console.timeEnd("flux-generation");

    // FLUX returns a URL to the generated image
    const imageUrl = Array.isArray(output) ? output[0] : output;

    if (!imageUrl) {
      throw new Error("No image URL returned from FLUX");
    }

    // Fetch the image from the URL
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image from URL: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.timeEnd("flux-generation");
    console.error("❌ FLUX API Error Details:", error);
    throw error;
  }
}

/**
 * Generate image using OpenRouter with specified model
 */
async function generateImageOpenRouter(
  modelId: string,
  modelDisplayName: string,
  prompt: string,
  forKids: boolean = true,
  lineStyle: string = 'default'
): Promise<Buffer> {
  console.log(`🎨 Generating image with ${modelDisplayName}: "${prompt}"`);
  console.time(`${modelDisplayName}-generation`);

  const promptPrefix = forKids
    ? "A black and white kids coloring page."
    : "A black and white coloring page.";

  const lineStyleModifiers: Record<string, string> = {
    'default': '',
    'sharpie': 'thick bold lines, sharpie marker drawing, vector art, monochrome, high contrast, no shading, no gray, 2D flat',
    'stencil': 'black and white stencil art, woodcut style, rubber stamp style, clean edges, negative space',
    'coloring-book': 'simple line art coloring page, low detail, minimalist, uncolored, outlines only'
  };

  const styleModifier = lineStyleModifiers[lineStyle] || '';
  const fullPrompt = styleModifier
    ? `${promptPrefix} ${styleModifier}. ${prompt}`
    : `${promptPrefix} ${prompt}`;

  try {
    const response = await openrouter.images.generate({
      model: modelId,
      prompt: fullPrompt,
      n: 1,
      size: "1024x1536", // 2:3 aspect ratio for portrait stickers
    });

    console.timeEnd(`${modelDisplayName}-generation`);

    if (!response.data || response.data.length === 0) {
      throw new Error(`No image returned from ${modelDisplayName}`);
    }

    const imageData = response.data[0];

    // Handle both URL and base64 responses
    if (imageData.url) {
      const fetchResponse = await fetch(imageData.url);
      if (!fetchResponse.ok) {
        throw new Error(`Failed to fetch image from URL: ${fetchResponse.statusText}`);
      }
      const arrayBuffer = await fetchResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } else if (imageData.b64_json) {
      return Buffer.from(imageData.b64_json, 'base64');
    } else {
      throw new Error(`No image URL or base64 data returned from ${modelDisplayName}`);
    }
  } catch (error) {
    console.timeEnd(`${modelDisplayName}-generation`);
    console.error(`❌ ${modelDisplayName} API Error Details:`, error);
    throw error;
  }
}

/**
 * Save images and metadata to disk
 */
async function saveImagesWithMetadata(
  images: { buffer: Buffer; model: string }[],
  prompt: string,
  settings: {
    forKids: boolean;
    enableSafetyChecker: boolean;
    safetyTolerance: number;
    lineStyle: string;
  }
): Promise<{ imagePaths: string[]; metadataPath: string }> {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\..+/, "");
  const sanitizedPrompt = prompt
    .substring(0, 50)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

  const baseFilename = `${timestamp}_${sanitizedPrompt}`;
  const imagePaths: string[] = [];
  const imageFiles: string[] = [];

  // Save each image with model name in filename
  for (const { buffer, model } of images) {
    const imageFilename = `${baseFilename}_${model}.png`;
    const imagePath = join(SAVE_DIR, imageFilename);
    await writeFile(imagePath, buffer);
    imagePaths.push(imagePath);
    imageFiles.push(imageFilename);
    console.log(`💾 Saved: ${imageFilename}`);
  }

  // Save metadata with all settings and image references
  const metadataPath = join(SAVE_DIR, `${baseFilename}.json`);
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        prompt,
        timestamp: new Date().toISOString(),
        settings: {
          forKids: settings.forKids,
          enableSafetyChecker: settings.enableSafetyChecker,
          safetyTolerance: settings.safetyTolerance,
          lineStyle: settings.lineStyle,
        },
        images: imageFiles.map((filename, i) => ({
          filename,
          model: images[i].model,
          path: imagePaths[i],
        })),
      },
      null,
      2
    )
  );

  console.log(`📝 Saved metadata: ${baseFilename}.json`);
  return { imagePaths, metadataPath };
}

/**
 * API endpoint to generate and print image
 */
app.post("/api/generate", async (c) => {
  const { prompt, models, enableSafetyChecker, safetyTolerance, autoPrint, forKids, lineStyle } =
    await c.req.json();

  if (!prompt) {
    return c.json({ error: "Prompt is required" }, 400);
  }

  const selectedModels = models || ["gemini"]; // Default to gemini if no models specified
  const shouldAutoPrint = autoPrint !== false; // Default to true
  const isForKids = forKids !== false; // Default to true
  const selectedLineStyle = lineStyle || 'default';

  try {
    const buffers: Buffer[] = [];
    const modelNames: string[] = [];

    // Generate images for each selected model
    for (const modelName of selectedModels) {
      try {
        let buffer: Buffer;

        switch (modelName) {
          case 'gemini':
            buffer = await generateImageGemini(prompt, isForKids, selectedLineStyle);
            break;
          case 'flux':
            buffer = await generateImageFlux(prompt, enableSafetyChecker, safetyTolerance, isForKids, selectedLineStyle);
            break;
          case 'dalle3':
            buffer = await generateImageOpenRouter('openai/dall-e-3', 'DALL-E 3', prompt, isForKids, selectedLineStyle);
            break;
          case 'sd3':
            buffer = await generateImageOpenRouter('stabilityai/stable-diffusion-3-medium', 'SD3', prompt, isForKids, selectedLineStyle);
            break;
          default:
            console.error(`Unknown model: ${modelName}`);
            continue;
        }

        buffers.push(buffer);
        modelNames.push(modelName);
      } catch (error) {
        console.error(`${modelName} generation failed:`, error);
        // Continue with other models even if one fails
      }
    }

    if (buffers.length === 0) {
      throw new Error("All models failed to generate images");
    }

    // Save all generated images with metadata
    const imagesToSave = buffers.map((buffer, i) => ({
      buffer,
      model: modelNames[i],
    }));

    const { imagePaths } = await saveImagesWithMetadata(imagesToSave, prompt, {
      forKids: isForKids,
      enableSafetyChecker,
      safetyTolerance,
      lineStyle: selectedLineStyle,
    });

    // Auto-print if enabled - use saved images instead of keeping in memory
    if (shouldAutoPrint) {
      for (let i = 0; i < imagePaths.length; i++) {
        try {
          // Read the saved image file for printing
          const imageBuffer = await readFile(imagePaths[i]);

          const printResult = await printToUSB(imageBuffer, {
            fitToPage: true,
            copies: 1,
          });
          console.log(
            `✅ Print job ${i + 1}/${imagePaths.length} submitted to ${
              printResult.printerName
            } (${modelNames[i]})`
          );
        } catch (printError) {
          console.warn(`⚠️ Printing failed for ${modelNames[i]}:`, printError);
        }
      }
    }

    // Return all images as base64 in JSON
    const images = buffers.map((buffer, i) => ({
      data: buffer.toString("base64"),
      model: modelNames[i],
    }));

    return c.json({ images });
  } catch (error) {
    // Log the full error for debugging
    console.error("❌ Full error object:", error);

    let errorMessage = "Unknown error";

    if (error instanceof Error) {
      errorMessage = error.message;

      // Check if the error message itself is a JSON string and extract the message
      try {
        const parsed = JSON.parse(errorMessage);
        if (parsed.message) {
          errorMessage = parsed.message;
        } else if (parsed.error?.message) {
          errorMessage = parsed.error.message;
        }
      } catch {
        // Not JSON, use error.message as-is
      }
    } else if (typeof error === "object" && error !== null) {
      // Handle API error objects
      const apiError = error as any;
      if (apiError.message) {
        errorMessage = apiError.message;
      } else if (apiError.error?.message) {
        errorMessage = apiError.error.message;
      } else {
        // Stringify as last resort
        errorMessage = JSON.stringify(error);
      }
    }

    console.error("❌ Extracted error message:", errorMessage);

    return c.json(
      {
        error: errorMessage,
      },
      500
    );
  }
});

/**
 * API endpoint to get random past sticker ideas for inspiration
 */
app.get("/api/inspiration", async (c) => {
  try {
    const count = parseInt(c.req.query("count") || "10", 10);

    // Read all JSON files from the generated-stickers directory
    const files = await readdir(SAVE_DIR);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    if (jsonFiles.length === 0) {
      return c.json({ ideas: [] });
    }

    // Randomly select some files
    const selectedFiles = jsonFiles
      .sort(() => Math.random() - 0.5)
      .slice(0, Math.min(count, jsonFiles.length));

    // Read the metadata and get the first image for each
    const ideas = await Promise.all(
      selectedFiles.map(async (file) => {
        try {
          const metadataPath = join(SAVE_DIR, file);
          const metadata = JSON.parse(await readFile(metadataPath, "utf-8"));

          // Get the first image (prefer gemini, fallback to any available)
          let imageFilename: string | null = null;

          if (metadata.images && metadata.images.length > 0) {
            // New format with multiple images
            const geminiImage = metadata.images.find((img: any) => img.model === "gemini");
            imageFilename = geminiImage?.filename || metadata.images[0].filename;
          } else if (metadata.filename) {
            // Old format with single filename
            imageFilename = metadata.filename;
          }

          if (!imageFilename) {
            return null;
          }

          // Read the image and convert to base64
          const imagePath = join(SAVE_DIR, imageFilename);
          const imageBuffer = await readFile(imagePath);
          const imageBase64 = imageBuffer.toString("base64");

          return {
            prompt: metadata.prompt.trim(),
            image: imageBase64,
            timestamp: metadata.timestamp,
          };
        } catch (error) {
          console.warn(`Failed to read ${file}:`, error);
          return null;
        }
      })
    );

    // Filter out any failed reads
    const validIdeas = ideas.filter((idea) => idea !== null);

    return c.json({ ideas: validIdeas });
  } catch (error) {
    console.error("❌ Error getting inspiration:", error);
    return c.json({ error: "Failed to get inspiration", ideas: [] }, 500);
  }
});

/**
 * API endpoint to print an image
 */
app.post("/api/print", async (c) => {
  try {
    const { imageData } = await c.req.json();

    if (!imageData) {
      return c.json({ error: "Image data is required" }, 400);
    }

    // Convert base64 to buffer
    const buffer = Buffer.from(imageData, "base64");

    // Print the image
    const printResult = await printToUSB(buffer, {
      fitToPage: true,
      copies: 1,
    });

    console.log(`✅ Print job submitted to ${printResult.printerName}`);

    return c.json({ success: true, printer: printResult.printerName });
  } catch (error) {
    console.error("❌ Print error:", error);
    return c.json(
      {
        error: error instanceof Error ? error.message : "Print failed",
      },
      500
    );
  }
});

serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`🚀 Server running at http://localhost:${info.port}`);
  }
);
