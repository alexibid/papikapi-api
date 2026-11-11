"""Finds the eye TRELLIS painted, in a view of the figure taken through the art camera, by matching the art eye
against it (zero-mean normalised cross-correlation of brightness, at a few sizes). The best match gives the centre
of the TRELLIS eye in art pixels; the middle of the TRELLIS eye's own pixels then fixes its centre and size, and the
art eye is pasted there, at that size, not where the camera fit alone puts it.

The TRELLIS eye is then erased: every pixel of its core and a thin rim takes the colour of the nearest skin pixel,
copied, never averaged, so no blur is left where the eye was."""
from dataclasses import dataclass, replace

import numpy as np

from pixel_ops import dilate, luminance


@dataclass(frozen=True)
class EyeMatch:
    centre: tuple
    scale: float
    score: float


@dataclass(frozen=True)
class Erasure:
    """mask: the view pixels of the TRELLIS eye; source: for each of them, the skin pixel whose colour it takes."""
    mask: np.ndarray
    source: np.ndarray


def box_sums(image, height, width):
    integral = np.pad(image, ((1, 0), (1, 0))).cumsum(axis=0).cumsum(axis=1)
    return (integral[height:, width:] - integral[:-height, width:] - integral[height:, :-width]
            + integral[:-height, :-width])


def correlation(image, template):
    """Normalised cross-correlation of every placement of the template fully inside the image."""
    height, width = template.shape
    centred = template - template.mean()
    size = (image.shape[0] + height, image.shape[1] + width)
    product = np.fft.irfft2(np.fft.rfft2(image, size) * np.conj(np.fft.rfft2(centred, size)), size)
    product = product[:image.shape[0] - height + 1, :image.shape[1] - width + 1]
    count = height * width
    sums, squares = box_sums(image, height, width), box_sums(image * image, height, width)
    spread = np.sqrt(np.maximum(squares - sums * sums / count, 1e-12)) * np.sqrt((centred * centred).sum())
    return product / np.maximum(spread, 1e-9)


def resized(image, scale):
    height, width = image.shape
    rows = np.clip((np.arange(max(round(height * scale), 3)) + 0.5) / scale - 0.5, 0, height - 1.001)
    cols = np.clip((np.arange(max(round(width * scale), 3)) + 0.5) / scale - 0.5, 0, width - 1.001)
    row0, col0 = rows.astype(int), cols.astype(int)
    fr, fc = (rows - row0)[:, None], (cols - col0)[None, :]
    return (image[row0][:, col0] * (1 - fr) * (1 - fc) + image[row0 + 1][:, col0] * fr * (1 - fc)
            + image[row0][:, col0 + 1] * (1 - fr) * fc + image[row0 + 1][:, col0 + 1] * fr * fc)


def eye_template(art_rgb, art_eye, pad):
    top, left = art_eye.origin
    height, width = art_eye.mask.shape
    low_row, low_col = max(top - pad, 0), max(left - pad, 0)
    patch = luminance(art_rgb[low_row:top + height + pad, low_col:left + width + pad])
    return patch, (art_eye.centre[0] - low_row, art_eye.centre[1] - low_col)


def free_placements(scores, view, anchor, taken):
    """Placements whose centre lands on an eye already taken by another art eye score nothing."""
    rows, cols = np.indices(scores.shape)
    for (row, col), radius in taken:
        near = np.hypot(view.top + rows + anchor[0] - row, view.left + cols + anchor[1] - col) < radius
        scores = np.where(near, -np.inf, scores)
    return scores


def near_guess(scores, view, anchor, art_eye, settings):
    """Placements lose score with their distance from where the art camera puts the eye, in eye sizes squared: the
    camera fit is close, so a likeness far off (a dark muzzle) never wins over the eye at the guess."""
    rows, cols = np.indices(scores.shape)
    size = max(art_eye.mask.shape)
    offset = np.hypot(view.top + rows + anchor[0] - art_eye.centre[0], view.left + cols + anchor[1] - art_eye.centre[1])
    return scores - settings["eye_match_distance_penalty"] * (offset / size) ** 2


def match_eye(view, art_rgb, art_eye, settings, taken):
    """taken: ((art row, art col), radius) of TRELLIS eyes already given to another art eye."""
    pad = round(max(art_eye.mask.shape) * settings["eye_match_pad_ratio"])
    template, anchor = eye_template(art_rgb, art_eye, pad)
    image = luminance(view.colours)
    image[~view.seen] = np.median(image[view.seen]) if view.seen.any() else 0.0
    best = None
    for scale in settings["eye_match_scales"]:
        scaled = resized(template, scale)
        if scaled.shape[0] >= image.shape[0] or scaled.shape[1] >= image.shape[1]:
            continue
        scaled_anchor = (anchor[0] * scale, anchor[1] * scale)
        scores = near_guess(correlation(image, scaled), view, scaled_anchor, art_eye, settings)
        scores = free_placements(scores, view, scaled_anchor, taken)
        row, col = np.unravel_index(int(np.argmax(scores)), scores.shape)
        if best is None or scores[row, col] > best.score:
            centre = (view.top + row + anchor[0] * scale, view.left + col + anchor[1] * scale)
            best = EyeMatch(centre=centre, scale=float(scale), score=float(scores[row, col]))
    return best


def grown_from(seed, allowed):
    region = seed & allowed
    while True:
        grown = dilate(region, 1) & allowed
        if (grown == region).all():
            return region
        region = grown


