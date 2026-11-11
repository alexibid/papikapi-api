"""Replaces the TRELLIS eyes by the FLUX art eyes, centred on the eye TRELLIS painted (eye_locator.py).

Every atlas texel around an eye is carried to its point on the figure and from there to the art view of that eye.
Two layers are written, in this order:
- erase, on the TRELLIS atlas: a texel on the TRELLIS eye takes the colour of the skin texel chosen for it
  (eye_match.erase), so the TRELLIS eye is gone, with no blur;
- paste, on the simplified figure's atlas once the colours were copied onto it: a texel under the art eye, laid with
  its centre on the TRELLIS eye centre and scaled to the TRELLIS eye, takes the art pixel as it is.
The pasted eye is never touched again; only its outermost pixel is anti-aliased."""
import numpy as np
from mathutils import Vector

from eye_view import ViewCamera
from surface_transfer import bilinear as texture_colour
from surface_transfer import texel_points, unit_normals


def art_eye_alpha(figure_eyes, eye):
    """The art eye mask over the whole art; sampled bilinearly, only its outermost pixel is blended."""
    full = np.zeros(figure_eyes.art_rgb.shape[:2], dtype=np.float32)
    top, left = eye.origin
    full[top:top + eye.mask.shape[0], left:left + eye.mask.shape[1]] = eye.mask
    return full


def bilinear(grid, rows, cols):
    height, width = grid.shape[:2]
    rows = np.clip(rows - 0.5, 0, height - 1.001)
    cols = np.clip(cols - 0.5, 0, width - 1.001)
    row0, col0 = rows.astype(np.int64), cols.astype(np.int64)
    fr, fc = rows - row0, cols - col0
    if grid.ndim == 3:
        fr, fc = fr[:, None], fc[:, None]
    return (grid[row0, col0] * (1 - fr) * (1 - fc) + grid[row0 + 1, col0] * fr * (1 - fc)
            + grid[row0, col0 + 1] * (1 - fr) * fc + grid[row0 + 1, col0 + 1] * fr * fc)


def spot_texels(trellis, spot, settings):
    """Atlas texels of the TRELLIS triangles on the eye's own surface: beside the spot and within a layer of its
    plane, so a muzzle in front of the eye or a wall behind it is never painted."""
    corners, uvs, _, texture = trellis
    offsets = corners.mean(axis=1) - spot.centre
    depth = offsets @ spot.normal
    across = np.linalg.norm(offsets - depth[:, None] * spot.normal, axis=1)
    depth_limit = spot.radius * max(settings["eye_surface_depth_ratio"] * 3.0, 1.5)
    near = (across < spot.radius * settings["eye_paint_reach_ratio"]) & (np.abs(depth) < depth_limit)
    facing_min = max(settings.get("eye_facing_min", 0.45), 0.45)
    near &= (unit_normals(corners) @ spot.normal) > facing_min
    rows, cols, points, _ = texel_points(corners[near], uvs[near], texture.shape[0])
    inside = (rows >= 0) & (rows < texture.shape[0]) & (cols >= 0) & (cols < texture.shape[1])
    return rows[inside], cols[inside], points[inside]


def in_window(view, art):
    height, width = view.seen.shape
    return (art[:, 0] >= view.top) & (art[:, 0] < view.top + height) \
        & (art[:, 1] >= view.left) & (art[:, 1] < view.left + width)


def seen_texels(texels, spot, offset, settings):
    """The texels the eye's camera sees: the surface its ray meets first at the texel's art pixel is the texel itself.
    A texel near the eye but hidden from that view (the side of a muzzle) is neither erased nor pasted, or it would
    get a second copy of the eye."""
    rows, cols, art, points = texels
    inside = in_window(spot.view, art)
    view_rows, view_cols = spot.view.at(art[:, 0], art[:, 1])
    seen = spot.view.seen[view_rows, view_cols]
    gap = np.linalg.norm(spot.view.hits[view_rows, view_cols] + offset - points, axis=1)
    depth_ratio = max(settings["eye_seen_depth_ratio"], 0.85)
    kept = inside & seen & (gap < spot.radius * depth_ratio)
    return rows[kept], cols[kept], art[kept]


