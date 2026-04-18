import asyncio
import logging
import shutil
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import BackgroundTasks, FastAPI, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from job_store import JobStore, _safe_delete
from summarizer import Summarizer
from transcriber import Transcriber

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("transcriber")

TMP_DIR = Path(__file__).parent / "tmp"

ACCEPTED_MIME_TYPES = {
    "audio/mpeg",
    "audio/wav",
    "audio/mp4",
    "audio/ogg",
    "audio/flac",
    "audio/webm",
    "audio/x-wav",
    "audio/x-m4a",
    "video/webm",
}

store = JobStore()
transcriber: Transcriber | None = None
summarizer: Summarizer | None = None
inference_semaphore: asyncio.Semaphore | None = None
models_ready = False


@asynccontextmanager
async def lifespan(app: FastAPI):
    global transcriber, summarizer, inference_semaphore, models_ready

    TMP_DIR.mkdir(exist_ok=True)
    for f in TMP_DIR.iterdir():
        _safe_delete(f)

    inference_semaphore = asyncio.Semaphore(1)

    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _load_models)
        models_ready = True
        logger.info("Models loaded — server ready")
    except Exception as exc:
        logger.error(f"Failed to load models: {exc}", exc_info=True)

    yield

    models_ready = False


def _load_models():
    global transcriber, summarizer
    logger.info("Loading Whisper large-v3...")
    transcriber = Transcriber()
    logger.info("Whisper loaded.")
    logger.info("Loading Phi-4 Q8_0 (this may take a moment)...")
    summarizer = Summarizer()
    logger.info("Phi-4 loaded.")


app = FastAPI(title="Local Transcriber", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)


@app.get("/health")
async def health():
    if models_ready:
        return JSONResponse({"status": "ready"})
    return JSONResponse({"status": "loading"}, status_code=503)


@app.post("/transcribe")
async def transcribe_endpoint(
    background_tasks: BackgroundTasks,
    audio: UploadFile,
    output_format: Literal["txt", "md"] = Form(...),
    summarize: bool = Form(...),
):
    if not models_ready:
        raise HTTPException(status_code=503, detail="Models not yet loaded")

    content_type = (audio.content_type or "").split(";")[0].strip().lower()
    if content_type not in ACCEPTED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported MIME type: {content_type}",
        )

    suffix = Path(audio.filename or "audio").suffix or ".audio"
    job = store.create(output_format=output_format, summarize=summarize, audio_path=Path(""))

    audio_path = TMP_DIR / f"{job.job_id}_audio{suffix}"
    try:
        with audio_path.open("wb") as f:
            content = await audio.read()
            f.write(content)
    except Exception:
        store.delete(job.job_id)
        raise HTTPException(status_code=500, detail="Failed to save uploaded audio")

    store.update(job.job_id, audio_path=audio_path)
    background_tasks.add_task(_process_job, job.job_id)

    return {"job_id": job.job_id}


@app.get("/status/{job_id}")
async def status_endpoint(job_id: str):
    job = store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return {
        "job_id": job.job_id,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
    }


@app.get("/download/{job_id}")
async def download_endpoint(job_id: str, background_tasks: BackgroundTasks):
    job = store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "complete":
        raise HTTPException(status_code=409, detail="Job not yet complete")
    if not job.output_path or not job.output_path.exists():
        raise HTTPException(status_code=404, detail="Output file not found")

    label = "summary" if job.summarize else "transcript"
    filename = f"{label}.{job.output_format}"
    media_type = "text/plain"

    background_tasks.add_task(_cleanup_job, job_id)

    return FileResponse(
        path=job.output_path,
        media_type=media_type,
        filename=filename,
    )


async def _process_job(job_id: str):
    job = store.get(job_id)
    if not job:
        return

    async with inference_semaphore:
        try:
            store.update(job_id, status="transcribing", progress=0)

            loop = asyncio.get_running_loop()

            def do_transcribe():
                def on_progress(p: int):
                    store.update(job_id, progress=p)

                return transcriber.transcribe(job.audio_path, progress_callback=on_progress)

            transcript = await loop.run_in_executor(None, do_transcribe)
            store.update(job_id, transcript=transcript, progress=80)

            text_to_write = transcript

            if job.summarize:
                store.update(job_id, status="summarizing", progress=80)
                summary = await loop.run_in_executor(None, summarizer.summarize, transcript)
                store.update(job_id, progress=90)
                text_to_write = summary

            output_path = TMP_DIR / f"{job_id}_output.{job.output_format}"
            _write_output(output_path, text_to_write, job.output_format, job.summarize)

            store.update(job_id, status="complete", progress=100, output_path=output_path)

        except Exception as exc:
            store.update(job_id, status="error", error=str(exc))
            _safe_delete(job.audio_path)


def _write_output(path: Path, text: str, fmt: str, is_summary: bool) -> None:
    title = "Summary" if is_summary else "Transcript"
    if fmt == "md":
        content = f"# {title}\n\n{text}\n"
    else:
        content = text
    path.write_text(content, encoding="utf-8")


def _cleanup_job(job_id: str) -> None:
    job = store.get(job_id)
    if job:
        _safe_delete(job.audio_path)
        _safe_delete(job.output_path)
        store.delete(job_id)
