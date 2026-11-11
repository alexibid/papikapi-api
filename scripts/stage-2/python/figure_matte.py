"""Cuts the figure out of the art by its shape, never by its colours.

SAM outlines the figure from a box around everything FLUX drew above the plane, with the plane as the
negative example, and ViTMatte then settles every edge pixel inside a narrow band around that outline. White
eyes and markings belong to the figure's shape, so they are kept whatever their colour. Of SAM's candidate
outlines the smallest one that still holds the figure's clear core is taken: soft shadows are only a little
darker than the background and carry no colour, so they never count as core and a shadow beside the figure
stays out. Patches of the seamless background wall that SAM glues to white figures are taken out of every outline.
"""
import cv2
import numpy as np

from plane_mask import BACKGROUND_ROWS, background_wall, drawn_area, upper_body_point

BOX_PADDING = 6
PLANE_GUARD = 3
CORE_CHROMA = 20.0
CORE_BRIGHTER = 10.0
CORE_DARKER = 80.0
CORE_COVERAGE = 0.995
TRIMAP_BAND = 12
MIN_PART_SHARE = 0.01
SIDE_PART_SHARE = 0.02
SIDE_PART_COLOURED = 0.3
SIDE_PART_BRIGHTER = 2.0
MAX_POSITIVES = 8
UNKNOWN = 128


def disc(radius: int) -> np.ndarray:
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))


def above_plane(bgr: np.ndarray, plane: np.ndarray) -> np.ndarray:
    """What FLUX drew off the plane: the largest part, and every other sizeable part of real colour or lighter than
    the wall (white legs standing apart from a pale body on a contrasting sheet), never a grey shadow."""
    region = drawn_area(bgr) & ~(cv2.dilate(plane.astype(np.uint8), disc(PLANE_GUARD)) > 0)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(region.astype(np.uint8))
    if count < 2:
        return region
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    coloured = unlike_shadow(bgr) | brighter_than_background(bgr)
    parts = [part for part in range(1, count) if part == largest or (
        stats[part, cv2.CC_STAT_AREA] >= SIDE_PART_SHARE * stats[largest, cv2.CC_STAT_AREA]
        and coloured[labels == part].mean() >= SIDE_PART_COLOURED)]
    return np.isin(labels, parts)


def inner_points(region: np.ndarray) -> list[list[int]]:
    """The deepest point of each part, so SAM is told every part belongs to the figure."""
    count, labels = cv2.connectedComponents(region.astype(np.uint8))
    depth = cv2.distanceTransform(region.astype(np.uint8), cv2.DIST_L2, 5)
    points = []
    for part in range(1, count):
        inside = np.where(labels == part, depth, 0)
        row, col = np.unravel_index(int(np.argmax(inside)), inside.shape)
        points.append([int(col), int(row)])
    return points


def plane_points(plane: np.ndarray) -> list[list[int]]:
    ys, xs = np.nonzero(plane)
    if not len(xs):
        return []
    lowest = ys.max()
    row = xs[ys == lowest]
    return [[int(row.min()), int(lowest)], [int(row.max()), int(lowest)]]


def figure_prompt(bgr: np.ndarray, plane: np.ndarray) -> dict:
    region = above_plane(bgr, plane)
    ys, xs = np.nonzero(region)
    height, width = region.shape
    box = [max(int(xs.min()) - BOX_PADDING, 0), max(int(ys.min()) - BOX_PADDING, 0),
           min(int(xs.max()) + BOX_PADDING, width - 1), min(int(ys.max()) + BOX_PADDING, height - 1)]
    positives = [upper_body_point(region), *inner_points(region)][:MAX_POSITIVES]
    return {"positives": positives, "negatives": plane_points(plane), "box": box}


def brighter_than_background(bgr: np.ndarray) -> np.ndarray:
    """Lighter than the wall: only the figure can be (a shadow is always darker)."""
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    return lab[..., 0] > np.median(lab[:BACKGROUND_ROWS, :, 0]) + SIDE_PART_BRIGHTER


def unlike_shadow(bgr: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
    background = np.median(lab[:BACKGROUND_ROWS].reshape(-1, 3), axis=0)
    lightness = lab[..., 0] - background[0]
    chroma = np.hypot(lab[..., 1] - background[1], lab[..., 2] - background[2])
    return (chroma > CORE_CHROMA) | (lightness > CORE_BRIGHTER) | (lightness < -CORE_DARKER)


def clear_core(bgr: np.ndarray, plane: np.ndarray) -> np.ndarray:
    return unlike_shadow(bgr) & above_plane(bgr, plane)


def without_glued_wall(candidate: np.ndarray, wall: np.ndarray) -> np.ndarray:
    """Takes out the patches of wall SAM glued to the outline: they reach the edge of the outline's box. A pale part
    of the figure in the wall's colour (a white chest) lies inside the outline and stays."""
    glued = candidate & wall
    count, labels = cv2.connectedComponents(glued.astype(np.uint8))
    if count < 2:
        return candidate
    rows, cols = np.nonzero(candidate)
    border = np.zeros(candidate.shape, bool)
    border[[rows.min(), rows.max()], cols.min():cols.max() + 1] = True
    border[rows.min():rows.max() + 1, [cols.min(), cols.max()]] = True
    reaching = np.setdiff1d(np.unique(labels[border & glued]), [0])
    return candidate & ~np.isin(labels, reaching)


def best_figure_mask(masks: np.ndarray, bgr: np.ndarray, plane: np.ndarray) -> np.ndarray:
    core = clear_core(bgr, plane)
    wall = background_wall(bgr)
    candidates = [without_glued_wall(masks[..., k] & ~plane, wall) for k in range(masks.shape[2])]
    candidates = [candidate for candidate in candidates if candidate.any()]
    coverages = [(candidate & core).sum() / max(core.sum(), 1) for candidate in candidates]
    covering = [c for c, coverage in zip(candidates, coverages) if coverage >= CORE_COVERAGE * max(coverages)]
    return min(covering, key=lambda candidate: candidate.sum())


def trimap(mask: np.ndarray) -> np.ndarray:
    solid = mask.astype(np.uint8)
    sure = cv2.erode(solid, disc(TRIMAP_BAND)) > 0
    maybe = cv2.dilate(solid, disc(TRIMAP_BAND)) > 0
    return np.where(sure, 255, np.where(maybe, UNKNOWN, 0)).astype(np.uint8)


def main_parts(alpha: np.ndarray) -> np.ndarray:
    solid = (alpha > UNKNOWN).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(solid)
    if count < 2:
        return alpha
    largest = stats[1:, cv2.CC_STAT_AREA].max()
    kept = [k for k in range(1, count) if stats[k, cv2.CC_STAT_AREA] >= MIN_PART_SHARE * largest]
    near = cv2.dilate(np.isin(labels, kept).astype(np.uint8), disc(2)) > 0
    return np.where(near, alpha, 0).astype(np.uint8)
