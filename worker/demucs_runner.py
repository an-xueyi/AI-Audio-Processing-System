"""Run the Demucs library in an isolated child and emit structured progress."""

import argparse
import json
from pathlib import Path

from demucs.api import Separator, save_audio

# This must match demucs_process.py so the parent can recognize JSON event lines.
EVENT_PREFIX = "DEMUCS_EVENT "


def emit_event(event: dict) -> None:
    # The prefix distinguishes machine-readable progress JSON from ordinary
    # Demucs log lines. demucs_process.py parses only lines with this marker.
    # flush=True sends the line through the pipe immediately instead of waiting
    # for Python's output buffer to fill.
    print(f"{EVENT_PREFIX}{json.dumps(event)}", flush=True)


def main() -> None:
    # argparse converts the argument list assembled by demucs_process.py into a
    # named object and automatically reports missing required values.
    parser = argparse.ArgumentParser()
    # `type=Path` converts file-path strings into pathlib.Path instances.
    parser.add_argument("--model", required=True)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    def report_progress(progress_info: dict) -> None:
        # Some Demucs models are bags containing multiple models. Progress for
        # the current segment is combined with the completed model count to form
        # one value between 0 and 1 for the complete separation operation.
        # max(..., 1) prevents division by zero for malformed or empty metadata.
        audio_length = max(int(progress_info["audio_length"]), 1)
        model_count = max(int(progress_info["models"]), 1)

        # Convert callback values to ordinary Python integers before arithmetic.
        model_index = int(progress_info["model_idx_in_bag"])

        # Cap an offset at the song length so current-model progress stays <= 1.
        segment_offset = min(int(progress_info["segment_offset"]), audio_length)

        # Calculate progress inside the current model, then include models already
        # completed to obtain one combined fraction for the whole model bag.
        current_model_progress = segment_offset / audio_length
        total_progress = (model_index + current_model_progress) / model_count
        emit_event({"type": "separation_progress", "value": total_progress})

    # Separator loads the requested pretrained model and exposes a Python API for
    # inference instead of using the Demucs command-line wrapper directly.
    separator = Separator(
        model=args.model,
        # Docker on Apple Silicon does not expose Metal acceleration, so inference
        # uses the portable CPU backend.
        device="cpu",
        callback=report_progress,
        # Disable Demucs's terminal progress bar because structured callbacks are
        # more useful to the web application.
        progress=False,
    )

    # The first returned value is the original mixture; `_` conventionally marks
    # a value intentionally unused. The second value maps stem names to tensors.
    _, separated_sources = separator.separate_audio_file(args.input)

    # Build output parents when absent and tolerate an existing directory.
    args.output.mkdir(parents=True, exist_ok=True)
    stem_count = len(separated_sources)

    # enumerate adds a counter while items() supplies each stem name and audio
    # tensor. start=1 makes the completed count natural for progress reporting.
    for index, (stem_name, source) in enumerate(
        separated_sources.items(),
        start=1,
    ):
        # Convert one separated tensor into a WAV file at the model's sample rate.
        save_audio(
            source,
            args.output / f"{stem_name}.wav",
            samplerate=separator.samplerate,
        )
        # Notify the parent only after this particular file has been fully saved.
        emit_event(
            {
                "type": "stem_saved",
                "completed": index,
                "total": stem_count,
            }
        )


if __name__ == "__main__":
    # This guard runs main only when Python executes this file as the child entry
    # point, not if another module imports it.
    main()