def erase_spot(texture, original, texels, spot):
    rows, cols, art = texels
    view_rows, view_cols = spot.view.at(art[:, 0], art[:, 1])
    erased = spot.erasure.mask[view_rows, view_cols]
    sources = spot.erasure.source[view_rows[erased], view_cols[erased]]
    skin_uvs = spot.view.uvs[sources[:, 0], sources[:, 1]]
    colours = np.array([texture_colour(original, uv)[:3] for uv in skin_uvs]).reshape(-1, 3)
    texture[rows[erased], cols[erased], :3] = colours


def paste_spot(texture, texels, spot, figure_eyes):
    """The art eye laid with its centre on the TRELLIS eye centre and scaled to the TRELLIS eye."""
    rows, cols, art = texels
    alpha = art_eye_alpha(figure_eyes, spot.art_eye)
    centre = np.asarray(spot.art_eye.centre, dtype=np.float64)
    source = centre + (art - np.asarray(spot.match.centre)) / spot.match.scale
    eye = bilinear(alpha, source[:, 0], source[:, 1])[:, None]
    painted = eye[:, 0] > 0
    colours = bilinear(figure_eyes.art_rgb, source[painted, 0], source[painted, 1])
    current = texture[rows[painted], cols[painted], :3]
    texture[rows[painted], cols[painted], :3] = eye[painted] * colours + (1 - eye[painted]) * current
    return int((eye[:, 0] > 0.5).sum())


def erase_eyes(trellis, figure_eyes, settings):
    """A copy of the TRELLIS texture (rows bottom-up, as Blender stores them) with each TRELLIS eye erased."""
    original = trellis[3]
    texture = original.copy()
    for spot in figure_eyes.spots:
        rows, cols, points = spot_texels(trellis, spot, settings)
        if len(rows) == 0:
            continue
        texels = seen_texels((rows, cols, figure_eyes.art_pixels(points, spot), points), spot, figure_eyes.offset,
                             settings)
        erase_spot(texture, original, texels, spot)
    return texture


def paste_on_figure(figure, figure_eyes, settings):
    """The simplified figure's atlas with each art eye pasted on it, as the art camera sees the figure: the eye goes
    on the paper faces themselves, so a fold beside the eye (a pug's muzzle) never drags part of it across."""
    texture = figure[3].copy()
    pasted = 0
    for spot in figure_eyes.spots:
        rows, cols, points = spot_texels(figure, spot, settings)
        if len(rows) == 0:
            continue
        art = figure_eyes.art_pixels(points, spot)
        seen = seen_from_camera(figure, (art, points), spot, (figure_eyes, settings))
        pasted += paste_spot(texture, (rows[seen], cols[seen], art[seen]), spot, figure_eyes)
    return texture, pasted


def seen_from_camera(figure, located, spot, context):
    """Texels whose point is the first surface the eye's camera meets through their own art pixel."""
    art, points = located
    figure_eyes, settings = context
    camera = ViewCamera(camera=figure_eyes.camera, mirror_x=figure_eyes.mirror_x, mirrored=spot.mirrored)
    span = float(np.ptp(figure[0].reshape(-1, 3), axis=0).max())
    tolerance = spot.radius * settings["eye_seen_depth_ratio"]
    seen = np.zeros(len(points), dtype=bool)
    for index, ((row, col), point) in enumerate(zip(art, points)):
        origin, forward = camera.ray(float(row), float(col))
        start = origin + figure_eyes.offset - forward * span * 2
        location, _, _, _ = figure[2].ray_cast(Vector(start), Vector(forward), span * 4)
        if location is None:
            seen[index] = True
        else:
            loc = np.array(location)
            # Accept only if the ray cast hit matches the surface point within mesh tolerance
            seen[index] = np.linalg.norm(loc - point) < tolerance * 2.5
    return seen
