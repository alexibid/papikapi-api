"""Moves the TRELLIS input into stage 2 and gives the upscaled FLUX art its own step (s1-step-3).

New layout: s1-step-3 upscale (stage-1/step-3-upscaled.png), s2-step-1 TRELLIS input
(stage-2/step-1-art-cutout.png), s2-step-2 TRELLIS (stage-2/step-2-3d.glb), s2-step-3 eyes
(stage-2/step-3-details.glb). Figures built with the old TRELLIS 1 pipeline already use these file names and
are left alone; figures built since the TRELLIS input lived in s1-step-3 are renamed.

python3 scripts/shared/migrations/stage-2-layout.py [--apply]   (stop the API container first)
"""
import copy
import json
import sqlite3
import sys
from pathlib import Path

APP = Path(__file__).resolve().parents[3]
DB = APP / "resources" / "papikapi.db"
FILE_MOVES = (
    ("stage-1/step-3-trellis-input.png", "stage-2/step-1-art-cutout.png"),
    ("stage-1/step-3-cutout.png", "stage-2/step-1-figure-cutout.png"),
    ("stage-1/step-3-manifest.json", "stage-2/step-1-manifest.json"),
    ("stage-2/step-2-details.glb", "stage-2/step-3-details.glb"),
    ("stage-2/step-2-manifest.json", "stage-2/step-3-manifest.json"),
    ("stage-2/step-1-3d.glb", "stage-2/step-2-3d.glb"),
    ("stage-2/step-1-preview.png", "stage-2/step-2-preview.png"),
    ("stage-2/step-1-manifest.json", "stage-2/step-2-manifest.json"),
)
PATH_RENAMES = (
    ("stage-1/step-3-trellis-input.png", "stage-2/step-1-art-cutout.png"),
    ("stage-1/step-3-cutout.png", "stage-2/step-1-figure-cutout.png"),
    ("stage-2/step-2-details.glb", "stage-2/step-3-details.glb"),
    ("stage-2/step-1-3d", "stage-2/step-2-3d"),
    ("stage-2/step-1-preview.png", "stage-2/step-2-preview.png"),
)
STAGE_RENAMES = (("s2-step-2", "s2-step-3"), ("s2-step-1", "s2-step-2"), ("s1-step-3", "s2-step-1"))


def upscale_step(old_input: dict) -> dict:
    return {
        "id": "s1-step-3", "name": "Upscale Art", "label": "UPSCALE", "emoji": "🔍", "expected_seconds": 10,
        "script": "scripts/stage-1/step-3-upscale.ts", "stage_dir": "stage-1",
        "depends_on": {"step_id": "s1-step-2", "stage_dir": "stage-1"},
        "models_from": "resources/*/stage-1/step-2-art.jpeg",
        "inputs": {"stage_dir": "stage-1", "art_resource": "step-2-art.jpeg"},
        "outputs": {"stage_dir": "stage-1", "upscaled_resource": "step-3-upscaled.png",
                    "manifest": "step-3-manifest.json"},
        "parameters": {"python_script": "scripts/stage-1/python/upscale.py",
                       "super_resolution": old_input["parameters"]["super_resolution"]},
        "messages": {"start": "[Stage 1: Step 3] Upscaling the chosen art of {model}",
                     "completed": "✔ [Stage 1: Step 3] Art of {model} upscaled with {method} in {duration}s ($0.00)"},
        "manifest_contract": old_input["manifest_contract"],
    }


def trellis_input_step(old_input: dict) -> dict:
    step = copy.deepcopy(old_input)
    step.update({
        "id": "s2-step-1", "script": "scripts/stage-2/step-1-trellis-input.ts", "stage_dir": "stage-2",
        "depends_on": {"step_id": "s1-step-3", "stage_dir": "stage-1"},
        "models_from": "resources/*/stage-1/step-3-upscaled.png",
        "inputs": {"stage_dir": "stage-1", "art_resource": "step-3-upscaled.png"},
        "outputs": {"stage_dir": "stage-2", "cutout_resource": "step-1-figure-cutout.png",
                    "trellis_input_resource": "step-1-art-cutout.png", "manifest": "step-1-manifest.json"},
        "parameters": {"python_script": "scripts/stage-2/python/trellis_input.py",
                       "image_size": old_input["parameters"]["image_size"]},
        "messages": {"start": "[Stage 2: Step 1] Cutting {model} out of the upscaled art for TRELLIS (SAM + ViTMatte)",
                     "completed": "✔ [Stage 2: Step 1] TRELLIS input ready for {model} in {duration}s ($0.00)"},
    })
    return step


def renamed(value):
    text = json.dumps(value, ensure_ascii=False)
    for old, new in (("step-1-3d", "step-2-3d"), ("step-1-preview", "step-2-preview"),
                     ("step-2-details", "step-3-details")):
        text = text.replace(old, new)
    return json.loads(text)


