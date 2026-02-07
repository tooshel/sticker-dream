import { pipeline } from "@huggingface/transformers";

// Initialize the transcriber
const transcriber = await pipeline(
  "automatic-speech-recognition",
  "Xenova/whisper-tiny.en",
  {
    progress_callback: (event) => {
      // console.log(event);
    },
  }
);

// Get DOM elements
const recordBtn = document.querySelector(".record") as HTMLButtonElement;
const transcriptDiv = document.querySelector(".transcript") as HTMLTextAreaElement;
const statusMessage = document.querySelector(".status-message") as HTMLDivElement;
const cancelBtn = document.querySelector(".cancel-btn") as HTMLButtonElement;
const generateBtn = document.querySelector(".generate-btn") as HTMLButtonElement;
const audioElement = document.querySelector("#audio") as HTMLAudioElement;
const imagesContainer = document.querySelector(".images-container") as HTMLDivElement;
const toastContainer = document.querySelector(".toast-container") as HTMLDivElement;
const settingsBtn = document.querySelector(".settings-btn") as HTMLButtonElement;
const settingsModal = document.querySelector(".settings-modal") as HTMLDivElement;
const closeBtn = document.querySelector(".close-btn") as HTMLButtonElement;
const saveBtn = document.querySelector(".save-btn") as HTMLButtonElement;
const modelSelect = document.querySelector("#model-select") as HTMLSelectElement;
const safetyToleranceSlider = document.querySelector("#safety-tolerance") as HTMLInputElement;
const safetyToleranceValue = document.querySelector(".slider-value") as HTMLSpanElement;
const enableSafetyCheckbox = document.querySelector("#enable-safety") as HTMLInputElement;
const autoPrintCheckbox = document.querySelector("#auto-print") as HTMLInputElement;
const forKidsCheckbox = document.querySelector("#for-kids") as HTMLInputElement;
const lineStyleSelect = document.querySelector("#line-style") as HTMLSelectElement;
const fluxSettings = document.querySelector(".flux-settings") as HTMLDivElement;

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let recordingTimeout: number | null = null;
let currentAbortController: AbortController | null = null;
let isRecordingViaKeyboard = false;

// Settings state
interface AppSettings {
  model: 'gemini' | 'flux' | 'all';
  enableSafetyChecker: boolean;
  safetyTolerance: number;
  autoPrint: boolean;
  forKids: boolean;
  lineStyle: 'default' | 'sharpie' | 'stencil' | 'coloring-book';
}

const DEFAULT_SETTINGS: AppSettings = {
  model: 'gemini',
  enableSafetyChecker: true,
  safetyTolerance: 2,
  autoPrint: true,
  forKids: true,
  lineStyle: 'default'
};

let currentSettings: AppSettings = { ...DEFAULT_SETTINGS };

// Load settings from localStorage
function loadSettings(): AppSettings {
  try {
    const saved = localStorage.getItem('stickerDreamSettings');
    if (saved) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
    }
  } catch (error) {
    console.error('Error loading settings:', error);
  }
  return { ...DEFAULT_SETTINGS };
}

// Save settings to localStorage
function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem('stickerDreamSettings', JSON.stringify(settings));
    currentSettings = settings;
  } catch (error) {
    console.error('Error saving settings:', error);
  }
}

// Update UI from settings
function updateSettingsUI(): void {
  modelSelect.value = currentSettings.model;
  safetyToleranceSlider.value = currentSettings.safetyTolerance.toString();
  safetyToleranceValue.textContent = currentSettings.safetyTolerance.toString();
  enableSafetyCheckbox.checked = currentSettings.enableSafetyChecker;
  autoPrintCheckbox.checked = currentSettings.autoPrint;
  forKidsCheckbox.checked = currentSettings.forKids;
  lineStyleSelect.value = currentSettings.lineStyle;

  // Show/hide FLUX settings based on model
  const showFluxSettings = currentSettings.model === 'flux' || currentSettings.model === 'all';
  fluxSettings.style.display = showFluxSettings ? 'block' : 'none';
}

// Initialize settings
currentSettings = loadSettings();
updateSettingsUI();

