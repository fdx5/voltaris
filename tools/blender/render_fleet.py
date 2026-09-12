"""Render inspection sheets from the editable Blender source, never concept art."""
import bpy, math, json
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parents[2]
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'art/blender/voltaris-fleet.blend'))
scene=bpy.context.scene
# Make the editable source open on the hero rather than 61 overlapping ships.
bpy.ops.object.select_all(action='DESELECT')
for obj in scene.objects:
    if obj.parent: obj.hide_set(obj.parent.name!='player')
hero_source=bpy.data.objects['player']; hero_source.select_set(True)
bpy.context.view_layer.objects.active=hero_source
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'art/blender/voltaris-fleet.blend'),compress=True)
for obj in scene.objects: obj.hide_set(False)
scene.render.engine='CYCLES'; scene.cycles.samples=24
scene.cycles.use_denoising=True
try:
    preferences=bpy.context.preferences.addons['cycles'].preferences
    preferences.compute_device_type='OPTIX'; preferences.get_devices()
    for device in preferences.devices: device.use=device.type!='CPU'
    if any(d.use for d in preferences.devices): scene.cycles.device='GPU'
except Exception:
    pass
scene.render.resolution_x=1600; scene.render.resolution_y=1100; scene.render.resolution_percentage=100
scene.world.color=(.16,.16,.16)
scene.view_settings.view_transform='AgX'
roots=[o for o in scene.objects if o.type=='EMPTY' and o.parent is None]
for o in roots:
    for c in o.children: c.hide_render=True

def light(loc,power,size,color):
    data=bpy.data.lights.new('studio / softbox','AREA'); data.energy=power; data.shape='DISK'; data.size=size; data.color=color
    obj=bpy.data.objects.new(data.name,data); scene.collection.objects.link(obj); obj.location=loc
    obj.rotation_euler=(Vector((0,0,0))-obj.location).to_track_quat('-Z','Y').to_euler()
light((-6,-3,16),3300,10,(.78,.88,1))
light((7,8,12),4200,8,(1,.85,.67))
light((0,-10,6),1700,7,(.42,.70,1))
bpy.ops.object.camera_add(location=(0,-13,29))
cam=bpy.context.object; cam.rotation_euler=(Vector((0,0,0))-cam.location).to_track_quat('-Z','Y').to_euler()
cam.data.type='ORTHO'; cam.data.ortho_scale=30; scene.camera=cam
out=ROOT/'doc/validation'; out.mkdir(parents=True,exist_ok=True)
labels=[]
ink=bpy.data.materials.new('inspection typography'); ink.diffuse_color=(.65,.78,.88,1); ink.use_nodes=True
shader=next(n for n in ink.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
shader.inputs['Base Color'].default_value=(.65,.78,.88,1)
shader.inputs['Emission Color'].default_value=(.65,.78,.88,1); shader.inputs['Emission Strength'].default_value=.5
def label(text,x,y,size=.25):
    data=bpy.data.curves.new('inspection caption','FONT'); data.body=text; data.size=size; data.align_x='CENTER'
    obj=bpy.data.objects.new('inspection caption',data); scene.collection.objects.link(obj)
    obj.location=(x,y,.1); obj.rotation_euler=cam.rotation_euler; obj.data.materials.append(ink); labels.append(obj)

def show(name,xy,scale=1):
    o=bpy.data.objects[name]; o.location=(xy[0],xy[1],0); o.scale=tuple(v*scale for v in o.scale)
    for c in o.children: c.hide_render=False
    return o

for i,n in enumerate(['gatekeeper','ares','jove','nereid']):
    xy=(-6 if i%2==0 else 6,3.6 if i<2 else -4.2)
    for prefix in ('boss','core','ring'): show(prefix+'_'+n,xy,.9)
    label(n.upper()+' / STAGE '+str(i+1),xy[0],xy[1]-3.35,.28)
hero=show('player',(0,8.1),1.65)
label('PEREGRINE / PLAYER',0,6.8,.22)
scene.render.filepath=str(out/'blender-capital-ships.png'); bpy.ops.render.render(write_still=True)
for obj in labels: obj.hide_render=True
labels=[]
for o in roots:
    for c in o.children: c.hide_render=True
    o.location=(0,0,0)
cam.data.ortho_scale=46; scene.render.resolution_x=2100; scene.render.resolution_y=2600
designs=json.loads((ROOT/'data/enemies/fleet-designs.json').read_text())
stats=json.loads((ROOT/'data/enemies/enemy-defs.json').read_text())
views=json.loads((ROOT/'data/enemies/fleet-hardpoints.json').read_text())
label('VOLTARIS / 44 INDEPENDENT AIRFRAMES',0,22,.43)
label('13 MEDIUM CLASSES / AUTHORED VIEWS / ACTUAL RELATIVE GAME SCALE',0,21.1,.24)
for i in range(44):
    o=bpy.data.objects[f'enemy_{i:02d}']
    # Preserve the actual medium/small size difference and each authored view.
    x=-15+(i%6)*6; y=18.3-(i//6)*5.2
    show(o.name,(x,y),1)
    label(f'{i+1:02}  {designs[i]["name"]} / {designs[i]["size"].upper()}',x,y-2.2,.23)
    label(f'{stats[i]["hp"]} HP / VIEW {views[i]["viewDegrees"]} DEG',x,y-2.62,.19)
scene.render.filepath=str(out/'blender-enemy-fleet.png'); bpy.ops.render.render(write_still=True)
for obj in labels: obj.hide_render=True
labels=[]
for o in roots:
    for child in o.children: child.hide_render=True
cam.data.ortho_scale=17; scene.render.resolution_x=1600; scene.render.resolution_y=1150
for i in range(12):
    x=-6+(i%4)*4; y=3.1-(i//4)*3.25
    show(f'ground_{i:02d}',(x,y),1)
    label(f'EMPLACEMENT {i+1:02}',x,y-.55,.18)
scene.render.filepath=str(out/'blender-emplacements.png'); bpy.ops.render.render(write_still=True)
print('Inspection sheets rendered')
