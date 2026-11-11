"""Closes the holes the background cutout punches into white details.

The cutout model mistakes eye catchlights, white markings and pale insides of ears for the light background,
leaving them transparent or half transparent, and TRELLIS then builds dark eyes and gaps. Any region that is not
fully opaque, fully enclosed by the figure and not large next to it is such a detail and is made opaque again; a
large enclosed hole is a real gap between limbs (gaps between legs reach the bottom and are never enclosed).
"""
import cv2
import numpy as np

OPAQUE = 128
MAX_HOLE_SHARE = 0.05


def fill_enclosed_holes(alpha: np.ndarray) -> tuple[np.ndarray, int]:
    solid = (alpha > OPAQUE).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(1 - solid, connectivity=4)
    border = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    limit = MAX_HOLE_SHARE * solid.sum()
    holes = [i for i in range(1, count) if i not in border and stats[i, cv2.CC_STAT_AREA] <= limit]
    filled = alpha.copy()
    inside = np.isin(labels, holes)
    filled[inside] = 255
    return filled, int(inside.sum())
