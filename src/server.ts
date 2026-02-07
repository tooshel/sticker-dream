import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { cors } from "hono/cors";
import { GoogleGenAI } from "@google/genai";
import Replicate from "replicate";
import { printToUSB, watchAndResumePrinters } from "./print.ts";
import { writeFile, mkdir, readFile } from "fs/promises";
import { join } from "path";

const app = new Hono();
const PORT = 3000;
const SAVE_DIR = "./generated-stickers";

// Ensure save directory exists
await mkdir(SAVE_DIR, { recursive: true });

// Enable CORS for Vite dev server
app.use("/*", cors());

watchAndResumePrinters();

// Initialize Google AI
const ai = new GoogleGenAI({
  apiKey: process.env["GEMINI_API_KEY"],
});

// Initialize Replicate
const replicate = new Replicate({
  auth: process.env["REPLICATE_API_TOKEN"],
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
  const { prompt, model, enableSafetyChecker, safetyTolerance, autoPrint, forKids, lineStyle } =
    await c.req.json();

  if (!prompt) {
    return c.json({ error: "Prompt is required" }, 400);
  }

  const selectedModel = model || "gemini";
  const shouldAutoPrint = autoPrint !== false; // Default to true
  const isForKids = forKids !== false; // Default to true
  const selectedLineStyle = lineStyle || 'default';

  try {
    const buffers: Buffer[] = [];
    const modelNames: string[] = [];

    // Generate images based on selected model
    if (selectedModel === "all") {
      // Generate with both models
      try {
        const geminiBuffer = await generateImageGemini(prompt, isForKids, selectedLineStyle);
        buffers.push(geminiBuffer);
        modelNames.push("gemini");
      } catch (error) {
        console.error("Gemini generation failed:", error);
      }

      try {
        const fluxBuffer = await generateImageFlux(
          prompt,
          enableSafetyChecker,
          safetyTolerance,
          isForKids,
          selectedLineStyle
        );
        buffers.push(fluxBuffer);
        modelNames.push("flux");
      } catch (error) {
        console.error("FLUX generation failed:", error);
      }

      if (buffers.length === 0) {
        throw new Error("All models failed to generate images");
      }
    } else if (selectedModel === "flux") {
      const buffer = await generateImageFlux(
        prompt,
        enableSafetyChecker,
        safetyTolerance,
        isForKids,
        selectedLineStyle
      );
      buffers.push(buffer);
      modelNames.push("flux");
    } else {
      // Default to gemini
      const buffer = await generateImageGemini(prompt, isForKids, selectedLineStyle);
      buffers.push(buffer);
      modelNames.push("gemini");
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
