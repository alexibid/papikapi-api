import subprocess
import tempfile
from pathlib import Path

import cv2
import numpy as np

LANCZOS = "lanczos"


def run_model(binary: Path, model: str, scale: int, source: Path, target: Path) -> None:
    command = [str(binary), "-i", str(source), "-o", str(target), "-n", model, "-s", str(scale),
               "-m", str(binary.parent / "models")]
    outcome = subprocess.run(command, capture_output=True, text=True)
    if outcome.returncode != 0 or not target.exists():
        raise RuntimeError(f"Real-ESRGAN failed: {outcome.stderr[-400:]}")


def lanczos(bgr: np.ndarray, scale: int) -> np.ndarray:
    height, width = bgr.shape[:2]
    return cv2.resize(bgr, (width * scale, height * scale), interpolation=cv2.INTER_LANCZOS4)


def real_esrgan(bgr: np.ndarray, binary: Path, model: str, scale: int) -> np.ndarray:
    with tempfile.TemporaryDirectory() as folder:
        source, target = Path(folder) / "in.png", Path(folder) / "out.png"
        cv2.imwrite(str(source), bgr)
        run_model(binary, model, scale, source, target)
        return cv2.imread(str(target), cv2.IMREAD_COLOR)


def super_resolve(bgr: np.ndarray, binary: Path, model: str, scale: int) -> tuple[np.ndarray, str]:
    """Enlarged image and the method that made it: the Real-ESRGAN model, or lanczos when it is not installed."""
    if not binary.exists():
        return lanczos(bgr, scale), LANCZOS
    return real_esrgan(bgr, binary, model, scale), model
