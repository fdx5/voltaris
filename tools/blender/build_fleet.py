"""Author VOLTARIS fleet in Blender. Run: blender -b --python tools/blender/build_fleet.py

Coordinates are deliberately authored in game XYZ (camera +Z, hostile nose -X).
GLTF export_yup=False keeps that contract. Editable parts stay in the .blend;
the export copy is welded into one mesh per finish for bounded draw calls.
"""
import bpy, bmesh, math, json, random
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'public/models'
SOURCE = ROOT / 'art/blender'
OUT.mkdir(parents=True, exist_ok=True)
SOURCE.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
random.seed(42)

def linear(h):
    rgb = [int(h[i:i+2],16)/255 for i in (1,3,5)]
    return tuple(c/12.92 if c<=.04045 else ((c+.055)/1.055)**2.4 for c in rgb)

def material(name, color, metal=.65, rough=.38, emission=0):
    m=bpy.data.materials.new(name); m.diffuse_color=(*linear(color),1); m.use_nodes=True
    p=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if p is None:
        p=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        output=m.node_tree.nodes.new('ShaderNodeOutputMaterial')
        m.node_tree.links.new(p.outputs['BSDF'],output.inputs['Surface'])
    p.inputs['Base Color'].default_value=m.diffuse_color
    p.inputs['Metallic'].default_value=metal; p.inputs['Roughness'].default_value=rough
    m['paint_roughness']=rough
    if emission:
        p.inputs['Emission Color'].default_value=m.diffuse_color
        p.inputs['Emission Strength'].default_value=emission
    else:
        noise=m.node_tree.nodes.new('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value=75
        noise.inputs['Detail'].default_value=2
        ramp=m.node_tree.nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position=.20; ramp.color_ramp.elements[1].position=.80
        ramp.color_ramp.elements[0].color=tuple(c*.72 for c in m.diffuse_color[:3])+(1,)
        ramp.color_ramp.elements[1].color=tuple(min(1,c*1.04) for c in m.diffuse_color[:3])+(1,)
        m.node_tree.links.new(noise.outputs['Fac'],ramp.inputs['Fac'])
        m.node_tree.links.new(ramp.outputs['Color'],p.inputs['Base Color'])
        roughmap=m.node_tree.nodes.new('ShaderNodeMapRange')
        roughmap.inputs['To Min'].default_value=max(.1,rough-.06)
        roughmap.inputs['To Max'].default_value=min(.85,rough+.14)
        m.node_tree.links.new(noise.outputs['Fac'],roughmap.inputs['Value'])
        m.node_tree.links.new(roughmap.outputs['Result'],p.inputs['Roughness'])
    return m

dark=material('recess / carbon titanium','#263039',.72,.46)
steel=material('machined / titanium','#8b969b',.86,.29)
black=material('ceramic / heatshield','#111a20',.25,.66)
glass=material('canopy / smoked sapphire','#194457',.8,.12)
palettes=[('#88958e','#d3c8ac','#bc6039','#f3b881'),('#786b60','#b1a184','#904c39','#ff9a50'),('#737f95','#c2c4c9','#746083','#bdb3ff'),('#91a9b5','#d4e0df','#396678','#8de1f0')]
M=[]
for i,(h,t,a,l) in enumerate(palettes):
    M.append([material(f'L{i+1} / naval armour',h),material(f'L{i+1} / edge ceramic',t,.35,.45),material(f'L{i+1} / identification',a,.45,.44),material(f'L{i+1} / navigation',l,.1,.3,2)])
player_m=[material('Peregrine / pearl titanium','#b8c5ca',.7,.32),steel,material('Peregrine / petrol blue','#315b6b',.6,.36),material('Peregrine / ion emitter','#81dfff',.1,.2,2.5)]
active=None
models=[]

def start(name):
    global active
    active=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(active)
    models.append(active)
    print('Authoring',name,flush=True)
    return active

def finish(o,mat,bevel=.02,smooth=False):
    o.parent=active; o.data.materials.append(mat)
    if bevel:
        bm=bmesh.new(); bm.from_mesh(o.data)
        edges=[e for e in bm.edges if e.is_manifold and e.calc_face_angle()>.52]
        bmesh.ops.bevel(bm,geom=edges,offset=bevel,segments=1 if bevel<.008 else 3,affect='EDGES',clamp_overlap=True)
        bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
        bm.to_mesh(o.data); bm.free()
    for p in o.data.polygons: p.use_smooth=smooth and len(p.vertices)==4
    return o

def mesh_object(name,verts,faces):
    mesh=bpy.data.meshes.new(name); mesh.from_pydata(verts,[],faces); mesh.update()
    o=bpy.data.objects.new(name,mesh); bpy.context.collection.objects.link(o)
    return o

def box(name,loc,size,mat,bevel=.02,angle=0):
    verts=[(x*size[0]/2,y*size[1]/2,z*size[2]/2) for x,y,z in [(-1,-1,-1),(-1,-1,1),(-1,1,-1),(-1,1,1),(1,-1,-1),(1,-1,1),(1,1,-1),(1,1,1)]]
    o=mesh_object(name,verts,[(0,4,6,2),(1,3,7,5),(0,1,5,4),(2,6,7,3),(0,2,3,1),(4,5,7,6)])
    o.location=loc; o.rotation_euler.z=angle
    return finish(o,mat,bevel)

def plate(name,points,z,depth,mat,bevel=.02):
    n=len(points); verts=[(x,y,z+d) for d in (0,depth) for x,y in points]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    o=mesh_object(name,verts,faces)
    # Both mirrored planforms and convex outlines have consistent outward normals.
    bm=bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(o.data); bm.free()
    return finish(o,mat,bevel)

def cylinder(name,loc,r,depth,mat,axis='X',r2=None,vertices=16):
    n=vertices
    verts=[(radius*math.cos(j*math.tau/n),radius*math.sin(j*math.tau/n),z) for radius,z in [(r,-depth/2),(r if r2 is None else r2,depth/2)] for j in range(n)]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    o=mesh_object(name,verts,faces); o.location=loc
    if axis=='X': o.rotation_euler.y=math.pi/2
    if axis=='Y': o.rotation_euler.x=math.pi/2
    return finish(o,mat,0 if r<.03 else min(.012,r*.13),True)

def torus(name,loc,r,t,mat,axis='Z'):
    verts=[((r+t*math.cos(j*math.tau/6))*math.cos(i*math.tau/32),(r+t*math.cos(j*math.tau/6))*math.sin(i*math.tau/32),t*math.sin(j*math.tau/6)) for i in range(32) for j in range(6)]
    faces=[(i*6+j,((i+1)%32)*6+j,((i+1)%32)*6+(j+1)%6,i*6+(j+1)%6) for i in range(32) for j in range(6)]
    o=mesh_object(name,verts,faces); o.location=loc
    if axis=='X': o.rotation_euler.y=math.pi/2
    return finish(o,mat,0,True)

def fasteners(x,y,z,length,count=4):
    for j in range(count):
        cylinder('captive panel fastener',(x+j*length/(count-1),y,z),.018,.015,steel,'Z',vertices=6)

def vents(x,y,z,length,width,count=6):
    box('recessed radiator bed',(x,y,z),(length,width,.025),black,.005)
    for j in range(count):
        box('radiator blade',(x-length*.42+j*length*.84/(count-1),y,z+.022),(.021,width*.86,.025),steel,.003)

def engine(x,y,z,r,length,m):
    cylinder('engine / heatshield',(x,y,z),r,length,dark)
    cylinder('engine / jacket',(x-.07,y,z),r*1.05,length*.48,m[0])
    for dx in (-.28,0,.28):
        torus('engine / clamp',(x+dx*length,y,z),r*1.015,.018,steel,'X')
    end=x+length*.52
    cylinder('nozzle / bell',(end,y,z),r*.95,length*.22,steel,r2=r*.75)
    cylinder('nozzle / dark throat',(end+length*.116,y,z),r*.72,.025,black)
    cylinder('nozzle / ion chamber',(end+length*.13,y,z),r*.51,.026,m[3])
    for j in range(8):
        a=j*math.tau/8
        box('nozzle / cooling rib',(x,y+math.cos(a)*r,z+math.sin(a)*r),(length*.7,.025,.025),steel,.003)

def gun(x,y,z,length=.7,r=.07):
    cylinder('cannon / breech',(x+length*.3,y,z),r*1.6,length*.4,dark)
    cylinder('cannon / barrel',(x,y,z),r,length,steel)
    cylinder('cannon / muzzle shroud',(x-length*.48,y,z),r*1.4,.13,dark)
    cylinder('cannon / bore',(x-length*.55,y,z),r*.66,.012,black)

# Every hostile hull is authored independently; no shared craft template.
exec(compile((ROOT/'tools/blender/unit_designs.py').read_text(encoding='utf-8'), 'unit_designs.py', 'exec'), globals())

# Preserve every named editable component. Collections keep a large fleet manageable.
for model in models:
    collection=bpy.data.collections.new(model.name); bpy.context.scene.collection.children.link(collection)
    for obj in [model,*model.children]:
        for c in list(obj.users_collection): c.objects.unlink(obj)
        collection.objects.link(obj)
bpy.ops.object.select_all(action='DESELECT')
for model in models:
    for child in model.children: child.hide_set(model.name!='player')
bpy.context.view_layer.objects.active=models[0]; models[0].select_set(True)
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE/'voltaris-fleet.blend'),compress=True)
for obj in bpy.context.scene.objects: obj.hide_set(False)

