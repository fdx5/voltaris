"""Render the actual GLBs for armament buttons and an asset inspection sheet.
blender --background --python tools/blender/render-player-loadout.py
"""
import bpy, math, os
from mathutils import Vector

ROOT = os.getcwd()
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 32
scene.render.resolution_x = 720
scene.render.resolution_y = 360
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGBA'
scene.render.film_transparent = True
scene.world.color = (0.22, 0.22, 0.22)
scene.view_settings.view_transform = 'AgX'
bpy.ops.object.camera_add(location=(0.8, -8, 4.5))
camera = bpy.context.object
camera.rotation_euler = (Vector((0,0,0)) - camera.location).to_track_quat('-Z', 'Y').to_euler()
camera.data.type = 'ORTHO'
camera.data.ortho_scale = 4.5
scene.camera = camera
for pos, power, size in [((1,-4,6),650,5),((-2,3,4),850,4),((0,-3,-3),250,4)]:
    bpy.ops.object.light_add(type='AREA', location=pos)
    lamp = bpy.context.object
    lamp.data.energy = power
    lamp.data.shape = 'DISK'
    lamp.data.size = size
    lamp.rotation_euler = (-lamp.location).to_track_quat('-Z','Y').to_euler()
os.makedirs('public/images/ships',exist_ok=True)
os.makedirs('.local/player-review',exist_ok=True)
for label, path in [
    ('laser','.local/player-review/laser.glb'),
    ('missile','public/models/player/missile-ship.glb'),
    ('spread','public/models/player/spread-ship.glb'),
    *[(n,'public/models/player/'+n+'.glb') for n in ['missile-main','missile-option','spread-main','spread-option']]
]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,path))
    objects = set(bpy.data.objects) - before
    bpy.context.view_layer.update()
    # Fit projected bounds, including broad wings, with consistent safe margins.
    inv = camera.matrix_world.inverted()
    verts = [inv @ obj.matrix_world @ Vector(v) for obj in objects if obj.type=='MESH' for v in obj.bound_box]
    width = max(v.x for v in verts)-min(v.x for v in verts)
    height = max(v.y for v in verts)-min(v.y for v in verts)
    camera.data.ortho_scale = max(width,height*2)*1.15
    dest = 'public/images/ships' if label in ['laser','missile','spread'] else '.local/player-review'
    scene.render.filepath = os.path.join(ROOT,dest,label+'.png')
    bpy.ops.render.render(write_still=True)
    for obj in objects: bpy.data.objects.remove(obj,do_unlink=True)
