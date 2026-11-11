"""The TRELLIS figure seen through the art camera, pixel for pixel with the art, in a window around one eye. For the
far eye the camera is mirrored across the figure's plane of symmetry, so the far eye is seen exactly as the art
shows the near one. Each view pixel holds the point, texture coordinate and TRELLIS base colour of the surface its
ray meets first."""
from dataclasses import dataclass

import numpy as np
from mathutils import Vector

from surface_transfer import bilinear as texture_colour
from surface_transfer import spatial_barycentric


@dataclass(frozen=True)
class EyeView:
    top: int
    left: int
    colours: np.ndarray
    uvs: np.ndarray
    seen: np.ndarray
    hits: np.ndarray

    def at(self, art_rows, art_cols):
        """View pixel nearest to each art position, clipped to the window."""
        rows = np.clip(np.rint(art_rows - self.top).astype(int), 0, self.colours.shape[0] - 1)
        cols = np.clip(np.rint(art_cols - self.left).astype(int), 0, self.colours.shape[1] - 1)
        return rows, cols


@dataclass(frozen=True)
class ViewCamera:
    camera: object
    mirror_x: float
    mirrored: bool

    def ray(self, row, col):
        origin, forward = self.camera.ray(row, col)
        if not self.mirrored:
            return origin, forward
        return mirrored(origin, self.mirror_x), mirrored(forward, 0.0)


def mirrored(vector, plane_x):
    flipped = np.array(vector, dtype=np.float64)
    flipped[0] = 2 * plane_x - flipped[0]
    return flipped


def first_hit(surface, origin, forward, reach):
    """Point, texture coordinate and base colour of the first surface along the ray, or None."""
    corners, uvs, tree, texture = surface
    location, _, face, _ = tree.ray_cast(Vector(origin), Vector(forward), reach)
    if location is None:
        return None
    uv = spatial_barycentric(np.array(location), corners[face]) @ uvs[face]
    return np.array(location), uv, texture_colour(texture, uv)[:3]


def view_around(surface, view_camera, box, span):
    """box: top, left, height, width in art pixels."""
    top, left, height, width = box
    colours, uvs, hits = np.zeros((height, width, 3)), np.zeros((height, width, 2)), np.zeros((height, width, 3))
    seen = np.zeros((height, width), dtype=bool)
    for row in range(height):
        for col in range(width):
            origin, forward = view_camera.ray(float(top + row), float(left + col))
            hit = first_hit(surface, origin - forward * span * 2, forward, span * 4)
            if hit is not None:
                hits[row, col], uvs[row, col], colours[row, col] = hit
                seen[row, col] = True
    return EyeView(top=top, left=left, colours=colours, uvs=uvs, seen=seen, hits=hits)
