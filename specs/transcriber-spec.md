# Local Transcriber App — Technical Specification

A fully local, privacy-first audio transcription tool. Audio never leaves the machine. Runs on `localhost` with no external API calls, no auth, and no hosting cost.

---

## Stack

### Backend
| Concern | Library | Version |
|---|---|---|
| HTTP server | `fastapi` | latest |
| ASGI server | `uvicorn` | latest |
| Transcription | `faster-whisper` | latest |
| Whisper model | `large-v3` | via faster-whisper auto-download |
| Summarization | `llama-cpp-python` | latest (Metal build on Apple Silicon) |
| LLM model | Phi-4 14B Q8_0 GGUF | ~14GB, converted from `microsoft/phi-4` via `llama.cpp` |
| Output formats | plain `.txt` and `.md` (no dependencies) | — |
| File upload | `python-multipart` | latest |
| Runtime | Python 3.11+ | |

### Frontend
| Concern | Tool |
|---|---|
| Framework | React 18 + Vite |
| Language | TypeScript |
| Styling | TailwindCSS v3 (plain, no component library) |
| Icons | `lucide-react` |
| HTTP | native `fetch` |

---

## Project Structure

```
local-transcriber-app/
├── specs/
│   └── transcriber-spec.md        # this file
├── backend/
│   ├── main.py                    # FastAPI app, CORS, route registration, lifespan
│   ├── transcriber.py             # faster-whisper wrapper
│   ├── summarizer.py              # llama-cpp-python wrapper
│   ├── job_store.py               # in-memory job state + TTL cleanup
│   ├── models/                    # GGUF model file (gitignored)
│   │   └── .gitkeep
│   ├── tmp/                       # temp audio + output files (gitignored)
│   │   └── .gitkeep
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── tsconfig.json
│   ├── package.json
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       └── components/
│           ├── UploadCard.tsx     # file picker + options form
│           ├── ProgressBar.tsx    # job status polling + progress display
│           └── DownloadPanel.tsx  # download button + reset
└── start.sh                       # launches backend + frontend concurrently
```

---

## API Specification

### `GET /health`
Check if models are loaded and the server is ready.

**Response** `200 OK` — models loaded, ready to accept jobs
```json
{ "status": "ready" }
```
**Response** `503 Service Unavailable` — still loading
```json
{ "status": "loading" }
```
Frontend polls this on page load and shows a loading state until ready.

---

### `POST /transcribe`
Submit an audio file for processing.

**Request** — `multipart/form-data`
| Field | Type | Required | Description |
|---|---|---|---|
| `audio` | file | ✅ | Audio file — validated by MIME type, not extension (see accepted types below) |
| `output_format` | string | ✅ | `"txt"` or `"md"` |
| `summarize` | boolean | ✅ | `true` = transcribe + summarize, `false` = transcribe only |

**Accepted MIME types**
| Format | MIME type |
|---|---|
| MP3 | `audio/mpeg` |
| WAV | `audio/wav` |
| M4A | `audio/mp4` |
| OGG | `audio/ogg` |
| FLAC | `audio/flac` |
| WebM | `audio/webm` |

**Response** `200 OK`
```json
{ "job_id": "a1b2c3d4" }
```

**Error responses**
| Status | Reason |
|---|---|
| `400` | Unsupported MIME type or missing fields |
| `413` | File exceeds size limit (200MB) |
| `503` | Models not yet loaded |

---

### `GET /status/{job_id}`
Poll job status.

**Response** `200 OK`
```json
{
  "job_id": "a1b2c3d4",
  "status": "queued" | "transcribing" | "summarizing" | "complete" | "error",
  "progress": 0,
  "error": null
}
```
- `progress` is `0–100`, updated per chunk during transcription
- `error` is a string message when `status == "error"`, otherwise `null`

**Error responses**
| Status | Reason |
|---|---|
| `404` | Unknown job_id (never existed or already cleaned up) |

