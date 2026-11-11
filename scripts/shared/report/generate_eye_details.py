"""Generates high-resolution side-by-side eye comparison images for all models.
Left: FLUX 2D art eye crop.
Right: 3D model / preview eye crop.
Labels and match score metrics indicate compliance.
Output: public/models/<id>/eye-detail.webp
"""
import json
import os
import sqlite3
import sys
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'stage-3' / 'python'))
from art_eye import NoArtEye, drawn_eyes
from find_art_eye import check_override

PAPER_BG = (236, 235, 231)
VEHICLE_SUBJECTS = {'plane', 'police-car', 'tractor', 'fire-truck', 'submarine', 'train'}
OUTPUT_WIDTH = 400
OUTPUT_HEIGHT = 175
EYE_SIZE = 120


def load_eye_settings():
    db = sqlite3.connect('resources/papikapi.db')
    row = db.cursor().execute('SELECT config FROM pipeline_versions WHERE is_active = 1').fetchone()
    db.close()
    config = json.loads(row[0])
    for stage in config['pipeline_stages']:
        for step in stage['steps']:
            if step['id'] == 's3-step-1':
                return step['eyes']
    raise RuntimeError("No eye settings found in pipeline config")


def make_vehicle_image(output_path):
    img = np.full((OUTPUT_HEIGHT, OUTPUT_WIDTH, 3), PAPER_BG, dtype=np.uint8)
    cv2.rectangle(img, (20, 20), (OUTPUT_WIDTH - 20, OUTPUT_HEIGHT - 20), (210, 207, 200), 1)
    text1 = "VEHICLE — NO EYES REQUIRED"
    text2 = "N/A (Standard Vehicle Body)"
    s1 = cv2.getTextSize(text1, cv2.FONT_HERSHEY_SIMPLEX, 0.50, 1)[0]
    s2 = cv2.getTextSize(text2, cv2.FONT_HERSHEY_SIMPLEX, 0.40, 1)[0]
    cv2.putText(img, text1, ((OUTPUT_WIDTH - s1[0]) // 2, 80), cv2.FONT_HERSHEY_SIMPLEX, 0.50, (120, 118, 112), 1, cv2.LINE_AA)
    cv2.putText(img, text2, ((OUTPUT_WIDTH - s2[0]) // 2, 110), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (150, 147, 140), 1, cv2.LINE_AA)
    cv2.imwrite(output_path, img)


def extract_art_crop(cutout, mid, settings):
    override = check_override(f"resources/{mid}/stage-2/step-1-art-cutout.webp")
    centre = None
    radius = None

    if override and override.get("found", False) and override.get("eyes"):
        eye = override["eyes"][0]
        centre = eye["centre"]
        h, w = eye["shape"]
        radius = int(round(max(h, w) * 1.05))
    else:
        rgba = cv2.cvtColor(cutout, cv2.COLOR_BGRA2RGBA).astype(np.float32) / 255.0
        try:
            eyes = drawn_eyes(rgba, settings)
            e = eyes[0]
            centre = e.centre
            h, w = e.mask.shape
            radius = int(round(max(h, w) * 1.05))
        except NoArtEye:
            alpha = cutout[..., 3] > 50 if cutout.shape[2] == 4 else np.any(cutout > 20, axis=-1)
            rows, cols = np.where(alpha)
            if len(rows) == 0:
                return None, None
            centre = (int(rows.min() + (rows.max() - rows.min()) * 0.25), int(cols.mean()))
            radius = 70

    cy, cx = int(round(centre[0])), int(round(centre[1]))
    radius = max(radius, 60)
    y0, y1 = max(0, cy - radius), min(cutout.shape[0], cy + radius)
    x0, x1 = max(0, cx - radius), min(cutout.shape[1], cx + radius)
    crop = cutout[y0:y1, x0:x1]

    # Pad with PAPER_BG if the crop was clipped by the image edge
    pad_top = max(0, -(cy - radius))
    pad_bottom = max(0, (cy + radius) - cutout.shape[0])
    pad_left = max(0, -(cx - radius))
    pad_right = max(0, (cx + radius) - cutout.shape[1])
    if pad_top > 0 or pad_bottom > 0 or pad_left > 0 or pad_right > 0:
        bg_col = (*PAPER_BG, 255) if crop.shape[2] == 4 else PAPER_BG
        crop = cv2.copyMakeBorder(crop, pad_top, pad_bottom, pad_left, pad_right, cv2.BORDER_CONSTANT, value=bg_col)

    return crop, (cy, cx)


def match_in_preview(preview, art_crop):
    if art_crop is None or art_crop.size == 0:
        return None, 0.0

    art_bgr = art_crop[:, :, :3]
    h_art, w_art = art_bgr.shape[:2]

    # Handle transparent background by compositing onto PAPER_BG
    if preview.shape[2] == 4:
        alpha_mask = preview[..., 3] > 80
        fg = preview[..., :3].astype(np.float32)
        alpha_f = (preview[..., 3:4].astype(np.float32) / 255.0)
        bg_f = np.full_like(fg, PAPER_BG, dtype=np.float32)
        preview_bgr = (fg * alpha_f + bg_f * (1.0 - alpha_f)).astype(np.uint8)
    else:
        preview_bgr = preview[:, :, :3]
        alpha_mask = np.any(np.abs(preview_bgr.astype(int) - np.array(PAPER_BG)) > 15, axis=-1)

    rows, cols = np.where(alpha_mask)
    if len(rows) == 0:
        return None, 0.0

    rmin, rmax = rows.min(), rows.max()
    cmin, cmax = cols.min(), cols.max()

    # Include up to 72% of model height to cover quadruped heads while excluding human legs/hands
    head_rmax = int(rmin + (rmax - rmin) * 0.72)
    head_preview = preview_bgr[rmin:head_rmax, cmin:cmax]
    head_alpha = alpha_mask[rmin:head_rmax, cmin:cmax]
    int_alpha = cv2.integral(head_alpha.astype(np.uint8))

    best_score = -1.0
    best_crop = None
    art_has_glint = (art_bgr.max() > 200) and (art_bgr.min() < 70)
    art_is_blue = (art_bgr[:, :, 0].mean() > art_bgr[:, :, 2].mean() + 15)
    art_is_green = (art_bgr[:, :, 1].mean() > art_bgr[:, :, 0].mean() + 15) and (art_bgr[:, :, 1].mean() > art_bgr[:, :, 2].mean() + 15)

    for scale in np.linspace(0.35, 1.35, 38):
        h = int(h_art * scale)
        w = int(w_art * scale)
        if h >= head_preview.shape[0] or w >= head_preview.shape[1] or h < 14 or w < 14:
            continue
        resized = cv2.resize(art_bgr, (w, h))
        res = cv2.matchTemplate(head_preview, resized, cv2.TM_CCOEFF_NORMED)

        # Vectorized patch alpha mean via integral image: mask out background void
        patch_alpha_sum = (
            int_alpha[h:h+res.shape[0], w:w+res.shape[1]]
            - int_alpha[0:res.shape[0], w:w+res.shape[1]]
            - int_alpha[h:h+res.shape[0], 0:res.shape[1]]
            + int_alpha[0:res.shape[0], 0:res.shape[1]]
        )
        patch_alpha_mean = patch_alpha_sum / (h * w)
        res[patch_alpha_mean < 0.60] = -1.0

        flat = res.flatten()
        top_k = min(15, len(flat))
        top_indices = np.argsort(flat)[-top_k:]

        for idx in top_indices:
            raw_score = flat[idx]
            if raw_score < 0.2:
                continue
            y, x = np.unravel_index(idx, res.shape)

            patch = head_preview[y:y+h, x:x+w]
            patch_std = float(patch.std())
            patch_rng = float(patch.max() - patch.min())
            if patch_std < 18.0 or patch_rng < 50.0:
                continue
            if patch.mean() < 25.0 or patch.mean() > 235.0:
                continue

            score = float(raw_score)
            if art_has_glint and (patch.max() > 170) and (patch.min() < 65):
                score += 0.15
            elif art_has_glint and patch.max() < 140:
                # Penalize patches without any glint when eye has one (e.g. plain cheetah spots)
                score -= 0.25

            if art_is_blue:
                if patch[:, :, 0].mean() > patch[:, :, 2].mean() + 10:
                    score += 0.20
                else:
                    score -= 0.25

            if art_is_green:
                if (patch[:, :, 1].mean() > patch[:, :, 0].mean() + 10) and (patch[:, :, 1].mean() > patch[:, :, 2].mean() + 10):
                    score += 0.20
                else:
                    score -= 0.25

            if score > best_score:
                best_score = score
                best_crop = patch

    final_score = max(0.0, min(1.0, best_score))
    return best_crop, final_score


def fit_square(img, size=120, bg=PAPER_BG):
    if img is None or img.size == 0:
        return np.full((size, size, 3), bg, dtype=np.uint8)
    if img.ndim == 3 and img.shape[2] == 4:
        alpha = img[..., 3:4].astype(np.float32) / 255.0
        fg = img[..., :3].astype(np.float32)
        bg_arr = np.full_like(fg, bg, dtype=np.float32)
        bgr = (fg * alpha + bg_arr * (1.0 - alpha)).astype(np.uint8)
    else:
        bgr = img[:, :, :3]
    h, w = bgr.shape[:2]
    scale = size / max(h, w)
    nh, nw = max(1, int(round(h * scale))), max(1, int(round(w * scale)))
    resized = cv2.resize(bgr, (nw, nh), interpolation=cv2.INTER_AREA if scale < 1.0 else cv2.INTER_LINEAR)
    canvas = np.full((size, size, 3), bg, dtype=np.uint8)
    y_off = (size - nh) // 2
    x_off = (size - nw) // 2
    canvas[y_off:y_off+nh, x_off:x_off+nw] = resized
    return canvas


def build_comparison_image(art_crop, preview_crop, score, mid, output_path):
    canvas = np.full((OUTPUT_HEIGHT, OUTPUT_WIDTH, 3), PAPER_BG, dtype=np.uint8)
    
    # Left box: FLUX Art (aspect-ratio preserved)
    art_sq = fit_square(art_crop, EYE_SIZE)
        
    # Right box: 3D Preview (aspect-ratio preserved)
    prev_sq = fit_square(preview_crop, EYE_SIZE)
        
    # Paste left and right inside Y=20..140
    canvas[20:20+EYE_SIZE, 40:40+EYE_SIZE] = art_sq
    canvas[20:20+EYE_SIZE, 240:240+EYE_SIZE] = prev_sq
    
    # Border around images
    cv2.rectangle(canvas, (39, 19), (40+EYE_SIZE, 20+EYE_SIZE), (210, 207, 200), 1)
    cv2.rectangle(canvas, (239, 19), (240+EYE_SIZE, 20+EYE_SIZE), (210, 207, 200), 1)
    
    # Labels above boxes
    cv2.putText(canvas, "FLUX ART", (40, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (100, 98, 92), 1, cv2.LINE_AA)
    cv2.putText(canvas, "3D MODEL", (240, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.36, (100, 98, 92), 1, cv2.LINE_AA)
    
    # Status / verdict pill at bottom (Y=160, safely separated from box bottom at Y=140)
    is_pass = score >= 0.50
    status_text = f"MATCH: {int(score * 100)}% (PASS)" if is_pass else f"SCORE: {int(score * 100)}% (FAIL / MISMATCH)"
    color = (30, 140, 30) if is_pass else (30, 30, 200)
    
    text_size = cv2.getTextSize(status_text, cv2.FONT_HERSHEY_SIMPLEX, 0.38, 1)[0]
    text_x = (OUTPUT_WIDTH - text_size[0]) // 2
    cv2.putText(canvas, status_text, (text_x, 160), cv2.FONT_HERSHEY_SIMPLEX, 0.38, color, 1, cv2.LINE_AA)
    cv2.imwrite(output_path, canvas)
    return is_pass, score


def main():
    settings = load_eye_settings()
    db = sqlite3.connect('resources/papikapi.db')
    cursor = db.cursor()
    models = cursor.execute("SELECT m.id, COALESCE(m.display_name_en, m.subject), m.subject FROM models m ORDER BY m.id").fetchall()
    db.close()
    
    print(f"Generating eye comparison details for {len(models)} models...")
    stats = {"pass": 0, "fail": 0, "vehicle": 0}
    
    for mid, name, subject in models:
        out_dir = Path(f"public/models/{mid}")
        out_dir.mkdir(parents=True, exist_ok=True)
        out_file = str(out_dir / "eye-detail.webp")
        
        if subject in VEHICLE_SUBJECTS:
            make_vehicle_image(out_file)
            stats["vehicle"] += 1
            print(f"  {mid} ({name:<20}): VEHICLE (no eyes)")
            continue
            
        cutout_path = f"resources/{mid}/stage-2/step-1-art-cutout.webp"
        preview_path = f"public/models/{mid}/preview-three-quarter.webp"
        
        if not os.path.exists(cutout_path) or not os.path.exists(preview_path):
            print(f"  {mid} ({name:<20}): MISSING FILES")
            stats["fail"] += 1
            continue
            
        cutout = cv2.imread(cutout_path, cv2.IMREAD_UNCHANGED)
        preview = cv2.imread(preview_path, cv2.IMREAD_UNCHANGED)
        
        art_crop, centre = extract_art_crop(cutout, mid, settings)
        prev_crop, score = match_in_preview(preview, art_crop)
        
        passed, score = build_comparison_image(art_crop, prev_crop, score, mid, out_file)
        if passed:
            stats["pass"] += 1
            print(f"  {mid} ({name:<20}): PASS (Score: {int(score*100)}%)")
        else:
            stats["fail"] += 1
            print(f"  {mid} ({name:<20}): FAIL (Score: {int(score*100)}%)")
            
    print(f"\nCompleted: {stats['pass']} PASS, {stats['fail']} FAIL, {stats['vehicle']} VEHICLE")


if __name__ == '__main__':
    main()
