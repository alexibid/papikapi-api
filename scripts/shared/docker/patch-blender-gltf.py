"""Patches Blender 3.4 glTF importer to support EXT_texture_webp and modern NumPy."""
import os

gltf_io_path = '/usr/share/blender/scripts/addons/io_scene_gltf2/io/imp/gltf2_io_gltf.py'
if os.path.exists(gltf_io_path):
    with open(gltf_io_path, 'r', encoding='utf8') as f:
        content = f.read()
    if 'EXT_texture_webp' not in content:
        content = content.replace(
            "'KHR_materials_ior'",
            "'KHR_materials_ior',\n            'EXT_texture_webp'"
        )
        with open(gltf_io_path, 'w', encoding='utf8') as f:
            f.write(content)
        print("Patched gltf2_io_gltf.py with EXT_texture_webp")

gltf_tex_path = '/usr/share/blender/scripts/addons/io_scene_gltf2/blender/imp/gltf2_blender_texture.py'
if os.path.exists(gltf_tex_path):
    with open(gltf_tex_path, 'r', encoding='utf8') as f:
        content = f.read()
    if 'EXT_texture_webp' not in content:
        target = "if pytexture.source is not None:"
        replacement = """tex_source = pytexture.source
        if tex_source is None and pytexture.extensions and 'EXT_texture_webp' in pytexture.extensions:
            tex_source = pytexture.extensions['EXT_texture_webp'].get('source')
        if tex_source is not None:"""
        content = content.replace(target, replacement)
        content = content.replace("BlenderImage.create(mh.gltf, pytexture.source)", "BlenderImage.create(mh.gltf, tex_source)")
        content = content.replace("pyimg = mh.gltf.data.images[pytexture.source]", "pyimg = mh.gltf.data.images[tex_source]")
        with open(gltf_tex_path, 'w', encoding='utf8') as f:
            f.write(content)
        print("Patched gltf2_blender_texture.py with EXT_texture_webp source resolution")

gltf_mesh_path = '/usr/share/blender/scripts/addons/io_scene_gltf2/blender/imp/gltf2_blender_mesh.py'
if os.path.exists(gltf_mesh_path):
    with open(gltf_mesh_path, 'r', encoding='utf8') as f:
        content = f.read()
    if 'np.bool' in content:
        content = content.replace('np.bool', 'bool')
        with open(gltf_mesh_path, 'w', encoding='utf8') as f:
            f.write(content)
        print("Patched gltf2_blender_mesh.py for numpy bool compatibility")
