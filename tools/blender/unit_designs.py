"""Independent silhouettes. Shared functions below manufacture components, not hulls.
Executed inside build_fleet.py so every part remains native editable Blender mesh data.
"""
catalog=json.loads((ROOT/'data/enemies/fleet-designs.json').read_text())
hardpoints=[]
ports=[]

def painted(name,points,z,depth,m):
    plate(name+' / subframe',points,z,depth,dark,.025)
    cx=sum(x for x,y in points)/len(points); cy=sum(y for x,y in points)/len(points)
    plate(name+' / inset armour',[(cx+(x-cx)*.97,cy+(y-cy)*.97) for x,y in points],z+depth,.045,m,.012)
    # Manufacturing detail follows each independently drawn panel perimeter.
    for j,(x,y) in enumerate(points):
        xx,yy=points[(j+1)%len(points)]
        if math.hypot(xx-x,yy-y)<.24: continue
        a=(cx+(x-cx)*.90,cy+(y-cy)*.90,z+depth+.069)
        b=(cx+(xx-cx)*.90,cy+(yy-cy)*.90,z+depth+.069)
        rod(name+' / engraved panel seam',a,b,.006,black)
        for u in [.15,.85]:
            cylinder(name+' / recessed fastener',(a[0]+(b[0]-a[0])*u,a[1]+(b[1]-a[1])*u,a[2]+.006),.014,.01,steel,'Z',vertices=6)
    # Upper armour follows the parent panel's silhouette; recessed dark seams
    # separate ceramic slabs and preserve the design's negative spaces.
    if depth > .18 and len(points) >= 4:
        inset=[(cx+(x-cx)*.82,cy+(y-cy)*.82) for x,y in points]
        plate(name+' / floating ceramic skin',inset,z+depth+.046,.018,m,.008)
    if active.name.startswith('boss_') and depth > .45:
        from mathutils.geometry import tessellate_polygon
        polygon=[Vector((x,y,0)) for x,y in points]
        for ti,triangle in enumerate(tessellate_polygon([polygon])):
            tri=[polygon[v] if isinstance(v,int) else v for v in triangle]
            center=(tri[0]+tri[1]+tri[2])/3
            patch=[(center.x+(v.x-center.x)*.72,center.y+(v.y-center.y)*.72) for v in tri]
            plate(name+' / segmented ballistic tile',patch,z+depth+.09,.085,m,.012)
            if ti%2==0:
                a,b=patch[:2]
                rod(name+' / tile service channel',(a[0],a[1],z+depth+.18),(b[0],b[1],z+depth+.18),.018,black)
    # Small maintenance hatch: only on broad filled panels, never across a void.
    inside=False
    for j,(x,y) in enumerate(points):
        xx,yy=points[(j+1)%len(points)]
        if (y>cy)!=(yy>cy) and cx<(xx-x)*(cy-y)/(yy-y)+x: inside=not inside
    if inside and max(x for x,y in points)-min(x for x,y in points)>.7 and max(y for x,y in points)-min(y for x,y in points)>.6:
        box(name+' / access hatch',(cx,cy,z+depth+.075),(.22,.15,.018),dark,.008)
        box(name+' / service marking',(cx+.04,cy,z+depth+.088),(.08,.025,.008),steel,0)

def orb(name,loc,scale,mat,faceted=False):
    n=18 if faceted else 32; rows=12 if faceted else 16
    verts=[(scale[0]*math.sin(j*math.pi/rows)*math.cos(i*math.tau/n),scale[1]*math.sin(j*math.pi/rows)*math.sin(i*math.tau/n),scale[2]*math.cos(j*math.pi/rows)) for j in range(rows+1) for i in range(n)]
    faces=[(j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i) for j in range(rows) for i in range(n)]
    o=mesh_object(name,verts,faces); o.location=loc
    finish(o,mat,0,not faceted)
    if max(scale)>.32:
        # Flush pressure-vessel seams, sized to this ellipsoid rather than a
        # generic body shell. They expose construction on otherwise smooth pods.
        ring=torus(name+' / pressure seam',loc,1,.012,steel)
        ring.scale=(scale[0],scale[1],scale[2])
    return o

def rod(name,a,b,r,mat):
    a=Vector(a); b=Vector(b)
    o=cylinder(name,(a+b)/2,r,(b-a).length,mat,'Z',vertices=10)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return o

def shell(name,center,r,width,begin,end,z,depth,mat):
    n=max(6,int(abs(end-begin)*8))
    angles=[begin+(end-begin)*i/n for i in range(n+1)]
    pts=[(center[0]+math.cos(a)*rad,center[1]+math.sin(a)*rad) for rad,aa in [(r,angles),(r-width,list(reversed(angles)))] for a in aa]
    plate(name,pts,z,depth,mat,.018)

def spike(name,a,b,r,mat,sides=6):
    a=Vector(a); b=Vector(b)
    o=cylinder(name,(a+b)/2,r,(b-a).length,mat,'Z',r2=.008,vertices=sides)
    o.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return o

def port(loc,mat,r=.065):
    ports.append(list(loc))
    cylinder('weapon / aperture bezel',loc,r*1.5,.05,steel,'Z',vertices=12)
    cylinder('weapon / charged aperture',(loc[0],loc[1],loc[2]+.03),r,.045,mat,'Z',vertices=12)

def battery(loc,mat,length=.65,r=.055):
    gun(loc[0],loc[1],loc[2],length,r)
    port((loc[0]-length*.56,loc[1],loc[2]+r),mat,r*.8)

def palette(record):
    h,s,t,l=record['palette']
    return [material(record['name']+' / primary paint',h,.42,.40),
            material(record['name']+' / contrasting armour',s,.55,.35),
            material(record['name']+' / service trim',t,.74,.31),
            material(record['name']+' / emitter',l,.1,.24,1.6)]