# The editable Blender source retains the procedural finish. Export the base
# PBR factors; the runtime reconstructs the matching microfinish with TSL.
for mat in bpy.data.materials:
    if not mat.use_nodes or 'paint_roughness' not in mat: continue
    shader=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if shader:
        for socket in ['Base Color','Roughness']:
            for link in list(shader.inputs[socket].links): mat.node_tree.links.remove(link)
        shader.inputs['Base Color'].default_value=mat.diffuse_color
        shader.inputs['Roughness'].default_value=mat['paint_roughness']

# Bake root transforms and combine by finish directly in Blender's mesh data.
# Avoid per-part selection/operators: their dependency-graph rebuild is quadratic.
bpy.context.view_layer.update()
for model in models:
    print('Exporting',model.name,flush=True)
    children=list(model.children)
    batches={}
    for o in children: batches.setdefault(o.data.materials[0].name,[]).append(o)
    matrices={o.name:o.matrix_world.copy() for o in children}
    for mat,objects in batches.items():
        verts=[]; faces=[]; smoothing=[]
        for obj in objects:
            offset=len(verts); matrix=matrices[obj.name]
            verts.extend(tuple(matrix@v.co) for v in obj.data.vertices)
            faces.extend(tuple(i+offset for i in p.vertices) for p in obj.data.polygons)
            smoothing.extend(p.use_smooth for p in obj.data.polygons)
        merged=mesh_object(model.name+'__'+mat,verts,faces)
        merged.data.materials.append(bpy.data.materials[mat]); merged.parent=model
        for p,smooth in zip(merged.data.polygons,smoothing): p.use_smooth=smooth
    model.rotation_euler=(0,0,0); model.scale=(1,1,1)
    for obj in children: bpy.data.objects.remove(obj,do_unlink=True)

bpy.ops.export_scene.gltf(filepath=str(OUT/'voltaris-fleet.glb'),export_format='GLB',export_yup=False,export_extras=True,export_texcoords=False,export_cameras=False,export_lights=False)
manifest={'generator':'Blender '+bpy.app.version_string,'source':'art/blender/voltaris-fleet.blend','models':[m.name for m in models],'player':1,'enemies':len(defs),'emplacements':12,'bosses':4,'triangles':sum(len(o.data.loop_triangles) for o in bpy.data.objects if o.type=='MESH')}
(OUT/'fleet-manifest.json').write_text(json.dumps(manifest,indent=2))
print('FLEET COMPLETE',json.dumps(manifest))
