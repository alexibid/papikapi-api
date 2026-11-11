"""s3-step-2 (TRELLIS atlas): saves the texture of the TRELLIS figure exactly as TRELLIS made it, so the details pasted
in s3-step-3 can be compared with the original.

blender -b -P extract_trellis_atlas.py -- '{"model_glb", "output_image"}'
"""
import json
import sys
import traceback

import bpy

RESULT_MARKER = "PAPERCRAFT_RESULT "
LOSSLESS_QUALITY = 100
ERROR_MARKER = "PAPERCRAFT_ERROR "


def base_colour_image():
    for material in bpy.data.materials:
        principled = material.node_tree.nodes.get("Principled BSDF") if material.node_tree else None
        links = principled.inputs["Base Color"].links if principled else []
        if links and links[0].from_node.type == "TEX_IMAGE":
            return links[0].from_node.image
    raise RuntimeError("The TRELLIS figure has no base colour texture")


def main():
    settings = json.loads(sys.argv[sys.argv.index("--") + 1])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=settings["model_glb"])
    image = base_colour_image()
    image.filepath_raw = settings["output_image"]
    image.file_format = "WEBP"
    image.save(quality=LOSSLESS_QUALITY)
    width, height = image.size
    print(RESULT_MARKER + json.dumps({"width": width, "height": height}))


if __name__ == "__main__":
    try:
        main()
    except Exception as failure:
        traceback.print_exc()
        print(ERROR_MARKER + json.dumps(str(failure)))
        sys.exit(1)
