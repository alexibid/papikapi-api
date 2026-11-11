"""Places the eyes of the FLUX art on the eyes TRELLIS painted. The art eye was found on the art beforehand
(scripts/stage-3/python/find_art_eye.py). The recovered art camera only gives a first guess of where it lies on the
figure; the TRELLIS figure is then seen through that camera around the guess (through the mirrored camera for the far
eye) and the TRELLIS eye is found there by matching the art eye against it. Its centre is where the art eye goes, and
its pixels are the ones erased.

Spots are given in the frame of the TRELLIS model plus `offset` (the grounded frame of the simplified figure);
art_pixels maps such points back to the art, mirrored for the far eye, so painting copies the art eye pixel by
pixel. When the art shows both eyes, each is placed on its own TRELLIS eye; only a lone art eye is mirrored for
the hidden one."""
import json
from dataclasses import dataclass, replace

import bpy
import numpy as np
from mathutils import Vector

from art_camera import ArtCamera, close_cameras
from camera_choice import best_looking
from eye_match import Erasure, EyeMatch, erase, match_eye, trellis_eye
from eye_view import EyeView, ViewCamera, view_around
from surface_transfer import detailed_surface
from symmetry import mirror_plane_x


class NoArtEye(RuntimeError):
    """The figure keeps its TRELLIS eyes: the art has no eye with a catchlight, or it cannot be placed safely."""


@dataclass(frozen=True)
class ArtEye:
    centre: tuple
    origin: tuple
    mask: np.ndarray


@dataclass(frozen=True)
class EyeSpot:
    art_eye: ArtEye
    centre: np.ndarray
    normal: np.ndarray
    radius: float
    mirrored: bool
    view: EyeView
    match: EyeMatch
    erasure: Erasure


@dataclass(frozen=True)
class FigureEyes:
    art_rgb: np.ndarray
    camera: ArtCamera
    offset: np.ndarray
    mirror_x: float
    spots: tuple

    def art_pixels(self, points, spot):
        local = points - self.offset
        if spot.mirrored:
            local = local.copy()
            local[:, 0] = 2 * self.mirror_x - local[:, 0]
        return self.camera.to_art(local)


