import csv,sys,collections,json,math,datetime
from zoneinfo import ZoneInfo
D=sys.argv[1]; OUT=sys.argv[2]
R=lambda f: csv.DictReader(open(f"{D}/{f}",encoding='utf-8-sig'))
L=('M1','M2','M3','M4')
NAMES=dict(M14St='Александър Малинов',M19St='Цариградско шосе',M2St='Люлин',M202St='Бели Дунав',M13St='Младост 1',M5St='Константин Величков',M206St='Централна гара',M12St='Мусагеница',M304St='Стадион „Георги Аспарухов“',M318St='Горна баня',M16St='Бизнес парк София',M4St='Вардар',M315St='Овча купел',M20St='Дружба',M207St='Лъвов мост',M203St='Надежда',M23St='Летище София',M314St='Цар Борис III',M204St='Хан Кубрат',M201St='Ломско шосе',M22St='Софийска Света гора',M15St='Ал. Теодоров-Балан',M211St='Джеймс Баучер',M302St='Ген. Владимир Вазов',M21St='Искърско шосе',M1St='Сливница',M316St='Мизия',M9St='Стадион „Васил Левски“',M312St='България',M305St='Хаджи Димитър',M311St='Медицински университет',M303St='Бесарабия',M6St='Опълченска',M310St='НДК 2',M317St='Овча купел 2',M208St='Сердика 2',M212St='Витоша',M0St='Обеля',M306St='Театрална',M11St='Г. М. Димитров',M7St='Сердика',SUSt='Софийски университет',M10St='Жолио Кюри',M210St='Европейски съюз',M18St='Младост 3',M205St='Княгиня Мария Луиза',M209St='НДК',M3St='Западен парк',M309St='Патриарх Евтимий',OMSt='Орлов мост')
routes={r['route_id']:r for r in R('routes.txt') if r['route_id'] in L}
trips=[t for t in R('trips.txt') if t['route_id'] in L]
tids={t['trip_id'] for t in trips}
st=collections.defaultdict(list)
for r in R('stop_times.txt'):
    if r['trip_id'] in tids: st[r['trip_id']].append(r)
def sec(h): a,b,c=map(int,h.split(':')); return a*3600+b*60+c
stops={r['stop_id']:r for r in R('stops.txt') if r['stop_id'].startswith('M')}
en={}
for r in R('translations.txt'):
    if r['table_name']=='stops' and r['field_name']=='stop_name' and r['language']=='en': en[r['field_value']]=r['translation']
shapes=collections.defaultdict(list)
for r in R('shapes.txt'):
    if r['shape_id'][:2] in L and '_' in r['shape_id']: shapes[r['shape_id']].append((int(r['shape_pt_sequence']),float(r['shape_pt_lat']),float(r['shape_pt_lon'])))
lat0=42.69; kx=111320*math.cos(math.radians(lat0)); ky=110540
def xy(lat,lon): return ((lon-23.32)*kx,(lat-lat0)*ky)
shp={}
for k,v in shapes.items():
    v.sort(); pts=[(round(a,5),round(b,5)) for _,a,b in v]
    # dedupe
    p2=[pts[0]]
    for p in pts[1:]:
        if p!=p2[-1]: p2.append(p)
    cum=[0.0]
    for i in range(1,len(p2)):
        x1,y1=xy(*p2[i-1]);x2,y2=xy(*p2[i]); cum.append(cum[-1]+math.hypot(x2-x1,y2-y1))
    shp[k]=(p2,cum)
def project(shape,lat,lon,start):
    pts,cum=shp[shape]; px,py=xy(lat,lon); best=(1e18,0)
    for i in range(1,len(pts)):
        x1,y1=xy(*pts[i-1]);x2,y2=xy(*pts[i]); dx,dy=x2-x1,y2-y1; L2=dx*dx+dy*dy or 1e-9
        t=max(0,min(1,((px-x1)*dx+(py-y1)*dy)/L2)); d=math.hypot(x1+t*dx-px,y1+t*dy-py)
        s=cum[i-1]+t*math.sqrt(L2)
        if s+1<start: continue
        if d<best[0]-1e-6: best=(d,s)
        if d<30 and best[0]<30 and d>best[0]+200: break
    return best
# date sets
sids={t['service_id'] for t in trips}; dates=collections.defaultdict(set)
for r in R('calendar_dates.txt'):
    if r['service_id'] in sids and r['exception_type']=='1': dates[r['service_id']].add(int(r['date']))
setidx={}; sets=[]
fi=next(R('feed_info.txt'))
cutoff=int((datetime.datetime.now(ZoneInfo('Europe/Sofia'))-datetime.timedelta(days=2)).strftime('%Y%m%d'))
patidx={}; pats=[]; out=[]
maxd=0
for t in trips:
    s=sorted(st[t['trip_id']],key=lambda r:int(r['stop_sequence']))
    t0=sec(s[0]['departure_time'])
    key=(t['shape_id'],tuple(r['stop_id'] for r in s),tuple(sec(r['arrival_time'])-t0 for r in s),tuple(sec(r['departure_time'])-t0 for r in s))
    if key not in patidx:
        dist=[];cur=0
        for r in s:
            d,sd=project(t['shape_id'],float(stops[r['stop_id']]['stop_lat']),float(stops[r['stop_id']]['stop_lon']),cur); dist.append(round(sd)); cur=sd; maxd=max(maxd,d)
        patidx[key]=len(pats); pats.append({'r':t['route_id'],'sh':t['shape_id'],'s':list(key[1]),'a':list(key[2]),'d':list(key[3]),'x':dist})
    ds=frozenset(x for x in dates[t['service_id']] if x>=cutoff)
    if ds not in setidx: setidx[ds]=len(sets); sets.append(sorted(ds))
    out.append([patidx[key],t0,setidx[ds]])
print('max proj err m',round(maxd),'patterns',len(pats),'sets',[len(s) for s in sets])
used={x for p in pats for x in p['s']}
stations={}
plat={}
for sid in used:
    s=stops[sid]; par=s['parent_station'] or sid
    P=stops.get(par,s); plat[sid]=par
    stations[par]={'n':NAMES.get(par,P['stop_name']),'lat':round(float(P['stop_lat']),5),'lon':round(float(P['stop_lon']),5)}
for p in pats: p['s']=[plat[x] for x in p['s']]
out.sort(key=lambda x:x[1])
data={'lines':{k:{'c':'#'+r['route_color'],'tc':'#'+r['route_text_color'],'n':r['route_long_name']} for k,r in routes.items()},
 'shapes':{k:v[0] for k,v in shp.items() if k in {p['sh'] for p in pats}},
 'stations':stations,'patterns':pats,'trips':out,'sets':sets,'feed':fi['feed_start_date'],'feedEnd':fi['feed_end_date'],
 'built':datetime.datetime.now(ZoneInfo('Europe/Sofia')).strftime('%Y%m%d')}
assert set(data['lines'])==set(L) and len(stations)>=40 and len(out)>=1000, 'metro data looks incomplete'
json.dump(data,open(OUT,'w'),ensure_ascii=False,separators=(',',':'))
import os; print('bytes',os.path.getsize(OUT), 'stations',len(stations))

