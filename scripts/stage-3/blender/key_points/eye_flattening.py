"""Flattens the simplified figure around each eye. TRELLIS sculpts eyes as balls, rings or sockets; a papercraft eye
is printed flat on the paper, so every vertex over an eye is pressed onto the plane of the face around it."""
import bmesh
import numpy as np
from mathutils import Vector

RIM_RATIO = 1.8


def flatten_eyes(surface, spots, settings):
    moved = sum(flatten_eye(surface, spot, spot.radius * settings["eye_flatten_radius_ratio"]) for spot in spots)
    bmesh.ops.dissolve_degenerate(surface, edges=surface.edges, dist=settings["eye_degenerate_ratio"] * spots[0].radius)
    surface.normal_update()
    return moved


def flatten_eye(surface, spot, radius):
    vertices = list(surface.verts)
    offsets = np.array([tuple(vertex.co) for vertex in vertices]) - spot.centre
    depth = offsets @ spot.normal
    lateral = np.linalg.norm(offsets - depth[:, None] * spot.normal, axis=1)
    beside = np.abs(depth) < radius
    over_eye = beside & (lateral < radius)
    rim = beside & (lateral >= radius) & (lateral < radius * RIM_RATIO)
    plane_depth = float(np.median(depth[rim])) if rim.any() else 0.0
    push = Vector(tuple(spot.normal))
    for index in np.nonzero(over_eye)[0]:
        vertices[index].co -= push * float(depth[index] - plane_depth)
    return int(over_eye.sum())