// Toast notification function
function showToast(message: string, type: 'error' | 'success' | 'info' = 'error', duration = 5000) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;

  toastContainer.appendChild(toast);

  // Auto-remove after duration
  setTimeout(() => {
    toast.style.animation = 'toast-fade-out 0.3s ease-out';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}

// Check for microphone access before showing the button
async function checkMicrophoneAccess() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Stop the stream immediately, we just needed to check permission
    stream.getTracks().forEach((track) => track.stop());

    // Show the record button
    recordBtn.style.display = "block";
    transcriptDiv.value = "Press and hold the button to describe your sticker!\nOr type your idea here!";
    generateBtn.style.display = "block";
  } catch (error) {
    console.error("Microphone access denied:", error);
    transcriptDiv.value =
      "❌ Microphone access required. Please enable microphone permissions in your browser settings.";
    recordBtn.style.display = "none";
  }
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resetRecorder() {
  audioChunks = [];
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (event) => {
    console.log(`Data available`, event);
    audioChunks.push(event.data);
  };

  mediaRecorder.onstop = async () => {
    console.log(`Media recorder stopped`);
    // Remove recording class
    recordBtn.classList.remove("recording");
    recordBtn.classList.add("loading");
    recordBtn.textContent = "Imagining...";

    // Create audio blob and URL
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    const audioUrl = URL.createObjectURL(audioBlob);
    audioElement.src = audioUrl;

    // Transcribe
    statusMessage.textContent = "Transcribing...";
    statusMessage.style.display = "block";
    generateBtn.style.display = "none";
    const output = await transcriber(audioUrl);
    const text = Array.isArray(output) ? output[0].text : output.text;
    transcriptDiv.value = text;
    statusMessage.style.display = "none";
    generateBtn.style.display = "block";

    console.log(output);
    recordBtn.textContent = "Dreaming Up...";

    const abortWords = ["BLANK", "NO IMAGE", "NO STICKER", "CANCEL", "ABORT", "START OVER"];
    if(!text || abortWords.some(word => text.toUpperCase().includes(word))) {
      statusMessage.textContent = "Cancelled";
      statusMessage.style.display = "block";
      recordBtn.classList.remove("loading");
      recordBtn.textContent = "Cancelled";
      setTimeout(() => {
        recordBtn.textContent = "Sticker Dream";
        statusMessage.style.display = "none";
      }, 1000);
      generateBtn.style.display = "none";
      resetRecorder();
      return;
    }

    // Generate and print the image
    await generateAndPrint(text);

    // Stop loading state
    recordBtn.classList.remove("loading");
    recordBtn.textContent = "Printed!";
    setTimeout(() => {
      recordBtn.textContent = "Sticker Dream";
    }, 1000);
    resetRecorder();

  };
}

// Clear default text on first focus
const defaultText = "Press and hold the button to describe your sticker!\nOr type your idea here!";
transcriptDiv.addEventListener("focus", () => {
  if (transcriptDiv.value === defaultText) {
    transcriptDiv.value = "";
  }
});

// Check microphone access on load
checkMicrophoneAccess();
resetRecorder();

// Start recording when button is pressed down
recordBtn.addEventListener("pointerdown", async () => {
  // Reset audio chunks
  audioChunks = [];
  console.log(`Media recorder`, mediaRecorder);
  // Start recording
  mediaRecorder.start();
  console.log(`Media recorder started`);
  recordBtn.classList.add("recording");
  recordBtn.textContent = "Listening...";

  // Auto-stop after 5 seconds
  recordingTimeout = window.setTimeout(() => {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    }
  }, 15000);
});

// Stop recording when button is released
recordBtn.addEventListener("pointerup", () => {
  console.log(`Media recorder pointerup`);
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }

  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }
});

// Also stop if pointer leaves the button while held
recordBtn.addEventListener("pointerleave", () => {
  if (recordingTimeout) {
    clearTimeout(recordingTimeout);
    recordingTimeout = null;
  }

  if (mediaRecorder && mediaRecorder.state === "recording") {
    mediaRecorder.stop();
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }
});

// Prevent context menu on long press
recordBtn.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// Keyboard event handling for Ctrl+Enter (push-to-talk)
document.addEventListener("keydown", async (e) => {
  // Check for Ctrl+Enter (Cmd+Enter on Mac also works with ctrlKey)
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && !isRecordingViaKeyboard) {
    e.preventDefault();

    // Don't start recording if already recording or loading or no mediaRecorder
    if (!mediaRecorder || mediaRecorder.state === "recording" || recordBtn.classList.contains("loading")) {
      return;
    }

    isRecordingViaKeyboard = true;

    // Reset audio chunks
    audioChunks = [];
    console.log(`Media recorder (keyboard)`, mediaRecorder);

    // Start recording
    mediaRecorder.start();
    console.log(`Media recorder started (keyboard)`);
    recordBtn.classList.add("recording");
    recordBtn.textContent = "Listening...";

    // Auto-stop after 15 seconds
    recordingTimeout = window.setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
        isRecordingViaKeyboard = false;
      }
    }, 15000);
  }
});

