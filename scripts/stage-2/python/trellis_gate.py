"""Checks a TRELLIS model against the art it was built from, so a broken build is retried with a new seed.

Two measures, from the GLB and the art cutout alone:
- overlap: the model's silhouette seen by the recovered art camera against the art's silhouette (a figure built
  with a repeated head or missing legs covers the art poorly);
- parts: separate solid pieces of the model (a loose tail or a floating plate is a piece of its own).
The score ranks attempts when none passes: the best covered, least broken model is kept.

python3 trellis_gate.py --glb model.glb --cutout art-cutout.webp --settings '{...}'  -> JSON on stdout
"""
import argparse
import json
import struct
import sys
from pathlib import Path

import cv2
import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "stage-3" / "blender" / "eyes"))
from art_camera import fit_art_camera  # noqa: E402

COMPONENT_TYPES = {5126: np.float32, 5125: np.uint32, 5123: np.uint16, 5121: np.uint8}
COMPONENT_COUNTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}


class Glb:
    def __init__(self, path: str):
        data = Path(path).read_bytes()
        length = struct.unpack("<I", data[12:16])[0]
        self.document = json.loads(data[20:20 + length])
        start = 20 + length + 8
        self.binary = data[start:]

    def view(self, index: int) -> bytes:
        view = self.document["bufferViews"][index]
        offset = view.get("byteOffset", 0)
        return self.binary[offset:offset + view["byteLength"]]

    def accessor(self, index: int) -> np.ndarray:
        accessor = self.document["accessors"][index]
        raw = self.view(accessor["bufferView"])[accessor.get("byteOffset", 0):]
        width = COMPONENT_COUNTS[accessor["type"]]
        values = np.frombuffer(raw, dtype=COMPONENT_TYPES[accessor["componentType"]], count=accessor["count"] * width)
        return values.reshape(accessor["count"], width) if width > 1 else values

    def primitive(self) -> dict:
        return self.document["meshes"][0]["primitives"][0]


def z_up(points: np.ndarray) -> np.ndarray:
    """glTF is Y-up; the art camera works Z-up, as Blender imports it."""
    return np.stack([points[:, 0], -points[:, 2], points[:, 1]], axis=1).astype(np.float64)


def solid_parts(points: np.ndarray, settings: dict) -> int:
    grid = settings["parts_grid"]
    low, span = points.min(axis=0), np.ptp(points, axis=0).max()
    cells = np.clip(((points - low) / span * (grid - 1)).astype(int), 0, grid - 1)
    occupied = np.zeros((grid, grid, grid), bool)
    occupied[cells[:, 0], cells[:, 1], cells[:, 2]] = True
    labels, count = ndimage.label(ndimage.binary_dilation(occupied), structure=np.ones((3, 3, 3)))
    sizes = np.bincount(labels[occupied])[1:]
    return int((sizes >= settings["part_min_share"] * sizes.sum()).sum()) if count else 0


def judge(glb_path: str, cutout_path: str, settings: dict) -> dict:
    glb = Glb(glb_path)
    points = z_up(glb.accessor(glb.primitive()["attributes"]["POSITION"]))
    cutout = cv2.imread(cutout_path, cv2.IMREAD_UNCHANGED)
    camera = fit_art_camera(points, cutout[..., 3] / 255.0, settings)
    parts = solid_parts(points, settings)
    reasons = []
    if camera.overlap < settings["overlap_min"]:
        reasons.append(f"silhouette overlap {camera.overlap:.2f} < {settings['overlap_min']}")
    if parts > settings["parts_max"]:
        reasons.append(f"{parts} separate parts > {settings['parts_max']}")
    return {"passed": not reasons, "reasons": reasons, "overlap": round(camera.overlap, 4), "parts": parts,
            "score": round(camera.overlap - settings["extra_part_penalty"] * max(parts - 1, 0), 4)}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--cutout", required=True)
    parser.add_argument("--settings", required=True)
    arguments = parser.parse_args()
    print(json.dumps(judge(arguments.glb, arguments.cutout, json.loads(arguments.settings))))


if __name__ == "__main__":
    main()
