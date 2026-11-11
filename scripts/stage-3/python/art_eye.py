"""Finds eyes on an image: the most visible eye on the FLUX art, or every eye on the TRELLIS atlas. Every figure is
drawn with cute eyes that carry round white catchlights (a rule of the stage-1 prompt), and TRELLIS keeps them, so an
eye is a small near-white spot sitting on a dark pupil. The eye itself is the region around that spot whose colour
differs from the skin around it, holes filled. Works on a float RGBA array."""
from dataclasses import dataclass

import cv2
import numpy as np


@dataclass(frozen=True)
class ArtEye:
    centre: tuple
    box: tuple
    mask: np.ndarray
    rgb: np.ndarray
    origin: tuple


class NoArtEye(RuntimeError):
    """The art has no eye with a catchlight (blocky pixel eyes, closed eyes)."""


def value_and_saturation(rgb):
    high, low = rgb.max(axis=-1), rgb.min(axis=-1)
    return high, np.where(high > 0, (high - low) / np.maximum(high, 1e-6), 0.0)


def fill_holes(mask):
    """Fills enclosed holes (the pupil inside the iris) by flooding the background from the border."""
    padded = np.pad(~mask, 1, constant_values=True).astype(np.uint8)
    flood = np.zeros((padded.shape[0] + 2, padded.shape[1] + 2), dtype=np.uint8)
    cv2.floodFill(padded, flood, (0, 0), 2)
    return padded[1:-1, 1:-1] != 2


def component_with(mask, seed):
    count, labels = cv2.connectedComponents(mask.astype(np.uint8), connectivity=4)
    row, col = seed
    if not (0 <= row < mask.shape[0] and 0 <= col < mask.shape[1]) or labels[row, col] == 0:
        return None
    return labels == labels[row, col]


def ring(shape, centre, inner, outer):
    rows, cols = np.ogrid[:shape[0], :shape[1]]
    distance = np.hypot(rows - centre[0], cols - centre[1])
    return (distance >= inner) & (distance < outer)


def catchlights(rgba, settings):
    """Centre and area of every small near-white spot."""
    figure = rgba[..., 3] > 0.5
    value, saturation = value_and_saturation(rgba[..., :3])
    white = figure & (value >= settings["catchlight_value_min"]) & (saturation <= settings["catchlight_saturation_max"])
    largest = settings["catchlight_area_max_ratio"] * figure.sum()
    count, _, stats, centroids = cv2.connectedComponentsWithStats(white.astype(np.uint8), connectivity=4)
    areas = stats[1:, cv2.CC_STAT_AREA]
    keep = np.nonzero((areas >= 2) & (areas <= largest))[0] + 1
    return [((float(centroids[label][1]), float(centroids[label][0])), int(stats[label, cv2.CC_STAT_AREA]))
            for label in keep]


def pupil_around(rgba, centre, area):
    """Mean value of a thin ring around the spot: a catchlight sits on a dark pupil, a glint on skin does not."""
    radius = max(np.sqrt(area / np.pi), 1.0)
    local, (top, left) = window(rgba, centre, radius * 2 + 3)
    around = ring(local.shape[:2], (centre[0] - top, centre[1] - left), radius + 1, radius * 2 + 2)
    around &= local[..., 3] > 0.5
    value, _ = value_and_saturation(local[..., :3])
    return float(value[around].mean()) if around.any() else 1.0, radius


def window(rgba, centre, half):
    top, left = max(int(centre[0] - half), 0), max(int(centre[1] - half), 0)
    bottom, right = min(int(centre[0] + half) + 1, rgba.shape[0]), min(int(centre[1] + half) + 1, rgba.shape[1])
    return rgba[top:bottom, left:right], (top, left)


def eye_region(rgba, centre, radius, reach_ratio, settings):
    """Pixels near the catchlight whose colour differs from the skin, the skin being the ring far around it."""
    reach = radius * reach_ratio
    local, (top, left) = window(rgba, centre, reach * 1.5)
    local_centre = (centre[0] - top, centre[1] - left)
    skin_ring = ring(local.shape[:2], local_centre, reach, reach * 1.4) & (local[..., 3] > 0.5)
    if not skin_ring.any():
        return None
    skin = np.median(local[skin_ring][:, :3], axis=0)
    distance = np.linalg.norm(local[..., :3] - skin, axis=-1)
    near = ring(local.shape[:2], local_centre, 0, reach)
    candidate = near & (distance > settings["skin_distance_min"]) & (local[..., 3] > 0.5)
    candidate |= ring(local.shape[:2], local_centre, 0, radius + 1)
    region = component_with(candidate, tuple(np.round(local_centre).astype(int)))
    if region is None:
        return None
    mask = np.zeros(rgba.shape[:2], dtype=bool)
    mask[top:top + local.shape[0], left:left + local.shape[1]] = fill_holes(region)
    return mask


def dilate(mask, steps):
    grown = mask.copy()
    for _ in range(max(int(steps), 0)):
        step = grown.copy()
        step[1:] |= grown[:-1]
        step[:-1] |= grown[1:]
        step[:, 1:] |= grown[:, :-1]
        step[:, :-1] |= grown[:, 1:]
        grown = step
    return grown


