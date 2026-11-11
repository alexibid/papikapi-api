"""s1-step-3: enlarges the chosen FLUX art and keeps the result as the step's own image."""
import argparse
import json
from pathlib import Path

import cv2

from superres import super_resolve

LOSSLESS_WEBP = [cv2.IMWRITE_WEBP_QUALITY, 101]


def parser_of() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Enlarge the chosen FLUX art")
    for name in ("--art", "--out", "--sr-binary", "--sr-model"):
        parser.add_argument(name, required=True)
    parser.add_argument("--sr-scale", type=int, default=4)
    return parser


def main():
    arguments = parser_of().parse_args()
    art = cv2.imread(arguments.art, cv2.IMREAD_COLOR)
    enlarged, method = super_resolve(art, Path(arguments.sr_binary).expanduser(), arguments.sr_model,
                                     arguments.sr_scale)
    cv2.imwrite(arguments.out, enlarged, LOSSLESS_WEBP)
    print(json.dumps({"sourceSize": list(art.shape[1::-1]), "upscaledSize": list(enlarged.shape[1::-1]),
                      "method": method}))


if __name__ == "__main__":
    main()