document.addEventListener("keyup", (e) => {
  // Stop recording when either Ctrl or Enter is released
  if (isRecordingViaKeyboard && (e.key === "Control" || e.key === "Meta" || e.key === "Enter")) {
    e.preventDefault();
    console.log(`Media recorder keyup`);

    if (recordingTimeout) {
      clearTimeout(recordingTimeout);
      recordingTimeout = null;
    }

    if (mediaRecorder) {
      if (mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        mediaRecorder.stream.getTracks().forEach((track) => track.stop());
      } else {
        // If we released too quickly and recorder hasn't started, just reset the button
        recordBtn.classList.remove("recording");
        recordBtn.textContent = "Sticker Dream";
      }
    }

    isRecordingViaKeyboard = false;
  }
});

// Cancel button handler
cancelBtn.addEventListener("click", () => {
  if (currentAbortController) {
    currentAbortController.abort();
    recordBtn.classList.remove("loading");
    recordBtn.textContent = "Sticker Dream";
  }
});

// Generate button handler
generateBtn.addEventListener("click", async () => {
  const prompt = transcriptDiv.value.trim();
  if (prompt && prompt !== "Transcribing..." && prompt !== "No image generated.") {
    // Show loading state on both buttons
    generateBtn.classList.add("loading");
    generateBtn.textContent = "Generating...";
    recordBtn.classList.add("loading");
    recordBtn.textContent = "Dreaming Up...";

    await generateAndPrint(prompt);

    // Reset button states
    generateBtn.classList.remove("loading");
    generateBtn.textContent = "Generate";
    recordBtn.classList.remove("loading");
    recordBtn.textContent = "Sticker Dream";
  }
});

// Settings modal handlers
settingsBtn.addEventListener("click", () => {
  settingsModal.style.display = "flex";
});

closeBtn.addEventListener("click", () => {
  settingsModal.style.display = "none";
});

// Close modal when clicking outside
settingsModal.addEventListener("click", (e) => {
  if (e.target === settingsModal) {
    settingsModal.style.display = "none";
  }
});

// Update slider value display
safetyToleranceSlider.addEventListener("input", () => {
  safetyToleranceValue.textContent = safetyToleranceSlider.value;
});

// Show/hide FLUX settings based on model selection
modelSelect.addEventListener("change", () => {
  const showFluxSettings = modelSelect.value === 'flux' || modelSelect.value === 'all';
  fluxSettings.style.display = showFluxSettings ? 'block' : 'none';
});

// Save settings
saveBtn.addEventListener("click", () => {
  const newSettings: AppSettings = {
    model: modelSelect.value as 'gemini' | 'flux' | 'all',
    enableSafetyChecker: enableSafetyCheckbox.checked,
    safetyTolerance: parseInt(safetyToleranceSlider.value),
    autoPrint: autoPrintCheckbox.checked,
    forKids: forKidsCheckbox.checked,
    lineStyle: lineStyleSelect.value as 'default' | 'sharpie' | 'stencil' | 'coloring-book'
  };

  saveSettings(newSettings);
  settingsModal.style.display = "none";
  showToast("Settings saved!", 'success', 3000);
});

// Print a single image
async function printImage(imageData: string, model: string) {
  try {
    const response = await fetch("/api/print", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ imageData }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Print failed');
    }

    showToast(`${model.toUpperCase()} image sent to printer!`, 'success', 3000);
  } catch (error) {
    console.error("Print error:", error);
    showToast(`Failed to print ${model} image`, 'error', 5000);
  }
}

