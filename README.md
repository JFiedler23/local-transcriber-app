# Local Transcriber

Private, on-device audio transcription and summarization. No audio or text ever leaves your machine.

![Local Transcriber](local_transcriber_screenshot.png)

## Features

- Transcribe audio files (MP3, WAV, M4A, OGG, FLAC, WebM) using Whisper large-v3
- Optionally summarize transcripts using Llama-3.1-8B-Instruct running locally via llama.cpp
- Download results as plain text or Markdown
- Jobs are queued and processed one at a time; temporary files are cleaned up automatically

## Requirements

- macOS (Apple Silicon recommended — Metal is used for both Whisper and Llama inference)
- Python 3.11+
- Node.js 18+
- [ffmpeg](https://ffmpeg.org/) (required by pywhispercpp to decode audio)
- The Llama-3.1-8B-Instruct Q4_K_M GGUF model at `backend/models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf` (~4.7 GB)

## First-time setup

```bash
# 1. Install ffmpeg (required by pywhispercpp to decode audio)
brew install ffmpeg

# 2. Create and activate a Python virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install Python dependencies
pip install -r backend/requirements.txt

# 4. Install llama-cpp-python with Metal support
CMAKE_ARGS="-DGGML_METAL=on" pip install llama-cpp-python

# 5. Install frontend dependencies
npm install --prefix frontend
```

Place your `Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf` file at:
```
backend/models/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf
```

The Whisper `large-v3` model (~3.1 GB) is downloaded automatically to `~/Library/Application Support/pywhispercpp/models/` on first run.

## Running

```bash
./start.sh
```

This starts both servers:
- Backend API: `http://localhost:8000`
- Frontend UI: `http://localhost:5173`

Open `http://localhost:5173` in your browser. The UI shows a loading spinner while models are initializing (typically 5–15 seconds), then presents the upload form.

Press **Ctrl+C** to stop both servers.

## Architecture

```
local-transcriber-app/
├── backend/
│   ├── main.py          # FastAPI app — routes, lifespan, background job runner
│   ├── job_store.py     # In-memory job store with threading.Lock and TTL cleanup
│   ├── transcriber.py   # Whisper large-v3 via pywhispercpp / whisper.cpp (Metal)
│   ├── summarizer.py    # Llama-3.1-8B-Instruct Q4_K_M via llama-cpp-python (Metal)
│   ├── models/          # GGUF model file (gitignored)
│   └── tmp/             # Ephemeral audio and output files (gitignored)
├── frontend/
│   └── src/
│       ├── App.tsx                      # State machine: loading → idle → processing → complete/error
│       └── components/
│           ├── UploadCard.tsx           # Drag-and-drop upload, format/mode toggles
│           ├── ProgressBar.tsx          # Polling /status every 2s, indeterminate then determinate
│           └── DownloadPanel.tsx        # Download trigger and reset
└── start.sh             # Starts uvicorn + Vite dev server, kill -9 on Ctrl+C
```

### Request flow

1. User selects a file, output format (TXT/Markdown), and mode (transcript only or transcript + summary)
2. `POST /transcribe` — file is saved to `backend/tmp/`, a job is created and queued
3. A background task acquires the inference semaphore (serializes jobs) and runs transcription in a thread pool executor so the event loop stays unblocked
4. If summarization is requested, Llama-3.1-8B runs after transcription completes
5. Frontend polls `GET /status/{job_id}` every 2 seconds; progress advances 0→80% during transcription, 80→100% during summarization
6. On completion, `GET /download/{job_id}` returns the file and schedules cleanup of all temporary files for that job

### Models

| Model | Purpose | Runtime | Approximate memory |
|---|---|---|---|
| Whisper large-v3 | Transcription | pywhispercpp / whisper.cpp (Metal) | ~3.1 GB |
| Llama-3.1-8B-Instruct Q4_K_M | Summarization | llama-cpp-python / Metal | ~4.7 GB |

### Known behavior

- **Transcription speed**: Whisper large-v3 runs via whisper.cpp with Metal acceleration on Apple Silicon. The Whisper model auto-downloads (~3.1 GB) to `~/Library/Application Support/pywhispercpp/models/` on first startup. Rough speed: ~15–20× realtime on Apple Silicon.
- **Summarization**: Llama-3.1-8B must run with `verbose=True` in llama-cpp-python; `verbose=False` suppresses file descriptors in a way that breaks Metal inference on macOS.
- **Job queue**: Only one job runs at a time. A second upload while a job is in progress will queue and start automatically when the first finishes.
