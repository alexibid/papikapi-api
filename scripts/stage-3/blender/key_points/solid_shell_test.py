"""Synthetic checks of the closed shell, run inside Blender:
blender -b --factory-startup -P scripts/stage-3/blender/key_points/solid_shell_test.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import bmesh
from mathutils import Matrix, Vector

from mesh_quality import enclosed_volume, open_and_non_manifold_edges
from solid_shell import solid_shell

CELL = 0.02
SPIKE_TIP = 1.4


def spiked_cube_with_inner_wall():
    surface = bmesh.new()
    bmesh.ops.create_cube(surface, size=2.0)
    inner = bmesh.ops.create_cube(surface, size=1.6)["verts"]
    bmesh.ops.reverse_faces(surface, faces=list({face for vertex in inner for face in vertex.link_faces}))
    bmesh.ops.create_cone(surface, cap_ends=True, segments=4, radius1=0.3, radius2=0.0, depth=0.8,
                          matrix=Matrix.Translation(Vector((0.0, 0.0, 1.0))))
    surface.normal_update()
    return surface


def test_shell_is_closed_although_the_figure_has_an_inner_wall() -> None:
    surface = spiked_cube_with_inner_wall()
    shell = solid_shell(surface, CELL)
    open_edges, non_manifold = open_and_non_manifold_edges(shell)
    assert open_edges == 0 and non_manifold == 0, (open_edges, non_manifold)


def test_spike_keeps_its_tip() -> None:
    surface = spiked_cube_with_inner_wall()
    shell = solid_shell(surface, CELL)
    top = max(vertex.co.z for vertex in shell.verts)
    assert abs(top - SPIKE_TIP) < CELL, top


def test_inner_wall_does_not_hollow_the_solid() -> None:
    surface = spiked_cube_with_inner_wall()
    shell = solid_shell(surface, CELL)
    volume = enclosed_volume(shell)
    assert abs(volume - 8.0) / 8.0 < 0.05, volume


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
