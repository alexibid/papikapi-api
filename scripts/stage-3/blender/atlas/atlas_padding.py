"""Border around every UV island of the atlas. Texture filtering reads a few texels past the edge of each face; with
an empty border those texels are transparent black and draw a dark line along every fold. The border repeats the
island's own edge colour outwards, so the colours inside each face stay an exact copy of TRELLIS."""
import numpy as np

NEIGHBOURS = ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1))


def pad_islands(atlas, border_px):
    padded = atlas.copy()
    for _ in range(border_px):
        grow_once(padded)
    return padded


def grow_once(atlas):
    filled = atlas[..., 3] > 0
    total = np.zeros(atlas.shape, dtype=np.float32)
    count = np.zeros(filled.shape, dtype=np.float32)
    for row_shift, col_shift in NEIGHBOURS:
        neighbour_filled = shifted(filled, row_shift, col_shift)
        total += shifted(atlas, row_shift, col_shift) * neighbour_filled[..., None]
        count += neighbour_filled
    grows = ~filled & (count > 0)
    atlas[grows] = total[grows] / count[grows][:, None]


def shifted(values, row_shift, col_shift):
    moved = np.zeros_like(values)
    rows, cols = values.shape[:2]
    target_rows = slice(max(row_shift, 0), rows + min(row_shift, 0))
    source_rows = slice(max(-row_shift, 0), rows + min(-row_shift, 0))
    target_cols = slice(max(col_shift, 0), cols + min(col_shift, 0))
    source_cols = slice(max(-col_shift, 0), cols + min(-col_shift, 0))
    moved[target_rows, target_cols] = values[source_rows, source_cols]
    return moved
