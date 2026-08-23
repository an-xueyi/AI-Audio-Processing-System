import argparse
import json
from pathlib import Path

from demucs.api import Separator, save_audio

EVENT_PREFIX = "DEMUCS_EVENT "


def emit_event(event: dict) -> None:
    print(f"{EVENT_PREFIX}{json.dumps(event)}", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    def report_progress(progress_info: dict) -> None:
        audio_length = max(int(progress_info["audio_length"]), 1)
        model_count = max(int(progress_info["models"]), 1)
        model_index = int(progress_info["model_idx_in_bag"])
        segment_offset = min(int(progress_info["segment_offset"]), audio_length)
        current_model_progress = segment_offset / audio_length
        total_progress = (model_index + current_model_progress) / model_count
        emit_event({"type": "separation_progress", "value": total_progress})

    separator = Separator(
        model=args.model,
        device="cpu",
        callback=report_progress,
        progress=False,
    )
    _, separated_sources = separator.separate_audio_file(args.input)

    args.output.mkdir(parents=True, exist_ok=True)
    stem_count = len(separated_sources)

    for index, (stem_name, source) in enumerate(
        separated_sources.items(),
        start=1,
    ):
        save_audio(
            source,
            args.output / f"{stem_name}.wav",
            samplerate=separator.samplerate,
        )
        emit_event(
            {
                "type": "stem_saved",
                "completed": index,
                "total": stem_count,
            }
        )


if __name__ == "__main__":
    main()