def trellis_step(old: dict) -> dict:
    step = renamed(old)
    step.update({"id": "s2-step-2", "script": "scripts/stage-2/step-2-trellis.ts",
                 "depends_on": {"step_id": "s2-step-1", "stage_dir": "stage-2"},
                 "models_from": "resources/*/stage-2/step-1-art-cutout.png"})
    step["inputs"].update({"stage_dir": "stage-2", "trellis_input_resource": "step-1-art-cutout.png"})
    step["outputs"]["manifest"] = "step-2-manifest.json"
    step["messages"]["start"] = step["messages"]["start"].replace("Stage 2: Step 1", "Stage 2: Step 2")
    return step


def details_step(old: dict) -> dict:
    step = renamed(old)
    step.update({"id": "s2-step-3", "script": "scripts/stage-2/step-3-details.ts",
                 "depends_on": {"step_id": "s2-step-2", "stage_dir": "stage-2"},
                 "models_from": "resources/*/stage-2/step-2-3d.glb"})
    step["inputs"].update({"art_stage_dir": "stage-2", "art_resource": "step-1-art-cutout.png"})
    step["outputs"]["manifest"] = "step-3-manifest.json"
    step["messages"] = {key: text.replace("Stage 2: Step 2", "Stage 2: Step 3").replace("zsh.00", "$0.00")
                        for key, text in step["messages"].items()}
    return step


def migrated_config(config: dict) -> dict:
    steps = {step["id"]: step for stage in config["pipeline_stages"] for step in stage["steps"]}
    if steps.get("s1-step-3", {}).get("script", "").endswith("step-3-upscale.ts"):
        return config
    stage_1, stage_2 = config["pipeline_stages"][0], config["pipeline_stages"][1]
    stage_1["steps"] = [steps["s1-step-1"], steps["s1-step-2"], upscale_step(steps["s1-step-3"])]
    stage_2["steps"] = [trellis_input_step(steps["s1-step-3"]), trellis_step(steps["s2-step-1"]),
                        details_step(steps["s2-step-2"])]
    for stage in config["pipeline_stages"][2:]:
        stage["steps"] = [renamed(step) for step in stage["steps"]]
    stage_3 = config["pipeline_stages"][2]["steps"][0]
    stage_3["depends_on"] = {"step_id": "s2-step-3", "stage_dir": "stage-2"}
    return config


def recent_figures() -> list[Path]:
    return sorted(folder for folder in (APP / "resources").iterdir()
                  if (folder / "stage-1" / "step-3-trellis-input.png").exists()
                  and not (folder / "stage-2" / "step-2-3d.glb").exists())


def move_files(figure: Path, apply: bool) -> list[str]:
    moved = []
    for old, new in FILE_MOVES:
        source, target = figure / old, figure / new
        if source.exists() and not target.exists():
            moved.append(f"{old} -> {new}")
            if apply:
                target.parent.mkdir(parents=True, exist_ok=True)
                source.rename(target)
    for pick in sorted((figure / "stage-2").glob("step-1-3d-pick-*.glb")):
        target = pick.with_name(pick.name.replace("step-1-3d", "step-2-3d"))
        if not target.exists():
            moved.append(f"stage-2/{pick.name} -> stage-2/{target.name}")
            if apply:
                pick.rename(target)
    return moved


def rename_rows(db: sqlite3.Connection, figure_id: str) -> None:
    for old, new in STAGE_RENAMES:
        db.execute("update model_stages set stage_id=? where model_id=? and stage_id=?", (new, figure_id, old))
    for old, new in PATH_RENAMES:
        db.execute("update model_stages set data=replace(data, ?, ?) where model_id=?", (old, new, figure_id))
    db.execute("""delete from model_stages where model_id=? and stage_id='s2-step-3' and id=model_id || '-s2-step-3'
                  and timestamp < (select max(timestamp) from model_stages m
                                   where m.model_id=model_stages.model_id and m.stage_id='s2-step-3')""", (figure_id,))
    db.execute("update model_stages set id='tmp-' || id where model_id=? and id != model_id || '-' || stage_id",
               (figure_id,))
    db.execute("update model_stages set id=model_id || '-' || stage_id where model_id=? and id like 'tmp-%'",
               (figure_id,))


def main():
    apply = "--apply" in sys.argv
    db = sqlite3.connect(DB)
    row = db.execute("select id, config from pipeline_versions where is_active=1").fetchone()
    config = migrated_config(json.loads(row[1]))
    print("steps:", [step["id"] + " " + step["name"] for stage in config["pipeline_stages"][:3] for step in stage["steps"]])
    for figure in recent_figures():
        print(figure.name, move_files(figure, apply))
        if apply:
            rename_rows(db, figure.name)
    if apply:
        db.execute("update pipeline_versions set config=? where id=?", (json.dumps(config, ensure_ascii=False), row[0]))
        db.commit()
    print("applied" if apply else "dry run: nothing changed")


if __name__ == "__main__":
    main()
