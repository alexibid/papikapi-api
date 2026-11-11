import json
import sys
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
sys.path.insert(0, str(Path(__file__).parent.parent / "eyes"))
sys.path.insert(0, str(Path(__file__).parent.parent / "atlas"))

from blockiness import aligned_area_ratio
from box_slab import remove_slab
from box_yaw import estimate_yaw
from box_surface import triangulate_polygons
from box_union import fit_box_union
from connectivity import face_records, vertex_records
from eye_flattening import flatten_eyes
from eye_locator import NoArtEye, locate_eyes
from face_splitter import split_oversized_faces
from planar_reduction import reduce_planar
from solid_shell import solid_shell
from mesh_export import export_airtight_mesh_glb
from outer_shell import keep_outer_surface
from mesh_quality import enclosed_volume, measure_quality, outside_distance
from model_loader import load_grounded_mesh
from quad_conversion import join_triangles_into_quads
from quality_gates import gate_failures
from scene_builder import build_scene
from surface_decimator import decimate_surface
from surface_repair import boundary_edges, repair_surface
from volume_restore import restore_volume
import bmesh

RESULT_MARKER = "PAPERCRAFT_RESULT "
ERROR_MARKER = "PAPERCRAFT_ERROR "


def read_settings():
    return json.loads(sys.argv[sys.argv.index("--") + 1])


def write_document(path, length, offset, surface):
    document = {
        "lengthMeters": length,
        "groundOffset": list(offset),
        "vertices": vertex_records(surface),
        "faces": face_records(surface),
    }
    Path(path).write_text(json.dumps(document, indent=2))


def organic_candidate(surface, length, faces, settings):
    candidate = surface.copy()
    decimate_surface(candidate, faces)
    repair_surface(candidate)
    edges = boundary_edges(candidate)
    if edges:
        bmesh.ops.edgeloop_fill(candidate, edges=edges)
    restore_volume(candidate, enclosed_volume(surface))
    join_triangles_into_quads(candidate, settings["quad_face_angle_deg"], settings["quad_shape_angle_deg"])
    split_oversized_faces(candidate, length, settings["face_max_extent_ratio"])
    return candidate


def reduce_organic(surface, length, settings):
    """Fewest faces that keep the figure: grows the face budget until every gate passes."""
    faces, attempts = settings["target_faces"], []
    while faces <= settings["max_faces"]:
        candidate = organic_candidate(surface, length, faces, settings)
        quality = measure_quality(candidate, surface)
        failures = gate_failures(quality, settings)
        attempts.append({"targetFaces": faces, "meshFaces": quality["meshFaces"],
                         "volumeChangePercent": quality["volumeChangePercent"],
                         "featureLossMm": quality["featureLossMm"], "failures": failures})
        if not failures:
            return candidate, attempts
        candidate.free()
        faces = int(round(faces * settings["face_growth"]))
    raise RuntimeError(f"No face budget up to {settings['max_faces']} keeps the figure: {attempts}")


def planar_attempt(shell, length, faces, context):
    settings, reference, target_volume, attempts = context
    candidate = reduce_planar(shell.copy(), length, {**settings, "planar_decimate_faces": faces})
    quality = measure_quality(candidate, reference, reference_volume=target_volume)
    attempts.append({"targetFaces": faces, "meshFaces": quality["meshFaces"], "airtight": quality["airtight"],
                     "volumeChangePercent": quality["volumeChangePercent"],
                     "dimensionChangePercent": quality["dimensionChangePercent"]})
    return candidate, quality


def acceptable(quality, settings):
    change = max(abs(quality["volumeChangePercent"]), quality["dimensionChangePercent"])
    return quality["airtight"] and change <= settings["planar_max_change_percent"]


def reduce_planar_within_limit(surface, length, settings):
    """Fewest planar faces, growing from target_faces, that keep the shell closed and its volume and size within
    the planar limit. Past max_paper_faces (the figure is folded by hand) the growth stops as soon as the shell is
    closed, so the paper limit wins over the change limit but never leaves a hole."""
    shell = solid_shell(surface, length * settings["planar_voxel_ratio"])
    target_volume = enclosed_volume(shell)
    attempts = []
    context = (settings, surface, target_volume, attempts)
    faces = settings["target_faces"]
    candidate, quality = planar_attempt(shell, length, faces, context)
    while not acceptable(quality, settings) and faces * settings["face_growth"] <= settings["max_faces"]:
        faces = int(round(faces * settings["face_growth"]))
        bigger, bigger_quality = planar_attempt(shell, length, faces, context)
        if bigger_quality["meshFaces"] > settings["max_paper_faces"] and quality["airtight"]:
            bigger.free()
            break
        candidate.free()
        candidate, quality = bigger, bigger_quality
    shell.free()
    return candidate, attempts, target_volume


