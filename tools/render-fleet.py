"""Offline orthographic contact sheet of the actual game meshes, with vertex colours."""
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

records = json.loads(Path('doc/validation/fleet-preview.json').read_text())
S = 2
W, H = 240, 220
rows = math.ceil(len(records) / 7)
out = Image.new('RGB', (W * 7 * S, (H * rows + 72) * S), '#081321')
draw = ImageDraw.Draw(out)
font_path = 'C:/Windows/Fonts/consola.ttf'
font = ImageFont.truetype(font_path, 13 * S)
heading = ImageFont.truetype(font_path, 23 * S)
draw.text((24*S, 15*S), f'VOLTARIS / {len(records)} IMPORTED UNITS', fill='#e5eff8', font=heading)
draw.text((24*S, 44*S), 'ACTUAL GEOMETRY / ORTHOGRAPHIC COLOUR STUDY / NOT AN IN-GAME CAPTURE', fill='#84a3bd', font=font)
for idx, record in enumerate(records):
    ox, oy = idx % 7 * W, idx // 7 * H + 72
    draw.rounded_rectangle((ox*S+5*S, oy*S+5*S, (ox+W-5)*S, (oy+H-5)*S), radius=9*S, fill='#101f30', outline='#21374b')
    all_points = [p for part in record['parts'] for p in zip(*[iter(part['points'])]*3)]
    xs = [p[0] for p in all_points]
    ys = [p[1]+p[2]*.25 for p in all_points]
    scale = min(196/(max(xs)-min(xs)), 153/(max(ys)-min(ys)))
    cx, cy = (min(xs)+max(xs))/2, (min(ys)+max(ys))/2
    faces = []
    for part in record['parts']:
        points = list(zip(*[iter(part['points'])]*3))
        colors = list(zip(*[iter(part['colors'])]*3))
        normals = list(zip(*[iter(part['normals'])]*3))
        indices = part['index'] or list(range(len(points)))
        for j in range(0,len(indices),3):
            ids=indices[j:j+3]
            p=[points[i] for i in ids]
            rgb=[sum(colors[i][ch] for i in ids)/3 for ch in range(3)]
            normal=[sum(normals[i][ch] for i in ids)/3 for ch in range(3)] if normals else [0,0,1]
            light=1 if part['emissive'] else .42+.58*max(0,normal[0]*-.3+normal[1]*.4+normal[2]*.86)
            # Convert linear vertex colours to display sRGB.
            rgb=tuple(round(255*min(1,max(0,c*light))**(1/2.2)) for c in rgb)
            xy=[((ox+120+(x-cx)*scale)*S,(oy+93-(y+z*.25-cy)*scale)*S) for x,y,z in p]
            depth=sum(z-y*.25 for x,y,z in p)/3
            faces.append((depth,xy,rgb))
    for _,xy,rgb in sorted(faces,key=lambda f:f[0]): draw.polygon(xy,fill=rgb)
    draw.text(((ox+14)*S,(oy+182)*S),f'{idx+1:02}  {record["name"]}',fill='#d8e8f3',font=font)
    for j,c in enumerate(record.get('palette', [])):
        draw.rectangle(((ox+15+j*22)*S,(oy+203)*S,(ox+32+j*22)*S,(oy+208)*S),fill=c)
out.resize((W*7,H*rows+72), Image.Resampling.LANCZOS).save('doc/validation/fleet-redesign.png')
print('doc/validation/fleet-redesign.png')
