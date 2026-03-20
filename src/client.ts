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
const modelCheckboxes = document.querySelectorAll(".model-checkbox") as NodeListOf<HTMLInputElement>;
const safetyToleranceSlider = document.querySelector("#safety-tolerance") as HTMLInputElement;
const safetyToleranceValue = document.querySelector(".slider-value") as HTMLSpanElement;
const enableSafetyCheckbox = document.querySelector("#enable-safety") as HTMLInputElement;
const autoPrintCheckbox = document.querySelector("#auto-print") as HTMLInputElement;
const forKidsCheckbox = document.querySelector("#for-kids") as HTMLInputElement;
const lineStyleSelect = document.querySelector("#line-style") as HTMLSelectElement;
const fluxSettings = document.querySelector(".flux-settings") as HTMLDivElement;
const showInspirationCheckbox = document.querySelector("#show-inspiration") as HTMLInputElement;
const inspirationSpeedSlider = document.querySelector("#inspiration-speed") as HTMLInputElement;
const speedValue = document.querySelector("#speed-value") as HTMLSpanElement;
const inspirationSection = document.querySelector(".inspiration-section") as HTMLDivElement;
const inspirationGallery = document.querySelector(".inspiration-gallery") as HTMLDivElement;

let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let recordingTimeout: number | null = null;
let currentAbortController: AbortController | null = null;
let isRecordingViaKeyboard = false;

// Settings state
interface AppSettings {
  models: string[]; // Array of selected model names
  enableSafetyChecker: boolean;
  safetyTolerance: number;
  autoPrint: boolean;
  forKids: boolean;
  lineStyle: 'default' | 'sharpie' | 'stencil' | 'coloring-book';
  showInspiration: boolean;
  inspirationSpeed: number;
}

