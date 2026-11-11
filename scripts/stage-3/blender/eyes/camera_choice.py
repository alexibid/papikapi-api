"""Chooses, among views whose silhouettes fit the art almost equally, the one from which the TRELLIS figure looks
most like the art: the TRELLIS base colour seen through each view is correlated with the art's, in all three colour
channels, pixel by pixel, on a grid over the art's silhouette. Brightness alone cannot tell a green face from dark
green hair; colour can."""
import numpy as np

from eye_view import first_hit


def grid_pixels(alpha, cells):
    rows, cols = np.nonzero(alpha > 0.9)
    row_steps = np.linspace(rows.min(), rows.max(), cells)
    col_steps = np.linspace(cols.min(), cols.max(), cells)
    grid_rows, grid_cols = np.meshgrid(row_steps, col_steps, indexing="ij")
    inside = alpha[grid_rows.astype(int), grid_cols.astype(int)] > 0.9
    return grid_rows[inside], grid_cols[inside]


def likeness(camera, surface, art, pixels):
    span = float(np.ptp(surface[0].reshape(-1, 3), axis=0).max())
    model, drawn = [], []
    for row, col in zip(*pixels):
        origin, forward = camera.ray(float(row), float(col))
        hit = first_hit(surface, origin - forward * span * 2, forward, span * 4)
        if hit is not None:
            model.append(hit[2])
            drawn.append(art[int(row), int(col), :3])
    if len(model) < 10:
        return -1.0
    return float(np.corrcoef(np.ravel(model), np.ravel(drawn))[0, 1])


def best_looking(cameras, surface, art, cells):
    pixels = grid_pixels(art[..., 3], cells)
    return max(cameras, key=lambda camera: likeness(camera, surface, art, pixels))
