"""s3-step-3 (atlas): pastes the FLUX art eyes on the TRELLIS atlas saved by s3-step-2 (eye_paste.py), then copies that
atlas onto the simplified figure, texel by texel, from the outer TRELLIS surface along each face normal, and borders
every UV island so folds show no dark line.

blender -b -P bake_atlas.py -- '{"detailed_glb", "trellis_atlas", "simple_glb", "ground_offset", "art_cutout",
"art_eye_json", "art_eye_mask", "eyes", "output_image", "output_uv_json", ...}'
The simplified mesh gets fresh UVs (one island per group of flat faces) and a new atlas; its geometry is untouched.
"""
import json
import sys
import traceback
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "eyes"))
from atlas_padding import pad_islands
from colour_calibration import calibrate
from eye_locator import NoArtEye, locate_eyes
from eye_paste import erase_eyes, paste_on_figure
from mathutils.bvhtree import BVHTree
from surface_transfer import detailed_surface, transfer, triangles

RESULT_MARKER = "PAPERCRAFT_RESULT "
LOSSLESS_QUALITY = 100
ERROR_MARKER = "PAPERCRAFT_ERROR "
ATLAS_NAME = "Atlas"


def read_settings():
    return json.loads(sys.argv[sys.argv.index("--") + 1])


def import_joined(path, name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    meshes = [item for item in bpy.data.objects if item not in before and item.type == "MESH"]
    if not meshes:
        raise RuntimeError(f"No mesh found in {path}")
    bpy.ops.object.select_all(action="DESELECT")
    for item in meshes:
        item.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")
    if len(meshes) > 1:
        bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    joined.name = name
    return joined


def unwrap(figure, settings):
    bpy.ops.object.select_all(action="DESELECT")
    figure.select_set(True)
    bpy.context.view_layer.objects.active = figure
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=settings["uv_angle_limit_rad"], island_margin=settings["uv_island_margin"])
    bpy.ops.object.mode_set(mode="OBJECT")


def atlas_material(figure, resolution):
    image = bpy.data.images.new(ATLAS_NAME, resolution, resolution, alpha=True)
    image.generated_color = (0.0, 0.0, 0.0, 0.0)
    material = bpy.data.materials.new(ATLAS_NAME)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    material.node_tree.links.new(texture.outputs["Color"], nodes["Principled BSDF"].inputs["Base Color"])
    nodes.active = texture
    figure.data.materials.clear()
    figure.data.materials.append(material)
    return image


def write_islands(figure, path):
    """UV polygon of every face, so the atlas cleanup knows which texels belong to which face."""
    uv_layer = figure.data.uv_layers.active.data
    faces = [[list(uv_layer[loop].uv) for loop in polygon.loop_indices] for polygon in figure.data.polygons]
    with open(path, "w") as output:
        json.dump({"faces": faces}, output)


def trellis_atlas(path):
    return bpy.data.images.load(path, check_existing=False)


def art_eyes_of(settings):
    """Where the art eyes go on the figure, or None when the TRELLIS eyes are kept."""
    paths = {"trellis_glb": settings["detailed_glb"], "art_cutout": settings["art_cutout"],
             "art_eye_json": settings["art_eye_json"], "art_eye_mask": settings["art_eye_mask"]}
    try:
        return locate_eyes(paths, settings["ground_offset"], settings["eyes"])
    except NoArtEye as missing:
        print(f"Eyes kept from TRELLIS: {missing}")
        return None


def without_trellis_eyes(trellis, found, settings):
    return trellis if found is None else (*trellis[:3], erase_eyes(trellis, found, settings["eyes"]))


def with_art_colours(trellis, settings):
    """The TRELLIS surface in the art's colours when this figure is set for calibration, and the fit's report."""
    if "colour_calibration" not in settings:
        return trellis, {}
    paths = {"trellis_glb": settings["detailed_glb"], "art_cutout": settings["art_cutout"],
             "offset": settings["ground_offset"]}
    found = calibrate(trellis, paths, {**settings["colour_calibration"], "camera": settings["eyes"]})
    return (*trellis[:3], found.texture), {"colourPairs": found.pairs, "colourResidual": round(found.residual, 4)}


def fill_atlas(trellis, simple, image, settings):
    """The simplified figure's atlas: the TRELLIS colours copied texel by texel, then the art eyes pasted on it as
    the art camera sees it, then every island bordered. Returns how many texels took an art eye."""
    reach = max(simple.dimensions) * settings["reach_ratio"]
    atlas = transfer(trellis["surface"], simple.data, image.size[0], reach)
    pasted = 0
    if trellis["eyes"] is not None:
        atlas, pasted = paste_on_figure(figure_surface(simple, atlas), trellis["eyes"], settings["eyes"])
    image.pixels.foreach_set(pad_islands(atlas, settings["island_border_px"]).ravel())
    return pasted


def figure_surface(simple, atlas):
    corners, uvs = triangles(simple.data)
    flat = corners.reshape(-1, 3).tolist()
    tree = BVHTree.FromPolygons(flat, np.arange(len(flat)).reshape(-1, 3).tolist())
    return corners, uvs, tree, atlas


def save(image, path):
    image.filepath_raw = path
    image.file_format = "WEBP"
    image.save(quality=LOSSLESS_QUALITY)


def export(simple, path):
    bpy.ops.object.select_all(action="DESELECT")
    simple.select_set(True)
    bpy.context.view_layer.objects.active = simple
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_materials="EXPORT")


def main():
    settings = read_settings()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    detailed = import_joined(settings["detailed_glb"], "Detailed")
    detailed.location = settings["ground_offset"]
    bpy.ops.object.select_all(action="DESELECT")
    detailed.select_set(True)
    bpy.context.view_layer.objects.active = detailed
    bpy.ops.object.transform_apply(location=True)
    simple = import_joined(settings["simple_glb"], "Simplified")
    for polygon in simple.data.polygons:
        polygon.use_smooth = False
    unwrap(simple, settings)
    write_islands(simple, settings["output_uv_json"])
    image = atlas_material(simple, settings["resolution"])
    coloured, colour_report = with_art_colours(
        detailed_surface(detailed.data, trellis_atlas(settings["trellis_atlas"])), settings)
    found = art_eyes_of(settings)
    erased = without_trellis_eyes(coloured, found, settings)
    eye_texels = fill_atlas({"surface": erased, "eyes": found}, simple, image, settings)
    save(image, settings["output_image"])
    bpy.data.objects.remove(detailed, do_unlink=True)
    if settings.get("output_glb"):
        export(simple, settings["output_glb"])
    print(RESULT_MARKER + json.dumps({"resolution": settings["resolution"], "faces": len(simple.data.polygons),
                                     "eyeTexels": eye_texels, **colour_report}))


if __name__ == "__main__":
    try:
        main()
    except Exception as failure:
        traceback.print_exc()
        print(ERROR_MARKER + json.dumps(str(failure)))
        sys.exit(1)