def filled(mask):
    """The mask with its enclosed holes (catchlights inside a pupil) filled."""
    border = np.zeros(mask.shape, dtype=bool)
    border[[0, -1], :] = True
    border[:, [0, -1]] = True
    return mask | ~grown_from(border & ~mask, ~mask)


def distance_from(shape, centre):
    rows, cols = np.indices(shape)
    return np.hypot(rows - centre[0], cols - centre[1])


@dataclass(frozen=True)
class CoreSearch:
    """Where to look for an eye's core: the colours, the pixels that may hold the eye, its expected centre, the skin
    brightness around it, and how far from the centre the core may reach."""
    rgb: np.ndarray
    inside: np.ndarray
    centre: tuple
    skin: float
    reach: float


def core_of(search, colour_distance_max):
    """The eye's core: the connected pixels nearest the centre that lie on the eye's side of the halfway brightness
    between the skin and the eye's most extreme pixels, the side that departs most from the skin (a dark pupil on
    light or mid skin, never its small catchlight; a light iris on dark fur), of a
    colour close to the core's own and never further than `reach` from the centre, so a dark muzzle or a red cap
    brim touching the eye is cut off."""
    lum = luminance(search.rgb)
    if not search.inside.any():
        return np.zeros(lum.shape, dtype=bool)
    dark, light = np.percentile(lum[search.inside], [5, 95])
    darker = search.skin - dark >= light - search.skin
    extreme = dark if darker else light
    side = (lum < (search.skin + extreme) / 2) if darker else (lum > (search.skin + extreme) / 2)
    candidates = side & search.inside
    if not candidates.any():
        return candidates
    distance = distance_from(lum.shape, search.centre)
    seed = np.zeros(lum.shape, dtype=bool)
    seed[np.unravel_index(int(np.argmin(np.where(candidates, distance, np.inf))), lum.shape)] = True
    like = np.linalg.norm(search.rgb - search.rgb[seed][0], axis=-1) < colour_distance_max
    return filled(grown_from(seed, side & like & (distance < search.reach)))


def trellis_eye(view, art_eye, found, settings):
    """The TRELLIS eye around the match: its core gives the centre (the core's centroid, not the correlation peak,
    which may sit on a catchlight), the match gives the size, and the core with a thin rim is what gets erased. A
    core far bigger than the eye ran into a mask of the face: None, the TRELLIS eye stays."""
    radius = max(art_eye.mask.shape) / 2 * found.scale
    centre = (found.centre[0] - view.top, found.centre[1] - view.left)
    distance = distance_from(view.seen.shape, centre)
    ring = view.seen & (distance > radius * 1.5) & (distance < radius * 2.2)
    if not ring.any():
        return None
    search = CoreSearch(rgb=view.colours, inside=view.seen & (distance < radius), centre=centre,
                        skin=float(np.median(luminance(view.colours)[ring])),
                        reach=radius * settings["eye_core_reach_ratio"])
    core = core_of(search, settings["eye_core_colour_distance"]) & view.seen
    eye_area = art_eye.mask.sum() * found.scale ** 2
    if not core.any() or core.sum() > eye_area * settings["eye_core_area_max_ratio"]:
        return None
    rows, cols = np.nonzero(core)
    placed = replace(found, centre=(view.top + rows.mean(), view.left + cols.mean()))
    return placed, erased_region(view, art_eye, placed, (core, search.skin, settings))


def footprint(view, art_eye, found):
    """The art eye mask laid on the found centre at the found size, in view pixels."""
    mask = np.zeros(view.seen.shape, dtype=bool)
    rows, cols = np.nonzero(art_eye.mask)
    top, left = art_eye.origin
    view_rows = found.centre[0] + (top + rows - art_eye.centre[0]) * found.scale - view.top
    view_cols = found.centre[1] + (left + cols - art_eye.centre[1]) * found.scale - view.left
    inside = (view_rows >= 0) & (view_rows < mask.shape[0]) & (view_cols >= 0) & (view_cols < mask.shape[1])
    mask[view_rows[inside].astype(int), view_cols[inside].astype(int)] = True
    return dilate(mask, 1)


def erased_region(view, art_eye, found, core_parts):
    core, skin, settings = core_parts
    radius = max(art_eye.mask.shape) / 2 * found.scale
    centre = (found.centre[0] - view.top, found.centre[1] - view.left)
    distance = distance_from(view.seen.shape, centre)

    eye_zone = distance < radius * 1.35
    lum = luminance(view.colours)
    contrast = np.abs(lum - skin) > 0.08
    non_skin = eye_zone & (contrast | (distance < radius * 1.15))

    to_erase = footprint(view, art_eye, found) | core | non_skin
    return dilate(to_erase, 3) & view.seen


def erase(view, mask):
    """Each masked pixel takes its nearest skin pixel, ring by ring from the edge of the mask inward."""
    source = np.stack(np.indices(mask.shape), axis=-1)
    known = view.seen & ~mask
    offsets = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))
    while True:
        frontier = mask & ~known & view.seen & dilate(known, 1)
        if not frontier.any():
            return Erasure(mask=mask & known, source=source)
        for row, col in zip(*np.nonzero(frontier)):
            for step_row, step_col in offsets:
                near_row, near_col = row + step_row, col + step_col
                if 0 <= near_row < mask.shape[0] and 0 <= near_col < mask.shape[1] and known[near_row, near_col]:
                    source[row, col] = source[near_row, near_col]
                    break
        known |= frontier
