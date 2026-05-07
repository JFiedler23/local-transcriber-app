from pathlib import Path

from llama_cpp import Llama

MODEL_PATH = Path(__file__).parent / "models" / "Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf"

SYSTEM_PROMPT = "You are a helpful assistant that summarizes transcripts concisely."

USER_TEMPLATE = (
    "Summarize the following transcript in clear, concise paragraphs:\n\n{transcript}"
)

MAX_WORDS = 5_000


def _build_prompt(transcript: str) -> str:
    words = transcript.split()
    if len(words) > MAX_WORDS:
        transcript = " ".join(words[:MAX_WORDS])

    return (
        f"<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n{SYSTEM_PROMPT}<|eot_id|>"
        f"<|start_header_id|>user<|end_header_id|>\n\n{USER_TEMPLATE.format(transcript=transcript)}<|eot_id|>"
        f"<|start_header_id|>assistant<|end_header_id|>\n\n"
    )


class Summarizer:
    def __init__(self):
        self._llm = Llama(
            model_path=str(MODEL_PATH),
            n_ctx=8192,
            n_gpu_layers=-1,
            verbose=True,
        )

    def summarize(self, transcript: str) -> str:
        prompt = _build_prompt(transcript)
        output = self._llm(
            prompt,
            max_tokens=1024,
            temperature=0.3,
            stop=["<|eot_id|>"],
        )
        return output["choices"][0]["text"].strip()
