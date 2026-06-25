import argparse
import json
import math
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


def input_devices():
    try:
        default_input = sd.default.device[0]
    except (TypeError, IndexError):
        default_input = sd.default.device
    devices = []
    for index, device in enumerate(sd.query_devices()):
        max_input_channels = int(device.get("max_input_channels") or 0)
        if max_input_channels <= 0:
            continue
        devices.append({
            "device_index": index,
            "device_name": str(device.get("name") or f"Input device {index}"),
            "max_input_channels": max_input_channels,
            "default_sample_rate": float(device.get("default_samplerate") or 0),
            "is_default": index == default_input,
            "can_attempt": True,
        })
    return devices


def find_device(args):
    devices = input_devices()
    if args.device_name:
        for device in devices:
            if device["device_name"] == args.device_name:
                return device, False
        for device in devices:
            if device["is_default"]:
                return device, True
        return None, True

    if args.device_index is not None:
        for device in devices:
            if device["device_index"] == args.device_index:
                return device, False
    for device in devices:
        if device["is_default"]:
            return device, bool(args.device_name or args.device_index is not None)
    return None, False


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
    parser.add_argument("--device-index", type=int, default=None)
    parser.add_argument("--device-name", default="")
    parser.add_argument("--diagnostics", action="store_true")
    parser.add_argument("--list-devices-json", action="store_true")
    args = parser.parse_args()

    if args.list_devices_json:
        write_event({"event": "audio_devices", "devices": input_devices()})
        return

    audio_queue = queue.Queue()
    stream_status = ""

    def callback(indata, frames, callback_time, status):
        nonlocal stream_status
        if status:
            stream_status = str(status)
            write_event({"event": "warning", "message": stream_status})
        audio_queue.put(bytes(indata))

    selected_device, used_fallback = find_device(args)
    if selected_device is None:
        write_event({"event": "error", "message": "No usable input microphone device was found."})
        return

    model = build_model(args)
    write_event({
        "event": "ready",
        "model": args.custom_model_path or args.model_name,
        "hint": "Say the configured model phrase, for example 'hey jarvis' for hey_jarvis."
    })
    last_wake = 0.0

    with sd.RawInputStream(
        samplerate=args.sample_rate,
        blocksize=args.block_size,
        dtype="int16",
        channels=1,
        device=selected_device["device_index"],
        callback=callback,
    ) as stream:
        write_event({
            "event": "audio_device",
            "device_index": selected_device["device_index"],
            "device_name": selected_device["device_name"],
            "requested_sample_rate": args.sample_rate,
            "actual_sample_rate": stream.samplerate,
            "channels": stream.channels,
            "dtype": "int16",
            "block_size": args.block_size,
            "fallback": used_fallback,
        })
        if used_fallback:
            write_event({
                "event": "warning",
                "message": "Configured wake-word microphone was unavailable; using the system default input device."
            })

        level_chunks = 0
        level_peak = 0
        level_sum_squares = 0.0
        level_samples = 0
        max_score = 0.0
        last_level_event = time.monotonic()
        last_score_event = time.monotonic()

        while True:
            chunk = audio_queue.get()
            audio = np.frombuffer(chunk, dtype=np.int16)
            if audio.size:
                abs_audio = np.abs(audio.astype(np.int32))
                level_peak = max(level_peak, int(abs_audio.max()))
                level_sum_squares += float(np.sum(audio.astype(np.float64) ** 2))
                level_samples += int(audio.size)
                level_chunks += 1

            predictions = model.predict(audio)
            if not predictions:
                continue
            label, score = max(predictions.items(), key=lambda item: item[1])
            max_score = max(max_score, float(score))
            now = time.monotonic()
            if args.diagnostics and now - last_level_event >= 1.0:
                rms = math.sqrt(level_sum_squares / max(1, level_samples))
                dbfs = 20 * math.log10(max(rms / 32768.0, 0.000001))
                write_event({
                    "event": "audio_level",
                    "peak": level_peak,
                    "rms": rms,
                    "dbfs": max(dbfs, -120),
                    "chunks": level_chunks,
                    "stream_status": stream_status,
                })
                level_chunks = 0
                level_peak = 0
                level_sum_squares = 0.0
                level_samples = 0
                stream_status = ""
                last_level_event = now

            if args.diagnostics and now - last_score_event >= 1.0:
                write_event({
                    "event": "wake_score",
                    "model": label,
                    "current_score": float(score),
                    "maximum_score_since_last_event": max_score,
                    "threshold": args.threshold,
                })
                max_score = 0.0
                last_score_event = now

            if score >= args.threshold and (now - last_wake) * 1000 >= args.cooldown_ms:
                last_wake = now
                write_event({
                    "event": "wake",
                    "model": label,
                    "score": float(score),
                    "threshold": args.threshold,
                })


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        write_event({"event": "stopped", "message": "Wake listener stopped."})
    except Exception as error:
        write_event({"event": "error", "message": str(error)})
        raise
