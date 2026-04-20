import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal

OutputFormat = Literal["txt", "md"]
JobStatus = Literal["queued", "transcribing", "summarizing", "complete", "error"]

@dataclass
class Job:
    job_id: str
    status: JobStatus
    progress: int
    output_format: OutputFormat
    summarize: bool
    audio_path: Path
    output_path: Path | None
    transcript: str | None
    created_at: datetime
    error: str | None


class JobStore:
    def __init__(self, ttl_seconds: int = 3600):
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._ttl_seconds = ttl_seconds
        self._start_ttl_cleanup()

    def create(
        self,
        output_format: OutputFormat,
        summarize: bool,
        audio_path: Path,
    ) -> Job:
        job_id = str(uuid.uuid4())
        job = Job(
            job_id=job_id,
            status="queued",
            progress=0,
            output_format=output_format,
            summarize=summarize,
            audio_path=audio_path,
            output_path=None,
            transcript=None,
            created_at=datetime.now(),
            error=None,
        )
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get(self, job_id: str) -> Job | None:
        with self._lock:
            return self._jobs.get(job_id)

    def update(self, job_id: str, **kwargs) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job:
                for key, value in kwargs.items():
                    setattr(job, key, value)

    def delete(self, job_id: str) -> None:
        with self._lock:
            self._jobs.pop(job_id, None)

    def _start_ttl_cleanup(self) -> None:
        def cleanup():
            while True:
                time.sleep(300)
                self._run_ttl_cleanup()

        thread = threading.Thread(target=cleanup, daemon=True)
        thread.start()

    def _run_ttl_cleanup(self) -> None:
        now = datetime.now()
        with self._lock:
            expired = [
                job_id
                for job_id, job in self._jobs.items()
                if (now - job.created_at).total_seconds() > self._ttl_seconds
            ]
        for job_id in expired:
            with self._lock:
                job = self._jobs.pop(job_id, None)
            if job:
                _safe_delete(job.audio_path)
                if job.output_path:
                    _safe_delete(job.output_path)


def _safe_delete(path: Path | None) -> None:
    if path and path.exists():
        try:
            path.unlink()
        except OSError:
            pass
