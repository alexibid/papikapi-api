"""Synthetic checks of the hole filling: python3 scripts/stage-1/python/holes_test.py"""
import numpy as np

from holes import fill_enclosed_holes

SIZE = 200


def figure() -> np.ndarray:
    alpha = np.zeros((SIZE, SIZE), np.uint8)
    alpha[20:180, 40:160] = 255
    return alpha


def test_catchlight_inside_the_eye_is_closed() -> None:
    alpha = figure()
    alpha[50:56, 70:76] = 0
    filled, pixels = fill_enclosed_holes(alpha)
    assert filled[53, 73] == 255
    assert pixels == 36


def test_large_gap_between_limbs_stays_open() -> None:
    alpha = figure()
    alpha[60:160, 70:130] = 0
    filled, pixels = fill_enclosed_holes(alpha)
    assert filled[100, 100] == 0
    assert pixels == 0


def test_half_transparent_white_marking_is_made_opaque() -> None:
    alpha = figure()
    alpha[40:70, 90:100] = 90
    filled, _ = fill_enclosed_holes(alpha)
    assert filled[55, 95] == 255


def test_pale_inside_of_an_ear_is_closed() -> None:
    alpha = figure()
    alpha[30:60, 60:85] = 0
    filled, _ = fill_enclosed_holes(alpha)
    assert filled[45, 70] == 255


def test_notch_open_to_the_background_stays_open() -> None:
    alpha = figure()
    alpha[150:180, 95:105] = 0
    filled, _ = fill_enclosed_holes(alpha)
    assert filled[170, 100] == 0


if __name__ == "__main__":
    for name, check in list(globals().items()):
        if name.startswith("test_"):
            check()
            print("ok", name)