// Generate and print image from transcript
async function generateAndPrint(prompt: string) {
  if (!prompt || prompt === "Transcribing...") {
    console.error("No valid prompt to generate");
    return;
  }

  try {
    const printText = currentSettings.autoPrint ? "Generating & Printing..." : "Generating...";
    statusMessage.textContent = printText;
    statusMessage.style.display = "block";
    generateBtn.style.display = "none";
    cancelBtn.style.display = "block";

    // Create abort controller for this request
    currentAbortController = new AbortController();

    const response = await fetch("/api/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        model: currentSettings.model,
        enableSafetyChecker: currentSettings.enableSafetyChecker,
        safetyTolerance: currentSettings.safetyTolerance,
        autoPrint: currentSettings.autoPrint,
        forKids: currentSettings.forKids,
        lineStyle: currentSettings.lineStyle
      }),
      signal: currentAbortController.signal
    });

    if (!response.ok) {
      // Try to parse error details from JSON response
      const contentType = response.headers.get("content-type");
      if (contentType?.includes("application/json")) {
        const errorData = await response.json();
        throw new Error(errorData.error || `Server error: ${response.statusText}`);
      }
      throw new Error(`Server error: ${response.statusText}`);
    }

    const data = await response.json();

    // Clear previous images
    imagesContainer.innerHTML = '';
    imagesContainer.style.display = 'flex';

    // Display all images
    data.images.forEach((img: { data: string, model: string }) => {
      const imageCard = document.createElement('div');
      imageCard.className = 'image-card';

      const header = document.createElement('div');
      header.className = 'image-card-header';

      const modelName = document.createElement('span');
      modelName.textContent = img.model.toUpperCase();
      header.appendChild(modelName);

      // Add print button if auto-print is disabled
      if (!currentSettings.autoPrint) {
        const printBtn = document.createElement('button');
        printBtn.className = 'print-btn';
        printBtn.innerHTML = `<svg width="24" height="24" viewBox="0 0 8 8" xmlns="http://www.w3.org/2000/svg">
          <rect x="2" y="0" width="4" height="1" fill="currentColor"/>
          <rect x="1" y="1" width="1" height="1" fill="currentColor"/>
          <rect x="6" y="1" width="1" height="1" fill="currentColor"/>
          <rect x="0" y="2" width="1" height="3" fill="currentColor"/>
          <rect x="7" y="2" width="1" height="3" fill="currentColor"/>
          <rect x="1" y="2" width="6" height="1" fill="currentColor"/>
          <rect x="2" y="4" width="4" height="1" fill="currentColor"/>
          <rect x="1" y="5" width="1" height="3" fill="currentColor"/>
          <rect x="6" y="5" width="1" height="3" fill="currentColor"/>
          <rect x="2" y="5" width="4" height="2" fill="currentColor"/>
          <rect x="2" y="7" width="4" height="1" fill="currentColor"/>
        </svg>`;
        printBtn.setAttribute('aria-label', 'Print this image');
        printBtn.addEventListener('click', () => {
          printBtn.disabled = true;
          const originalHTML = printBtn.innerHTML;
          printBtn.innerHTML = '<span style="font-size: 20px;">●</span>';
          printImage(img.data, img.model).finally(() => {
            printBtn.disabled = false;
            printBtn.innerHTML = originalHTML;
          });
        });
        header.appendChild(printBtn);
      }

      imageCard.appendChild(header);

      const image = document.createElement('img');
      image.src = `data:image/png;base64,${img.data}`;
      imageCard.appendChild(image);

      imagesContainer.appendChild(imageCard);
    });

    statusMessage.style.display = "none";
    cancelBtn.style.display = "none";
    generateBtn.style.display = "block";
    console.log("✅ Image(s) generated!");
  } catch (error) {
    console.error("Error:", error);

    // Check if it was aborted
    if (error instanceof Error && error.name === 'AbortError') {
      statusMessage.textContent = "Cancelled";
      statusMessage.style.display = "block";
      setTimeout(() => {
        statusMessage.style.display = "none";
      }, 2000);
      cancelBtn.style.display = "none";
      generateBtn.style.display = "block";
      return;
    }

    let errorMessage = error instanceof Error ? error.message : "Unknown error";

    // Try to parse if it's a JSON error and extract the message
    try {
      const parsed = JSON.parse(errorMessage);
      if (parsed.message) {
        errorMessage = parsed.message;
      }
    } catch {
      // Not JSON, use the message as-is
    }

    statusMessage.textContent = "❌ Error generating image";
    statusMessage.style.display = "block";
    cancelBtn.style.display = "none";
    generateBtn.style.display = "block";
    showToast(errorMessage, 'error', 7000);

    setTimeout(() => {
      statusMessage.style.display = "none";
    }, 3000);
  } finally {
    currentAbortController = null;
  }
}
