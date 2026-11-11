"""Closed shell of the TRELLIS figure that keeps its flat facets.

TRELLIS 2 meshes carry inner walls and small gaps, so the raw mesh is not a closed solid and Blender's voxel
remesh turns the gaps into pits. Here the figure is filled with voxels from the outside in: whatever the outside
cannot reach is solid, inner walls included. The boundary of that solid is a closed shell of cell faces, and each
shell vertex is pulled onto the nearest point of the TRELLIS surface, which brings back its facets and spikes
while the shell stays closed.
"""
import bmesh
from mathutils.bvhtree import BVHTree

from box_cells import seal_pinches
from box_surface import build_cell_surface
from box_voxels import voxel_occupancy


def solid_shell(surface, cell):
    grid, low = voxel_occupancy(surface, cell)
    occupied = seal_pinches(grid)
    planes = [[low[axis] + index * cell for index in range(occupied.shape[axis] + 1)] for axis in range(3)]
    shell = build_cell_surface(occupied, planes)
    snap_to_surface(shell, surface)
    bmesh.ops.triangulate(shell, faces=shell.faces)
    shell.normal_update()
    return shell


def snap_to_surface(shell, surface):
    tree = BVHTree.FromBMesh(surface)
    for vertex in shell.verts:
        vertex.co = tree.find_nearest(vertex.co)[0]