def design_enemy(i,m):
    h,s,t,l=m
    if i==0:  # CRESCENT: open arc with an off-centre cargo capsule.
        shell('crescent spar',(.1,0),1.1,.32,.60,5.68,-.13,.3,h)
        orb('offset courier capsule',(.38,-.28,.12),(.62,.28,.23),s)
        rod('diagonal keel',(-.62,-.64,0),(.7,.6,0),.08,steel)
        for y in [-.70,.70]: port((-.73,y,.22),l)
        engine(.82,.08,0,.18,.52,m); vents(.25,-.28,.35,.55,.12)
    elif i==1:  # LANCER: a single rail, no fighter wings.
        painted('needle rail', [(-1.7,0),(.66,-.20),(1.05,0),(.66,.20)],-.12,.24,h)
        for y in [-.16,.16]: rod('exposed accelerator',(-1.35,y,.18),(.65,y,.18),.038,s)
        for a in [0,2.094,4.188]:
            spike('stern vane',(.65,0,0),(1.1,math.cos(a)*.65,math.sin(a)*.65),.15,s)
        battery((-.95,0,.08),l,1.1,.07); torus('single induction coil',(.48,0,0),.24,.055,t,'X')
    elif i==2:  # CARRIER: offset industrial bay and a single bridge boom.
        painted('hangar barge',[(-1.1,-.63),(.95,-.63),(1.23,.2),(.65,.55),(-.85,.32)],-.25,.53,h)
        box('open port hangar',(-.5,-.17,.32),(1.0,.56,.04),black)
        for j in range(4):
            box('hangar partition',(-.9+j*.26,-.17,.39),(.035,.58,.16),t,.006)
            port((-.98,-.42+j*.17,.46),l,.04)
        rod('starboard bridge boom',(-.8,.72,0),(.85,.72,0),.09,steel)
        box('asymmetric bridge',(-.52,.70,.19),(.6,.24,.32),s,.055)
        engine(.95,-.4,-.08,.22,.5,m)
    elif i==3:  # WARDEN: vertical shield with a recessed octagonal aperture.
        pts=[(math.cos(a)*.85,math.sin(a)*1.25) for a in [j*math.tau/8 for j in range(8)]]
        painted('octagonal shield',pts,-.28,.43,h)
        shell('shield cavity',(0,0),.62,.18,0,math.tau,.2,.15,s)
        orb('recessed reactor',(0,0,.24),(.30,.30,.10),black)
        for j in range(6):
            y=-.90+j*.36; box('shield sliding shutter',(-.40,y,.32),(.45,.20,.14),s)
            port((-.58,y,.43),l,.05)
        for y in [-.85,.85]: vents(.2,y,.28,.58,.17)
    elif i==4:  # WASP: head, thorax, exposed waist, tapered abdomen.
        orb('wasp thorax',(-.1,0,0),(.40,.38,.34),h)
        orb('wasp head',(-.77,0,.04),(.29,.31,.25),s)
        rod('flexible waist',(.15,0,0),(.65,0,0),.10,black)
        spike('segmented sting pod',(1.1,0,0),(.30,0,0),.37,h)
        for y in [-1,1]:
            painted('membrane blade',[(-.15,y*.22),(.08,y*.97),(.55,y*.68),(.35,y*.18)],-.02,.055,t)
            rod('antenna',(-.91,y*.12,.08),(-1.24,y*.35,.16),.025,s)
        battery((-.95,0,.07),l,.45,.055)
    elif i==5:  # SPINNER: four open rotor shrouds, no directional fuselage.
        box('rotor hub',(0,0,0),(.47,.47,.32),h,.06)
        for j in range(4):
            a=j*math.pi/2; x=math.cos(a)*.81; y=math.sin(a)*.81
            rod('rotor arm',(0,0,0),(x,y,0),.10,steel)
            torus('ducted rotor',(x,y,.03),.36,.085,s)
            for k in range(3):
                b=a+k*math.tau/3
                rod('rotor blade',(x,y,.02),(x+math.cos(b)*.27,y+math.sin(b)*.27,.02),.028,t)
            port((x,y,.17),l,.055)
    elif i==6:  # MORTAR: suspended cauldron held between tall hydraulic legs.
        cylinder('mortar cup',(0,.2,0),.46,.7,h,'Y',r2=.31,vertices=20)
        for x in [-.64,.64]:
            rod('suspension piston',(x,-.7,0),(x,.75,0),.10,t)
            box('hover shoe',(x,-.72,0),(.48,.22,.55),s,.06)
            rod('cup yoke',(x,.1,0),(0,.1,0),.08,steel)
        shell('range finder',(0,.16),.63,.055,0,math.pi,.34,.05,t)
        port((0,.48,.39),l,.12)
    elif i==7:  # SHARD: three interlocking crystalline wedges.
        for j,(y,z) in enumerate([(-.28,0),(.28,0),(0,.3)]):
            spike('trihedral cutting spar',(.88,y,z),(-1.45,y*.25,z*.15),.33,[h,s,t][j],3)
        rod('rear crossbar',(.67,-.56,0),(.67,.56,0),.06,steel)
        port((-1.03,0,.21),l,.055)
    elif i==8:  # SENTRY: two huge optical drums, joined by one exposed rail.
        for y in [-.53,.53]:
            orb('optical drum',(.0,y,0),(.52,.37,.35),h)
            cylinder('front lens housing',(-.44,y,.04),.26,.14,s)
            torus('focus wheel',(-.50,y,.04),.25,.035,t,'X')
            port((-.47,y,.28),l,.09)
        rod('binocular bridge',(.28,-.65,0),(.28,.65,0),.1,steel)
        box('range processor',(.5,0,.1),(.32,.35,.28),s)
    elif i==9:  # RAVEN: one unbroken angular bat-wing planform.
        painted('kite skin',[(-1.08,0),(-.35,-.54),(-.6,-1.1),(.45,-.63),(1.15,-.86),(.7,0),(1.15,.86),(.45,.63),(-.6,1.1),(-.35,.54)],-.11,.23,h)
        spike('dorsal stealth ridge',(.75,0,.24),(-.98,0,.03),.18,s,3)
        for y in [-.64,.64]: port((-.35,y,.16),l,.055)
        vents(.39,0,.24,.38,.20)
    elif i==10:  # HYDRA: three separately articulated gun necks.
        painted('hydra power back',[(.0,-.85),(.8,-.64),(1.12,0),(.8,.64),(.0,.85),(-.22,0)],-.3,.55,h)
        for j in range(3):
            y=(j-1)*.72; elbow=(-.30,y*.7,.10)
            rod('neck hydraulic',(.25,y*.8,0),elbow,.12,steel)
            rod('neck armour',elbow,(-.9,y,.12),.15,s)
            orb('hydra gun head',(-.95,y,.15),(.30,.21,.20),h)
            battery((-1.08,y,.2),l,.50,.075)
        vents(.48,0,.30,.53,.52,8)
    elif i==11:  # BULWARK: a wide armoured traverse with seven shutters.
        painted('bunker slab',[(-.62,-1.25),(.57,-1.08),(.8,-.7),(.8,.7),(.57,1.08),(-.62,1.25)],-.31,.63,h)
        for j in range(7):
            y=-1.02+j*.34
            box('traverse armour',(-.21,y,.40),(.62,.27,.18),s,.035)
            port((-.53,y,.5),l,.045)
        for y in [-.75,.75]: engine(.72,y,0,.22,.40,m)
    elif i==12:  # SEEKER: spherical gimbal with one offset antenna.
        orb('search eye',(0,0,0),(.58,.58,.48),h)
        torus('outer gimbal',(0,0,0),.78,.055,s)
        torus('tilted gimbal',(0,0,0),.67,.045,t,'X')
        rod('sensor mast',(.35,.45,0),(.8,.95,.15),.04,t)
        orb('secondary optic',(.80,.95,.15),(.14,.14,.13),s)
        port((-.40,0,.4),l,.13)
    elif i==13:  # MANTIS: paired forward scythes around a narrow waist.
        orb('mantis abdomen',(.48,0,0),(.63,.27,.26),h)
        for sign in [-1,1]:
            painted('scythe blade',[(.24,sign*.13),(.11,sign*.84),(-.89,sign*1.0),(-1.34,sign*.45),(-.65,sign*.71),(-.28,sign*.5)],-.12,.20,s)
            rod('scythe actuator',(.7,sign*.16,.1),(-.02,sign*.66,.1),.05,t)
            port((-1.15,sign*.5,.16),l,.055)
    elif i==14:  # DRILL: helical borer and an offset counterweight pod.
        spike('drill core',(.74,0,0),(-1.3,0,0),.48,h,12)
        for j in range(18):
            x=-1.1+j*.10; r=.05+j*.020; a=j*.76
            rod('helical cutting tooth',(x,math.cos(a)*r,math.sin(a)*r),(x+.12,math.cos(a)*r*1.28,math.sin(a)*r*1.28),.045,s)
        orb('counterweight',(.58,.65,0),(.32,.25,.25),s)
        rod('offset brace',(.6,0,0),(.58,.65,0),.08,t)
        port((-.87,0,.20),l,.065)
    elif i==15:  # MONOLITH: two unequal vertical slabs separated by a void.
        painted('left obsidian slab',[(-.53,-1.42),(-.05,-1.19),(-.05,1.46),(-.63,1.12)],-.27,.60,h)
        painted('right obsidian slab',[(.12,-1.06),(.55,-1.34),(.76,1.0),(.12,1.34)],-.23,.45,s)
        for j in range(5):
            y=-.96+j*.47; rod('bridge conduit',(-.2,y,0),(.29,y,0),.038,t)
            port((-.28,y,.39),l,.07)
    elif i==16:  # SWARMER: three offset pods woven around an empty centre.
        for j in range(3):
            a=j*math.tau/3+.35; x=math.cos(a)*.65; y=math.sin(a)*.65
            orb('swarm capsule',(x,y,0),(.39,.28,.26),h)
            b=a+math.tau/3
            rod('interpod link',(x,y,0),(math.cos(b)*.65,math.sin(b)*.65,0),.05,s)
            port((x-.20,y,.25),l,.055)
    elif i==17:  # ARBITER: balance beam with two suspended shield pans.
        painted('central balance tower',[(-.37,-.34),(.08,-.61),(.45,-.22),(.45,.22),(.08,.61),(-.37,.34)],-.32,.63,h)
        rod('balance beam',(0,-1.2,0),(0,1.2,0),.12,t)
        for sign in [-1,1]:
            shell('balance shield',(.05,sign*1.02),.43,.19,.2,6.08,.0,.25,s)
            rod('pan brace',(.2,0,.18),(.05,sign*1.02,.18),.055,steel)
            port((-.29,sign*1.02,.31),l,.085)
        battery((-.58,0,.32),l,.65,.10)
    elif i==18:  # SCOURGE: asymmetric scorpion with a hooked articulated tail.
        orb('scorpion carapace',(-.3,-.18,0),(.72,.49,.33),h,True)
        tail=[(.15,.1,0),(.78,.25,.08),(1.12,.73,.14),(.78,1.14,.23),(.12,1.06,.34),(-.27,.66,.40)]
        for a,b in zip(tail,tail[1:]): rod('tail segment',a,b,.115,s)
        spike('tail sting',tail[-1],(-.8,.53,.43),.16,t)
        for y in [-.57,.18]: battery((-.99,y,.14),l,.42,.065)
        port((-.65,.56,.49),l,.08)
    elif i==19:  # HALBERD: one-sided axe blade attached to a long shaft.
        rod('poleaxe shaft',(-1.5,0,0),(1.0,0,0),.12,h)
        painted('axe head',[(-1.01,-.10),(-.65,-1.16),(-.08,-.9),(-.26,-.5),(.2,-.22)],-.1,.24,s)
        spike('back spike',(-.5,.1,0),(-.63,.72,0),.23,t,3)
        orb('rear counterweight',(.84,0,0),(.23,.21,.21),s)
        port((-1.38,0,.16),l,.07)
    elif i==20:  # CINDER: open industrial furnace with a suspended hot core.
        for y in [-.63,.63]: box('furnace girder',(0,y,0),(1.27,.15,.22),h)
        for x in [-.56,.56]: rod('furnace hoop',(x,-.63,0),(x,.63,0),.075,s)
        orb('caged furnace',(0,0,.0),(.47,.42,.38),l)
        for j in range(8):
            a=j*math.tau/8; rod('containment rib',(-.50,math.cos(a)*.46,math.sin(a)*.40),(.50,math.cos(a)*.46,math.sin(a)*.40),.035,t)
        for y in [-.33,0,.33]: port((-.56,y,.26),l,.05)
    elif i==21:  # TALON: three forward claws at different depths.
        orb('claw knuckle',(.48,0,0),(.41,.39,.33),h)
        for j,(y,z) in enumerate([(-.65,0),(.65,0),(0,.48)]):
            pts=[(.57,y*.36),(.1,y),(-.89,y*1.10),(-1.27,y*.43),(-.62,y*.64),(.08,y*.5)] if j!=2 else [(.57,-.1),(-.82,-.18),(-1.3,0),(-.82,.18),(.57,.1)]
            painted('talon finger',pts,z-.08,.13,s if j==2 else h)
            port((-1.08,y*.47,z+.1),l,.06)
        torus('knuckle race',(.58,0,0),.38,.06,t,'X')
    elif i==22:  # VULTURE: broken elbows and a very long skeletal neck.
        spike('beaked head',(-.49,0,.11),(-1.37,0,.01),.23,h,5)
        for sign in [-1,1]:
            painted('broken wing',[(.05,sign*.13),(-.14,sign*.74),(.50,sign*1.16),(.32,sign*.62),(.86,sign*.4)],-.09,.15,s)
            rod('exposed wing bone',(-.28,0,0),(.45,sign*.94,0),.055,t)
            port((-.02,sign*.65,.12),l,.045)
        rod('tail skeleton',(-.28,0,0),(1.14,0,0),.09,steel)
        engine(.93,0,0,.13,.39,m)
    elif i==23:  # SIREN: a tuning fork with differently sized resonators.
        shell('tuning fork',(.12,0),.87,.20,-1.8,1.8,-.13,.26,h)
        for y,r in [(-.68,.24),(.68,.36)]:
            rod('resonance tine',(.1,y,0),(-1.03,y,0),.08,t)
            torus('resonant mouth',(-.85,y,0),r,.065,s,'X')
            port((-.87,y,.24),l,.075)
        vents(.5,0,.19,.28,.32)
    elif i==24:  # BASILISK: overlapping reptilian siege armour.
        for j in range(7):
            x=-.95+j*.34; w=.28+math.sin(j*math.pi/7)*.48
            painted('overlapping scale',[(x-.22,-w),(x+.19,-w*.8),(x+.28,0),(x+.19,w*.8),(x-.22,w)],-.25,.36+j*.025,h if j%2 else s)
        for y in [-.85,.85]:
            rod('flank weapon rail',(-.6,y,0),(.73,y,0),.105,t)
            for j in range(3): battery((-.62+j*.44,y,.11),l,.38,.065)
        spike('head prow',(-.9,0,.04),(-1.48,0,0),.3,h,4)
    elif i==25:  # COMET: single teardrop turbine, a trailing tail of heat vanes.
        orb('teardrop vessel',(-.22,0,0),(.90,.44,.40),h)
        spike('needle nose',(-.65,0,0),(-1.48,0,0),.26,s)
        for j in range(4):
            a=j*math.pi/2
            spike('heat vane',(.43,math.cos(a)*.30,math.sin(a)*.30),(1.4,math.cos(a)*.58,math.sin(a)*.58),.16,t,3)
        torus('turbine throat',(.58,0,0),.31,.085,s,'X')
        port((-.91,0,.29),l,.065)
    elif i==26:  # GORGON: five unequal optical arms splayed as a fan.
        orb('fan knuckle',(.60,0,0),(.32,.38,.32),h)
        for j in range(5):
            a=2.10+j*.52; x=.4+math.cos(a)*(1.05+(j%2)*.2); y=math.sin(a)*1.0
            rod('optical stalk',(.52,0,0),(x,y,.13),.055,t)
            orb('gaze pod',(x,y,.12),(.25,.20,.17),s if j%2 else h)
            port((x-.14,y,.27),l,.075)
    elif i==27:  # ANVIL: blunt hammer face ahead of an exposed cargo spine.
        painted('hammer face',[(-1.02,-1.02),(-.41,-.89),(-.31,-.42),(-.31,.42),(-.41,.89),(-1.02,1.02)],-.32,.61,h)
        rod('freighter spine',(-.43,0,0),(1.14,0,0),.19,steel)
        for x in [.08,.48,.88]: box('underslung cargo',(x,0,-.19),(.32,.73,.43),s,.045)
        for y in [-.78,-.26,.26,.78]: port((-.93,y,.38),l,.075)
        vents(-.64,0,.36,.27,.67)
    elif i==28:  # WRAITH: a hollow inverted U with absolutely no centre body.
        painted('spectre arch',[(-1.05,-.94),(.81,-.82),(1.06,0),(.81,.82),(-1.05,.94),(-.57,.61),(.43,.47),(.62,0),(.43,-.47),(-.57,-.61)],-.14,.29,h)
        for sign in [-1,1]:
            spike('swept ghost horn',(.4,sign*.7,0),(-1.35,sign*.88,.05),.14,s,3)
            port((-1.02,sign*.82,.20),l,.06)
    elif i==29:  # TEMPEST: three counter-rotating gyroscope hoops.
        for j,(r,z) in enumerate([(.97,0),(.70,.20),(.43,.42)]):
            torus('gyro ring',(0,0,z),r,.07,[h,s,t][j])
            for k in range(3):
                a=k*math.tau/3+j*.55
                box('gyro magnet',(math.cos(a)*r,math.sin(a)*r,z),(.21,.14,.17),s,.022,angle=a)
        for j in range(3):
            a=j*math.tau/3; port((math.cos(a)*.88,math.sin(a)*.88,.16),l,.06)
        orb('gyro spindle',(0,0,0),(.16,.16,.62),h)
    elif i==30:  # CHIMERA: organic port nacelle, mechanical starboard rail.
        orb('hybrid pressure body',(.08,.13,0),(.73,.40,.32),h,True)
        orb('bioceramic left lobe',(-.21,-.66,.08),(.67,.34,.29),s)
        for j in range(4): torus('lobe retaining collar',(-.58+j*.24,-.66,.08),.29,.024,t,'X')
        painted('right rail frame',[(-1.16,.51),(.97,.51),(.82,1.0),(-.66,.87)],-.08,.22,h)
        for y in [.61,.82]: battery((-.65,y,.21),l,1.12,.07)
        port((-.71,-.66,.31),l,.13)
        spike('diagonal counterfin',(.3,-.15,.3),(.9,-.2,.86),.25,s,3)
    elif i==31:  # OBELISK: tilted pyramid with a triangular base and aperture runes.
        verts=[(-.75,-.75,-.25),(.83,-.55,-.25),(.17,.91,-.25),(-.38,.14,1.32)]
        finish(mesh_object('tilted pyramid',verts,[(0,2,1),(0,1,3),(1,2,3),(2,0,3)]),h,.025)
        for a,b in [(verts[0],verts[3]),(verts[1],verts[3]),(verts[2],verts[3])]: rod('pyramid edge inlay',a,b,.027,s)
        for j in range(4): port((-.38,-.46+j*.22,.28+j*.18),l,.052)
        shell('incomplete base race',(0,0),1.0,.12,.4,5.7,-.30,.13,s)
    elif i==32:  # NOVA: five opening explosive petals around a dark void.
        for j in range(5):
            a=j*math.tau/5
            pts=[(.28,-.12),(.91,-.32),(1.25,0),(.91,.32),(.28,.12)]
            pts=[(x*math.cos(a)-y*math.sin(a),x*math.sin(a)+y*math.cos(a)) for x,y in pts]
            painted('opening charge petal',pts,-.09,.20,h if j%2 else s)
            port((math.cos(a)*.86,math.sin(a)*.86,.2),l,.055)
        torus('petal linkage',(0,0,0),.3,.055,t)
    elif i==33:  # LEVIATHAN: nine articulated vertebrae, no shared airframe.
        for j in range(9):
            x=-1.1+j*.31; y=math.sin(j*.72)*.31; r=.36-j*.022
            orb('armoured vertebra',(x,y,0),(.26,r,r*.8),h if j%2 else s,True)
            if j<8: rod('spinal joint',(x,y,0),(x+.31,math.sin((j+1)*.72)*.31,0),.07,t)
            if j in [0,2,4,6]:
                for sign in [-1,1]: port((x,y+sign*r*.75,.22),l,.055)
        spike('caudal blade',(1.1,-.08,0),(1.83,.35,0),.33,s,3)
    elif i==34:  # SLEET: three mismatched needles joined by a diagonal brace.
        for x,y,length in [(-.15,-.57,1.55),(.13,0,2.18),(.37,.57,1.17)]:
            spike('ice pick',(x+.55,y,0),(x-length*.50,y,0),.19,h,3)
            port((x-length*.40,y,.12),l,.04)
        rod('slanted brace',(.32,-.75,0),(.73,.75,0),.08,s)
    elif i==35:  # GLIMMER: suspended diamond lantern inside a small cage.
        orb('faceted lantern',(0,0,0),(.64,.66,.63),h,True)
        for j in range(4):
            a=j*math.pi/2+.4
            rod('lantern cage',(math.cos(a)*.78,math.sin(a)*.78,-.24),(0,0,.84),.025,s)
        spike('lantern crown',(0,0,.54),(0,0,1.03),.20,t,4)
        for y in [-.3,.3]: port((-.34,y,.56),l,.06)
    elif i==36:  # SHIVER: a zigzag conducting rail with three rectifier blocks.
        line=[(-1.25,-.60),(-.52,-.60),(-.78,.10),(.04,.10),(.32,.74),(1.09,.74)]
        for (x,y),(xx,yy) in zip(line,line[1:]): rod('zigzag superconductor',(x,y,0),(xx,yy,0),.125,h)
        for j in [1,3,5]:
            x,y=line[j]; box('rectifier block',(x,y,.1),(.38,.29,.33),s,.04)
            port((x-.19,y,.29),l,.05)
    elif i==37:  # RIME: a horseshoe radiator with staggered ice plates.
        shell('radiator horseshoe',(0,0),1.01,.29,-2.15,2.15,-.11,.25,h)
        for j in range(11):
            a=-1.9+j*.38; x=math.cos(a)*.88; y=math.sin(a)*.88
            box('radiator ice plate',(x,y,.18),(.13,.42,.06),s,.012,angle=a)
        for y in [-.8,.8]: port((-.48,y,.22),l,.075)
    elif i==38:  # FLOE: three rectangular rafts floating on piston links.
        positions=[(-.74,-.35),(.0,.39),(.74,-.19)]
        for j,(x,y) in enumerate(positions):
            painted('raft deck',[(x-.36,y-.32),(x+.36,y-.24),(x+.28,y+.33),(x-.36,y+.28)],-.18,.30,h if j!=1 else s)
            port((x-.2,y,.19),l,.07); vents(x,y+.17,.17,.34,.08,4)
        for a,b in zip(positions,positions[1:]): rod('raft piston',(*a,0),(*b,0),.075,t)
    elif i==39:  # CRYSTAL: divergent hexagonal crystals of unequal heights.
        for j,(x,y,z,r) in enumerate([(-.5,0,.65,.26),(.05,-.4,.38,.32),(.3,.23,.83,.27),(.66,-.18,.26,.22)]):
            spike('hexagonal resonator',(x,y,-.22),(x-.3,y+.1,z),r,h if j%2 else s,6)
            port((x-.15,y,z*.65),l,.05)
        painted('crystal socket',[(-.8,-.4),(.76,-.6),(1,.25),(.35,.58),(-.73,.48)],-.32,.14,t)
    elif i==40:  # HOARFROST: branching antenna; open spaces dominate its shape.
        for j in range(6):
            a=j*math.tau/6; end=(math.cos(a)*1.12,math.sin(a)*1.12,0)
            rod('antenna branch',(0,0,0),end,.045,h)
            for b in [-.65,.65]:
                origin=(math.cos(a)*.57,math.sin(a)*.57,0)
                rod('antenna twig',origin,(origin[0]+math.cos(a+b)*.36,origin[1]+math.sin(a+b)*.36,.05),.032,s)
        orb('antenna receiver',(0,0,.04),(.24,.24,.16),s)
        for y in [-.33,0,.33]: port((-.28,y,.13),l,.04)
    elif i==41:  # CALVING: inverted wedge carrying hanging fragmentation blocks.
        painted('calving overhang',[(-1.1,-.64),(.9,-.85),(1.2,.3),(-.37,.76),(-.95,.29)],.1,.43,h)
        for j in range(5):
            x=-.75+j*.39; z=-.38-(j%2)*.19
            rod('release hanger',(x,-.08,.13),(x,-.08,z),.05,t)
            box('hanging impact block',(x,-.08,z),(.30,.58,.34),s,.025)
            port((x-.15,-.27,z+.2),l,.065)
        vents(.24,.08,.59,.9,.35,9)
    elif i==42:  # MORAINE: irregular mining orb with one excavator arm.
        orb('mineral armoured orb',(0,0,0),(.64,.59,.52),h,True)
        shell('mining collar',(0,0),.76,.1,.4,5.1,.04,.12,s)
        rod('excavator upper arm',(.37,-.35,0),(.88,-.68,.08),.08,t)
        rod('excavator forearm',(.88,-.68,.08),(.17,-1.03,.15),.075,h)
        spike('excavator tooth',(.17,-1.03,.15),(-.41,-.9,.12),.16,s,4)
        port((-.38,0,.45),l,.13)
    elif i==43:  # GLACIER: stepped icebreaking rampart, broad bow and low stern.
        for j in range(5):
            x=-.82+j*.38; w=1.05-j*.13; depth=.55-j*.075
            painted('stepped icebreaker deck',[(x-.23,-w),(x+.20,-w*.88),(x+.20,w*.88),(x-.23,w)],-.30,depth,h if j%2 else s)
        for j in range(6):
            y=-.85+j*.34; spike('icebreaking tooth',(-.90,y,0),(-1.29,y,.03),.14,t,4)
            port((-.92,y,.36),l,.055)
        for y in [-.39,.39]: engine(.81,y,-.18,.17,.40,m)

