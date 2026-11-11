from math import radians

import bmesh
import bpy

from face_splitter import split_oversized_faces
from mesh_quality import open_and_non_manifold_edges
from quad_conversion import join_triangles_into_quads
from surface_decimator import decimate_surface
from surface_repair import repair_surface


def smooth_surface(surface, iterations, factor):
    for _ in range(iterations):
        bmesh.ops.smooth_vert(surface, verts=surface.verts, factor=factor, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    surface.normal_update()


def dissolve_planar(surface, angle_deg):
    bmesh.ops.dissolve_limit(
        surface,
        angle_limit=radians(angle_deg),
        verts=surface.verts,
        edges=surface.edges,
        use_dissolve_boundaries=False,
    )
    surface.normal_update()


def triangulate_polygons(surface):
    polygons = [face for face in surface.faces if len(face.verts) > 4]
    bmesh.ops.triangulate(surface, faces=polygons)
    surface.normal_update()


def reduce_planar(surface, length, settings):
    smooth_iterations = min(settings.get("planar_smooth_iterations", 0), 1)
    if smooth_iterations > 0:
        smooth_surface(surface, smooth_iterations, min(settings.get("planar_smooth_factor", 0.0), 0.2))
    decimate_faces = settings.get("planar_decimate_faces", settings.get("target_faces", 450))
    decimate_surface(surface, decimate_faces)
    dissolve_angle = min(settings.get("planar_dissolve_angle_deg", 6), 8)
    if dissolve_angle > 0:
        candidate = surface.copy()
        dissolve_planar(candidate, dissolve_angle)
        triangulate_polygons(candidate)
        open_e, nonman_e = open_and_non_manifold_edges(candidate)
        if open_e == 0 and nonman_e == 0:
            temp_mesh = bpy.data.meshes.new("temp")
            candidate.to_mesh(temp_mesh)
            surface.clear()
            surface.from_mesh(temp_mesh)
            bpy.data.meshes.remove(temp_mesh)
        candidate.free()
    else:
        triangulate_polygons(surface)
    join_triangles_into_quads(surface, settings["quad_face_angle_deg"], settings["quad_shape_angle_deg"])
    split_oversized_faces(surface, length, settings["face_max_extent_ratio"])
    repair_surface(surface)
    return surface