const DEFAULT_SETTINGS: AppSettings = {
  models: ['gemini'], // Default to just Gemini
  enableSafetyChecker: true,
  safetyTolerance: 2,
  autoPrint: true,
  forKids: true,
  lineStyle: 'default',
  showInspiration: true,
  inspirationSpeed: 60
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
  // Update model checkboxes
  modelCheckboxes.forEach(checkbox => {
    const modelName = checkbox.getAttribute('data-model');
    checkbox.checked = currentSettings.models.includes(modelName || '');
  });

  safetyToleranceSlider.value = currentSettings.safetyTolerance.toString();
  safetyToleranceValue.textContent = currentSettings.safetyTolerance.toString();
  enableSafetyCheckbox.checked = currentSettings.enableSafetyChecker;
  autoPrintCheckbox.checked = currentSettings.autoPrint;
  forKidsCheckbox.checked = currentSettings.forKids;
  lineStyleSelect.value = currentSettings.lineStyle;
  showInspirationCheckbox.checked = currentSettings.showInspiration;
  inspirationSpeedSlider.value = currentSettings.inspirationSpeed.toString();
  speedValue.textContent = `${currentSettings.inspirationSpeed}s`;

  // Show/hide FLUX settings based on selected models
  const hasFluxModel = currentSettings.models.includes('flux');
  fluxSettings.style.display = hasFluxModel ? 'block' : 'none';

  // Apply inspiration settings
  applyInspirationSettings();
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

// Apply inspiration settings (show/hide and speed)
function applyInspirationSettings() {
  // Show/hide inspiration section
  if (!currentSettings.showInspiration) {
    inspirationSection.style.display = "none";
    return;
  }

  // Update animation speed
  const scrollWrapper = document.querySelector(".inspiration-scroll-wrapper") as HTMLElement;
  if (scrollWrapper) {
    scrollWrapper.style.animationDuration = `${currentSettings.inspirationSpeed}s`;
  }

  // Only show if we have content
  if (inspirationGallery.children.length > 0) {
    inspirationSection.style.display = "block";
  }
}

// Fetch and display inspiration ideas
async function loadInspirationGallery() {
  try {
    const response = await fetch("/api/inspiration?count=50");
    const data = await response.json();

    if (!data.ideas || data.ideas.length === 0) {
      // No ideas yet, hide the section
      inspirationSection.style.display = "none";
      return;
    }

    // Clear existing content
    inspirationGallery.innerHTML = "";

    // Create an inner wrapper for the scrolling items
    const scrollWrapper = document.createElement("div");
    scrollWrapper.className = "inspiration-scroll-wrapper";

    // Function to create an item element
    const createItem = (idea: { prompt: string; image: string; timestamp: string }) => {
      const item = document.createElement("div");
      item.className = "inspiration-item";

      const img = document.createElement("img");
      img.src = `data:image/png;base64,${idea.image}`;
      img.alt = idea.prompt;

      const prompt = document.createElement("p");
      prompt.textContent = idea.prompt;

      item.appendChild(img);
      item.appendChild(prompt);

      // Click to use this idea
      item.addEventListener("click", () => {
        transcriptDiv.value = idea.prompt;
        // Scroll to the textarea
        transcriptDiv.scrollIntoView({ behavior: "smooth", block: "center" });
        // Flash the textarea to show it was updated
        transcriptDiv.classList.add("flash");
        setTimeout(() => transcriptDiv.classList.remove("flash"), 500);
      });

      return item;
    };

    // Add items twice for seamless infinite scrolling
    data.ideas.forEach((idea: { prompt: string; image: string; timestamp: string }) => {
      scrollWrapper.appendChild(createItem(idea));
    });

    // Duplicate items for seamless loop
    data.ideas.forEach((idea: { prompt: string; image: string; timestamp: string }) => {
      scrollWrapper.appendChild(createItem(idea));
    });

    // Add the wrapper to the gallery
    inspirationGallery.appendChild(scrollWrapper);

    // Start auto-scrolling animation with current speed
    scrollWrapper.classList.add("auto-scroll");
    scrollWrapper.style.animationDuration = `${currentSettings.inspirationSpeed}s`;

    // Show the section (if enabled in settings)
    if (currentSettings.showInspiration) {
      inspirationSection.style.display = "block";
    } else {
      inspirationSection.style.display = "none";
    }
  } catch (error) {
    console.error("Failed to load inspiration:", error);
    inspirationSection.style.display = "none";
  }
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
  // Clean up old recorder if it exists
  if (mediaRecorder && mediaRecorder.stream) {
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
  }

  audioChunks = [];
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  mediaRecorder.ondataavailable = (event) => {
    console.log(`Data available`, event);
    audioChunks.push(event.data);
  };

  mediaRecorder.onstop = async () => {
    console.log(`Media recorder stopped, audio chunks:`, audioChunks.length);
    // Remove recording class
    recordBtn.classList.remove("recording");
    recordBtn.classList.add("loading");
    recordBtn.textContent = "Imagining...";

    // Check if we have audio data
    if (audioChunks.length === 0) {
      console.error("No audio data captured");
      recordBtn.classList.remove("loading");
      recordBtn.textContent = "Sticker Dream";
      showToast("No audio captured. Try holding the button longer.", 'error');
      resetRecorder();
      return;
    }

    // Create audio blob and URL
    const audioBlob = new Blob(audioChunks, { type: "audio/webm" });
    console.log(`Audio blob size: ${audioBlob.size} bytes`);

    if (audioBlob.size === 0) {
      console.error("Audio blob is empty");
      recordBtn.classList.remove("loading");
      recordBtn.textContent = "Sticker Dream";
      showToast("No audio captured. Try holding the button longer.", 'error');
      resetRecorder();
      return;
    }

    const audioUrl = URL.createObjectURL(audioBlob);
    audioElement.src = audioUrl;

    // Transcribe
    let text: string;
    try {
      statusMessage.textContent = "Transcribing...";
      statusMessage.style.display = "block";
      generateBtn.style.display = "none";
      console.log("Starting transcription...");
      const output = await transcriber(audioUrl);
      console.log("Transcription complete:", output);
      text = Array.isArray(output) ? output[0].text : output.text;
      transcriptDiv.value = text;
      statusMessage.style.display = "none";
      generateBtn.style.display = "block";
      recordBtn.textContent = "Dreaming Up...";
    } catch (error) {
      console.error("Transcription error:", error);
      recordBtn.classList.remove("loading");
      recordBtn.textContent = "Sticker Dream";
      statusMessage.style.display = "none";
      showToast("Transcription failed. Please try again.", 'error');
      resetRecorder();
      return;
    }

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
    console.log("Calling generateAndPrint with text:", text);
    await generateAndPrint(text);
    console.log("generateAndPrint completed");

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
loadInspirationGallery();

// Start recording when button is pressed down
recordBtn.addEventListener("pointerdown", async () => {
  // Don't start if already recording
  if (mediaRecorder && mediaRecorder.state === "recording") {
    return;
  }

  // Reset audio chunks
  audioChunks = [];
  console.log(`Media recorder`, mediaRecorder);
  // Start recording with 100ms timeslice to ensure data is captured
  mediaRecorder.start(100);
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
    // Don't stop tracks immediately - let the onstop handler deal with it
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
    // Don't stop tracks immediately - let the onstop handler deal with it
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

    // Start recording with 100ms timeslice to ensure data is captured
    mediaRecorder.start(100);
    console.log(`Media recorder started (keyboard)`);
    recordBtn.classList.add("recording");
    recordBtn.textContent = "Listening...";

    // Auto-stop after 15 seconds
    recordingTimeout = window.setTimeout(() => {
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        // Don't stop tracks immediately - let the onstop handler deal with it
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
        // Don't stop tracks immediately - let the onstop handler deal with it
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

inspirationSpeedSlider.addEventListener("input", () => {
  speedValue.textContent = `${inspirationSpeedSlider.value}s`;
});

// Show/hide FLUX settings based on model selection
modelCheckboxes.forEach(checkbox => {
  checkbox.addEventListener("change", () => {
    const selectedModels = Array.from(modelCheckboxes)
      .filter(cb => cb.checked)
      .map(cb => cb.getAttribute('data-model') || '');

    const hasFluxModel = selectedModels.includes('flux');
    fluxSettings.style.display = hasFluxModel ? 'block' : 'none';
  });
});

// Save settings
saveBtn.addEventListener("click", () => {
  // Get selected models from checkboxes
  const selectedModels = Array.from(modelCheckboxes)
    .filter(cb => cb.checked)
    .map(cb => cb.getAttribute('data-model') || '');

  if (selectedModels.length === 0) {
    showToast("Please select at least one model", 'error', 3000);
    return;
  }

  const newSettings: AppSettings = {
    models: selectedModels,
    enableSafetyChecker: enableSafetyCheckbox.checked,
    safetyTolerance: parseInt(safetyToleranceSlider.value),
    autoPrint: autoPrintCheckbox.checked,
    forKids: forKidsCheckbox.checked,
    lineStyle: lineStyleSelect.value as 'default' | 'sharpie' | 'stencil' | 'coloring-book',
    showInspiration: showInspirationCheckbox.checked,
    inspirationSpeed: parseInt(inspirationSpeedSlider.value)
  };

  saveSettings(newSettings);
  applyInspirationSettings(); // Apply inspiration settings immediately
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

  // Hide inspiration gallery while generating
  inspirationSection.style.display = "none";

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
        models: currentSettings.models,
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
    console.log("Received data from API:", data);

    // Clear previous images
    imagesContainer.innerHTML = '';
    imagesContainer.style.display = 'flex';
    console.log("Images container display set to flex");

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
    console.log(`Appended ${data.images.length} image(s) to container`);

    statusMessage.style.display = "none";
    cancelBtn.style.display = "none";
    generateBtn.style.display = "block";
    console.log("✅ Image(s) generated!");

    // Show inspiration gallery again after 5 seconds
    setTimeout(() => {
      if (currentSettings.showInspiration) {
        inspirationSection.style.display = "block";
      }
    }, 5000);
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

      // Show inspiration gallery back immediately on cancel
      if (currentSettings.showInspiration) {
        inspirationSection.style.display = "block";
      }
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

    // Show inspiration gallery back immediately on error
    if (currentSettings.showInspiration) {
      inspirationSection.style.display = "block";
    }
  } finally {
    currentAbortController = null;
  }
}