# Independent view selection, baked before silhouette normalization and muzzle export.
views=[20,70,28,8,38,0,65,52,25,7,30,58,18,12,72,20,42,34,10,65,40,28,22,48,56,75,8,62,5,30,38,55,0,67,15,42,63,12,24,52,0,48,36,60]
defs=json.loads((ROOT/'data/enemies/enemy-defs.json').read_text())

# PEREGRINE III: variable-sweep interceptor, layered wings and twin nacelles.
start('player'); ports=[]
painted('titanium keel',[(-1.3,-.19),(-.48,-.32),(.55,-.19),(1.65,0),(.55,.19),(-.48,.32),(-1.3,.19)],-.17,.33,player_m[0])
painted('dorsal spine',[(-1.1,-.12),(.10,-.17),(1.28,0),(.10,.17),(-1.1,.12)],.17,.10,player_m[0])
for sign in [-1,1]:
    painted('swept carrier wing',[(-.26,sign*.2),(-1.25,sign*1.03),(-.82,sign*1.12),(.59,sign*.29)],-.12,.13,player_m[0])
    painted('inset wing armour',[(-.28,sign*.31),(-1.04,sign*.96),(-.78,sign*.94),(.33,sign*.32)],.018,.038,player_m[2])
    painted('forward canard',[(.70,sign*.13),(.12,sign*.58),(.47,sign*.57),(1.02,sign*.16)],-.04,.065,player_m[0])
    painted('engine nacelle',[(-1.38,sign*.32),(-1.35,sign*.64),(-.25,sign*.60),(.18,sign*.39),(-.31,sign*.26)],-.20,.38,player_m[0])
    box('recessed intake',(-.04,sign*.4,.22),(.26,.20,.10),black,.015)
    for j in range(4): box('intake compressor vane',(-.14+j*.062,sign*.4,.28),(.018,.17,.025),steel,.004)
    cylinder('ceramic nozzle',(-1.32,sign*.47,-.015),.17,.30,dark)
    torus('exhaust rim',(-1.49,sign*.47,-.015),.14,.025,steel,'X')
    cylinder('ion chamber',(-1.51,sign*.47,-.015),.11,.018,player_m[3])
    spike('canted stabilizer',(-1.06,sign*.45,.12),(-1.19,sign*.67,.63),.20,player_m[2],3)
    battery((.40,sign*.32,-.12),player_m[3],.68,.033)
    box('wing identification stripe',(-.78,sign*.86,.09),(.17,.055,.009),player_m[0],0,angle=sign*.4)
    vents(-.72,sign*.47,.25,.44,.17,5)
