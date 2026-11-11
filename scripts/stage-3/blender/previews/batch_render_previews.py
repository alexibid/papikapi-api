"""Batch runner for s3-step-6 (previews): renders canonical standardized previews
for all specified models in a single Blender process.
"""
import json
import math
import sys
import traceback
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).parent))
from render_previews import (
    adapt_exposure,
    bounds,
    canonical_direction,
    detect_heading,
    import_figure,
    place,
    render_textured,
    render_wireframes,
    scene_camera,
    wireframe_overlay,
)

RESULT_MARKER = "PAPERCRAFT_BATCH_RESULT "
ERROR_MARKER = "PAPERCRAFT_ERROR "


def main():
    settings_path = sys.argv[sys.argv.index("--") + 1]
    with open(settings_path, "r", encoding="utf-8") as f:
        tasks = json.load(f)

    results = []
    for item in tasks:
        figure = import_figure(item["model_glb"])
        centre, size = bounds(figure)
        direction, yaw_deg = canonical_direction(figure, item)
        camera = scene_camera(size, item)
        views = {"three_quarter": lambda cam: place(cam, centre, size, direction)}

        art_cutout = item.get("art_cutout") or f"resources/{item['model_id']}/stage-2/step-1-art-cutout.webp"
        lighting_data = adapt_exposure(camera, views, item["outputs"], art_cutout, item)

        wireframe_overlay(figure, size, item)
        render_wireframes(figure, camera, views, item["outputs"], item)

        heading = detect_heading(figure)
        camera_data = {
            "type": "ORTHO",
            "pitchDeg": float(item.get("pitch_deg", 25.0)),
            "yawDeg": round(yaw_deg, 1),
            "heading": heading,
            "centre": [round(centre.x, 4), round(centre.y, 4), round(centre.z, 4)],
            "size": round(size, 4),
            "orthoScale": round(float(camera.data.ortho_scale), 4),
            "location": [round(camera.location.x, 4), round(camera.location.y, 4), round(camera.location.z, 4)],
            "direction": [round(direction.x, 4), round(direction.y, 4), round(direction.z, 4)],
        }

        results.append({
            "model_id": item["model_id"],
            "threeQuarterYawDeg": round(yaw_deg, 1),
            "faces": len(figure.data.polygons),
            "camera": camera_data,
            "lighting": lighting_data,
        })

    print(RESULT_MARKER + json.dumps(results))


if __name__ == "__main__":
    try:
        main()
    except Exception as failure:
        traceback.print_exc()
        print(ERROR_MARKER + json.dumps(str(failure)))
        sys.exit(1)
