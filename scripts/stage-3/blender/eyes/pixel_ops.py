"""Small image operations on numpy arrays, for Blender's Python, which has no OpenCV or SciPy."""
import numpy as np


def dilate(mask, steps):
    """Grows a boolean mask by `steps` pixels in all eight directions."""
    grown = mask.copy()
    for _ in range(max(int(steps), 0)):
        step = grown.copy()
        step[1:] |= grown[:-1]
        step[:-1] |= grown[1:]
        step[:, 1:] |= step[:, :-1].copy()
        step[:, :-1] |= step[:, 1:].copy()
        grown = step
    return grown


def luminance(rgb):
    return rgb[..., 0] * 0.299 + rgb[..., 1] * 0.587 + rgb[..., 2] * 0.114