orb('armoured canopy coaming',(.46,0,.23),(.48,.19,.12),dark)
orb('sapphire canopy',(.46,0,.29),(.40,.145,.13),glass)
for x in [.20,.63]: box('canopy structural frame',(x,0,.395),(.026,.22,.025),player_m[0],.006)
active.rotation_euler.x=math.radians(-26)
active['design']='PEREGRINE III / twin-engine variable-sweep interceptor'

for i,record in enumerate(catalog):
    start(f'enemy_{i:02d}'); ports=[]; m=palette(record)
    design_enemy(i,m)
    active.rotation_euler.x=math.radians(views[i])
    active.rotation_euler.y=math.radians([-9,0,12,0][i%4])
    bpy.context.view_layer.update()
    reach=max(max(abs((o.matrix_world@v.co)[a]) for a in (0,1)) for o in active.children for v in o.data.vertices)
    factor=defs[i]['radius']*1.55/reach
    rotation=active.rotation_euler.to_matrix()
    muzzle=[list((rotation@Vector(p))*factor) for p in ports]
    if not muzzle: raise RuntimeError('No authored weapon for '+record['name'])
    hardpoints.append({'name':record['name'],'size':record['size'],'viewDegrees':views[i],'muzzles':muzzle})
    active.scale=(factor,)*3
    active['design']=record['design']; active['sizeClass']=record['size']; active['viewDegrees']=views[i]
    active['muzzles']=muzzle

