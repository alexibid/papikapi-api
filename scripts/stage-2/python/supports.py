"""Parts of the figure SAM leaves out or adds wrongly.

A support column under a floating figure (a seahorse on its post) is drawn in the paper's colour and SAM keeps
it out of the figure, so it comes back here: a drawn upright part that touches both the figure and the paper
sheet belongs to the figure. SAM's plane outline speckles such a post, so the speckles are dropped from the sheet
first. A thin thread (the edge of the paper sheet, a scratch of the wall) glued to the
figure is not a part TRELLIS can build, so threads thinner than a few pixels are cut off.
"""
import cv2
import numpy as np

from plane_mask import background_wall, drawn_area

SUPPORT_CLOSE = 5
SHEET_SPECKLE = 12
SUPPORT_UPRIGHT = 1.0
SUPPORT_MAX_WIDTH = 0.5
SUPPORT_SOLIDITY = 0.6
SUPPORT_MIN_SHARE = 0.005
THREAD_RADIUS = 4
MIN_PART_SHARE = 0.01


def disc(radius: int) -> np.ndarray:
    return cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * radius + 1, 2 * radius + 1))


def with_supports(figure: np.ndarray, bgr: np.ndarray, plane: np.ndarray) -> np.ndarray:
    sheet = cv2.morphologyEx(plane.astype(np.uint8), cv2.MORPH_OPEN, disc(SHEET_SPECKLE))
    near_plane = cv2.dilate(sheet, disc(3)) > 0
    rest = drawn_area(bgr) & ~background_wall(bgr) & ~figure & ~near_plane
    rest = cv2.morphologyEx(rest.astype(np.uint8), cv2.MORPH_CLOSE, disc(SUPPORT_CLOSE))
    rest = cv2.morphologyEx(rest, cv2.MORPH_OPEN, disc(THREAD_RADIUS))
    count, labels, _, _ = cv2.connectedComponentsWithStats(rest)
    near_figure = cv2.dilate(figure.astype(np.uint8), disc(2)) > 0
    touching = (near_figure, cv2.dilate(near_plane.astype(np.uint8), disc(2)) > 0)
    supports = [part for part in range(1, count) if is_support(labels == part, figure, touching)]
    return figure | np.isin(labels, supports)


def is_support(part: np.ndarray, figure: np.ndarray, touching: tuple) -> bool:
    """An upright, solid post under the figure, narrower than it, standing on the paper and holding the figure."""
    if part.sum() < SUPPORT_MIN_SHARE * figure.sum():
        return False
    if not (part & touching[0]).any() or not (part & touching[1]).any():
        return False
    ys, xs = np.nonzero(part)
    figure_xs = np.nonzero(figure.any(axis=0))[0]
    width, height = np.ptp(xs) + 1, np.ptp(ys) + 1
    under = figure_xs.min() <= xs.min() and xs.max() <= figure_xs.max()
    narrow = width <= SUPPORT_MAX_WIDTH * (np.ptp(figure_xs) + 1)
    return under and narrow and height >= SUPPORT_UPRIGHT * width * 0.6 and solidity(part) >= SUPPORT_SOLIDITY


def solidity(part: np.ndarray) -> float:
    hull = cv2.convexHull(cv2.findNonZero(part.astype(np.uint8)))
    return float(part.sum()) / max(cv2.contourArea(hull), 1.0)


def without_threads(figure: np.ndarray) -> np.ndarray:
    solid = cv2.morphologyEx(figure.astype(np.uint8), cv2.MORPH_OPEN, disc(THREAD_RADIUS))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(solid)
    if count < 2:
        return figure
    largest = stats[1:, cv2.CC_STAT_AREA].max()
    kept = [part for part in range(1, count) if stats[part, cv2.CC_STAT_AREA] >= MIN_PART_SHARE * largest]
    return figure & (cv2.dilate(np.isin(labels, kept).astype(np.uint8), disc(1)) > 0)
