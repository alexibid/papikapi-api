"""s3-step-6 (previews): renders the final figure as the app shows it, from the standardized canonical view, textured and as a
wireframe, on a transparent background, as WebP.

blender -b -P render_previews.py -- '{"model_glb", "outputs", ...}'
The view is standardized to the canonical 3/4 elevated perspective (pitch 25.0°, yaw -45.0° relative to the figure's front),
so every preview uniformly shows the front face and right flank above the plinth. Both views use a soft studio light (`studio_light`).
"""
import json
import math
import os
import sys
import traceback
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

RESULT_MARKER = "PAPERCRAFT_RESULT "
ERROR_MARKER = "PAPERCRAFT_ERROR "


def read_settings() -> dict:
    return json.loads(sys.argv[sys.argv.index("--") + 1])


def measure_image_luminance(path: str) -> float:
    """Measures the foreground mean luminance (0.0 to 1.0) of a transparent WebP/PNG image."""
    if not os.path.exists(path):
        return 0.5
    img = bpy.data.images.load(path)
    try:
        pix = np.array(img.pixels[:], dtype=np.float32).reshape(-1, 4)
        fg = pix[pix[:, 3] > 0.15]
        if len(fg) == 0:
            return 0.5
        # Perceived luminance: Rec. 709 / sRGB
        lum = 0.2126 * fg[:, 0] + 0.7152 * fg[:, 1] + 0.0722 * fg[:, 2]
        return float(np.mean(lum))
    finally:
        bpy.data.images.remove(img)


def adapt_exposure(camera, views: dict, outputs: dict, art_cutout_path: str, settings: dict) -> dict:
    """Renders textured preview, compares foreground luminance to FLUX art cutout,
    and adapts exposure automatically so the 3D model matches the art's luminance."""
    scene = bpy.context.scene
    tex_path = outputs["three_quarter"]

    # Initial render
    render_textured(camera, views, outputs)

    art_lum = measure_image_luminance(art_cutout_path)
    prev_lum = measure_image_luminance(tex_path)

    # Adaptive loop: adjust exposure if difference > 4%
    if art_lum > 0.05 and prev_lum > 0.05:
        ratio = prev_lum / art_lum
        if abs(ratio - 1.0) > 0.04:
            delta_exp = math.log2(art_lum / prev_lum)
            # Clamp delta_exp to avoid extreme adjustments
            delta_exp = max(-1.2, min(1.2, delta_exp))
            scene.view_settings.exposure += delta_exp
            # Re-render with adjusted exposure
            render_textured(camera, views, outputs)
            prev_lum = measure_image_luminance(tex_path)

    match_ratio = round(prev_lum / art_lum, 3) if art_lum > 0.01 else 1.0
    return {
        "studioLight": settings.get("studio_light", "paint.sl"),
        "viewTransform": "Standard",
        "exposureUsed": round(float(scene.view_settings.exposure), 4),
        "fluxLuminance": round(art_lum, 4),
        "previewLuminance": round(prev_lum, 4),
        "luminanceMatchRatio": match_ratio,
    }


def import_figure(path: str):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [item for item in bpy.context.scene.objects if item.type == "MESH"]
    bpy.ops.object.select_all(action="DESELECT")
    for item in meshes:
        item.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def bounds(figure) -> tuple:
    corners = [figure.matrix_world @ Vector(corner) for corner in figure.bound_box]
    low = Vector([min(point[axis] for point in corners) for axis in range(3)])
    high = Vector([max(point[axis] for point in corners) for axis in range(3)])
    return (low + high) / 2, max(high - low)


def detect_heading(figure) -> int:
    """Detects whether the figure is facing -Y (standard = 1) or +Y (reversed = -1)
    by checking the position of top/head vertices relative to the bounding center."""
    verts = [figure.matrix_world @ v.co for v in figure.data.vertices]
    min_z = min(v.z for v in verts)
    max_z = max(v.z for v in verts)
    top_verts = [v for v in verts if v.z > min_z + (max_z - min_z) * 0.7]
    min_y = min(v.y for v in verts)
    max_y = max(v.y for v in verts)
    center_y = (min_y + max_y) / 2
    avg_top_y = sum(v.y for v in top_verts) / len(top_verts) if top_verts else center_y
    return -1 if (avg_top_y - center_y) > 0.15 else 1