(ROOT/'data/enemies/fleet-hardpoints.json').write_text(json.dumps(hardpoints,indent=2)+'\n')

# Twelve surface weapons, each with an unrelated foundation and mount mechanism.
ground_colors=[('#b27238','#e8d7a8'),('#46988a','#eeaa64'),('#8c608e','#ced787'),('#a9b9c6','#9b3b49'),('#e5d28d','#547e9b'),('#79b7ca','#bd6852'),('#b48474','#ded7c6'),('#576499','#d7a878'),('#8baba1','#e7c9a5'),('#c2b8d5','#477966'),('#78945c','#dfcbbb'),('#55869c','#dcdfcf')]
groundpoints=[]
for i in range(12):
    start(f'ground_{i:02d}'); ports=[]
    record={'name':f'GROUND {i}','palette':[*ground_colors[i],'#c7ced0',ground_colors[i][1]]}; h,s,t,l=palette(record)
    if i==0:
        for x in [-.6,.6]: box('tracked bunker shoe',(x,.14,0),(.31,.28,.94),s,.04)
        painted('sloped bunker',[(-.7,.25),(.6,.25),(.4,1.1),(-.45,1.18)],-.3,.6,h)
        for y in [.63,.85]: battery((-.64,y,.1),l,.76,.08)
    elif i==1:
        cylinder('radar pedestal',(0,.5,0),.17,1.0,h,'Y')
        shell('parabolic radar fan',(0,1.12),.58,.19,.12,3.0,.0,.14,s)
        for x in [-.48,0,.48]: rod('radar foundation',(0,.2,0),(x,.05,.3),.08,t)
        port((0,1.3,.19),l,.09)
    elif i==2:
        for j in range(3): cylinder('silo tube',((j-1)*.38,.60,0),.21,1.2,h,'Y',vertices=12)
        box('silo blast wall',(0,.24,-.22),(1.38,.48,.26),s)
        for x in [-.38,0,.38]: port((x,1.18,.2),l,.085)
    elif i==3:
        for x in [-.58,.58]: rod('flak A frame',(x,0,0),(0,.87,0),.08,t)
        orb('flak gun cradle',(0,.9,0),(.42,.3,.28),h)
        for y in [.82,1.04]: battery((-.48,y,.17),l,.87,.06)
    elif i==4:
        painted('ice saw foundation',[(-.78,0),(.72,0),(.3,.42),(-.44,.31)],-.34,.68,h)
        torus('ice saw wheel',(0,.83,0),.56,.12,s)
        for j in range(10):
            a=j*math.tau/10; spike('saw tooth',(math.cos(a)*.50,.83+math.sin(a)*.5,0),(math.cos(a)*.70,.83+math.sin(a)*.70,0),.095,t,3)
        port((-.45,1.0,.18),l,.08)
    elif i==5:
        for j in range(3):
            y=.25+j*.4; box('capacitor stack',(0,y,0),(.65-j*.1,.22,.52),h if j%2 else s,.035)
        torus('tesla head',(0,1.47,0),.35,.07,t)
        port((0,1.45,.14),l,.12)
    elif i==6:
        orb('buried artillery ball',(0,.42,0),(.62,.43,.48),h,True)
        rod('elevated breech',(0,.52,0),(-.38,1.04,.04),.13,s)
        battery((-.52,1.10,.13),l,.65,.11)
    elif i==7:
        for j in range(4):
            a=j*math.pi/2; rod('pyramid leg',(math.cos(a)*.58,0,math.sin(a)*.5),(0,1.1,0),.08,t)
        spike('crystal mortar',(0,.7,0),(0,1.80,0),.34,h,6)
        port((-.15,1.57,.27),l,.075)
    elif i==8:
        box('ceiling winch',(0,.12,0),(1.2,.24,.70),h)
        for x in [-.4,.4]: rod('hanging rail',(x,.2,0),(x,1.04,0),.055,t)
        box('suspended gun carriage',(0,.98,0),(.9,.32,.48),s)
        for x in [-.3,0,.3]: port((x,1.08,.28),l,.06)
    elif i==9:
        rod('inverted telescope',(0,.05,0),(0,1.1,0),.14,h)
        for y in [.36,.66,.96]: cylinder('telescope clamp',(0,y,0),.24,.13,s,'Y')
        orb('sensor dish',(0,1.25,0),(.47,.22,.35),h)
        port((-.28,1.30,.24),l,.11)
    elif i==10:
        painted('asymmetric ceiling mount',[(-.78,0),(.71,0),(.2,.4),(-.38,.51)],-.28,.56,h)
        rod('single swinging arm',(-.36,.34,0),(.38,.83,0),.10,t)
        torus('swinging bomb cradle',(.38,1.00,0),.29,.07,s)
        port((.38,1.03,.18),l,.09)
    else:
        painted('hanging organ pipes',[(-.69,0),(.69,0),(.56,.35),(-.56,.35)],-.25,.5,h)
        for j in range(5):
            x=(j-2)*.26; y=1.0+(.4 if j%2==0 else .05)
            rod('organ emitter',(x,.23,0),(x,y,0),.09,s)
            port((x,y,.13),l,.055)
    active.rotation_euler.y=math.radians([18,-12,0,27,9,-18,24,0,16,-20,32,8][i])
    groundpoints.append({'muzzles':[list(active.rotation_euler.to_matrix()@Vector(p)) for p in ports]})