---

### `GET /download/{job_id}`
Download the completed output file. **Deletes all temp files for the job after response is sent.**

**Response** `200 OK`
- `Content-Type`: `text/plain` for both formats
- `Content-Disposition`: `attachment; filename="transcript.txt"` / `"transcript.md"` / `"summary.txt"` / `"summary.md"`

**Error responses**
| Status | Reason |
|---|---|
| `404` | Unknown or already-downloaded job |
| `409` | Job not yet complete |

---

## Data Models

### Job (internal, in-memory)
```python
@dataclass
class Job:
    job_id: str
    status: Literal["queued", "transcribing", "summarizing", "complete", "error"]
    progress: int                  # 0–100
    output_format: Literal["txt", "md"]
    summarize: bool
    audio_path: Path               # temp input file
    output_path: Path | None       # temp output file (set on complete)
    transcript: str | None         # set after transcription; passed to summarizer
    created_at: datetime
    error: str | None
```

---

## Processing Pipeline

```
1. POST /transcribe received
   → validate file type + fields
   → save audio to backend/tmp/{job_id}_audio.{ext}
   → create Job(status="queued") in job store
   → return { job_id }
   → BackgroundTask starts

2. BackgroundTask
   a. acquire semaphore (blocks if another job is running)
   b. status = "transcribing"
      → faster-whisper transcribes audio
      → progress updated per segment (0→80)
   c. store transcript text on job.transcript
   d. if summarize == true:
         status = "summarizing"
         → truncate transcript if > ~12,000 words
         → llama-cpp-python summarizes transcript text
         → progress = 90
   e. generate output file (txt or md — no extra libs needed, pure string write)
      → if summarize == false: progress jumps 80 → 100 directly
      → if summarize == true:  progress goes 90 → 100
      → status = "complete", store output_path on job
   f. release semaphore
   on error:
      → status = "error", store error message
      → delete audio_path (no output_path to delete)
      → release semaphore

3. GET /download/{job_id}
   → stream file as response
   → BackgroundTask: delete audio_path + output_path
   → mark job as downloaded (404 on repeat calls)
```

---

## Transcriber Module (`transcriber.py`)

- Model: `large-v3`, loaded once at app startup via FastAPI `lifespan`
- Device: `"cpu"` on Apple Silicon (faster-whisper does not support Metal; ARM NEON is used automatically)
- Device: `"cuda"` on Linux/Windows with NVIDIA GPU; `"cpu"` otherwise
- Compute type: `"int8"` on CPU, `"float16"` on CUDA
- Returns: full transcript string + per-segment progress callback

---

## Summarizer Module (`summarizer.py`)

- Model: `phi-4-Q8_0.gguf` from `backend/models/`
- Source: converted from `microsoft/phi-4` (official) via `llama.cpp convert_hf_to_gguf.py`
- Loaded once at app startup via FastAPI `lifespan`
- Apple Silicon: installed with `CMAKE_ARGS="-DGGML_METAL=on"`
- Context window: `n_ctx=16384` (Phi-4 max; handles ~12,000 word transcripts)
- `n_gpu_layers=-1` — offloads all layers to Metal GPU on Apple Silicon; required for GPU acceleration (without this, runs on CPU even with Metal compiled in)
- `max_tokens=1024` — caps summary output length; prevents unbounded generation
- `temperature=0.3` — consistent, factual summaries with slight creative flexibility
- Truncation: if transcript exceeds ~12,000 words, truncate to last N tokens before summarizing (preserves conclusion over intro)
- Prompt template (Phi-4 ChatML format):
```
<|im_start|>system<|im_sep|>You are a helpful assistant that summarizes transcripts concisely.<|im_end|><|im_start|>user<|im_sep|>Summarize the following transcript in clear, concise paragraphs:

{transcript}<|im_end|><|im_start|>assistant<|im_sep|>
```

---

## Output Formatter

