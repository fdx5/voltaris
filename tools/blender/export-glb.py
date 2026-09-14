# Export one .blend to .glb: blender -b --factory-startup --python export-glb.py -- in.blend out.glb
import sys
import bpy

source, target = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.open_mainfile(filepath=source)
bpy.ops.export_scene.gltf(
    filepath=target,
    export_format='GLB',
    export_apply=True,
    export_cameras=False,
    export_lights=False,
    export_animations=False,
)
