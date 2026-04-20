import os
from pathlib import Path
from typing import Callable

from faster_whisper import WhisperModel


def _get_device() -> tuple[str, str]:
    try:
        import torch
        if torch.cuda.is_available():
            return "cuda", "float16"
    except ImportError:
        pass
    return "cpu", "int8"


class Transcriber:
    def __init__(self, model_size: str = "large-v3"):
        device, compute_type = _get_device()
        cpu_count = os.cpu_count() or 4
        cpu_threads = max(1, cpu_count // 2)
        self._model = WhisperModel(
            model_size,
            device=device,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
        )

    def transcribe(
        self,
        audio_path: Path,
        progress_callback: Callable[[int], None] | None = None,
    ) -> str:
        segments, info = self._model.transcribe(
            str(audio_path),
            beam_size=5,
        )

        total_duration = info.duration or 1.0
        transcript_parts: list[str] = []

        for segment in segments:
            transcript_parts.append(segment.text.strip())
            if progress_callback:
                raw = segment.end / total_duration
                progress = int(min(raw, 1.0) * 80)
                progress_callback(progress)

        if progress_callback:
            progress_callback(80)

        return " ".join(transcript_parts)
