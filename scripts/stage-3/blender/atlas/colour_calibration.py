"""Brings the TRELLIS base colour to the colours of the FLUX art. TRELLIS bakes its base colour with a tint of its own
(an orange puppy for a pale yellow art) and darker than the paper. The figure is seen through the recovered art camera:
the art pixels and the TRELLIS colours on the surface their rays meet are gathered on a grid.

The art is a lit photograph and the TRELLIS colour has no light at all, so the two cannot be matched tone by tone:
the shaded sides of the art would grey and darken every colour. Light scales the three channels of a linear colour
alike, so only what light cannot do is corrected: one gain per channel (a white balance, read from the colour
proportions, which shading does not change) and one exposure, read from the lit faces. Black stays black, every
colour keeps its hue relative to the others, and patterns stay as TRELLIS drew them. Only flat areas are compared,
where both images agree on a single colour, so the slight misalignment of the two never pairs a spot with fur."""
from dataclasses import dataclass

import numpy as np
from mathutils import Vector

from art_camera import close_cameras
from camera_choice import best_looking
from eye_locator import load_image, model_surface
from surface_transfer import bilinear, spatial_barycentric

LUMINANCE = np.array([0.2126, 0.7152, 0.0722])


@dataclass(frozen=True)
class Calibration:
    texture: np.ndarray
    pairs: int
    residual: float


@dataclass(frozen=True)
class ColourGain:
    """Per-channel gain of unit luminance (the white balance) and the exposure, both on linear colour. The gain is
    read from the figure's colours and tints neutral paper as much: white, grey and black take it in proportion to
    their saturation, so a white car stays white and a pale blue window does not turn lilac."""
    channels: np.ndarray
    exposure: float
    neutral_saturation: float

    def apply(self, rgb):
        high, low = rgb.max(axis=-1), rgb.min(axis=-1)
        saturation = (high - low) / np.maximum(high, 1e-6)
        weight = np.clip(saturation / self.neutral_saturation, 0.0, 1.0)[..., None]
        channels = 1.0 + (self.channels - 1.0) * weight
        return to_srgb(np.clip(to_linear(rgb) * channels * self.exposure, 0.0, 1.0))


def to_linear(rgb):
    return np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)


def to_srgb(linear):
    return np.where(linear <= 0.0031308, linear * 12.92, 1.055 * linear ** (1 / 2.4) - 0.055)


def solid_grid(alpha, step, inset):
    solid = alpha > 0.9
    for _ in range(inset):
        solid[1:-1, 1:-1] &= solid[:-2, 1:-1] & solid[2:, 1:-1] & solid[1:-1, :-2] & solid[1:-1, 2:]
    return solid[::step, ::step]


def surface_colour(detailed, origin, direction, reach):
    corners, uvs, tree, texture = detailed
    location, _, face, _ = tree.ray_cast(Vector(origin), Vector(direction), reach)
    if location is None:
        return None
    weights = spatial_barycentric(np.array(location), corners[face])
    return bilinear(texture, weights @ uvs[face])[:3]


def colour_grids(detailed, art, camera, offset, settings):
    """The TRELLIS and art colours on a grid over the art, NaN where the art ray misses the figure."""
    step = settings["sample_step_px"]
    solid = solid_grid(art[..., 3], step, settings["edge_inset_px"])
    span = float(np.ptp(detailed[0].reshape(-1, 3), axis=0).max())
    model = np.full((*solid.shape, 3), np.nan)
    for row, col in zip(*np.nonzero(solid)):
        origin, forward = camera.ray(float(row * step), float(col * step))
        colour = surface_colour(detailed, origin + offset - forward * span * 2, forward, span * 4)
        if colour is not None:
            model[row, col] = colour
    painted = art[::step, ::step, :3][:solid.shape[0], :solid.shape[1]]
    return model, np.where(np.isfinite(model), painted, np.nan)


def flat(grid, distance_max):
    """Grid cells whose eight neighbours all hold nearly the same colour."""
    padded = np.pad(grid, ((1, 1), (1, 1), (0, 0)), constant_values=np.nan)
    height, width = grid.shape[:2]
    spread = np.zeros((height, width))
    for row in range(3):
        for col in range(3):
            distance = np.linalg.norm(padded[row:row + height, col:col + width] - grid, axis=-1)
            spread = np.fmax(spread, np.where(np.isnan(distance), np.inf, distance))
    return spread < distance_max


def flat_pairs(model, art, settings):
    agreed = flat(model, settings["flat_colour_distance"]) & flat(art, settings["flat_colour_distance"])
    source, target = to_linear(model[agreed]), to_linear(art[agreed])
    floor = settings["dark_luminance_min"]
    visible = (source @ LUMINANCE > floor) & (target @ LUMINANCE > floor)
    return source[visible], target[visible]


def colour_gain(source, target, settings):
    proportions = (target / target.sum(axis=1, keepdims=True)) / np.maximum(
        source / source.sum(axis=1, keepdims=True), 1e-4)
    channels = np.clip(np.median(proportions, axis=0), *settings["channel_gain_range"])
    channels = channels / (channels @ LUMINANCE)
    brightening = (target @ LUMINANCE) / np.maximum((source * channels) @ LUMINANCE, 1e-4)
    exposure = np.clip(np.quantile(brightening, settings["exposure_quantile"]), *settings["exposure_range"])
    return ColourGain(channels=channels, exposure=float(exposure), neutral_saturation=settings["neutral_saturation"])


def calibrate(detailed, paths, settings):
    """paths: trellis_glb, art_cutout, offset. settings: the calibration block plus the art camera settings."""
    points, model = model_surface(paths["trellis_glb"])
    art = load_image(paths["art_cutout"])
    views = close_cameras(points, art[..., 3], settings["camera"])
    camera = best_looking(views, model, art, settings["camera"]["camera_likeness_cells"])
    offset = np.asarray(paths["offset"], dtype=np.float64)
    source, target = flat_pairs(*colour_grids(detailed, art, camera, offset, settings), settings)
    if len(source) < settings["pairs_min"]:
        raise RuntimeError(f"Colour calibration found only {len(source)} flat art pixels on the figure")
    gain = colour_gain(source, target, settings)
    texture = detailed[3].copy()
    texture[..., :3] = gain.apply(texture[..., :3].astype(np.float64))
    residual = float(np.median(np.abs(gain.apply(to_srgb(source)) - to_srgb(target))))
    return Calibration(texture=texture, pairs=len(source), residual=residual)
