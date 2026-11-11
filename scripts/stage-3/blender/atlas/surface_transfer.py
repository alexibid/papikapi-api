"""Colour transfer from the detailed TRELLIS figure: every texel of the simplified figure copies the colour of the
outer TRELLIS surface seen along its face normal from outside. TRELLIS figures carry inner walls under the skin; a
plain closest point lands on them where the simplified face cuts inside the figure. Texels whose normal line meets
no outward surface within reach look along tilted lines and further; only then the closest point is used, which may
be an inner wall (a dark face on a Zombie, a brown patch on a Calico)."""
import math

import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

MIN_FACING = 0.2
STEP_PAST = 1e-6
CONE_TILTS = (math.radians(25), math.radians(50))
CONE_TURNS = 8
REACH_SCALES = (1.0, 3.0)


def triangles(mesh):
    mesh.calc_loop_triangles()
    count = len(mesh.loop_triangles)
    loops = np.empty(count * 3, dtype=np.int64)
    vertices = np.empty(count * 3, dtype=np.int64)
    mesh.loop_triangles.foreach_get("loops", loops)
    mesh.loop_triangles.foreach_get("vertices", vertices)
    positions = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", positions)
    uvs = np.empty(len(mesh.loops) * 2)
    mesh.uv_layers.active.data.foreach_get("uv", uvs)
    return positions.reshape(-1, 3)[vertices].reshape(count, 3, 3), uvs.reshape(-1, 2)[loops].reshape(count, 3, 2)


def unit_normals(corners):
    normals = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-18)


def texture_pixels(image):
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(height, width, 4)


def texel_points(corners, uvs, size):
    """3D point under the centre of every texel covered by each simplified triangle, and that triangle's index."""
    found_rows, found_cols, found_points, found_faces = [], [], [], []
    for face, (corner, uv) in enumerate(zip(corners, uvs)):
        pixel = uv * size
        low = np.floor(pixel.min(axis=0)).astype(int)
        high = np.ceil(pixel.max(axis=0)).astype(int)
        cols, rows = np.meshgrid(np.arange(low[0], high[0] + 1), np.arange(low[1], high[1] + 1))
        centres = np.stack([cols.ravel() + 0.5, rows.ravel() + 0.5], axis=1)
        weights = barycentric(centres, pixel)
        inside = (weights >= -1e-3).all(axis=1)
        found_rows.append(rows.ravel()[inside])
        found_cols.append(cols.ravel()[inside])
        found_points.append(weights[inside] @ corner)
        found_faces.append(np.full(int(inside.sum()), face))
    if not found_rows or sum(len(r) for r in found_rows) == 0:
        return (np.empty(0, dtype=int), np.empty(0, dtype=int), np.empty((0, 3), dtype=float), np.empty(0, dtype=int))
    return (np.concatenate(found_rows), np.concatenate(found_cols), np.concatenate(found_points),
            np.concatenate(found_faces))


def barycentric(points, triangle):
    a, b, c = triangle
    denominator = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
    if abs(denominator) < 1e-12:
        return np.full((len(points), 3), -1.0)
    w0 = ((b[1] - c[1]) * (points[:, 0] - c[0]) + (c[0] - b[0]) * (points[:, 1] - c[1])) / denominator
    w1 = ((c[1] - a[1]) * (points[:, 0] - c[0]) + (a[0] - c[0]) * (points[:, 1] - c[1])) / denominator
    return np.stack([w0, w1, 1.0 - w0 - w1], axis=1)


def facing_hit(tree, point, normal, direction, reach):
    """First surface met by a ray that comes from outside down `direction` and faces back along the texel normal."""
    origin, travelled = point - direction * reach, 0.0
    while travelled < 2 * reach:
        location, hit_normal, face, distance = tree.ray_cast(origin, direction, 2 * reach - travelled)
        if location is None:
            return None
        if hit_normal.dot(normal) > MIN_FACING:
            return location, face, (location - point).length
        travelled += distance + STEP_PAST
        origin = location + direction * STEP_PAST
    return None