(ROOT/'data/enemies/ground-hardpoints.json').write_text(json.dumps(groundpoints,indent=2)+'\n')

# Four unrelated capital-ship structures and four unrelated destructible pods.
boss_palettes=[['#657482','#c8c7b8','#833c40','#ff9a70'],['#74685b','#aeb9bf','#43546a','#ffd377'],['#59637d','#b4bbc6','#827255','#d1b2ff'],['#436d78','#a2b9bd','#475260','#80efe4']]
for level,name in enumerate(['gatekeeper','ares','jove','nereid']):
    start('boss_'+name); ports=[]
    h,s,t,l=palette({'name':name.upper(),'palette':boss_palettes[level]})
    if level==0:  # GATEKEEPER: tall divided portal; centre is open machinery.
        for sign in [-1,1]:
            painted('portal jaw',[(-1.8,sign*.72),(-1.13,sign*2.9),(.68,sign*3.25),(1.65,sign*2.65),(1.12,sign*1.58),(.02,sign*1.12)],-.45,.76,h)
            for j in range(6):
                y=sign*(1.12+j*.31)
                box('portal sliding armour',(-.48,y,.47),(.90,.23,.22),s,.035,angle=sign*.2)
                battery((-1.30,y,.35),l,.58,.07)
            rod('portal rear spine',(1.03,sign*.4,-.2),(1.2,sign*2.6,-.2),.16,t)
            for j in range(4): vents(.60,sign*(1.3+j*.37),.4,.36,.2)
        shell('reactor half cradle',(.15,0),1.12,.20,-1.6,1.6,-.26,.43,s)
        for y in [-.51,.51]: rod('aperture strut',(.65,y,0),(-.40,y,0),.07,t)
        core_location=(-.10,0,.15)
    elif level==1:  # ARES: asymmetrical siege rail, drum magazine and command cab.
        painted('siege chassis',[(-2.65,-.42),(.63,-.90),(2.3,-.35),(2.85,.73),(1.48,1.8),(-1.21,1.08)],-.54,1.02,h)
        for y in [-.36,.36]:
            rod('long accelerator rail',(-3.95,y,.28),(.4,y,.28),.16,s)
            for j in range(8): box('rail cooling shoe',(-3.55+j*.44,y,.42),(.23,.25,.16),t,.02)
        cylinder('rotary siege magazine',(.7,-1.37,0),.91,1.48,s,'Z',vertices=24)
        for j in range(10):
            a=j*math.tau/10
            cylinder('magazine shell',(.7+math.cos(a)*.75,-1.37+math.sin(a)*.75,.50),.105,.72,t,'Z')
        box('elevated asymmetric command cab',(1.12,1.14,.79),(1.35,.67,.61),s,.09)
        vents(1.05,1.14,1.13,.9,.42,9)
        for x in [.85,1.55,2.25]: engine(x,.3,-.36,.28,.57,[h,s,t,l])
        core_location=(.7,-1.37,.92)
    elif level==2:  # JOVE: three swept radiator arms, an open triangular station.
        for j in range(3):
            a=j*math.tau/3
            pts=[(.52,-.33),(1.35,-.92),(3.45,-.56),(2.48,.02),(1.32,.48),(.63,.28)]
            pts=[(x*math.cos(a)-y*math.sin(a),x*math.sin(a)+y*math.cos(a)) for x,y in pts]
            painted('triskelion arm',pts,-.28,.54,h)
            for k in range(7):
                x=.95+k*.28; y=-.2-k*.025
                xx=x*math.cos(a)-y*math.sin(a); yy=x*math.sin(a)+y*math.cos(a)
                box('radiator sail slat',(xx,yy,.38),(.12,.66,.12),s,.012,angle=a+.22)
            x=math.cos(a)*2.68; y=math.sin(a)*2.68
            orb('arm emitter housing',(x,y,.18),(.39,.39,.30),t)
            port((x,y,.49),l,.19)
        for j in range(3):
            a=j*math.tau/3; b=a+math.tau/3
            rod('triangular reactor support',(math.cos(a)*.75,math.sin(a)*.75,0),(math.cos(b)*.75,math.sin(b)*.75,0),.10,t)
        core_location=(0,0,.20)
    else:  # NEREID: articulated deep-sea leviathan with a split hunting jaw.
        for j in range(8):
            x=-2.1+j*.76; y=math.sin(j*.63)*.47; radius=.98-j*.07
            orb('abyssal vertebra',(x,y,0),(.60,radius,radius*.75),h if j%2 else s,True)
            torus('vertebra pressure seal',(x+.38,y,0),radius*.75,.065,t,'X')
            for sign in [-1,1]:
                spike('ventral cryofin',(x,y+sign*radius*.55,0),(x+.54,y+sign*(radius+1.0),-.12),.24,h,3)
                if j%2==0: port((x,y+sign*.54,.64),l,.085)
        for sign in [-1,1]:
            painted('hunting mandible',[(-1.95,sign*.2),(-2.60,sign*1.02),(-3.78,sign*.59),(-2.80,sign*.52),(-2.72,sign*.13)],-.25,.48,s)
        spike('tail rudder',(3.0,0,0),(4.05,.90,.1),.55,h,3)
        core_location=(-1.50,0,.78)
    # Capital scale is communicated by layered superstructure and repeated
    # human-scale bays, rather than enlarging a single primitive.
    if level==0:
        for side in [-1,1]:
            painted('fortress shoulder',[(-.85,side*1.3),(-.82,side*2.7),(.5,side*2.95),(1.18,side*2.4),(.72,side*1.35)],.45,.33,h)
            for j in range(5):
                y=side*(1.45+j*.25)
                box('recessed hangar bay',(.45,y,.855),(.52,.16,.035),black,.01)
                box('hangar threshold',(.46,y,.881),(.34,.024,.012),s,.002)
            engine(1.25,side*1.92,.05,.31,.75,[h,s,t,l])
            box('armoured bridge',(.08,side*2.15,.98),(.62,.38,.26),s,.04)
            for j in range(5): box('bridge slit',(-.17+j*.09,side*2.15,1.12),(.045,.12,.012),glass,.002)
    elif level==1:
        for side in [-1,1]:
            painted('siege broadside armour',[(-1.9,side*.52),(-1.5,side*1.0),(.15,side*.98),(.42,side*.63)],.42,.27,h)
            for j in range(4):
                x=-1.45+j*.43
                box('magazine blast door',(x,side*.72,.73),(.30,.24,.055),s,.014)
                cylinder('vertical launch tube',(x,side*.72,.79),.064,.03,black,'Z',vertices=12)
        for j in range(7): box('command window',(0.63+j*.15,1.14,1.43),(.095,.38,.025),glass,.005)
        for y in [-.50,.42,1.12]:
            cylinder('heavy stern turbine',(2.12,y,-.22),.33,.85,dark)
            torus('turbine nozzle',(2.56,y,-.22),.27,.045,s,'X')
            cylinder('stern reactor',(2.60,y,-.22),.18,.035,l)
    elif level==2:
        for arm in range(3):
            a=arm*math.tau/3
            for j in range(4):
                x=1.0+j*.43; y=-.40
                xx=x*math.cos(a)-y*math.sin(a); yy=x*math.sin(a)+y*math.cos(a)
                box('radial armour cassette',(xx,yy,.53),(.34,.48,.23),h,.035,angle=a)
                box('cassette service recess',(xx,yy,.66),(.21,.25,.025),black,.006,angle=a)
            xx=1.1*math.cos(a); yy=1.1*math.sin(a)
            cylinder('field generator housing',(xx,yy,.40),.25,.45,s,'Z',vertices=20)
            torus('field generator iris',(xx,yy,.65),.18,.025,t)
    else:
        for j in range(7):
            x=-2.0+j*.76; y=math.sin(j*.63)*.47; radius=.98-j*.07
            for side in [-1,1]:
                painted('overlapping leviathan carapace',[(x-.35,y+side*.18),(x-.1,y+side*radius),(x+.43,y+side*radius*.83),(x+.31,y+side*.20)],radius*.60,.17,h)
                for k in range(3): box('gill heat exchanger',(x-.14+k*.13,y+side*radius*.53,radius*.60+.19),(.045,.24,.024),black,.003)
            spike('dorsal stabilizer',(x+.1,y,.45),(x+.46,y,.98-j*.05),.19,t,3)
        for side in [-1,1]:
            cylinder('jaw accelerator',(-2.97,side*.57,.38),.14,1.05,dark)
            torus('jaw muzzle brake',(-3.50,side*.57,.38),.13,.023,s,'X')
    active['design']=['divided vertical portal','asymmetric rail siege engine','open triskelion station','articulated abyssal leviathan'][level]
    active.rotation_euler.x=math.radians([12,58,22,42][level])
    # Reactor geometries stay local to their own pivot when animated in-game.
    start('core_'+name)
    orb('exposed reactor',core_location,(.30,.30,.18),l,level==3)
    active.rotation_euler.x=math.radians([12,58,22,42][level])
    start('ring_'+name)
    if level==0:
        for sign in [-1,1]: shell('portal iris',core_location, .53,.065,.2 if sign==1 else 3.34,2.9 if sign==1 else 6.03,core_location[2],.045,t)
    elif level==1:
        torus('magazine retainer',core_location,.54,.075,t)
        for j in range(6):
            a=j*math.tau/6; box('magazine latch',(core_location[0]+math.cos(a)*.5,core_location[1]+math.sin(a)*.5,core_location[2]),(.16,.10,.12),s,.016,angle=a)
    elif level==2:
        for j in range(3):
            a=j*math.tau/3; spike('triangular field vane',(math.cos(a)*.39,math.sin(a)*.39,.25),(math.cos(a+.3)*.65,math.sin(a+.3)*.65,.25),.12,s,3)
    else:
        for j in range(5):
            a=j*math.tau/5; orb('bioceramic iris petal',(core_location[0]+math.cos(a)*.43,math.sin(a)*.43,.81),(.15,.10,.07),t)
    active.rotation_euler.x=math.radians([12,58,22,42][level])
    start('pod_'+name); ports=[]
    if level==0:
        painted('portal shield drone',[(-.42,-.5),(.32,-.44),(.51,0),(.32,.44),(-.42,.5)],-.12,.24,h)
        for y in [-.27,.27]: battery((-.40,y,.18),l,.50,.05)
    elif level==1:
        cylinder('siege shell drone',(0,0,0),.22,1.04,h,r2=.13)
        for y in [-.25,.25]: spike('shell stabilizer',(.34,y*.3,0),(.59,y,0),.12,s,3)
        port((-.45,0,.17),l,.055)
    elif level==2:
        for j in range(3):
            a=j*math.tau/3; rod('relay tripod',(0,0,0),(math.cos(a)*.46,math.sin(a)*.46,0),.04,t)
            orb('relay lobe',(math.cos(a)*.4,math.sin(a)*.4,0),(.17,.17,.13),s)
        port((0,0,.17),l,.09)
    else:
        orb('abyssal stingray',(.0,0,0),(.49,.26,.17),h,True)
        for sign in [-1,1]: spike('stingray fin',(.0,sign*.1,0),(.26,sign*.6,0),.16,s,3)
        spike('stingray barb',(.25,0,0),(.95,0,0),.08,t,4)
        port((-.31,0,.14),l,.05)
    active.rotation_euler.x=math.radians([15,65,25,45][level])
