(function(){
"use strict";
const DATA = JSON.parse(document.getElementById('metro-data').textContent);
const NS = 'http://www.w3.org/2000/svg';
const $ = id => document.getElementById(id);
const LAT0 = 42.69, KX = 111320*Math.cos(LAT0*Math.PI/180), KY = 110540;
const toW = (lat, lon) => [(lon-23.32)*KX, (lat-LAT0)*KY];
const LINES = ['M1','M2','M3','M4'];
const OFF = {M1:0, M4:0, M2:0, M3:0};   // all lines share one colour, so the shared M1/M4 track is drawn once   // px side offset where M1 and M4 share track
const LC = DATA.lines;
const visible = {M1:true,M2:true,M3:true,M4:true};

/* ---------- geometry ---------- */
const SH = {};
for (const [k, pts] of Object.entries(DATA.shapes)) {
  const n = pts.length, xs = new Float64Array(n), ys = new Float64Array(n), cum = new Float64Array(n);
  for (let i=0;i<n;i++){ const w=toW(pts[i][0],pts[i][1]); xs[i]=w[0]; ys[i]=w[1]; if(i) cum[i]=cum[i-1]+Math.hypot(xs[i]-xs[i-1],ys[i]-ys[i-1]); }
  SH[k] = {xs, ys, cum, n};
}
function along(sh, d){
  const {xs,ys,cum,n} = sh;
  if (d <= 0) d = 0; if (d >= cum[n-1]) d = cum[n-1]-1e-6;
  let lo=0, hi=n-1;
  while (hi-lo>1){ const m=(lo+hi)>>1; if (cum[m] <= d) lo=m; else hi=m; }
  const seg = (cum[hi]-cum[lo]) || 1e-9, u = (d-cum[lo])/seg;
  const dx = xs[hi]-xs[lo], dy = ys[hi]-ys[lo], L = Math.hypot(dx,dy) || 1;
  return [xs[lo]+dx*u, ys[lo]+dy*u, dx/L, dy/L];
}

/* ---------- stations / patterns / trips ---------- */
const ST = {};
for (const [id, s] of Object.entries(DATA.stations)) { const w = toW(s.lat, s.lon); ST[id] = {id, name:s.n, x:w[0], y:w[1], lines:new Set()}; }
const P = DATA.patterns.map(p => {
  const idx = {}; p.s.forEach((s,j)=>{ (idx[s] ||= []).push(j); ST[s].lines.add(p.r); });
  return {...p, idx, head: ST[p.s[p.s.length-1]].name, dir: p.sh.endsWith('_1') ? 1 : 0, shape: SH[p.sh]};
});
const SETS = DATA.sets.map(a => new Set(a));
// drawn line = the shape cut exactly at the first and last station, so each line ends in its terminal circle
const CLIP = {};
function clipShape(sh, d0, d1){
  const X = [], Y = [], a = along(sh, d0); X.push(a[0]); Y.push(a[1]);
  for (let i=0;i<sh.n;i++) if (sh.cum[i] > d0 && sh.cum[i] < d1){ X.push(sh.xs[i]); Y.push(sh.ys[i]); }
  const b = along(sh, d1); X.push(b[0]); Y.push(b[1]);
  return {xs:X, ys:Y, n:X.length};
}
for (const l of LINES){
  const sh = SH[l+'_0'], xs = P.filter(p=>p.sh===l+'_0').flatMap(p=>p.x);
  CLIP[l] = (!sh || !xs.length) ? sh : clipShape(sh, Math.min(...xs), Math.max(...xs));
}
const T = DATA.trips.map(([pi,t0,si],i) => ({i, p:P[pi], t0, set:SETS[si], end:t0+P[pi].a[P[pi].a.length-1]}));
const PRE = 60; // seconds a train is shown waiting at its first station

// termini per line (most frequent pattern)
const TERM = {};
for (const l of LINES){
  const c = new Map();
  for (const t of T) if (t.p.r===l){ const k=t.p.s[0]+'|'+t.p.s[t.p.s.length-1]; c.set(k,(c.get(k)||0)+1); }
  const best = [...c.entries()].sort((a,b)=>b[1]-a[1])[0][0].split('|');
  TERM[l] = [ST[best[0]].name, ST[best[1]].name];
}
// major stations: termini, multi-line, or interchange with a nearby station of another line
const MAJOR = new Set();
for (const t of T){ MAJOR.add(t.p.s[0]); MAJOR.add(t.p.s[t.p.s.length-1]); }
const stList = Object.values(ST);
for (const a of stList){
  if (a.lines.size>1) MAJOR.add(a.id);
  for (const b of stList) if (a!==b && Math.hypot(a.x-b.x,a.y-b.y)<350 && ![...a.lines].some(l=>b.lines.has(l))) MAJOR.add(a.id);
}

// interchanges: two stations of different lines a short walk apart (Сердика/Сердика 2, НДК/НДК 2)
const PAIRS = [], IN_PAIR = new Set();
for (const a of stList) for (const b of stList)
  if (a.id < b.id && Math.hypot(a.x-b.x, a.y-b.y) < 160 && ![...a.lines].some(l=>b.lines.has(l))) { PAIRS.push([a,b]); IN_PAIR.add(a.id); IN_PAIR.add(b.id); }
// junctions: where lines split (Младост 1)
const NB = {};
for (const p of P) p.s.forEach((s,j)=>{ const n = (NB[s] ||= new Set()); if (j) n.add(p.s[j-1]); if (j<p.s.length-1) n.add(p.s[j+1]); });
const JUNCTION = new Set(stList.filter(s=>NB[s.id] && NB[s.id].size>=3).map(s=>s.id));
// one place per interchange: Сердика + Сердика 2 → „Сердика“, НДК + НДК 2 → „НДК“

// board: every line as a strip, west on the left
const ROWS = {};
for (const l of LINES){
  const ps = P.filter(p=>p.r===l && p.dir===0), pool = ps.length ? ps : P.filter(p=>p.r===l);
  const can = pool.reduce((a,b)=> b.s.length>a.s.length ? b : a).s.slice();
  if (ST[can[0]].x > ST[can[can.length-1]].x) can.reverse();
  const ix = {}; can.forEach((s,i)=>{ ix[s]=i; });
  ROWS[l] = {stops:can, ix};
}
// M1 and M4 run on the same track up to Младост 1: one strip, with the shorter line as a branch after the split
const ROWDEFS = [];
for (const grp of [['M1','M4'],['M2'],['M3']]){
  if (grp.length===1){ ROWDEFS.push({lines:grp, main:grp[0], branch:null}); continue; }
  const [a,b] = grp.map(l=>ROWS[l].stops); let c = 0;
  while (c<a.length && c<b.length && a[c]===b[c]) c++;
  if (c<2){ grp.forEach(l=>ROWDEFS.push({lines:[l], main:l, branch:null})); continue; }
  const main = a.length>=b.length ? grp[0] : grp[1];
  ROWDEFS.push({lines:grp, main, branch: main===grp[0] ? grp[1] : grp[0], split:c-1});
}
// M1 and M4 share a track up to Младост 1: draw it once (as M1); M4 is drawn only beyond the split,
// and M4 trains on the shared part follow the M1 geometry, so nothing is doubled a few metres apart
const SHARE = {};
for (const d of ROWDEFS) if (d.branch){
  const owner = d.branch, other = d.main, trunk = new Set(ROWS[other].stops.slice(0, d.split+1)), junction = ROWS[other].stops[d.split];
  const dist = {}; for (const p of P) if (p.sh===owner+'_0') p.s.forEach((s,j)=>{ if (trunk.has(s) && dist[s]===undefined) dist[s] = p.x[j]; });
  if (!Object.keys(dist).length) continue;
  SHARE[other] = {owner, trunk, junction, shape:SH[owner+'_0'], dist};
  const sh = SH[other+'_0'], own = [];
  for (const p of P) if (p.sh===other+'_0') p.s.forEach((s,j)=>{ if (!trunk.has(s) || s===junction) own.push([p.x[j], s]); });
  if (!sh || !own.length) continue;
  const ds = own.map(o=>o[0]), d0 = Math.min(...ds), d1 = Math.max(...ds), c = clipShape(sh, d0, d1);
  // join the branch exactly at the junction point on the drawn shared line
  const jd = own.find(o=>o[1]===junction), q = jd && dist[junction]!==undefined ? along(SH[owner+'_0'], dist[junction]) : null;
  if (q){ const k = Math.abs(jd[0]-d0) < Math.abs(jd[0]-d1) ? 0 : c.n-1; c.xs[k] = q[0]; c.ys[k] = q[1]; SHARE[other].jk = k; }
  CLIP[other] = c;
}
// map positions: every station sits exactly on its drawn line (where the trains stop), not at the raw platform
// coordinate a few metres off; an interchange sits where its two lines cross
const SNAP = {};
for (const sh of Object.values(SHARE)) for (const s of sh.trunk){                 // shared track: on the line drawn there
  if (sh.dist[s]!==undefined){ const q = along(sh.shape, sh.dist[s]); SNAP[s] = [q[0], q[1]]; }
}
for (const pass of [0,1]) for (const p of P){
  if (pass===0 && !p.sh.endsWith('_0')) continue;                     // prefer the shape the line is drawn with
  p.s.forEach((s,j)=>{ if (!SNAP[s]){ const q = along(p.shape, p.x[j]); SNAP[s] = [q[0], q[1]]; } });
}
const snapOf = s => SNAP[s.id] || [s.x, s.y];
const drawnLine = s => { const l = [...s.lines][0], sh = SHARE[l]; return sh && sh.trunk.has(s.id) ? sh.owner : l; };
// smoothed drawing lines: drop the little spikes the GTFS shapes make towards each platform,
// simplify, then round the corners; stations and trains are placed on these lines
function withCum(X, Y){ const cum = new Float64Array(X.length); for (let i=1;i<X.length;i++) cum[i] = cum[i-1] + Math.hypot(X[i]-X[i-1], Y[i]-Y[i-1]); return {xs:X, ys:Y, cum, n:X.length}; }
function smoothLine(c){
  let X = Array.from(c.xs), Y = Array.from(c.ys);
  for (let changed = true; changed; ){                                  // 1. spikes and duplicate points
    changed = false;
    for (let i=1; i<X.length-1; i++){
      const ax = X[i]-X[i-1], ay = Y[i]-Y[i-1], bx2 = X[i+1]-X[i], by2 = Y[i+1]-Y[i], la = Math.hypot(ax,ay), lb = Math.hypot(bx2,by2);
      if (la < 0.5 || lb < 0.5 || ((ax*bx2+ay*by2)/(la*lb) < -0.2 && Math.min(la,lb) < 80)){ X.splice(i,1); Y.splice(i,1); changed = true; i--; }
    }
  }
  const keep = new Array(X.length).fill(false); keep[0] = keep[X.length-1] = true;   // 2. simplify (15 m: irons out small steps)
  const stack = [[0, X.length-1]];
  while (stack.length){
    const [a, b] = stack.pop(), dx = X[b]-X[a], dy = Y[b]-Y[a], L = Math.hypot(dx,dy) || 1e-9; let best = -1, bi = -1;
    for (let i=a+1;i<b;i++){ const d = Math.abs(dy*(X[i]-X[a]) - dx*(Y[i]-Y[a]))/L; if (d > best){ best = d; bi = i; } }
    if (best > 15){ keep[bi] = true; stack.push([a,bi],[bi,b]); }
  }
  X = X.filter((_,i)=>keep[i]); Y = Y.filter((_,i)=>keep[i]);
  for (let it=0; it<3; it++){                                           // 3. round the corners (Chaikin), ends stay put
    const NX = [X[0]], NY = [Y[0]];
    for (let i=0;i<X.length-1;i++){
      if (i>0){ NX.push(.75*X[i]+.25*X[i+1]); NY.push(.75*Y[i]+.25*Y[i+1]); }
      if (i<X.length-2){ NX.push(.25*X[i]+.75*X[i+1]); NY.push(.25*Y[i]+.75*Y[i+1]); }
    }
    NX.push(X[X.length-1]); NY.push(Y[Y.length-1]); X = NX; Y = NY;
  }
  return withCum(X, Y);
}
function project(sh, x, y){                                             // distance along sh of the nearest point to (x,y)
  let best = 1e18, bd = 0;
  for (let i=1;i<sh.n;i++){
    const ax = sh.xs[i-1], ay = sh.ys[i-1], dx = sh.xs[i]-ax, dy = sh.ys[i]-ay, L2 = dx*dx+dy*dy || 1e-9;
    const u = Math.max(0, Math.min(1, ((x-ax)*dx+(y-ay)*dy)/L2)), d = Math.hypot(ax+u*dx-x, ay+u*dy-y);
    if (d < best){ best = d; bd = sh.cum[i-1] + u*Math.sqrt(L2); }
  }
  return bd;
}
const RS = {}, RSD = {};
const order = LINES.filter(l=>!SHARE[l]).concat(LINES.filter(l=>SHARE[l]));   // shared-track owners first
for (const l of order){
  const c = CLIP[l]; if (!c || !c.xs) continue;
  const sh = SHARE[l];
  if (sh && sh.jk!==undefined && RS[sh.owner] && SNAP[sh.junction]){        // branch starts at the junction on the smoothed owner line
    const q = along(RS[sh.owner], project(RS[sh.owner], SNAP[sh.junction][0], SNAP[sh.junction][1]));
    c.xs[sh.jk] = q[0]; c.ys[sh.jk] = q[1];
  }
  RS[l] = smoothLine(c);
  RSD[l] = {};
  for (const p of P) if (p.r===l) for (const s of p.s){
    if (RSD[l][s]!==undefined || !SNAP[s]) continue;
    if (sh && sh.trunk.has(s) && s!==sh.junction) continue;              // drawn on the owner line instead
    RSD[l][s] = project(RS[l], SNAP[s][0], SNAP[s][1]);
  }
}
const lineFor = (l, sa, sb) => { const sh = SHARE[l]; return sh && sh.trunk.has(sa) && sh.trunk.has(sb) ? sh.owner : l; };
const placeOf = s => { const L = drawnLine(s), d = RSD[L] && RSD[L][s.id]; return d===undefined ? snapOf(s) : along(RS[L], d).slice(0,2); };
function crossing(la, lb, mx, my){                                    // nearest crossing of two drawn lines to (mx,my)
  const A = RS[la], B = RS[lb]; if (!A || !B) return null;
  let best = null, bd = 400;                                          // only within 400 m
  for (let i=1;i<A.n;i++){
    const ax=A.xs[i-1], ay=A.ys[i-1], bx2=A.xs[i], by2=A.ys[i];
    if (Math.min(Math.hypot(ax-mx,ay-my), Math.hypot(bx2-mx,by2-my)) > 900) continue;
    for (let j=1;j<B.n;j++){
      const cx=B.xs[j-1], cy=B.ys[j-1], dx=B.xs[j], dy=B.ys[j];
      const den = (bx2-ax)*(dy-cy) - (by2-ay)*(dx-cx); if (Math.abs(den) < 1e-9) continue;
      const u = ((cx-ax)*(dy-cy) - (cy-ay)*(dx-cx))/den, v = ((cx-ax)*(by2-ay) - (cy-ay)*(bx2-ax))/den;
      if (u<0 || u>1 || v<0 || v>1) continue;
      const X = ax+u*(bx2-ax), Y = ay+u*(by2-ay), dd = Math.hypot(X-mx, Y-my);
      if (dd < bd){ bd = dd; best = [X, Y]; }
    }
  }
  return best;
}
const CANON = {}, MEMBERS = {}, NODES = [], paired = new Set();
for (const s of stList){ CANON[s.id] = s.id; MEMBERS[s.id] = [s.id]; }
for (const [a,b] of PAIRS){
  const prim = (/\s2$/.test(a.name) && !/\s2$/.test(b.name)) ? b : a, sec = prim===a ? b : a;
  CANON[sec.id] = prim.id; MEMBERS[prim.id] = MEMBERS[sec.id] = [prim.id, sec.id];
  const [ax, ay] = placeOf(a), [bx2, by2] = placeOf(b), mx = (ax+bx2)/2, my = (ay+by2)/2;
  const pos = crossing(drawnLine(a), drawnLine(b), mx, my) || [mx, my];
  NODES.push({id:prim.id, name:prim.name, x:pos[0], y:pos[1], lines:new Set([...a.lines, ...b.lines]), xfer:true});
  paired.add(a.id); paired.add(b.id);
}
for (const s of stList) if (!paired.has(s.id)){ const [x,y] = placeOf(s); NODES.push({id:s.id, name:s.name, x, y, lines:s.lines, xfer:JUNCTION.has(s.id)}); }
let mode = 'board';
try { if (localStorage.getItem('metro-view')==='geo') mode = 'geo'; } catch (e) {}

/* ---------- time ---------- */
const sofiaFmt = new Intl.DateTimeFormat('en-US',{timeZone:'Europe/Sofia',hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
let tzOff = 0, tzAt = -1e12;
function wallNow(){ // Sofia wall-clock as pseudo-UTC ms
  const now = Date.now();
  if (now - tzAt > 60000){
    const p = {}; for (const x of sofiaFmt.formatToParts(new Date(now))) p[x.type]=x.value;
    tzOff = Date.UTC(+p.year, +p.month-1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(now/1000)*1000; tzAt = now;
  }
  return now + tzOff;
}
const clock = {live:true, speed:1, paused:false, baseWall:0, baseReal:0};
function wall(){
  if (clock.live) return wallNow();
  if (clock.paused) return clock.baseWall;
  return clock.baseWall + (performance.now()-clock.baseReal)*clock.speed;
}
function setSim(w, speed, paused){ clock.live=false; clock.baseWall=w; clock.baseReal=performance.now(); clock.speed=speed; clock.paused=paused; syncControls(); }
const ymd = d => d.getUTCFullYear()*10000+(d.getUTCMonth()+1)*100+d.getUTCDate();
function tparts(w){
  const d = new Date(w), s = d.getUTCHours()*3600+d.getUTCMinutes()*60+d.getUTCSeconds()+d.getUTCMilliseconds()/1000;
  return {date:ymd(d), prev:ymd(new Date(w-86400000)), s, d};
}
const pad = n => String(n).padStart(2,'0');
const hhmm = sec => { sec = ((Math.round(sec)%86400)+86400)%86400; return pad(Math.floor(sec/3600))+':'+pad(Math.floor(sec/60)%60); };

/* ---------- train state ---------- */
function stateOf(t, rel){ // rel = seconds since trip start
  const p = t.p, a = p.a, d = p.d, x = p.x, n = a.length;
  if (rel < d[0]) return {dist:x[0], at:0, next:0, dwell:true, a:0, f:0};
  for (let i=0;i<n-1;i++){
    if (rel <= a[i+1]){
      if (rel < d[i]) return {dist:x[i], at:i, next:i+1, dwell:true, a:i, f:0};
      const span = a[i+1]-d[i], h = Math.min(12, span*0.2);
      const s0 = d[i]+h, s1 = a[i+1]-h;
      if (rel <= s0) return {dist:x[i], at:i, next:i+1, dwell:true, a:i, f:0};
      if (rel >= s1) return {dist:x[i+1], at:i+1, next:i+2, dwell:true, a:i, f:1};
      const u = (rel-s0)/(s1-s0), e = (1-Math.cos(Math.PI*u))/2;
      return {dist:x[i]+(x[i+1]-x[i])*e, at:-1, prev:i, next:i+1, dwell:false, a:i, f:e};
    }
  }
  return {dist:x[n-1], at:n-1, next:n, dwell:true, a:n-1, f:0};
}
function activeTrips(w){
  const {date, prev, s} = tparts(w), out = [];
  for (const t of T){
    let rel = null;
    if (t.set.has(date) && s >= t.t0-PRE && s <= t.end) rel = s-t.t0;
    else if (t.set.has(prev) && s+86400 >= t.t0-PRE && s+86400 <= t.end) rel = s+86400-t.t0;
    if (rel !== null) out.push({t, rel});
  }
  return out;
}

/* ---------- view ---------- */
const svg = $('map'), scroller = $('mapScroll');
let W = 800, H = 600;
function setSvgSize(w,h){ svg.style.width = w+'px'; svg.style.height = h+'px'; svg.setAttribute('viewBox', `0 0 ${w} ${h}`); }
const view = {cx:0, cy:0, k:0.05};
let fitK = 0.05;
let bounds = [1e9,1e9,-1e9,-1e9];
for (const s of Object.values(SH)) for (let i=0;i<s.n;i++){ bounds[0]=Math.min(bounds[0],s.xs[i]); bounds[1]=Math.min(bounds[1],s.ys[i]); bounds[2]=Math.max(bounds[2],s.xs[i]); bounds[3]=Math.max(bounds[3],s.ys[i]); }
function fit(){
  const bw = bounds[2]-bounds[0], bh = bounds[3]-bounds[1];
  fitK = Math.min((W-40)/bw, (H-70)/bh);
  view.k = fitK; view.cx = (bounds[0]+bounds[2])/2; view.cy = (bounds[1]+bounds[3])/2 - 10/fitK;
}
const sx = x => (x-view.cx)*view.k + W/2;
const sy = y => (view.cy-y)*view.k + H/2;
function el(tag, attrs, parent){ const e=document.createElementNS(NS,tag); for (const k in attrs) e.setAttribute(k, attrs[k]); if(parent) parent.appendChild(e); return e; }

function offsetPath(sh, off){
  const n = sh.n, X = new Array(n), Y = new Array(n);
  for (let i=0;i<n;i++){ X[i]=sx(sh.xs[i]); Y[i]=sy(sh.ys[i]); }
  let d = '';
  for (let i=0;i<n;i++){
    let nx=0, ny=0;
    if (off){
      const a = Math.max(0,i-1), b = Math.min(n-1,i+1);
      const dx = X[b]-X[a], dy = Y[b]-Y[a], L = Math.hypot(dx,dy)||1;
      nx = -dy/L*off; ny = dx/L*off;
    }
    d += (i?'L':'M') + (X[i]+nx).toFixed(1) + ',' + (Y[i]+ny).toFixed(1);
  }
  return d;
}

// background map of Sofia (OpenStreetMap), drawn once in metres and moved with one transform
const BASE = JSON.parse(document.getElementById('basemap-data').textContent);
const gBase = $('gBase');
for (const k of ['park','water','river','secondary','primary','major']) if (BASE[k]) el('path',{d:BASE[k], class:k}, gBase);

let selected = null; // {type:'train', i} | {type:'st', id}
let hoverLine = null;
let showLabels = true;
try { showLabels = localStorage.getItem('metro-labels') !== '0'; } catch (e) {}
function focusLines(){
  const f = new Set();
  if (hoverLine) f.add(hoverLine);
  if (selected && selected.type==='train') f.add(T[selected.i].p.r);
  return f;
}

function drawStatic(){
  if (mode==='board') drawBoard(); else drawGeo();
  // move the trains in the same step as the map (pan, zoom, view switch), not on the next tick
  const w = wall(); drawTrains(w); lastDrawnWall = w;
}

/* ---------- board view ---------- */
// rows: M1 and M4 share one strip up to the split (Младост 1); the shorter line leaves it as a branch below
let BL = null;
const bx = pos => BL.gutL + pos*BL.sp;
const hasBr = d => d.branch && visible[d.branch];
function rounded(pts, r){            // orthogonal polyline with rounded corners
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
  for (let i=1;i<pts.length;i++){
    const [x,y] = pts[i];
    if (i < pts.length-1){
      const [px,py] = pts[i-1], [nx,ny] = pts[i+1];
      const l1 = Math.hypot(x-px,y-py)||1, l2 = Math.hypot(nx-x,ny-y)||1, rr = Math.min(r, l1/2, l2/2);
      d += `L${(x-(x-px)/l1*rr).toFixed(1)},${(y-(y-py)/l1*rr).toFixed(1)}Q${x.toFixed(1)},${y.toFixed(1)} ${(x+(nx-x)/l2*rr).toFixed(1)},${(y+(ny-y)/l2*rr).toFixed(1)}`;
    } else d += `L${x.toFixed(1)},${y.toFixed(1)}`;
  }
  return d;
}
function onPoly(pts, d){              // point and heading (deg) at distance d along a polyline
  for (let i=1;i<pts.length;i++){
    const [x0,y0] = pts[i-1], [x1,y1] = pts[i], L = Math.hypot(x1-x0,y1-y0);
    if (d <= L || i===pts.length-1){ const u = L ? Math.max(0, Math.min(1, d/L)) : 0; return [x0+(x1-x0)*u, y0+(y1-y0)*u, Math.atan2(y1-y0, x1-x0)*180/Math.PI]; }
    d -= L;
  }
}
function rowItems(d){                 // stations drawn in a row: index, on branch?, lines that stop there
  const items = [];
  if (!d.branch){ ROWS[d.main].stops.forEach((s,i)=>items.push({s, i, br:false, lines:[d.main]})); return items; }
  const vis = d.lines.filter(l=>visible[l]).sort();
  ROWS[d.main].stops.forEach((s,i)=>{
    if (i <= d.split) items.push({s, i, br:false, lines:vis});
    else if (visible[d.main]) items.push({s, i, br:false, lines:[d.main]});
  });
  if (hasBr(d)) ROWS[d.branch].stops.forEach((s,i)=>{ if (i > d.split) items.push({s, i, br:true, lines:[d.branch]}); });
  return items;
}
function boardLayout(){
  const defs = ROWDEFS.filter(d=>d.lines.some(l=>visible[l]));
  const top = 52, bottom = 34, gutL = 88, gutR = 66, gap = 16;
  const units = Math.max(1, defs.reduce((a,d)=>a + (hasBr(d)?2:1), 0));
  const MIN_UNIT = 112, unit = Math.max(MIN_UNIT, (H - top - bottom)/units);   // never squeeze a strip: scroll instead
  const lz = unit - gap - 44;                       // room for the slanted names above each pair of tracks
  const items = defs.map(rowItems), all = items.flat();
  const longest = Math.max(60, ...all.map(it=>ST[it.s].name.length*5.7+6));
  const th = Math.min(1.05, Math.max(0.45, Math.asin(Math.min(1, lz/longest))));
  const maxN = Math.max(2, ...all.map(it=>it.i+1));
  // spacing: as wide as the box allows, but every slanted name (and the end marks) must stay inside
  const cosT = Math.cos(th), need = [];
  items.forEach(list=>{
    const lastMain = Math.max(...list.filter(it=>!it.br).map(it=>it.i)), lastBr = Math.max(-1, ...list.filter(it=>it.br).map(it=>it.i));
    list.forEach(it=>need.push([it.i, Math.max(ST[it.s].name.length*5.7*cosT + 12, (it.i===(it.br?lastBr:lastMain)) ? gutR : 0)]));
  });
  let sp = (W - gutL - gutR)/(maxN-1);
  for (const [i,nd] of need) if (i>0) sp = Math.min(sp, (W - gutL - nd)/i);
  sp = Math.max(15/Math.sin(th), sp);
  const BW = Math.max(W, Math.ceil(Math.max(...need.map(([i,nd])=>gutL + i*sp + nd))));
  let y = top; const Y = defs.map(d=>{
    const r = {y1: y+unit-24-gap, y2: y+unit-24};
    if (hasBr(d)){ r.yb1 = y+2*unit-24-gap; r.yb2 = y+2*unit-24; }
    y += unit*(hasBr(d)?2:1); return r;
  });
  // minH depends only on the number of strips, never on the current box size (so growing the box cannot feed back)
  return {defs, items, gutL, gutR, gap, th, sp, BW, Y, top, bottom, totalH: Math.ceil(top + bottom + unit*units), minH: Math.ceil(top + bottom + MIN_UNIT*units)};
}
function drawBoard(){
  BL = boardLayout();
  gBase.style.display = 'none';
  const {defs, items, gap, sp, BW, Y, th} = BL;
  // all strips must be reachable: on a phone the box grows to fit them (the page scrolls),
  // on a short desktop window the board scrolls inside its box
  const wrap = document.querySelector('.mapwrap');
  const mh = matchMedia('(max-width: 860px)').matches ? BL.minH+'px' : '';
  if (wrap.style.minHeight !== mh) wrap.style.minHeight = mh;
  setSvgSize(BW, Math.max(H, BL.totalH));
  const gG = $('gGrid'), gL = $('gLines'), gS = $('gStations'), gB = $('gLabels');
  gG.textContent = gL.textContent = gS.textContent = gB.textContent = '';
  const F = focusLines(), selId = selected && selected.type==='st' ? selected.id : null;
  const selLine = selected && selected.type==='st' ? selected.line : null;   // set when a single track square was picked here
  const deg = (-th*180/Math.PI).toFixed(1);
  // the path every line's trains follow, per track (0 = upper, trains going right; 1 = lower, going left)
  BL.paths = {};
  defs.forEach((d,r)=>{
    const {y1,y2,yb1,yb2} = Y[r], x0 = bx(0)-20, M = ROWS[d.main];
    const straight = (R, yy) => ({pts:[[x0,yy],[bx(R.stops.length-1)+20,yy]], dist:Object.fromEntries(R.stops.map((s,i)=>[s, bx(i)-x0]))});
    BL.paths[d.main] = [straight(M,y1), straight(M,y2)];
    if (hasBr(d)){
      const B = ROWS[d.branch], xc = bx(d.split) + sp*0.5;
      BL.paths[d.branch] = [[y1,yb1,xc+gap/2],[y2,yb2,xc-gap/2]].map(([yy,yb,xv])=>{
        const dist = {}; B.stops.forEach((s,i)=>{ const x = bx(i); dist[s] = i<=d.split ? x-x0 : (xv-x0)+(yb-yy)+(x-xv); });
        return {pts:[[x0,yy],[xv,yy],[xv,yb],[bx(B.stops.length-1)+20,yb]], dist, xv, yy, yb};
      });
    }
  });
  // links between neighbouring rows: interchanges (Сердика ↔ Сердика 2, НДК ↔ НДК 2)
  for (let r=0; r<defs.length-1; r++){
    for (const a of items[r]) for (const b of items[r+1]){
      const link = (a.s===b.s && IN_PAIR.has(a.s)) || PAIRS.some(([p,q])=>(p.id===a.s&&q.id===b.s)||(p.id===b.s&&q.id===a.s));
      if (!link) continue;
      const xa = bx(a.i), xb = bx(b.i), ya = (a.br ? Y[r].yb2 : Y[r].y2)+8, yb = (b.br ? Y[r+1].yb1 : Y[r+1].y1)-8, ym = ya+10;
      el('path',{d:`M${xa.toFixed(1)},${ya}V${ym}H${xb.toFixed(1)}V${yb}`, class:'link'}, gL);
    }
  }
  defs.forEach((d,r)=>{
    const {y1,y2,yb1,yb2} = Y[r], M = ROWS[d.main], x0 = bx(0)-20;
    const on = d.lines.some(l=>F.has(l)), vm = visible[d.main];
    // main tracks; if only the branch line is shown, the main strip stops at the split
    const xEnd = vm ? bx(M.stops.length-1)+20 : bx(d.split) + sp*0.5 + gap;
    for (const yy of [y1,y2]) el('path',{d:`M${x0.toFixed(1)},${yy}H${xEnd.toFixed(1)}`, class:'trk'+(on?' on':'')}, gL);
    const marks = (x, ya, yb, tag) => {
      el('text',{x:x+7, y:ya+5, class:'dirmark'}, gL).textContent = '››';
      el('text',{x:x+7, y:yb+5, class:'dirmark'}, gL).textContent = '‹‹';
      if (tag) el('text',{x:x+24, y:(ya+yb)/2+4, class:'endtag'}, gL).textContent = tag;
    };
    if (vm) marks(bx(M.stops.length-1)+20, y1, y2, d.branch ? d.main : '');
    if (hasBr(d)){
      const B = ROWS[d.branch], onB = F.has(d.branch);
      for (const t of BL.paths[d.branch]){
        const end = t.pts[3][0];
        el('path',{d:rounded([[t.xv-14,t.yy],[t.xv,t.yy],[t.xv,t.yb],[end,t.yb]], 8), class:'trk'+(onB?' on':'')}, gL);
      }
      marks(bx(B.stops.length-1)+20, yb1, yb2, d.branch);
    }
    // row label
    const vis = d.lines.filter(l=>visible[l]);
    const g = el('g',{transform:`translate(12,${(y1+y2)/2-20})`}, gL);
    el('rect',{width:66, height:40, rx:4, class:'rowbox'}, g);
    el('text',{x:9, y:14, class:'rowcap'}, g).textContent = 'ЛИНИЯ';
    const no = el('text',{x:9, y:33, class:'rowno'}, g); no.textContent = vis.join('·');
    if (vis.length>1) no.style.fontSize = '15px';
    vis.forEach((l,k)=>el('circle',{cx:58-(vis.length-1-k)*10, cy:10, r:3.5, fill:LC[l].c}, g));
    // stations
    for (const it of items[r]){
      const s = it.s, x = bx(it.i), ya = it.br ? yb1 : y1, yb = it.br ? yb2 : y2, key = it.lines.join(',');
      const term = it.lines.some(l=>{ const st = ROWS[l].stops; return st[0]===s || st[st.length-1]===s; });
      const big = term || JUNCTION.has(s) || IN_PAIR.has(s);
      const sel = !selLine && selId && selId===CANON[s] ? ' sel' : '';      // picked on the map: mark the whole station
      if (big) el('rect',{x:(x-6.5).toFixed(1), y:ya-7, width:13, height:gap+14, rx:2.5, class:'st big'+sel}, gS);
      else for (const yy of [ya,yb]) el('rect',{x:(x-4.5).toFixed(1), y:yy-4.5, width:9, height:9, rx:1.2, class:'st'+sel}, gS);
      if (selLine===key && selId===s){                                       // picked here: mark only that track
        const yy = selected.dir==='r' ? ya : yb;
        el('rect',{x:(x-5.5).toFixed(1), y:yy-5.5, width:11, height:11, rx:1.5, class:'st sel'}, gS);
      }
      // two hit areas: upper track = trains going right, lower track = trains going left
      el('rect',{x:(x-sp/2).toFixed(1), y:ya-16, width:sp.toFixed(1), height:16+gap/2, fill:'transparent', 'data-st':s, 'data-line':key, 'data-dir':'r'}, gS);
      el('rect',{x:(x-sp/2).toFixed(1), y:ya+gap/2, width:sp.toFixed(1), height:gap/2+16, fill:'transparent', 'data-st':s, 'data-line':key, 'data-dir':'l'}, gS);
      if (showLabels){
        const lx = (x+3).toFixed(1), ly = ya-13;
        el('text',{x:lx, y:ly, transform:`rotate(${deg} ${lx} ${ly})`, class:'lbl bl'+((IN_PAIR.has(s)||JUNCTION.has(s))?' xf':'')}, gB).textContent = ST[s].name;
      }
    }
  });
}

/* ---------- geographic view ---------- */
function drawGeo(){
  setSvgSize(W, H);
  // the city underneath: streets, rivers, parks
  $('gGrid').textContent = '';
  gBase.style.display = '';
  const k = view.k;
  gBase.setAttribute('transform', `matrix(${k},0,0,${-k},${(W/2 - view.cx*k).toFixed(2)},${(H/2 + view.cy*k).toFixed(2)})`);

  const gL = $('gLines'); gL.textContent='';
  const F = focusLines();
  const order = ['M3','M2','M4','M1'].filter(l=>visible[l]).sort((x,y)=>F.has(x)-F.has(y));
  for (const l of order){
    const on = F.has(l);
    el('path',{d:offsetPath(RS[l] || CLIP[l], OFF[l]), fill:'none', stroke:on?'var(--track-hi)':'var(--track)', 'stroke-width':on?5.6:4.8, 'stroke-linejoin':'round','stroke-linecap':'round'}, gL);
  }

  const gS = $('gStations'); gS.textContent='';
  const gB = $('gLabels'); gB.textContent='';
  const showAll = view.k >= fitK*1.9;
  const boxes = [];
  const shown = NODES.filter(s => [...s.lines].some(l=>visible[l]));
  const ranked = shown.slice().sort((a,b)=>(MAJOR.has(b.id)-MAJOR.has(a.id)) || (b.lines.size-a.lines.size));
  // map view: round stations; bigger with a light rim only where you change lines
  // (Сердика/Сердика 2, НДК/НДК 2, and Младост 1 where M1 and M4 split) — not along the shared M1/M4 track
  for (const s of shown){
    const X = sx(s.x), Y = sy(s.y), big = s.xfer;
    const isSel = selected && selected.type==='st' && CANON[selected.id]===s.id;
    const c = el('circle',{cx:X, cy:Y, r: big?5:3.4, class:'st'+(big||isSel?' x':'')}, gS);
    if (isSel) c.style.strokeWidth = '3';
    el('circle',{cx:X, cy:Y, r:11, fill:'transparent', 'data-st':s.id}, gS);
  }
  for (const s of (showLabels ? ranked : [])){
    const major = MAJOR.has(s.id);
    if (!showAll && !major && !(selected && selected.id===s.id)) continue;
    const X = sx(s.x), Y = sy(s.y), w = s.name.length*6.3+4, h = 14;
    const cands = [[X+9,Y+4,'start',X+7,Y-8],[X-9,Y+4,'end',X-7-w,Y-8],[X,Y-11,'middle',X-w/2,Y-23],[X,Y+19,'middle',X-w/2,Y+7]];
    for (const [tx,ty,anchor,bx,by] of cands){
      const box=[bx,by,bx+w,by+h];
      if (box[0]<4 || box[2]>W-50 || box[1]<4 || box[3]>H-4) continue;
      if (boxes.some(b=>!(box[2]<b[0]||box[0]>b[2]||box[3]<b[1]||box[1]>b[3]))) continue;
      boxes.push(box);
      const t = el('text',{x:tx, y:ty, 'text-anchor':anchor, class:'lbl'+(s.xfer?' xf':'')}, gB); t.textContent = s.name;
      break;
    }
  }
  // scale bar
  const target = 110/view.k, nice = [200,500,1000,2000,5000,10000].find(v=>v>=target*0.6) || 10000;
  $('scaleBar').style.width = Math.round(nice*view.k)+'px';
  $('scaleTxt').textContent = nice>=1000 ? (nice/1000)+' км' : nice+' м';
}

/* ---------- trains ---------- */
const trainEls = new Map();
let lastDrawnWall = -1, current = [];
function drawTrains(w){
  current = activeTrips(w);
  const gT = $('gTrains'), seen = new Set();
  for (const {t, rel} of current){
    if (!visible[t.p.r]) continue;
    seen.add(t.i);
    const st = stateOf(t, rel);
    let px, py, ang;
    if (mode==='board'){
      const p = t.p, R = ROWS[p.r], right = R.ix[p.s[p.s.length-1]] > R.ix[p.s[0]];
      const tr = BL.paths[p.r] && BL.paths[p.r][right?0:1];
      const d0 = tr && tr.dist[p.s[st.a]], d1 = tr && tr.dist[p.s[Math.min(st.a+1, p.s.length-1)]];
      if (d0===undefined || d1===undefined){ seen.delete(t.i); continue; }
      const [x, y, a] = onPoly(tr.pts, d0 + (d1-d0)*st.f);
      px = x; py = y; ang = (d1 < d0 || (d1===d0 && !right)) ? a+180 : a;
    } else {
      // follow the smoothed drawn line between the two stations (the shared M1/M4 part uses the line drawn there)
      const p = t.p, sa = p.s[st.a], sb = p.s[Math.min(st.a+1, p.s.length-1)], L = lineFor(p.r, sa, sb), D = RSD[L];
      let x, y, tx, ty;
      if (D && D[sa]!==undefined && D[sb]!==undefined){
        const da = D[sa], db = D[sb];
        [x, y, tx, ty] = along(RS[L], da + (db-da)*st.f);
        let fwd = db > da;
        if (da===db){ for (let j=1;j<p.s.length;j++){ const Lj = lineFor(p.r, p.s[j-1], p.s[j]), u = RSD[Lj] && RSD[Lj][p.s[j-1]], v = RSD[Lj] && RSD[Lj][p.s[j]]; if (Lj===L && u!==undefined && v!==undefined && u!==v){ fwd = v > u; break; } } }
        if (!fwd){ tx = -tx; ty = -ty; }
      } else [x, y, tx, ty] = along(p.shape, st.dist);
      const X = sx(x), Y = sy(y), stx = tx, sty = -ty; // screen tangent
      const off = OFF[t.p.r] * (t.p.dir ? -1 : 1);
      px = X + (-sty)*off; py = Y + stx*off;
      ang = Math.atan2(sty, stx)*180/Math.PI;
    }
    let g = trainEls.get(t.i);
    if (!g){
      g = el('g',{class:'train','data-trip':t.i}, gT);
      el('circle',{r:13, fill:'transparent'}, g);
      el('circle',{r:9, fill:'none', stroke:'var(--map-ink)', 'stroke-width':1.6, class:'sel', opacity:0}, g);
      const b = el('g',{class:'body'}, g);
      // double chevron pointing in the direction of travel: a faded one behind, a solid one in front
      const CH = 'M-3,-6L3.5,0L-3,6L-7.5,6L-1,0L-7.5,-6Z';
      const fillC = mode==='board' ? 'var(--train)' : LC[t.p.r].c;   // board: one signal colour, rows tell the lines apart
      el('path',{d:CH, transform:'translate(-0.8,0) scale(.65)', fill:fillC, opacity:.55, stroke:'var(--train-edge)', 'stroke-width':1, 'stroke-linejoin':'round'}, b);
      el('path',{d:CH, transform:'translate(3.5,0)', fill:fillC, stroke:'var(--train-edge)', 'stroke-width':.8, 'stroke-linejoin':'round'}, b);
      trainEls.set(t.i, g);
    }
    g.setAttribute('transform', `translate(${px.toFixed(1)},${py.toFixed(1)})`);
    g.lastChild.setAttribute('transform', `rotate(${ang.toFixed(1)})`);
    g.children[1].setAttribute('opacity', selected && selected.type==='train' && selected.i===t.i ? 1 : 0);
  }
  for (const [i,g] of trainEls) if (!seen.has(i)){ g.remove(); trainEls.delete(i); }
}

/* ---------- panel ---------- */
const badge = l => `<span class="badge" style="--c:${LC[l].c}"><i></i>${l}</span>`;
const linesBox = $('lines');
for (const l of LINES){
  const b = document.createElement('button');
  b.type='button'; b.className='line'; b.setAttribute('aria-pressed','true'); b.dataset.line=l;
  b.innerHTML = `${badge(l)}<span class="term">${TERM[l][0]} ↔ ${TERM[l][1]}</span><span class="cnt" id="cnt${l}">–</span>`;
  b.title = 'Покажи или скрий линия '+l;
  b.addEventListener('click',()=>{ visible[l]=!visible[l]; b.setAttribute('aria-pressed', String(visible[l])); drawStatic(); });
  const hov = on => ()=>{ hoverLine = on ? l : null; drawStatic(); };
  b.addEventListener('mouseenter', hov(true)); b.addEventListener('mouseleave', hov(false));
  b.addEventListener('focus', hov(true)); b.addEventListener('blur', hov(false));
  linesBox.appendChild(b);
}
const plural = n => n===1 ? '1 влак' : n+' влака';

function renderPanel(w){
  const {s} = tparts(w);
  const cnt = {M1:0,M2:0,M3:0,M4:0};
  for (const {t, rel} of current) if (rel >= 0) cnt[t.p.r]++;
  for (const l of LINES) $('cnt'+l).innerHTML = `<b>${cnt[l]}</b> ${cnt[l]===1?'влак':'влака'}`;
  const total = LINES.reduce((a,l)=>a+cnt[l],0);
  const today = tparts(w).date;
  $('mapNote').textContent = (today > dMax || today < dMin) ? 'За тази дата още няма разписание.' : total ? `${plural(total)} в движение` : 'Няма влакове в движение: метрото не работи в този час.';

  const box = $('detail');
  if (!selected){ return; }
  if (selected.type==='train'){
    const c = current.find(c=>c.t.i===selected.i);
    if (!c){ box.innerHTML = `<h2>Избрано</h2><div class="empty">Влакът стигна крайната си спирка. Изберете друг влак.</div>`; return; }
    const {t, rel} = c, p = t.p, st = stateOf(t, rel), n = p.s.length;
    let status;
    if (rel < 0) status = `Чака на ${ST[p.s[0]].name}, тръгва в ${hhmm(t.t0+p.d[0])}`;
    else if (st.dwell) status = st.at===n-1 ? `Пристигна на ${ST[p.s[n-1]].name}` : `На спирка ${ST[p.s[st.at]].name}`;
    else { const eta = Math.max(0, Math.round((t.t0+p.a[st.next] - (rel+t.t0))/60)); status = `Пътува към ${ST[p.s[st.next]].name} · ${eta<1?'пристига':'след '+eta+' мин'}`; }
    const from = st.dwell ? st.at : st.next;
    let li = '';
    for (let j=Math.max(0,from); j<n; j++){
      li += `<li class="${j===from?'next':''}" style="--c:${LC[p.r].c}"><span class="k"></span><span>${ST[p.s[j]].name}</span><span class="t">${hhmm(t.t0+p.a[j])}</span></li>`;
    }
    box.innerHTML = `<h2>Влак</h2><div class="dhead">${badge(p.r)}<h3>към ${p.head}</h3></div>
      <div class="status">${status}</div>
      <div class="sub">Тръгнал от ${ST[p.s[0]].name} в ${hhmm(t.t0+p.d[0])}</div>
      <ul class="stops">${li}</ul>`;
  } else {
    const one = selected.line ? selected : null, oneLines = one ? one.line.split(',') : [];
    const S = ST[selected.id], mem = one ? [selected.id] : (MEMBERS[selected.id] || [selected.id]);
    const {date, prev} = tparts(w), groups = new Map();
    for (const t of T) for (const m of mem){
      const idxs = t.p.idx[m]; if (!idxs) continue;
      if (one){
        if (!oneLines.includes(t.p.r)) continue;
        const R1 = ROWS[t.p.r], right = R1.ix[t.p.s[t.p.s.length-1]] > R1.ix[t.p.s[0]];
        if ((one.dir==='r') !== right) continue;
      }
      for (const [dd, base] of [[date,0],[prev,86400]]){
        if (!t.set.has(dd)) continue;
        for (const j of idxs){
          if (j === t.p.s.length-1) continue;
          const dep = t.t0 + t.p.d[j] - base;
          if (dep < s-20 || dep > s+5400) continue;
          const key = t.p.r+'|'+t.p.head;
          if (!groups.has(key)) groups.set(key, {l:t.p.r, head:t.p.head, ts:[]});
          groups.get(key).ts.push(dep);
        }
      }
    }
    const gs = [...groups.values()].sort((a,b)=>a.l.localeCompare(b.l) || Math.min(...a.ts)-Math.min(...b.ts));
    let html = '';
    for (const g of gs){
      g.ts.sort((a,b)=>a-b);
      const m = g.ts.slice(0,4).map((d,k)=>{ const mn = Math.floor((d-s)/60); const txt = mn<1 ? 'сега' : mn+' мин'; return k===0?`<b>${txt}</b>`:txt; }).join(' · ');
      html += `<div class="dep">${badge(g.l)}<div><div class="to">към ${g.head}</div><div class="mins">${m}</div></div></div>`;
    }
    const sl = one ? oneLines : [...new Set(mem.flatMap(m=>[...ST[m].lines]))].sort();
    let sub = mem.length>1 ? `<div class="sub">Прикачване: ${mem.map(m=>ST[m].name).join(' ↔ ')}</div>` : '';
    let empty = 'Няма влакове през следващите 90 минути.';
    if (one){
      const ends = [...new Set(oneLines.map(l=>{ const st = ROWS[l].stops; return ST[st[one.dir==='r' ? st.length-1 : 0]].name; }))];
      sub = `<div class="sub">Посока: към ${ends.join(' / ')}</div>`;
      const atEnd = oneLines.every(l=>{ const R1 = ROWS[l], i = R1.ix[S.id]; return one.dir==='r' ? i===R1.stops.length-1 : i===0; });
      if (atEnd) empty = 'Това е крайна спирка: влаковете в тази посока свършват тук.';
    }
    box.innerHTML = `<h2>Станция</h2><div class="dhead"><h3>${S.name}</h3><div class="row">${sl.map(badge).join('')}</div></div>${sub}
      <div class="deps">${html || `<div class="empty">${empty}</div>`}</div>`;
  }
}

/* ---------- controls ---------- */
const bgDate = new Intl.DateTimeFormat('bg-BG',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long'});
function syncControls(){
  $('now').setAttribute('aria-pressed', String(clock.live));
  document.querySelectorAll('[data-speed]').forEach(b=>b.setAttribute('aria-pressed', String(!clock.live && !clock.paused && clock.speed===+b.dataset.speed)));
  $('pause').setAttribute('aria-pressed', String(!clock.live && clock.paused));
  const m = $('mode');
  m.className = 'pill ' + (clock.live ? 'live' : 'sim');
  $('modeTxt').textContent = clock.live ? 'На живо' : clock.paused ? 'Пауза' : (clock.speed===1 ? 'Симулация' : 'Симулация ×'+clock.speed);
}
$('now').addEventListener('click',()=>{ clock.live=true; syncControls(); });
document.querySelectorAll('[data-speed]').forEach(b=>b.addEventListener('click',()=>setSim(wall(), +b.dataset.speed, false)));
$('pause').addEventListener('click',()=>{ if (!clock.live && clock.paused) setSim(wall(), clock.speed, false); else setSim(wall(), clock.live?1:clock.speed, true); });
$('tod').addEventListener('input', e=>{
  const d = new Date(wall()); const base = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  setSim(base + (+e.target.value)*1000, clock.live?1:clock.speed, clock.live?false:clock.paused);
});
$('day').addEventListener('change', e=>{
  if (!e.target.value) return;
  const [y,mo,da] = e.target.value.split('-').map(Number), d = new Date(wall());
  const tod = d.getUTCHours()*3600000+d.getUTCMinutes()*60000+d.getUTCSeconds()*1000;
  setSim(Date.UTC(y,mo-1,da)+tod, clock.live?1:clock.speed, clock.live?false:clock.paused);
});
function zoomAt(f, X, Y){
  const nk = Math.max(fitK*0.6, Math.min(fitK*14, view.k*f));
  const wx = view.cx + (X-W/2)/view.k, wy = view.cy - (Y-H/2)/view.k;
  view.k = nk; view.cx = wx - (X-W/2)/nk; view.cy = wy + (Y-H/2)/nk;
  drawStatic();
}
$('zin').addEventListener('click',()=>zoomAt(1.6, W/2, H/2));
$('zout').addEventListener('click',()=>zoomAt(1/1.6, W/2, H/2));
$('zfit').addEventListener('click',()=>{ fit(); drawStatic(); });
function syncLabelBtn(){
  const b = $('zlbl'), t = showLabels ? 'Скрий имената на спирките' : 'Покажи имената на спирките';
  b.setAttribute('aria-pressed', String(showLabels)); b.setAttribute('aria-label', t); b.title = t;
}
$('zlbl').addEventListener('click',()=>{
  showLabels = !showLabels; syncLabelBtn(); drawStatic();
  try { localStorage.setItem('metro-labels', showLabels ? '1' : '0'); } catch (e) {}
});
syncLabelBtn();
svg.addEventListener('wheel', e=>{ if (mode==='board') return; e.preventDefault(); const r=svg.getBoundingClientRect(); zoomAt(Math.exp(-e.deltaY*0.0016), e.clientX-r.left, e.clientY-r.top); }, {passive:false});

const ptrs = new Map(); let moved = false, pinch = null;
svg.addEventListener('pointerdown', e=>{
  svg.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, {x:e.clientX, y:e.clientY}); moved = false;
  if (ptrs.size===2){ const [a,b]=[...ptrs.values()]; pinch = {d:Math.hypot(a.x-b.x,a.y-b.y)}; }
});
svg.addEventListener('pointermove', e=>{
  const p = ptrs.get(e.pointerId); if (!p) return;
  const dx = e.clientX-p.x, dy = e.clientY-p.y;
  if (Math.abs(dx)+Math.abs(dy) > 0) { if (!moved && Math.hypot(dx,dy) < 4 && ptrs.size===1) return; moved = true; }
  if (mode==='board') return;
  if (ptrs.size===1){ view.cx -= dx/view.k; view.cy += dy/view.k; svg.classList.add('drag'); p.x=e.clientX; p.y=e.clientY; drawStatic(); }
  else if (ptrs.size===2 && pinch){
    p.x=e.clientX; p.y=e.clientY; const [a,b]=[...ptrs.values()]; const d=Math.hypot(a.x-b.x,a.y-b.y);
    const r = svg.getBoundingClientRect(); zoomAt(d/pinch.d, (a.x+b.x)/2-r.left, (a.y+b.y)/2-r.top); pinch.d = d;
  }
});
function endPtr(e){
  if (!ptrs.has(e.pointerId)) return;
  ptrs.delete(e.pointerId); if (ptrs.size<2) pinch=null; svg.classList.remove('drag');
  if (e.type==='pointerup' && !moved && ptrs.size===0){
    const hit = document.elementsFromPoint(e.clientX, e.clientY);
    const tr = hit.map(h=>h.closest && h.closest('[data-trip]')).find(Boolean);
    const st = hit.find(h=>h.dataset && h.dataset.st);
    if (tr) selected = {type:'train', i:+tr.dataset.trip};
    else if (st) selected = st.dataset.line
      ? {type:'st', id:st.dataset.st, line:st.dataset.line, dir:st.dataset.dir}
      : {type:'st', id:CANON[st.dataset.st] || st.dataset.st};
    else { selected = null; $('detail').innerHTML = '<h2>Избрано</h2><div class="empty">Докоснете влак, за да видите следващите му спирки, или станция, за да видите кога идват влаковете.</div>'; }
    drawStatic(); const w = wall(); drawTrains(w); renderPanel(w);
  }
}
svg.addEventListener('pointerup', endPtr); svg.addEventListener('pointercancel', endPtr);

/* ---------- loop ---------- */
let lastPanel = 0, firstSize = true;
function resize(){
  W = Math.max(200, scroller.clientWidth); H = Math.max(200, scroller.clientHeight);
  if (firstSize){ fit(); firstSize=false; }
  drawStatic();
}
new ResizeObserver(resize).observe(scroller);
function setMode(m){
  mode = m;
  try { localStorage.setItem('metro-view', m); } catch (e) {}
  $('vBoard').setAttribute('aria-pressed', String(m==='board'));
  $('vGeo').setAttribute('aria-pressed', String(m==='geo'));
  for (const id of ['zin','zout','zfit']) $(id).hidden = m==='board';
  document.querySelector('.scale').hidden = m==='board';
  $('osmAttr').hidden = m==='board';
  svg.style.touchAction = m==='board' ? 'pan-x pan-y' : 'none';
  svg.classList.toggle('board', m==='board');
  svg.setAttribute('aria-label', m==='board' ? 'Схема на метрото в София с влаковете в движение' : 'Карта на метрото в София с влаковете в движение');
  $('gTrains').textContent = ''; trainEls.clear();
  if (m==='geo') document.querySelector('.mapwrap').style.minHeight = '';
  scroller.scrollLeft = 0; scroller.scrollTop = 0;
  drawStatic();
}
$('vBoard').addEventListener('click', ()=>setMode('board'));
$('vGeo').addEventListener('click', ()=>setMode('geo'));
// battery: trains move a few pixels a second, so ~10 redraws a second look the same as 60;
// a sped-up simulation gets ~30 so the motion stays smooth; a hidden tab stops entirely (no animation frame)
function nextFrame(){
  const ms = (!clock.live && clock.paused) ? 250 : (clock.live || clock.speed===1) ? 100 : 33;
  setTimeout(()=>requestAnimationFrame(frame), ms);
}
function frame(){
  const w = wall();
  if (w !== lastDrawnWall){ drawTrains(w); lastDrawnWall = w; }   // paused: nothing to redraw
  const now = performance.now();
  if (now-lastPanel > 500){
    lastPanel = now;
    const {d, s} = tparts(w);
    $('clock').textContent = pad(d.getUTCHours())+':'+pad(d.getUTCMinutes())+':'+pad(d.getUTCSeconds());
    $('date').textContent = bgDate.format(d);
    const tod = $('tod'); if (document.activeElement!==tod) tod.value = Math.floor(s/60)*60;
    $('todTxt').textContent = hhmm(s);
    const day = $('day'), iso = d.toISOString().slice(0,10); if (document.activeElement!==day && day.value!==iso) day.value = iso;
    renderPanel(w);
  }
  nextFrame();
}
const allDates = DATA.sets.flat(), dMin = Math.min(...allDates), dMax = Math.max(...allDates);
const isoOf = n => String(n).replace(/(\d{4})(\d{2})(\d{2})/,'$1-$2-$3');
const bgOf = n => String(n).replace(/(\d{4})(\d{2})(\d{2})/,'$3.$2.$1');
$('day').min = isoOf(dMin); $('day').max = isoOf(dMax);
$('dataInfo').textContent = `Разписание от ${bgOf(DATA.built || DATA.feed)}, валидно до ${bgOf(dMax)}. Проверява се автоматично всяка нощ и страницата се обновява, ако ЦГМ промени разписанието.`;
resize(); setMode(mode); syncControls();
// open with a station selected so the panel shows what it does
selected = {type:'st', id:'M7St'};
requestAnimationFrame(frame);
})();