def pupil_core(local, centre, radius, settings):
    """Pixels joined to the catchlight that share the pupil colour; none when they run off the window (a dark
    pupil on equally dark skin) or barely reach past the catchlight (a pupil mottled by a second spot)."""
    around = ring(local.shape[:2], centre, radius + 2, radius * 2 + 3) & (local[..., 3] > 0.5)
    pupil = np.median(local[around][:, :3], axis=0)
    close = np.linalg.norm(local[..., :3] - pupil, axis=-1) < settings["pupil_distance_max"]
    close = (close & (local[..., 3] > 0.5)) | ring(local.shape[:2], centre, 0, radius + 1)
    core = component_with(close, tuple(np.round(centre).astype(int)))
    if core is None or core[0].any() or core[-1].any() or core[:, 0].any() or core[:, -1].any():
        return None
    core = fill_holes(core)
    return core if core.sum() >= np.pi * (radius * settings["core_min_radius_ratio"]) ** 2 else None


def with_bands(local, core, settings):
    """Adds the rings around the pupil that differ from the skin beyond them: a coloured iris, a white rim. A ring
    whose colour runs on well beyond it is no rim but a patch the eye sits on (Sonic's large white eye area)."""
    for _ in range(settings["band_steps"]):
        band_px = max(round(np.sqrt(core.sum() / np.pi) * settings["band_ratio"]), 1)
        band = dilate(core, band_px) & ~core
        beyond = dilate(core, band_px * 3) & ~dilate(core, band_px * 2) & (local[..., 3] > 0.5)
        if not beyond.any():
            break
        skin = np.median(local[beyond][:, :3], axis=0)
        added = band & (np.linalg.norm(local[..., :3] - skin, axis=-1) > settings["skin_distance_min"])
        if not added.any() or runs_on(local, added, core, settings):
            break
        core = fill_holes(component_with(core | added, tuple(np.argwhere(core)[0])))
    return core


def runs_on(local, added, core, settings):
    """Whether the colour of the ring reaches far past the pupil, further than an iris or a rim ever does."""
    colour = np.median(local[added][:, :3], axis=0)
    alike = (np.linalg.norm(local[..., :3] - colour, axis=-1) < settings["skin_distance_min"]) & (local[..., 3] > 0.5)
    _, labels = cv2.connectedComponents((alike | added).astype(np.uint8), connectivity=4)
    region = np.isin(labels, np.unique(labels[added]))
    rows, cols = np.nonzero(core)
    reach = np.hypot(*(np.nonzero(region) - np.array([[rows.mean()], [cols.mean()]]))).max()
    return reach > np.sqrt(core.sum() / np.pi) * settings["rim_reach_ratio"]


def eye_mask(rgba, centre, radius, settings):
    local, (top, left) = window(rgba, centre, radius * settings["core_reach_ratio"])
    local_centre = (centre[0] - top, centre[1] - left)
    core = pupil_core(local, local_centre, radius, settings)
    if core is None:
        return eye_region(rgba, centre, radius, settings["fallback_reach_ratio"], settings)
    mask = np.zeros(rgba.shape[:2], dtype=bool)
    mask[top:top + local.shape[0], left:left + local.shape[1]] = core
    return with_bands(rgba, mask, settings)


def roundness(mask):
    rows, cols = np.nonzero(mask)
    height, width = np.ptp(rows) + 1, np.ptp(cols) + 1
    return mask.sum() / (height * width) * min(height, width) / max(height, width)


def eye_masks(rgba, settings):
    """Every round eye with a catchlight, one mask per eye: two catchlights in one eye give one eye. A glint too
    small for an eye of this figure is not one."""
    found = []
    smallest = settings["eye_area_min_ratio"] * (rgba[..., 3] > 0.5).sum()
    for centre, area in catchlights(rgba, settings):
        pupil_value, radius = pupil_around(rgba, centre, area)
        if pupil_value > settings["pupil_value_max"]:
            continue
        mask = eye_mask(rgba, centre, radius, settings)
        if mask is None or mask.sum() < smallest or roundness(mask) < settings["eye_roundness_min"]:
            continue
        if not any((mask & other).any() for other in found):
            found.append(mask)
    return found


def twins(first, second, rgba, settings):
    """Two eyes of a like size and colour: the pair FLUX draws. A glossy spot on a dark patch of fur looks like an
    eye on its own, but it has no twin."""
    ratio = first.sum() / max(second.sum(), 1)
    colours = rgba[first][:, :3].mean(axis=0) - rgba[second][:, :3].mean(axis=0)
    return 1 / settings["pair_area_ratio_max"] <= ratio <= settings["pair_area_ratio_max"] \
        and np.linalg.norm(colours) <= settings["pair_colour_distance_max"]


def drawn_eyes(rgba, settings):
    """The eyes the art shows: the biggest pair of twin eyes (a three-quarter view shows both), else the biggest
    single eye (a side view shows one)."""
    masks = sorted(eye_masks(rgba, settings), key=lambda mask: -int(mask.sum()))
    if not masks:
        raise NoArtEye("No round eye with a catchlight on the art")
    pairs = [(first, second) for index, first in enumerate(masks) for second in masks[index + 1:]
             if twins(first, second, rgba, settings)]
    chosen = max(pairs, key=lambda pair: int(pair[0].sum() + pair[1].sum())) if pairs else (masks[0],)
    return [cut(rgba, mask) for mask in chosen]


def cut(rgba, mask):
    rows, cols = np.nonzero(mask)
    top, left, bottom, right = rows.min(), cols.min(), rows.max() + 1, cols.max() + 1
    return ArtEye(centre=(float(rows.mean()), float(cols.mean())), box=(int(top), int(left), int(bottom), int(right)),
                  mask=mask[top:bottom, left:right], rgb=rgba[top:bottom, left:right, :3].copy(),
                  origin=(int(top), int(left)))
