import os
from pathlib import Path
from typing import Callable

import mutagen
from pywhispercpp.model import Model


class Transcriber:
    def __init__(self, model_size: str = "large-v3"):
        cpu_count = os.cpu_count() or 4
        n_threads = max(1, cpu_count // 2)
        self._model = Model(model_size, n_threads=n_threads)

    def transcribe(
        self,
        audio_path: Path,
        progress_callback: Callable[[int], None] | None = None,
    ) -> str:
        _f = mutagen.File(str(audio_path))
        total_cs = int(_f.info.length * 100) if _f is not None else 0

        transcript_parts: list[str] = []

        def on_segment(segment):
            transcript_parts.append(segment.text.strip())
            if progress_callback and total_cs > 0:
                progress_callback(int(min(segment.t1 / total_cs, 1.0) * 80))

        self._model.transcribe(str(audio_path), new_segment_callback=on_segment)

        if progress_callback:
            progress_callback(80)

        return " ".join(transcript_parts)
