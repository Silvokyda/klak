import argparse
import json
import pathlib
import queue
import sys
import time

import numpy as np
import sounddevice as sd
import openwakeword
from openwakeword.model import Model
from openwakeword.utils import download_models


def write_event(payload):
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def build_model(args):
    if not args.custom_model_path:
        write_event({"event": "model_check", "model": args.model_name})
        ensure_onnx_models(args.model_name)
    wakeword_models = [args.custom_model_path] if args.custom_model_path else [args.model_name]
    return Model(wakeword_models=wakeword_models, inference_framework="onnx")


def ensure_onnx_models(model_name):
    model_dir = pathlib.Path(openwakeword.__file__).parent / "resources" / "models"
    required = [
        model_dir / "melspectrogram.onnx",
        model_dir / "embedding_model.onnx",
        model_dir / "silero_vad.onnx",
        model_dir / f"{model_name}_v0.1.onnx",
    ]
    if all(path.is_file() for path in required):
        return
    download_models([model_name])


def main():
    parser = argparse.ArgumentParser(description="Klak openWakeWord listener")
    parser.add_argument("--model-name", default="hey_jarvis")
    parser.add_argument("--custom-model-path", default="")
    parser.add_argument("--threshold", type=float, default=0.55)
    parser.add_argument("--cooldown-ms", type=int, default=2200)
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--block-size", type=int, default=1280)
    args = parser.parse_args()

    audio_queue = queue.Queue()

    def callback(indata, frames, callback_time, status):
        if status:
            write_event({"event": "warning", "message": str(status)})
        audio_queue.put(bytes(indata))

    model = build_model(args)
    write_event({"event": "ready", "model": args.custom_model_path or args.model_name})
    last_wake = 0.0

    with sd.RawInputStream(
        samplerate=args.sample_rate,
        blocksize=args.block_size,
        dtype="int16",
        channels=1,
        callback=callback,
    ):
        while True:
            chunk = audio_queue.get()
            audio = np.frombuffer(chunk, dtype=np.int16)
            predictions = model.predict(audio)
            if not predictions:
                continue
            label, score = max(predictions.items(), key=lambda item: item[1])
            now = time.monotonic()
            if score >= args.threshold and (now - last_wake) * 1000 >= args.cooldown_ms:
                last_wake = now
                write_event({"event": "wake", "label": label, "score": float(score)})


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception as error:
        write_event({"event": "error", "message": str(error)})
        raise