def cone_directions(normal):
    """The inward normal line, then lines tilted around it, so a texel whose straight line misses the outer skin
    still finds it nearby instead of falling on an inner wall."""
    side = normal.orthogonal().normalized()
    other = normal.cross(side)
    tilted = [(-normal + (side * math.cos(turn) + other * math.sin(turn)) * math.tan(tilt)).normalized()
              for tilt in CONE_TILTS for turn in np.linspace(0, 2 * math.pi, CONE_TURNS, endpoint=False)]
    return [-normal, *tilted]


def outer_hit(tree, point, normal, reach):
    """The outer TRELLIS surface a camera looking at this face sees, as in the TRELLIS render: along the normal line
    first, then along tilted lines and with a longer reach. The plain closest point is the last resort only."""
    straight = facing_hit(tree, point, normal, -normal, reach)
    if straight is not None:
        return straight[:2]
    for scale in REACH_SCALES:
        hits = [hit for direction in cone_directions(normal)
                if (hit := facing_hit(tree, point, normal, direction, reach * scale)) is not None]
        if hits:
            location, face, _ = min(hits, key=lambda hit: hit[2])
            return location, face
    location, _, face, _ = tree.find_nearest(point)
    return location, face


def sample_detailed(points, normals, detailed, reach):
    corners, uvs, tree, texture = detailed
    colours = np.zeros((len(points), 4), dtype=np.float32)
    for index, (point, normal) in enumerate(zip(points, normals)):
        location, face = outer_hit(tree, Vector(point), Vector(normal), reach)
        if location is None:
            continue
        weights = spatial_barycentric(np.array(location), corners[face])
        colours[index, :3] = bilinear(texture, weights @ uvs[face])[:3]
        colours[index, 3] = 1.0
    return colours


def bilinear(texture, uv):
    """Interpolated texture colour, so edges inside a detail (an iris) stay smooth instead of stair-stepped."""
    height, width = texture.shape[:2]
    x = np.clip((uv[0] % 1.0) * width - 0.5, 0, width - 1.001)
    y = np.clip((uv[1] % 1.0) * height - 0.5, 0, height - 1.001)
    col, row = int(x), int(y)
    fx, fy = x - col, y - row
    top = texture[row, col] * (1 - fx) + texture[row, col + 1] * fx
    bottom = texture[row + 1, col] * (1 - fx) + texture[row + 1, col + 1] * fx
    return top * (1 - fy) + bottom * fy


def spatial_barycentric(point, corner):
    first, second = corner[1] - corner[0], corner[2] - corner[0]
    offset = point - corner[0]
    d00, d01, d11 = first @ first, first @ second, second @ second
    d20, d21 = offset @ first, offset @ second
    denominator = max(d00 * d11 - d01 * d01, 1e-18)
    v = (d11 * d20 - d01 * d21) / denominator
    w = (d00 * d21 - d01 * d20) / denominator
    return np.clip(np.array([1.0 - v - w, v, w]), 0.0, 1.0)


def detailed_surface(mesh, image):
    corners, uvs = triangles(mesh)
    flat_vertices = corners.reshape(-1, 3).tolist()
    flat_faces = np.arange(len(flat_vertices)).reshape(-1, 3).tolist()
    return corners, uvs, BVHTree.FromPolygons(flat_vertices, flat_faces), texture_pixels(image)


def transfer(detailed, simple_mesh, size, reach):
    """Atlas pixels (rows bottom-up, as Blender) of the simplified mesh, copied from the detailed surface."""
    simple_corners, simple_uvs = triangles(simple_mesh)
    rows, cols, points, faces = texel_points(simple_corners, simple_uvs, size)
    colours = sample_detailed(points, unit_normals(simple_corners)[faces], detailed, reach)
    atlas = np.zeros((size, size, 4), dtype=np.float32)
    keep = (rows >= 0) & (rows < size) & (cols >= 0) & (cols < size)
    atlas[rows[keep], cols[keep]] = colours[keep]
    return atlas
