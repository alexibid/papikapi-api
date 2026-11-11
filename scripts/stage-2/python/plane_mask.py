"""Finds the paper plane by its shape.

The plane FLUX draws always runs out under the figure to the lowest rows of the art, so points on that lowest
strip lie on the plane and a point on the upper body lies on the figure. SAM traces the plane from those points
along its edges and shading. A mask narrower than the figure is a part of the figure, not a plane. FLUX often
shades the plane in two tones and SAM's favourite outline then holds only one of them, so of SAM's outlines the
widest solid one that stays in the lower half of the art is the plane: an outline that climbs into the upper half
is the background wall, and one made of separate pieces (legs, shoes) is a figure part, not a slab.
"""
import cv2
import numpy as np

BACKGROUND_ROWS = 6
BACKGROUND_DISTANCE = 16
MIN_STRIP_WIDTH = 0.15
STRIP_LIFT = 4
STRIP_SPREAD = (0.1, 0.5, 0.9)
MIN_PLANE_SPAN = 0.6
MAX_UPPER_SHARE = 0.1
MIN_SOLIDITY = 0.3
WALL_ANALYSIS_SIDE = 486
WALL_EDGE_LOW = 5
WALL_EDGE_HIGH = 15
WALL_BRIGHTER = 4
WALL_CHANNEL_PX = 7
WALL_DISTANCE = 14


def background_of(bgr: np.ndarray) -> np.ndarray:
    return np.median(bgr[:BACKGROUND_ROWS].reshape(-1, 3), axis=0)


def drawn_area(bgr: np.ndarray) -> np.ndarray:
    return np.abs(bgr.astype(int) - background_of(bgr)).max(axis=2) > BACKGROUND_DISTANCE


def background_wall(bgr: np.ndarray) -> np.ndarray:
    """The seamless background as one region: pixels of the background colour, never brighter than it, reached from
    the top edge without crossing an edge or squeezing through a gap narrower than a few pixels. A white figure has
    the background's colour but an outline, so it stays out, while a patch of wall that SAM glued to the figure has no
    outline against the rest of the wall and is caught."""
    scale = WALL_ANALYSIS_SIDE / max(bgr.shape[:2])
    small = cv2.resize(bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    edges = cv2.dilate(cv2.Canny(gray, WALL_EDGE_LOW, WALL_EDGE_HIGH), np.ones((3, 3), np.uint8)) > 0
    difference = small.astype(int) - background_of(small)
    like = (np.abs(difference).max(axis=2) <= WALL_DISTANCE) & (difference.mean(axis=2) <= WALL_BRIGHTER)
    channels = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (WALL_CHANNEL_PX, WALL_CHANNEL_PX))
    free = cv2.morphologyEx((like & ~edges).astype(np.uint8), cv2.MORPH_OPEN, channels)
    _, labels = cv2.connectedComponents(free, connectivity=4)
    wall = np.isin(labels, np.setdiff1d(np.unique(labels[0]), [0]))
    return cv2.resize(wall.astype(np.uint8), bgr.shape[1::-1], interpolation=cv2.INTER_NEAREST) > 0


def upper_body_point(drawn: np.ndarray) -> list[int]:
    height, width = drawn.shape
    ys, xs = np.nonzero(drawn[: height // 2])
    return [int(xs.mean()), int(ys.mean())] if len(xs) else [width // 2, height // 3]


def plane_prompt(bgr: np.ndarray) -> dict:
    drawn = drawn_area(bgr)
    height, width = drawn.shape
    body = upper_body_point(drawn)
    strips = [row for row in range(height - 1, height // 2, -1) if drawn[row].sum() > MIN_STRIP_WIDTH * width]
    if not strips:
        return {"positives": [], "negatives": [body]}
    row = strips[0] - STRIP_LIFT
    columns = np.nonzero(drawn[row])[0]
    left, right = int(columns.min()), int(columns.max())
    positives = [[int(left + (right - left) * share), row] for share in STRIP_SPREAD]
    return {"positives": positives, "negatives": [body]}


def widest_plane(outlines: np.ndarray, drawn: np.ndarray) -> np.ndarray:
    floors = [outlines[..., k] for k in range(outlines.shape[2]) if is_floor(outlines[..., k], drawn)]
    if not floors:
        return np.zeros(drawn.shape, bool)
    return max(floors, key=lambda floor: floor.sum())


def is_floor(outline: np.ndarray, drawn: np.ndarray) -> bool:
    upper_half = outline.shape[0] // 2
    stays_low = outline[:upper_half].sum() <= MAX_UPPER_SHARE * outline.sum()
    return stays_low and solidity(outline) >= MIN_SOLIDITY and is_plane(outline, drawn)


def solidity(outline: np.ndarray) -> float:
    points = cv2.findNonZero(outline.astype(np.uint8))
    if points is None:
        return 0.0
    return float(outline.sum()) / max(cv2.contourArea(cv2.convexHull(points)), 1.0)


def is_plane(mask: np.ndarray, figure: np.ndarray) -> bool:
    plane_columns = np.nonzero(mask.any(axis=0))[0]
    figure_columns = np.nonzero(figure.any(axis=0))[0]
    if not len(plane_columns) or not len(figure_columns):
        return False
    return np.ptp(plane_columns) >= MIN_PLANE_SPAN * np.ptp(figure_columns)
