# Sticker Dream

![](./dream.png)

A voice-activated sticker printer. Press and hold the button, describe what you want, and it generates a black and white coloring page sticker that prints to a thermal printer — instantly, no dialog, no fuss.

## How it works

1. Hold the button and speak (or type) your idea
2. Whisper transcribes your voice in the browser
3. One or more AI models generate a coloring-page style sticker
4. Image displays and prints automatically to your USB printer via CUPS

## Setup

1. Install dependencies:

```bash
pnpm install
```

2. Copy `.env.example` to `.env` and fill in your API keys:

```bash
cp .env.example .env
```

You'll need at minimum a `GEMINI_API_KEY`. Other keys unlock additional models (Replicate for FLUX, OpenRouter for others).

3. Connect a USB thermal printer.

## Running (dev mode)

Two terminals:

```bash
# Terminal 1 — backend on :3000
pnpm server

# Terminal 2 — frontend on :7767 (proxies /api to :3000)
pnpm dev
```

Open `http://localhost:7767`.

## Running (production / single port)

Build the frontend first, then the backend serves everything on one port:

```bash
pnpm run all
```

Open `http://localhost:3000`. This is also what you use when running at a show.

## Running publicly via Cloudflare Tunnel

Lets people visit a public URL (e.g. `https://sticker-dream.withgoogle.app`) and generate stickers that print at your local station.

### One-time Cloudflare setup

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Zero Trust → Networks → Tunnels → Create a tunnel
2. Name it (e.g. `sticker-dream`)
3. Under **Public Hostname**, set the service to `http://host.docker.internal:3000`
4. Copy the tunnel token and add it to your `.env`:

```
CLOUDFLARE_TUNNEL_TOKEN=eyJ...
```

### At every show

```bash
# Terminal 1 — backend + built frontend (needs CUPS/printer access, runs natively)
pnpm run all

# Terminal 2 — Cloudflare tunnel
docker compose up
```

That's it. Your public URL is live and prints come out at the station.

## Settings

Click the gear icon to access:

- **Models** — choose which AI model(s) to use (Gemini, FLUX, etc.). Multiple models generate side by side.
- **Auto Print** — when on, prints immediately after generating. When off, a print button appears on each image.
- **For Kids** — adds a safety prompt modifier to keep things appropriate.
- **Line Style** — changes the drawing style: Default, Sharpie, Stencil, or Coloring Book.
- **Safety Checker** — toggle FLUX's built-in safety filter and set tolerance level.
- **Inspiration Gallery** — scrolling ticker of past generations. Toggle on/off and control scroll speed.

## Printer management (CUPS)

The app uses CUPS (built into macOS) to print. Useful commands:

```bash
# See what's in the print queue
lpstat -o

# Cancel a specific job (use the job name from lpstat -o)
cancel PM-241-BT-924

# Cancel ALL jobs on a printer
cancel -a PM-241-BT-924

# List all printers CUPS knows about
lpstat -p

# See which printer is the default
lpstat -d

# Check if a printer is online/offline
lpstat -p PrinterName
```

If prints are going to the wrong (offline) printer, cancel all jobs on it and plug in the correct one.

## Cancelling a generation

Say "CANCEL", "ABORT", or "START OVER" as part of your recording, or click the cancel button that appears during generation.

## Printers

TLDR: [The Phomemo](https://amzn.to/4hOmqki) PM-241 works great over USB.

Any USB printer that CUPS supports will work. The app detects connected USB printers automatically and only prints to ones that are currently online — so swapping printers mid-show works fine.

Thermal printers are ideal: fast, cheap, no ink. 4x6 shipping labels give you a good sticker size.
