"""Decide whether a freshly built timetable differs from the one the app ships.

    python3 tools/update_check.py data/metro.json new-metro.json
Prints CHANGED or UNCHANGED (exit code 0 either way).

ЦГМ regenerates its GTFS file every night, but usually only the calendar grows by a day.
This compares what riders would see: lines, stations, shapes, trips, and the service days
of the next 90 days. It also reports CHANGED when the shipped calendar runs out within 45 days.
"""
import datetime
import json
import sys
from zoneinfo import ZoneInfo

old = json.load(open(sys.argv[1], encoding='utf-8'))
new = json.load(open(sys.argv[2], encoding='utf-8'))
today = datetime.datetime.now(ZoneInfo('Europe/Sofia')).date()
horizon = {int((today + datetime.timedelta(days=i)).strftime('%Y%m%d')) for i in range(-1, 91)}


def canon(d):
    sets = [set(s) & horizon for s in d['sets']]
    trips = sorted((json.dumps(d['patterns'][p], sort_keys=True), t0, tuple(sorted(sets[si])))
                   for p, t0, si in d['trips'])
    base = {k: d[k] for k in ('lines', 'shapes', 'stations')}
    return json.dumps(base, sort_keys=True, ensure_ascii=False), trips


old_max = max(x for s in old['sets'] for x in s)
runs_out = old_max < int((today + datetime.timedelta(days=45)).strftime('%Y%m%d'))
print('CHANGED' if canon(old) != canon(new) or runs_out else 'UNCHANGED')