def canonical_direction(figure, settings: dict) -> tuple[Vector, float]:
    pitch_deg = float(settings.get("pitch_deg", 25.0))
    base_yaw = float(settings.get("yaw_deg", -45.0))

    heading = detect_heading(figure)
    yaw_deg = (base_yaw + 180.0) if heading == -1 else base_yaw

    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    direction = Vector((
        math.sin(yaw) * math.cos(pitch),
        math.cos(yaw) * math.cos(pitch),
        -math.sin(pitch)
    ))
    return direction, yaw_deg


def wireframe_overlay(figure, size: float, settings: dict):
    wire = figure.copy()
    wire.data = figure.data.copy()
    bpy.context.scene.collection.objects.link(wire)
    modifier = wire.modifiers.new("Wire", "WIREFRAME")
    modifier.thickness = size * settings["wire_thickness_ratio"]
    modifier.use_replace = True
    modifier.use_even_offset = False
    wire.data.materials.clear()
    wire.data.materials.append(flat_material("Wire", settings["wire_colour"]))
    return wire


def flat_material(name: str, colour: list):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*colour, 1.0)
    return material


def scene_camera(size: float, settings: dict):
    scene = bpy.context.scene
    camera = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    scene.collection.objects.link(camera)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = size * settings["frame_margin"]
    scene.camera = camera
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = settings["size_px"]
    scene.render.image_settings.file_format = "WEBP"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.quality = settings["webp_quality"]
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.exposure = float(settings.get("exposure", 0.75))
    scene.display.shading.light = "STUDIO"
    scene.display.shading.studio_light = settings["studio_light"]
    return camera


def place(camera, centre: Vector, size: float, direction: Vector):
    camera.location = centre - direction * size * 3
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render(path: str):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_textured(camera, views: dict, outputs: dict):
    bpy.context.scene.display.shading.color_type = "TEXTURE"
    for name, place_view in views.items():
        place_view(camera)
        render(outputs[name])


def render_wireframes(figure, camera, views: dict, outputs: dict, settings: dict):
    figure.data.materials.clear()
    figure.data.materials.append(flat_material("Paper", settings["paper_colour"]))
    bpy.context.scene.display.shading.color_type = "MATERIAL"
    for name, place_view in views.items():
        place_view(camera)
        render(outputs[f"{name}_wire"])


def main():
    settings = read_settings()
    figure = import_figure(settings["model_glb"])
    centre, size = bounds(figure)
    direction, yaw_deg = canonical_direction(figure, settings)
    camera = scene_camera(size, settings)
    views = {"three_quarter": lambda item: place(item, centre, size, direction)}

    # Adaptive exposure lighting calibration against FLUX art cutout
    art_cutout_path = settings.get("art_view", {}).get("art_cutout", "")
    lighting_data = adapt_exposure(camera, views, settings["outputs"], art_cutout_path, settings)

    wireframe_overlay(figure, size, settings)
    render_wireframes(figure, camera, views, settings["outputs"], settings)

    heading = detect_heading(figure)
    camera_data = {
        "type": "ORTHO",
        "pitchDeg": float(settings.get("pitch_deg", 25.0)),
        "yawDeg": round(yaw_deg, 1),
        "heading": heading,
        "centre": [round(centre.x, 4), round(centre.y, 4), round(centre.z, 4)],
        "size": round(size, 4),
        "orthoScale": round(float(camera.data.ortho_scale), 4),
        "location": [round(camera.location.x, 4), round(camera.location.y, 4), round(camera.location.z, 4)],
        "direction": [round(direction.x, 4), round(direction.y, 4), round(direction.z, 4)],
    }

    result = {
        "threeQuarterYawDeg": round(yaw_deg, 1),
        "faces": len(figure.data.polygons),
        "camera": camera_data,
        "lighting": lighting_data,
    }
    print(RESULT_MARKER + json.dumps(result))


if __name__ == "__main__":
    try:
        main()
    except Exception as failure:
        traceback.print_exc()
        print(ERROR_MARKER + json.dumps(str(failure)))
        sys.exit(1)
