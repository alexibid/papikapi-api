import bmesh

MAX_PASSES = 8


def face_diameter(face):
    points = [vertex.co for vertex in face.verts]
    return max((first - second).length for first in points for second in points)


def oversized_faces(surface, limit):
    return [face for face in surface.faces if face_diameter(face) > limit]


def long_edges(faces, limit):
    edges = {edge for face in faces for edge in face.edges if edge.calc_length() > limit / 2}
    return list(edges)


def split_oversized_faces(surface, length, max_extent_ratio):
    """Cuts faces wider than the paper allows. No grid fill: Blender crashes filling a triangle cut on all three
    edges, so cut faces stay polygons and are triangulated below."""
    limit = length * max_extent_ratio
    for _ in range(MAX_PASSES):
        faces = oversized_faces(surface, limit)
        if not faces:
            break
        bmesh.ops.subdivide_edges(surface, edges=long_edges(faces, limit), cuts=1, use_grid_fill=False)
    polygons = [face for face in surface.faces if len(face.verts) > 4]
    if polygons:
        bmesh.ops.triangulate(surface, faces=polygons)
    surface.normal_update()
