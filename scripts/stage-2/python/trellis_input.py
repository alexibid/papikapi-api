import argparse
import json

import cv2
import numpy as np

from figure_matte import best_figure_mask, figure_prompt, main_parts, trimap
from holes import fill_enclosed_holes
from supports import with_supports, without_threads
from plane_mask import background_of, drawn_area, plane_prompt, widest_plane
from whiskers import remove_whiskers

LOSSLESS_WEBP = [cv2.IMWRITE_WEBP_QUALITY, 101]

MARGIN_RATIO = 0.02


def read_art(path: str) -> np.ndarray:
    return cv2.imread(path, cv2.IMREAD_COLOR)


def read_plane(path: str, art: np.ndarray) -> np.ndarray:
    if not path:
        return np.zeros(art.shape[:2], bool)
    return widest_plane(cv2.imread(path, cv2.IMREAD_COLOR) > 127, drawn_area(art))


def read_figure_masks(path: str) -> np.ndarray:
    return cv2.imread(path, cv2.IMREAD_COLOR) > 127


def fit_canvas(bgr: np.ndarray, mask: np.ndarray, side: int) -> tuple[np.ndarray, np.ndarray]:
    ys, xs = np.nonzero(mask)
    crop = (slice(ys.min(), ys.max() + 1), slice(xs.min(), xs.max() + 1))
    scale = side * (1.0 - 2 * MARGIN_RATIO) / max(np.ptp(ys) + 1, np.ptp(xs) + 1)
    size = (round((np.ptp(xs) + 1) * scale), round((np.ptp(ys) + 1) * scale))
    colour = np.empty((side, side, 3), np.uint8)
    colour[:] = background_of(bgr)
    shape = np.zeros((side, side), bool)
    top, left = (side - size[1]) // 2, (side - size[0]) // 2
    colour[top:top + size[1], left:left + size[0]] = cv2.resize(bgr[crop], size, interpolation=cv2.INTER_AREA)
    resized_mask = cv2.resize(mask[crop].astype(np.float32), size, interpolation=cv2.INTER_AREA)
    shape[top:top + size[1], left:left + size[0]] = resized_mask > 0.5
    return colour, shape


def prepare(arguments: argparse.Namespace) -> dict:
    art = read_art(arguments.art)
    plane = read_plane(arguments.plane_mask, art)
    chosen = best_figure_mask(read_figure_masks(arguments.figure_masks), art, plane)
    figure = without_threads(with_supports(chosen, art, plane))
    cutout = np.dstack([art, figure.astype(np.uint8) * 255])
    cv2.imwrite(arguments.out_cutout, cutout, LOSSLESS_WEBP)
    clean, whisker_pixels = remove_whiskers(cutout)
    colour, shape = fit_canvas(clean, figure, arguments.size)
    cv2.imwrite(arguments.out_colour, colour)
    cv2.imwrite(arguments.out_trimap, trimap(shape))
    return {"planePixels": int(plane.sum()), "figurePixels": int(figure.sum()), "whiskerPixels": whisker_pixels,
            "artSize": list(art.shape[1::-1]), "size": arguments.size}


def compose(arguments: argparse.Namespace) -> dict:
    colour = cv2.imread(arguments.colour, cv2.IMREAD_COLOR)
    alpha, hole_pixels = fill_enclosed_holes(main_parts(cv2.imread(arguments.alpha, cv2.IMREAD_GRAYSCALE)))
    cv2.imwrite(arguments.out, np.dstack([colour, alpha]), LOSSLESS_WEBP)
    return {"holePixels": hole_pixels}


def prompt_for_plane(arguments: argparse.Namespace) -> dict:
    return plane_prompt(read_art(arguments.art))


def prompt_for_figure(arguments: argparse.Namespace) -> dict:
    art = read_art(arguments.art)
    return figure_prompt(art, read_plane(arguments.plane_mask, art))


def parser_of() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Cut the FLUX figure out by its shape for TRELLIS")
    modes = parser.add_subparsers(dest="mode", required=True)
    plane = modes.add_parser("plane-prompt", help="points on the plane and on the body for SAM")
    plane.add_argument("--art", required=True)
    figure = modes.add_parser("figure-prompt", help="box and points of the figure for SAM")
    figure.add_argument("--art", required=True)
    figure.add_argument("--plane-mask", default="")
    prepare_parser = modes.add_parser("prepare", help="pick the figure mask and build the canvas and trimap")
    for name in ("--art", "--figure-masks", "--out-cutout", "--out-colour", "--out-trimap"):
        prepare_parser.add_argument(name, required=True)
    prepare_parser.add_argument("--plane-mask", default="")
    prepare_parser.add_argument("--size", type=int, default=1024)
    compose_parser = modes.add_parser("compose", help="join the colour canvas with the matted alpha")
    for name in ("--colour", "--alpha", "--out"):
        compose_parser.add_argument(name, required=True)
    return parser


def main():
    arguments = parser_of().parse_args()
    handlers = {"plane-prompt": prompt_for_plane, "figure-prompt": prompt_for_figure,
                "prepare": prepare, "compose": compose}
    print(json.dumps(handlers[arguments.mode](arguments)))


if __name__ == "__main__":
    main()
