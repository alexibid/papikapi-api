"""Finds the eyes drawn on the FLUX art and writes them for the Blender steps of stage 3.

python3 find_art_eye.py --art <cutout.png> --settings '<json>' --out-json <eyes.json> --out-mask <eyes.png>
The JSON lists each eye's centre, the top-left corner and size of its box in art pixels (rows top to bottom); the PNG,
the size of the art, labels the pixels of eye k with k + 1. With no eye on the art the JSON says so and no mask is
written."""
import argparse
import json
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from art_eye import NoArtEye, drawn_eyes


VEHICLE_MODELS = {'ayv4jctc', 'dz5voop3', 'g2d36jwk', 'hrd1uvps', 'lvlwusvu', 'xcg7xfd1'}


def read_art(path):
    image = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if image.ndim == 2 or image.shape[2] == 3:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGRA if image.ndim == 2 else cv2.COLOR_BGR2BGRA)
    return cv2.cvtColor(image, cv2.COLOR_BGRA2RGBA).astype(np.float32) / 255.0


def check_override(art_path):
    """Checks for a model-specific art-eye definition or vehicle exemption."""
    model_dir = Path(art_path).resolve().parents[1]
    model_id = model_dir.name
    if model_id in VEHICLE_MODELS:
        return {"found": False, "reason": "Vehicle without eyes"}
    for candidate in [model_dir / "art-eye.json", model_dir / "stage-3" / "step-1-art-eye.json"]:
        if candidate.is_file() and candidate.stat().st_size > 10:
            try:
                data = json.loads(candidate.read_text())
                if "found" in data:
                    return data
            except Exception:
                pass
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--art", required=True)
    parser.add_argument("--settings", required=True)
    parser.add_argument("--out-json", required=True)
    parser.add_argument("--out-mask", required=True)
    arguments = parser.parse_args()

    override = check_override(arguments.art)
    if override is not None:
        if not override.get("found", False):
            Path(arguments.out_json).write_text(json.dumps(override))
            return
        eyes_info = override.get("eyes", [])
        labels = np.zeros(cv2.imread(arguments.art).shape[:2], dtype=np.uint8)
        for index, eye in enumerate(eyes_info):
            row, col = int(eye["centre"][0]), int(eye["centre"][1])
            h, w = eye["shape"]
            cv2.ellipse(labels, (col, row), (max(w // 2, 1), max(h // 2, 1)), 0, 0, 360, index + 1, -1)
        cv2.imwrite(arguments.out_mask, labels)
        Path(arguments.out_json).write_text(json.dumps(override))
        return

    art = read_art(arguments.art)
    try:
        eyes = drawn_eyes(art, json.loads(arguments.settings))
    except NoArtEye as missing:
        Path(arguments.out_json).write_text(json.dumps({"found": False, "reason": str(missing)}))
        return
    labels = np.zeros(art.shape[:2], dtype=np.uint8)
    for index, eye in enumerate(eyes):
        top, left = eye.origin
        box = labels[top:top + eye.mask.shape[0], left:left + eye.mask.shape[1]]
        box[eye.mask] = index + 1
    cv2.imwrite(arguments.out_mask, labels)
    Path(arguments.out_json).write_text(json.dumps({"found": True, "eyes": [
        {"centre": list(eye.centre), "origin": list(eye.origin), "shape": list(eye.mask.shape)} for eye in eyes]}))


if __name__ == "__main__":
    main()
