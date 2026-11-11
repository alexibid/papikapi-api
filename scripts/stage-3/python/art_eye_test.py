"""Synthetic checks of the art eye finder: python3 scripts/stage-3/blender/eyes/art_eye_test.py"""
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))

from art_eye import NoArtEye, drawn_eyes

SETTINGS = {
    "catchlight_value_min": 0.85, "catchlight_saturation_max": 0.3, "catchlight_area_max_ratio": 0.002,
    "pupil_value_max": 0.45, "pupil_distance_max": 0.22, "core_reach_ratio": 8.0, "core_min_radius_ratio": 2.0,
    "band_ratio": 0.35, "band_steps": 3, "skin_distance_min": 0.25, "fallback_reach_ratio": 5.0,
    "eye_roundness_min": 0.38, "eye_area_min_ratio": 0.0015, "pair_area_ratio_max": 2.5,
    "pair_colour_distance_max": 0.12, "rim_reach_ratio": 2.5,
}
SIZE = 400
SKIN = (0.85, 0.7, 0.5)
IRIS = (0.2, 0.6, 0.95)
PUPIL = (0.05, 0.05, 0.08)


def disk(image, centre, radius, colour):
    rows, cols = np.ogrid[:SIZE, :SIZE]
    image[np.hypot(rows - centre[0], cols - centre[1]) < radius, :3] = colour


def figure_with_eyes(eyes):
    image = np.zeros((SIZE, SIZE, 4), dtype=np.float32)
    image[40:360, 40:360] = (*SKIN, 1.0)
    for centre, radius in eyes:
        disk(image, centre, radius, IRIS)
        disk(image, centre, radius * 0.6, PUPIL)
        disk(image, (centre[0] - radius * 0.25, centre[1] - radius * 0.25), radius * 0.16, (1.0, 1.0, 1.0))
    return image


def test_takes_both_eyes_of_a_pair_with_their_iris() -> None:
    image = figure_with_eyes([((150, 120), 34), ((150, 260), 24)])
    eyes = sorted(drawn_eyes(image, SETTINGS), key=lambda eye: eye.centre[1])
    assert len(eyes) == 2
    assert abs(eyes[0].centre[1] - 120) < 6 and abs(eyes[1].centre[1] - 260) < 6, [eye.centre for eye in eyes]
    height, width = eyes[0].mask.shape
    assert 60 <= height <= 76 and 60 <= width <= 76, eyes[0].mask.shape


def test_the_white_patch_an_eye_sits_on_is_not_part_of_it() -> None:
    image = figure_with_eyes([])
    for centre in ((150, 120), (150, 260)):
        disk(image, (centre[0], centre[1] - 30), 50, (1.0, 1.0, 1.0))
    for centre in ((150, 120), (150, 260)):
        disk(image, centre, 24, PUPIL)
        disk(image, (centre[0] - 6, centre[1] - 6), 4, (1.0, 1.0, 1.0))
    eyes = drawn_eyes(image, SETTINGS)
    assert len(eyes) == 2
    assert all(max(eye.mask.shape) <= 52 for eye in eyes), [eye.mask.shape for eye in eyes]


def test_a_lone_eye_is_taken_alone() -> None:
    eyes = drawn_eyes(figure_with_eyes([((150, 160), 34)]), SETTINGS)
    assert len(eyes) == 1 and abs(eyes[0].centre[1] - 160) < 6


def test_a_figure_without_catchlights_has_no_eye() -> None:
    image = np.zeros((SIZE, SIZE, 4), dtype=np.float32)
    image[40:360, 40:360] = (*SKIN, 1.0)
    disk(image, (150, 150), 30, PUPIL)
    try:
        drawn_eyes(image, SETTINGS)
    except NoArtEye:
        return
    raise AssertionError("A dark spot without a catchlight was taken for an eye")


if __name__ == "__main__":
    failed = 0
    for name, check in list(globals().items()):
        if name.startswith("test_"):
            try:
                check()
                print("ok", name)
            except AssertionError as failure:
                failed += 1
                print("FAIL", name, failure)
    sys.exit(1 if failed else 0)