def reduce_blocky(surface, length, settings):
    union = fit_box_union(surface, length, settings)
    surface.free()
    triangulate_polygons(union)
    join_triangles_into_quads(union, settings["quad_face_angle_deg"], settings["quad_shape_angle_deg"])
    return union


def resolve_mode(surface, settings):
    """The mode the pipeline chose for this figure (boxes for blocky figures, planes otherwise), and how much of the
    surface lies on axis-aligned planes, kept as a measure."""
    return settings["mode"], aligned_area_ratio(surface, estimate_yaw(surface))


def reduce_surface(surface, length, mode, settings):
    if mode == "boxes":
        return reduce_blocky(surface.copy(), length, settings), [], None
    if mode == "planar":
        return reduce_planar_within_limit(surface, length, settings)
    reduced, attempts = reduce_organic(surface, length, settings)
    return reduced, attempts, None


def simplify(settings, mode, aligned_ratio):
    surface, length, offset = load_grounded_mesh(settings)
    inner_wall_share = clean_surface(surface, length, mode, settings)
    if mode == "boxes":
        offset = remove_slab(surface, length, offset, settings)
    original_faces = len(surface.faces)
    reference = surface
    surface, attempts, target_vol = reduce_surface(reference, length, mode, settings)
    repair_surface(surface)
    if not surface.verts:
        reference.free()
        return {"surface": surface, "length": length, "offset": offset, "failures": ["empty simplified surface"],
                "statistics": {"mode": mode, "attempts": attempts}}
    ref_vol = target_vol if boundary_edges(reference) else None
    quality = measure_quality(surface, reference, reference_volume=ref_vol)
    quality["mode"] = mode
    reference.free()
    return {
        "surface": surface, "length": length, "offset": offset, "failures": gate_failures(quality, settings),
        "statistics": {
            "lengthMm": round(length * 1000, 1),
            "faces": original_faces,
            "points": len(surface.verts),
            "mode": mode,
            "alignedAreaRatio": round(aligned_ratio, 3),
            "innerWallShare": round(inner_wall_share, 3),
            "closingDeviationMm": 0.0,
            "attempts": attempts,
            **quality,
        },
    }


def clean_surface(surface, length, mode, settings):
    if mode != "organic":
        return 0.0
    inner_wall_share = keep_outer_surface(surface, length, settings["min_inner_wall_share"])
    repair_surface(surface)
    edges = boundary_edges(surface)
    if edges:
        bmesh.ops.edgeloop_fill(surface, edges=edges)
    return inner_wall_share


def chosen_mode(settings):
    surface, _, _ = load_grounded_mesh(settings)
    mode, aligned_ratio = resolve_mode(surface, settings)
    surface.free()
    return mode, aligned_ratio


def simplified_figure(settings):
    mode, aligned_ratio = chosen_mode(settings)
    result = simplify(settings, mode, aligned_ratio)
    if result["failures"] and mode == "boxes":
        result["surface"].free()
        result = simplify(settings, "planar", aligned_ratio)
        result["statistics"]["boxFallback"] = True
    if result["failures"]:
        raise RuntimeError(f"Simplified figure fails the gates: {result['failures']}")
    return result


def flattened_eyes(surface, offset, settings):
    """Eyes pressed flat onto the face around them, so they are printed and never sculpted. Box figures skip it: their
    faces are flat already, and pressing would crush a snout that sits next to the eyes."""
    paths = {key: settings[key] for key in ("art_cutout", "art_eye_json", "art_eye_mask")}
    try:
        found = locate_eyes({**paths, "trellis_glb": settings["input_glb"]}, offset, settings["eyes"])
    except NoArtEye as missing:
        return {"eyes": 0, "eyesSkipped": str(missing)}
    return {"eyes": len(found.spots), "eyeVerticesFlattened": flatten_eyes(surface, found.spots, settings["eyes"])}


def main():
    settings = read_settings()
    result = simplified_figure(settings)
    surface = result["surface"]
    if result["statistics"]["mode"] != "boxes":
        result["statistics"].update(flattened_eyes(surface, result["offset"], settings))
    write_document(settings["output_json"], result["length"], result["offset"], surface)
    build_scene(surface)
    export_airtight_mesh_glb(settings["output_glb"])
    surface.free()
    print(RESULT_MARKER + json.dumps(result["statistics"]))


if __name__ == "__main__":
    try:
        main()
    except Exception as failure:
        traceback.print_exc()
        print(ERROR_MARKER + json.dumps(str(failure)))
        sys.exit(1)
