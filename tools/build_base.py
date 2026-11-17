import json, math, sys
src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding='utf-8'))
LAT0 = 42.69; KX = 111320*math.cos(math.radians(LAT0)); KY = 110540
def xy(p): return ((p['lon']-23.32)*KX, (p['lat']-LAT0)*KY)
def dp(pts, tol):
    if len(pts) < 3: return pts
    keep = [False]*len(pts); keep[0] = keep[-1] = True; stack = [(0, len(pts)-1)]
    while stack:
        a, b = stack.pop(); (x1,y1),(x2,y2) = pts[a], pts[b]; dx, dy = x2-x1, y2-y1; L = math.hypot(dx,dy) or 1e-9
        best, bi = -1, -1
        for i in range(a+1, b):
            x, y = pts[i]; dist = abs(dy*(x-x1) - dx*(y-y1))/L if L > 1e-6 else math.hypot(x-x1, y-y1)
            if dist > best: best, bi = dist, i
        if best > tol: keep[bi] = True; stack += [(a,bi),(bi,b)]
    return [p for p,k in zip(pts,keep) if k]
def cls(t):
    h = t.get('highway')
    if h in ('motorway','trunk'): return 'major'
    if h in ('primary','secondary','tertiary'): return h
    if t.get('waterway') == 'river': return 'river'
    if t.get('natural') == 'water': return 'water'
    if t.get('leisure') == 'park': return 'park'
    return None
paths = {k: [] for k in ('park','water','river','tertiary','secondary','primary','major')}
npts = 0
for e in d['elements']:
    g = [p for p in e.get('geometry') or [] if p]
    c = cls(e.get('tags', {}))
    if not c or len(g) < 2: continue
    pts = [xy(p) for p in g]
    area = c in ('park','water')
    if area and (g[0]['lat'], g[0]['lon']) != (g[-1]['lat'], g[-1]['lon']): continue   # part of a multipolygon we did not fetch
    pts = dp(pts, 6 if area else 3.5)
    if area and len(pts) < 4: continue
    ip = [(round(x), round(y)) for x, y in pts]
    s = 'M%d,%d' % ip[0]; prev = ip[0]; seg = []
    for p in ip[1:]:
        dx, dy = p[0]-prev[0], p[1]-prev[1]
        if dx or dy: seg.append('%d,%d' % (dx, dy)); prev = p
    if not seg: continue
    s += 'l' + ' '.join(seg) + ('z' if area else '')
    paths[c].append(s); npts += len(seg)+1
res = {k: ''.join(v) for k, v in paths.items()}
res['osmBase'] = d.get('osm3s', {}).get('timestamp_osm_base', '')
json.dump(res, open(out, 'w'), separators=(',', ':'))
import os
print('points kept', npts, 'bytes', os.path.getsize(out), {k: len(v) for k, v in paths.items()})
