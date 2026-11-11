"""Synthetic checks of the figure and plane prompts: python3 scripts/stage-1/python/plane_mask_test.py"""
import numpy as np

from figure_matte import best_figure_mask, figure_prompt, main_parts, trimap
from plane_mask import drawn_area, is_plane, plane_prompt, widest_plane

BACKGROUND = (213, 213, 213)
PAPER = (250, 250, 250)
BLUE = (220, 90, 30)
SIZE = 200
PLANE = (slice(150, 200), slice(0, 200))
BODY = (slice(40, 170), slice(80, 120))


def scene() -> np.ndarray:
    image = np.zeros((SIZE, SIZE, 3), np.uint8)
    image[:] = BACKGROUND
    image[PLANE] = BLUE
    image[BODY] = PAPER
    return image


def plane_mask() -> np.ndarray:
    mask = np.zeros((SIZE, SIZE), bool)
    mask[PLANE] = True
    mask[BODY] = False
    return mask


def body_mask() -> np.ndarray:
    mask = np.zeros((SIZE, SIZE), bool)
    mask[BODY] = True
    return mask


def test_plane_points_land_on_the_plane_and_the_negative_on_the_body() -> None:
    prompt = plane_prompt(scene())
    assert len(prompt["positives"]) == 3
    assert all(row >= 150 for _, row in prompt["positives"])
    column, row = prompt["negatives"][0]
    assert 80 <= column < 120 and 40 <= row < 100


def test_no_plane_points_when_nothing_reaches_the_floor() -> None:
    image = scene()
    image[:] = BACKGROUND
    image[40:120, 90:110] = PAPER
    assert plane_prompt(image)["positives"] == []


def test_figure_box_wraps_the_body_and_the_plane_is_the_negative() -> None:
    prompt = figure_prompt(scene(), plane_mask())
    left, top, right, bottom = prompt["box"]
    assert left <= 80 and right >= 119 and top <= 40 and bottom < 175
    assert all(row >= 190 for _, row in prompt["negatives"])


def test_figure_mask_is_the_candidate_matching_the_body_without_the_plane() -> None:
    candidates = np.dstack([plane_mask(), body_mask() | plane_mask(), body_mask()])
    chosen = best_figure_mask(candidates, scene(), plane_mask())
    assert chosen[100, 100] and not chosen[190, 10]


def test_narrow_mask_is_a_part_of_the_figure_not_a_plane() -> None:
    mask = np.zeros((SIZE, SIZE), bool)
    mask[160:170, 95:105] = True
    assert not is_plane(mask, body_mask())


def test_trimap_leaves_only_a_band_around_the_outline_to_the_matting() -> None:
    band = trimap(body_mask())
    assert band[100, 100] == 255 and band[100, 10] == 0 and band[100, 80] == 128


def test_soft_shadow_beside_the_figure_stays_out() -> None:
    image = scene()
    image[60:150, 120:170] = (180, 180, 180)
    shadowed = body_mask()
    shadowed[60:150, 120:170] = True
    candidates = np.dstack([shadowed, body_mask(), shadowed])
    chosen = best_figure_mask(candidates, image, plane_mask())
    assert chosen[100, 100] and not chosen[100, 150]


def test_loose_speck_far_from_the_figure_goes() -> None:
    alpha = body_mask().astype(np.uint8) * 255
    alpha[10:13, 10:13] = 255
    cleaned = main_parts(alpha)
    assert cleaned[11, 11] == 0 and cleaned[100, 100] == 255


def test_two_tone_plane_is_taken_whole_and_the_background_never_is() -> None:
    lowest_tone = plane_mask()
    lowest_tone[150:180] = False
    background = np.ones((SIZE, SIZE), bool)
    chosen = widest_plane(np.dstack([lowest_tone, background, plane_mask()]), drawn_area(scene()))
    assert chosen[160, 10] and chosen[190, 10] and not chosen[20, 10]


def test_no_plane_when_the_only_wide_outline_is_two_separate_legs() -> None:
    legs = np.zeros((SIZE, SIZE), bool)
    legs[120:190, 0:20] = True
    legs[120:190, 180:200] = True
    chosen = widest_plane(np.dstack([legs, body_mask(), body_mask()]), drawn_area(scene()))
    assert not chosen.any()


def test_plinth_that_stops_above_the_bottom_of_the_art_is_the_plane() -> None:
    plinth = plane_mask()
    plinth[185:] = False
    chosen = widest_plane(np.dstack([plinth, body_mask(), body_mask()]), drawn_area(scene()))
    assert chosen[160, 10] and not chosen[100, 100]


if __name__ == "__main__":
    for name, check in list(globals().items()):
        if name.startswith("test_"):
            check()
            print("ok", name)
