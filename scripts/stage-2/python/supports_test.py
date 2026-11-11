"""Synthetic checks of the wall, support and thread rules: python3 scripts/stage-2/python/supports_test.py"""
import cv2
import numpy as np

from plane_mask import background_wall
from supports import with_supports, without_threads

WALL = (213, 213, 213)
WHITE = (240, 240, 240)
OUTLINE = (150, 150, 150)
BLUE = (160, 60, 40)
SIZE = 300


def wall_scene() -> np.ndarray:
    image = np.full((SIZE, SIZE, 3), WALL, np.uint8)
    cv2.rectangle(image, (100, 80), (200, 220), OUTLINE, 3)
    image[83:218, 103:198] = WHITE
    return image


def test_the_wall_is_found_and_a_white_body_with_an_outline_is_not() -> None:
    wall = background_wall(wall_scene())
    assert wall[10, 10] and wall[250, 250]
    assert not wall[150, 150]


def post_scene() -> tuple:
    image = np.full((SIZE, SIZE, 3), WALL, np.uint8)
    image[240:, :] = BLUE
    image[160:240, 130:170] = BLUE
    image[60:160, 90:210] = WHITE
    plane = np.zeros((SIZE, SIZE), bool)
    plane[240:, :] = True
    figure = np.zeros((SIZE, SIZE), bool)
    figure[60:160, 90:210] = True
    return image, figure, plane


def test_a_post_between_the_figure_and_the_paper_joins_the_figure() -> None:
    image, figure, plane = post_scene()
    joined = with_supports(figure, image, plane)
    assert joined[200, 150]
    assert not joined[270, 50]


def test_a_thread_glued_to_the_figure_is_cut_off() -> None:
    figure = np.zeros((SIZE, SIZE), bool)
    figure[100:200, 100:200] = True
    figure[150:152, 0:100] = True
    clean = without_threads(figure)
    assert clean[150, 150]
    assert not clean[151, 40]


if __name__ == "__main__":
    test_the_wall_is_found_and_a_white_body_with_an_outline_is_not()
    test_a_post_between_the_figure_and_the_paper_joins_the_figure()
    test_a_thread_glued_to_the_figure_is_cut_off()
    print("supports_test: 3 passed")
