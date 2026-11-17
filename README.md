# Метро София на живо

Къде са влаковете на софийското метро в момента: табло с линиите (M1·M4, M2, M3) и карта на града,
с влаковете в движение, изчислени по официалното разписание на Център за градска мобилност.

Позициите са изчислени по разписанието, а не идват от GPS: живият поток на ЦГМ (GTFS‑Realtime)
съдържа автобуси, трамваи и тролейбуси, но не и метрото. Закъснения и спрени влакове не се виждат.

## Като приложение на телефона

Отвори страницата в Safari (iPhone) или Chrome (Android) и избери
**Сподели → Добави към началния екран**. Приложението се отваря на цял екран, със своя иконка,
и работи и без интернет.

## Как работи

Цялото приложение е една страница, `index.html`, без сървър: стиловете, кодът, разписанието
и фоновата карта са вградени в нея. `sw.js` я пази за офлайн ползване.

| Път | Какво е |
|---|---|
| `src/head.html` | заглавие, шрифтове и стилове |
| `src/body.html` | структурата на страницата |
| `src/app.js` | логиката: позиции на влаковете, схема, карта, панел, време |
| `data/metro.json` | разписанието на метрото, свито от GTFS файла на ЦГМ |
| `data/basemap.json` | фоновата карта на София (OpenStreetMap), опростена |
| `tools/build_metro.py` | GTFS → `data/metro.json` |
| `tools/build_base.py` | OpenStreetMap JSON (Overpass) → `data/basemap.json` |
| `tools/update_check.py` | дали новото разписание се различава от вграденото |
| `tools/assemble.py` | сглобява `index.html` от `src/` и `data/` |
| `.github/workflows/update-timetable.yml` | всяка нощ сваля разписанието и обновява приложението, ако то се е променило |

След промяна в `src/` или `data/`:

```bash
python3 tools/assemble.py
```

Ръчно обновяване на разписанието:

```bash
curl -fsSL -o /tmp/gtfs.zip https://gtfs.sofiatraffic.bg/api/v1/static
unzip -oq /tmp/gtfs.zip -d /tmp/gtfs
python3 tools/build_metro.py /tmp/gtfs data/metro.json
python3 tools/assemble.py
```

## Данни и лицензи

- Разписание: GTFS на [Център за градска мобилност](https://www.sofiatraffic.bg/) (sofiatraffic.bg), открити данни.
- Фонова карта: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, лиценз ODbL.
