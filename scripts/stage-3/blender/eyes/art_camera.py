"""The camera FLUX drew the art from, recovered on the TRELLIS model: the orthographic view whose silhouette of the
model best covers the art's silhouette. With it, any point of the model maps to an art pixel and back.

Both silhouettes are framed the same way (cropped to their bounds, centred in a square grid), so they can be
compared without knowing the art's scale. Every yaw around the figure is searched: TRELLIS does not always face the
same way (a T-Rex came out facing backwards). Pure numpy over the model vertices; TRELLIS meshes are dense enough
for their vertices alone to paint a solid silhouette."""
import math
from dataclasses import dataclass

import numpy as np

UP = np.array([0.0, 0.0, 1.0])


@dataclass(frozen=True)
class Framing:
    low: tuple
    high: tuple
    scale: float
    margin: tuple


@dataclass(frozen=True)
class ArtCamera:
    forward: np.ndarray
    right: np.ndarray
    up: np.ndarray
    model: Framing
    art: Framing
    overlap: float

    def to_art(self, points):
        """Art (row, col) of 3D points in the TRELLIS frame."""
        grid = plane_to_grid(plane_coordinates(points, self.right, self.up), self.model)
        return grid_to_pixel(grid, self.art)

    def ray(self, row, col):
        """A point on the ray that draws art pixel (row, col), and its direction."""
        grid = pixel_to_grid(np.array([[row, col]], dtype=np.float64), self.art)
        u, v = grid_to_plane(grid, self.model)[0]
        return u * self.right + v * self.up, self.forward


def view_basis(yaw_deg, pitch_deg):
    yaw, pitch = math.radians(yaw_deg), math.radians(pitch_deg)
    forward = np.array([math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), -math.sin(pitch)])
    right = np.cross(forward, UP)
    right /= np.linalg.norm(right)
    return forward, right, np.cross(right, forward)


def plane_coordinates(points, right, up):
    return np.stack([points @ right, points @ up], axis=1)


def framing(low, high, size):
    extent = np.maximum(np.asarray(high, dtype=np.float64) - np.asarray(low, dtype=np.float64), 1e-9)
    scale = size / extent.max()
    return Framing(low=tuple(low), high=tuple(high), scale=float(scale), margin=tuple((size - extent * scale) / 2))


def plane_to_grid(plane, frame):
    return np.stack([frame.margin[1] + (frame.high[1] - plane[:, 1]) * frame.scale,
                     frame.margin[0] + (plane[:, 0] - frame.low[0]) * frame.scale], axis=1)


def grid_to_plane(grid, frame):
    return np.stack([frame.low[0] + (grid[:, 1] - frame.margin[0]) / frame.scale,
                     frame.high[1] - (grid[:, 0] - frame.margin[1]) / frame.scale], axis=1)


def pixel_to_grid(pixels, frame):
    return np.stack([frame.margin[1] + (pixels[:, 0] - frame.low[1]) * frame.scale,
                     frame.margin[0] + (pixels[:, 1] - frame.low[0]) * frame.scale], axis=1)


def grid_to_pixel(grid, frame):
    return np.stack([frame.low[1] + (grid[:, 0] - frame.margin[1]) / frame.scale,
                     frame.low[0] + (grid[:, 1] - frame.margin[0]) / frame.scale], axis=1)


def art_silhouette(alpha, size):
    rows, cols = np.nonzero(alpha > 0.5)
    frame = framing((cols.min(), rows.min()), (cols.max() + 1, rows.max() + 1), size)
    grid = pixel_to_grid(np.stack([rows, cols], axis=1).astype(np.float64), frame)
    return splat(grid, size), frame


def model_silhouette(points, basis, size):
    _, right, up = basis
    plane = plane_coordinates(points, right, up)
    frame = framing(plane.min(axis=0), plane.max(axis=0), size)
    return splat(plane_to_grid(plane, frame), size), frame


def splat(grid, size):
    image = np.zeros((size, size), dtype=bool)
    cells = np.clip(np.floor(grid).astype(np.int64), 0, size - 1)
    image[cells[:, 0], cells[:, 1]] = True
    closed = image.copy()
    closed[1:] |= image[:-1]
    closed[:-1] |= image[1:]
    closed[:, 1:] |= image[:, :-1]
    closed[:, :-1] |= image[:, 1:]
    return closed


def overlap(first, second):
    return float((first & second).sum() / max((first | second).sum(), 1))


def candidate_views(settings):
    low, high, step = settings["camera_yaw_range_deg"]
    pitch_low, pitch_high, pitch_step = settings["camera_pitch_range_deg"]
    return [(yaw, pitch) for yaw in np.arange(low, high + step / 2, step)
            for pitch in np.arange(pitch_low, pitch_high + pitch_step / 2, pitch_step)]


def scored_views(points, alpha, settings):
    """Every candidate view with its silhouette overlap, best first."""
    size = settings["camera_grid_px"]
    points = points[::max(len(points) // settings["camera_points_max"], 1)]
    art, art_frame = art_silhouette(alpha, size)
    scored = []
    for yaw, pitch in candidate_views(settings):
        basis = view_basis(yaw, pitch)
        model, model_frame = model_silhouette(points, basis, size)
        scored.append((overlap(model, art), basis, model_frame))
    scored.sort(key=lambda view: -view[0])
    return [ArtCamera(forward=forward, right=right, up=up, model=frame, art=art_frame, overlap=score)
            for score, (forward, right, up), frame in scored]


def fit_art_camera(points, alpha, settings):
    return scored_views(points, alpha, settings)[0]


def close_cameras(points, alpha, settings):
    """The views whose silhouette fits nearly as well as the best one, plus the best view from the other side of the
    figure when its silhouette is not much worse: a blocky figure looks almost the same from the front and from the
    back, so the silhouette alone cannot tell them apart and colour has to."""
    views = scored_views(points, alpha, settings)
    best = views[0]
    close = [view for view in views if view.overlap >= best.overlap - settings["camera_overlap_margin"]]
    other_side = [view for view in views if float(view.forward[:2] @ best.forward[:2]) < 0
                  and view.overlap >= best.overlap - settings["camera_other_side_margin"]]
    return close + other_side[:1]