No external library needed — both formats are plain text writes:
- **`.txt`**: raw text, written as-is
- **`.md`**: wrapped in minimal markdown — `# Transcript` / `# Summary` heading + body paragraphs

---

## Job Store (`job_store.py`)

- Plain `dict` keyed by `job_id` (UUID4)
- Access guarded by a `threading.Lock` to prevent race conditions between background tasks and API reads
- TTL cleanup: background thread checks every 5 minutes, deletes jobs + files older than 1 hour that were never downloaded
- No persistence — jobs lost on server restart (acceptable for local single-user tool)

## Concurrency

- A single `asyncio.Semaphore(1)` gates all inference — only one job runs at a time (`llama-cpp-python` is not thread-safe)
- `faster-whisper` is similarly serialized via the same semaphore (one transcription at a time)
- Semaphore initialized inside the FastAPI `lifespan` function (not at module level) to ensure it is created within the active event loop
- Jobs queue naturally via FastAPI `BackgroundTasks`; status reflects `"queued"` until the semaphore is acquired

---

## Frontend UI Flow

```
[App — on page load]
  - Polls GET /health every 2 seconds until { status: "ready" }
  - Shows spinner + "Loading models..." message while loading
  - Upload form disabled until ready

[UploadCard]
  - Drag-and-drop or file picker (accepts audio/*)
  - Toggle: "Transcription only" | "Transcription + Summary"
  - Toggle: "TXT" | "Markdown"
  - Submit button → POST /transcribe → receive job_id

[ProgressBar]  (shown after submit)
  - Polls GET /status/{job_id} every 2 seconds
  - Displays status label + animated progress bar
  - On error: shows error message + reset button

[DownloadPanel]  (shown on complete)
  - Single "Download" button → GET /download/{job_id}
  - After download: shows "Start over" button to reset state
```

---

## File Cleanup Rules

| Event | Action |
|---|---|
| `GET /download/{job_id}` completes | Delete audio + output files, mark job downloaded |
| Job errors during processing | Delete audio_path immediately; no output_path exists |
| Job age > 1 hour, never downloaded | TTL cleanup deletes files + job entry |
| Server startup | Clear all contents of `backend/tmp/` (stale files from previous run) |

---

## Setup

### Prerequisites
- `backend/models/phi-4-Q8_0.gguf` (~15.6GB) — already converted ✅
- Whisper `large-v3` — downloaded automatically by `faster-whisper` on first use (~3GB)

### Install dependencies
```bash
# Create and activate virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Backend
pip install -r backend/requirements.txt

# Apple Silicon — Metal-accelerated llama-cpp-python
CMAKE_ARGS="-DGGML_METAL=on" pip install llama-cpp-python

# Frontend
cd frontend && npm install
```

**`backend/requirements.txt`**
```
fastapi
uvicorn[standard]
faster-whisper
python-multipart
```
*(`llama-cpp-python` installed separately above due to build flags)*

### `start.sh` behaviour
Launches backend + frontend as concurrent processes. Ctrl+C kills both.
```bash
#!/bin/bash
source .venv/bin/activate
trap 'kill 0' SIGINT
# No --reload: models take ~60s to load; reloading on every file change is unusable
uvicorn backend.main:app --host 127.0.0.1 --port 8000 &
npm --prefix frontend run dev &
wait
```
Make executable once: `chmod +x start.sh`

### Run
```bash
./start.sh
# Backend:  http://localhost:8000
# Frontend: http://localhost:5173
```

---

## CORS
FastAPI configured to allow `http://localhost:5173` only (Vite dev server). No wildcard origins.

---

## Frontend Environment

**`frontend/.env`**
```
VITE_API_URL=http://localhost:8000
```
All `fetch` calls use `import.meta.env.VITE_API_URL` as the base URL rather than hardcoding `localhost:8000`.

---

## `.gitignore` additions
```
backend/models/
backend/tmp/
.venv/
frontend/.env
```
