"""The left-right plane of symmetry of a TRELLIS figure (x = constant). The middle of the bounding box is not it:
a stray piece next to the figure (a scrap of the floor plane) pulls the box sideways. The plane is the one that best
maps the figure onto itself: mirrored sample points land closest to the surface."""
import numpy as np
from mathutils import Vector

SAMPLES = 3000
CANDIDATES = 61


def mirror_plane_x(points, tree, search_ratio):
    rng = np.random.default_rng(0)
    sample = points[rng.choice(len(points), size=min(SAMPLES, len(points)), replace=False)]
    middle, span = float(np.median(points[:, 0])), float(np.ptp(points, axis=0).max())
    candidates = np.linspace(middle - span * search_ratio, middle + span * search_ratio, CANDIDATES)
    return float(min(candidates, key=lambda plane: mirror_gap(sample, plane, tree)))


def mirror_gap(sample, plane, tree):
    gaps = [tree.find_nearest(Vector((2 * plane - x, y, z)))[3] for x, y, z in sample]
    return float(np.median([gap for gap in gaps if gap is not None]))