def load_image(path):
    """Image as float RGBA, rows top to bottom."""
    image = bpy.data.images.load(path, check_existing=False)
    width, height = image.size
    pixels = np.empty(width * height * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(height, width, 4)[::-1].copy()


def read_art_eyes(eye_json, eye_labels):
    found = json.loads(open(eye_json).read())
    if not found["found"]:
        raise NoArtEye(found["reason"])
    labels = np.rint(load_image(eye_labels)[..., 0] * 255).astype(int)
    eyes = []
    for index, eye in enumerate(found["eyes"]):
        (top, left), (height, width) = eye["origin"], eye["shape"]
        eyes.append(ArtEye(centre=tuple(eye["centre"]), origin=(top, left),
                           mask=labels[top:top + height, left:left + width] == index + 1))
    return tuple(eyes)


def base_colour_image(material):
    for node in material.node_tree.nodes:
        if node.type == "TEX_IMAGE" and any(link.to_socket.name == "Base Color" for link in node.outputs[0].links):
            return node.image
    raise NoArtEye("The TRELLIS model has no base colour texture")


def model_surface(path):
    """Vertices and the textured surface of the TRELLIS model, in its own frame; the imported objects go again."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    added = [item for item in bpy.data.objects if item not in before]
    mesh_object = next(item for item in added if item.type == "MESH")
    mesh = mesh_object.data.copy()
    mesh.transform(mesh_object.matrix_world)
    surface = detailed_surface(mesh, base_colour_image(mesh_object.active_material))
    for item in added:
        bpy.data.objects.remove(item, do_unlink=True)
    points = np.array([tuple(vertex.co) for vertex in mesh.vertices])
    bpy.data.meshes.remove(mesh)
    return points, surface


def surface_spot(tree, origin, direction, reach):
    location, normal, _, _ = tree.ray_cast(Vector(origin), Vector(direction), reach)
    if location is None:
        return None
    normal = np.array(normal)
    return np.array(location), (normal if normal @ direction < 0 else -normal)


def eye_window(art_eye, settings):
    size = max(art_eye.mask.shape)
    half = round(size * (0.5 + settings["eye_match_window_ratio"]))
    return (round(art_eye.centre[0]) - half, round(art_eye.centre[1]) - half, 2 * half, 2 * half)


def placed_eye(found, art_eye, view_camera, sources, taken):
    """The spot of one art eye centred on the TRELLIS eye, or None when no TRELLIS eye is matched there."""
    surface, art_rgb, settings = sources
    span = float(np.ptp(surface[0].reshape(-1, 3), axis=0).max())
    view = view_around(surface, view_camera, eye_window(art_eye, settings), span)
    match = match_eye(view, art_rgb, art_eye, settings, taken) if view.seen.any() else None
    if match is None or match.score < settings["eye_match_score_min"]:
        return None
    placed = trellis_eye(view, art_eye, match, settings)
    if placed is None:
        return None
    match, region = placed
    origin, forward = view_camera.ray(*match.centre)
    hit = surface_spot(surface[2], origin - forward * span * 2, forward, span * 4)
    if hit is None:
        return None
    radius = max(art_eye.mask.shape) / 2 * match.scale * found.camera.art.scale / found.camera.model.scale
    return EyeSpot(art_eye=art_eye, centre=hit[0] + found.offset, normal=hit[1], radius=radius,
                   mirrored=view_camera.mirrored, view=view, match=match, erasure=erase(view, region))


def eye_cameras(art_eyes, camera, mirror_x):
    """Each eye the art shows, seen through the art camera; a lone eye also through the mirrored camera, for the
    eye the art hides."""
    plain = ViewCamera(camera=camera, mirror_x=mirror_x, mirrored=False)
    pairs = [(eye, plain) for eye in art_eyes]
    if len(art_eyes) == 1:
        pairs.append((art_eyes[0], ViewCamera(camera=camera, mirror_x=mirror_x, mirrored=True)))
    return pairs


def distinct(spots):
    """One spot per TRELLIS eye: two art eyes matched on the same TRELLIS eye keep the better match."""
    kept = []
    for spot in sorted(spots, key=lambda spot: -spot.match.score):
        if all(np.linalg.norm(spot.centre - other.centre) >= other.radius for other in kept):
            kept.append(spot)
    return tuple(kept)


def locate_eyes(paths, offset, settings):
    """paths: trellis_glb, art_cutout, art_eye_json, art_eye_mask."""
    art_eyes = read_art_eyes(paths["art_eye_json"], paths["art_eye_mask"])
    art = load_image(paths["art_cutout"])
    points, surface = model_surface(paths["trellis_glb"])
    camera = best_looking(close_cameras(points, art[..., 3], settings), surface, art, settings["camera_likeness_cells"])
    overlap_min = min(settings.get("camera_overlap_min", 0.50), 0.45)
    if camera.overlap < overlap_min:
        raise NoArtEye(f"The art camera fits the figure poorly ({camera.overlap:.2f})")
    mirror_x = mirror_plane_x(points, surface[2], settings["symmetry_search_ratio"])
    found = FigureEyes(art_rgb=art[..., :3], camera=camera, offset=np.asarray(offset, dtype=np.float64),
                       mirror_x=mirror_x, spots=())
    sources = (surface, art[..., :3], settings)
    spots = []
    for eye, view_camera in eye_cameras(art_eyes, camera, mirror_x):
        taken = [(spot.match.centre, max(spot.art_eye.mask.shape) / 2 * spot.match.scale)
                 for spot in spots if spot.mirrored == view_camera.mirrored]
        spot = placed_eye(found, eye, view_camera, sources, taken)
        if spot is not None:
            spots.append(spot)
    spots = distinct(spots)
    if not spots:
        raise NoArtEye("No TRELLIS eye matches the art eye")
    return replace(found, spots=spots)
