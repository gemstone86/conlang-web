# Weather generator (Eon Weather)

> Part of the combined app: it lives at `/weather/`, its API at `/weather/api/`, and accounts are the shared ones from the start page (see README.md). Notes below about running it on its own, its own login and its own database settings are out of date; the README has the combined setup.

The Eon weather generator as a web page, with optional accounts that save to a database and a clickable map with weather layers.

The weather engine is your original code (`weather/`, `date/`, `context/`), and temperature, wind and events match the desktop app. Precipitation follows two deliberate rule changes (see *Changes to the engine*).

## Running it

You need **Java 21** and **Maven** (the same tools you already build the desktop version with).

```
mvn spring-boot:run
```

Then open http://localhost:8080. On Windows you can double-click `run.bat`.

To build a single jar instead: `mvn package`, then `java -jar target/eon-weather.jar`. Run it from a folder that contains the `world/` folder.

By default everything is saved in an H2 database file under `./data/`, so there's nothing to install. To use PostgreSQL, see *Settings* below, or run `docker compose up -d`, which starts the app together with PostgreSQL.

## What's on the page

- **Left side:** the day's weather for the chosen region, with temperature, wind (Swedish/English Beaufort name and m/s), precipitation, events, holy days and influx. Below that are the hourly graph, the 28-day month grid, and your notes.
- **Date controls:** `‹ ›` step one day and `« »` step one month. The ← and → keys also step one day, and Shift+← / Shift+→ step a month. Every calendar in `calendars.yaml` can be shown.
- **Accounts (optional):** anyone can look up weather and see public maps without logging in. Logging in lets you
  - write **comments** and **campaign notes** per date (the same idea as the desktop app, now stored in the database)
  - keep several campaigns. Each one remembers its own date and region.
  - **import** your old `comments.yaml` / campaign `.yaml` files, and **export** back to the same format
  - upload your own **maps**
  - pick up where you left off (region, date, layers, map), on any device

**Influx:** next to the calendar picker, the day's four influx aspects are shown: year, month, week and day, each with its symbol if the map has one. Aspects that occur more than once are highlighted, since that's what gives the influx bonus (+3 per extra match), as shown under the day's events.

**Religion filter:** between the hourly graph and the calendar, untick **Alla religioner** and pick one religion. Only that religion's holy days are then marked in the calendar and listed for the day. The choice is remembered. The list of religions comes from `world/important_dates.yaml`.

## The map

### The default map (Mundana)

The app ships with a ready-made map: **Mundana**, with all regions placed and symbols for 12 aspects. Everyone sees it first, logged in or not, marked *(standard)* in the map picker. It belongs to a built-in system account (`@eon`) that nobody can log in as or register, so it can't be edited or deleted from the page. People can still upload their own maps next to it.

It lives in `src/main/resources/default-map/`:

```
default-map/
  map.json        name, settings (reach, kmPerPixel, wrapWidth, tiles), symbol files, region points
  map.jpg         the map image (the full map shrunk to 1/8: 5476 × 2818)
  height.png      optional greyscale height map ("height": "height.png" in map.json)
  symbols/*.png   one per aspect or force, e.g. Kryotropi.png
```

**Base map and layers (from 1.18):** `map.jpg` is the plain world map and nothing else. Every regional map is a see-through layer in `tiles/mundana-1/layers/<id>/` (zoom pieces plus `map.webp`, its part of the map picture), listed in `manifest.json`. The manifest has `"flat": true`: there are no pre-merged zoom images, so the page draws the base picture and, over it, the chosen layers (the ones marked `default` when nothing is chosen). The older paragraphs below describe the earlier way, where the regional maps were merged into the map picture and the zoom images.

**Layer order (admins):** the layers are drawn in the order of `layerOrder` in the standard map's settings (bottom first), or else the manifest's. Admins change it with ▲ ▼ in the *Kartbild* list; it is saved for everyone, shows up in the admin export under `settings.layerOrder`, and `tools/apply-export.py` builds it into `map.json` (with `layerOrderRelease`, so a release's newer order replaces one set in the app, and an older release never does). Layers the order doesn't list keep their place; the listed ones swap among the places they have.

**Sharp detail when zoomed in:** the full Mundana map is 43 807 × 22 545 pixels, far too big to load at once. Most of it is the older map enlarged, but the pasted-in regional maps (Ebhron, Jargien, Menon Aun, Mio–Enara, Stora arkipelagen and others) have real detail. Those parts are cut into 512-pixel tiles at 1/4, 1/2 and full size, in `src/main/resources/static/weather/tiles/mundana-1/` (about 1 700 tiles, 32 MB, plus `manifest.json` listing them). The page fetches the tiles for what's on screen as you zoom in, and draws them over the map image. Parts without tiles just show the map image. The map's `"tiles": "tiles/mundana-1/"` setting turns this on.

**Your own maps can use these tiles too:** in *Placera områden*, set **Zoombilder** to *Från Mundana*. That only makes sense for a map of the same world with the same framing; the image itself can be any size, even the old 3192-pixel one. The tiles are placed relative to the whole map, so they line up whatever the image's resolution.

To make tiles from a new full-size map, use `tools/make-tiles.py` (needs `vips` and the Python packages `pyvips`, `numpy` and `scipy`). It writes `map.jpg` and a new tile folder; use a new folder name (`mundana-2`…) so browsers don't keep old tiles.

At startup the app copies it into the database. It keeps a fingerprint of the files, so after you change any of them and restart (or deploy a new jar), the stored copy is refreshed. The map keeps the same id, so people's saved choice of map still works. Points for regions that no longer exist are skipped, with a note in the log.

**Rivers, nations and forests from a release vs edits in the app:** normally what was edited in the app on the standard map is kept over the release's. A release made from an export carries `settings.riversRelease` (and `nationsRelease`, `forestRelease`) with the export's time. A value the installed copy hasn't had installs the release's version once, over the app's. Edits made after that are kept again. `tools/apply-export.py` sets these.

**Updating it: the admin export.** Admins have an **Exportera…** button in *Placera områden* (on the standard map and on their own maps). It compares the map with the standard map shipped in this release and lists what differs, then downloads a zip:

```
export.json            what is in the zip, and what it was compared against (see below)
height.png             the whole height map, if any pixel differs (with how many and where)
rivers.json            the rivers, if they differ
nations.json           the nations, if they differ
map.jpg / map.png      the map picture, if it differs
regions/<name>.yaml    each region made or changed in the app
```

Region positions, leylines, high-magic areas and changed settings are inside `export.json`, in the same form as in `map.json`. **Ladda ner ändringarna** gives only what differs; **Ladda ner allt** gives every part. On a map other than the standard one, a part that is empty there (no rivers drawn, say) means "not used on this map", not "remove them from the standard map": it is listed under `emptyOnThisMap` instead.

Version info: `export.json` `"base"` holds the app version, the release's default-map fingerprint (`bundle`), and the height map's revision (`heightRev`) plus fingerprints of the rivers and nations. When a release is made from the export, `heightRev` goes into `map.json`'s `settings.heightRev`. Height map changes accepted in the app after the export are then put back on top of the new height map at install, so nothing done in between is lost.

Send the zip to me and I'll build it in with `tools/apply-export.py <export.zip> [--dry-run]`, which writes the files into `default-map/` and `world/regions/` and updates `map.json`. You can also edit a copy on the page and copy values into `map.json` by hand (`x`/`y` are fractions of the width/height, 0–1).

### Your own maps

1. Log in and click **Upload map** (PNG, JPEG, GIF or WebP, up to 30 MB).
2. In **Place regions**, pick a region and click where it lies on the map. The list marks placed regions with ✓ and unplaced ones with ○. Tick **Only unplaced** to list just the regions still missing (with a count); each point you place then moves the picker to the next unplaced region. Large regions can have several points. Drag points to move them and right-click to remove them. Press **Save positions** when you're done.
   While placing, every region's area is coloured (each region has its own colour, also used for its points) with dark lines on the borders, so you can see what each point covers. The region you're placing is brighter. While you drag a point the colours wait, and they update when you let go.
3. **Reach** sets how far from a point the weather is drawn. Tick **Visible to everyone** to share the map with people who aren't logged in.
4. **Removing a map:** **Radera** in *Placera områden* removes the map. It is hidden from everyone else at once, and stays in your own map list marked 🗑 *(borttagen)*, with an **Ångra borttagningen** button and how long is left. While removed it can't be changed. After 24 hours it is deleted for good, with everything on it: region positions, areas, leylines, rivers, nations, the height map and its suggestions. The server checks every 15 minutes, and at startup. For testing, start the server with `-Deon.mapPurgeHours=…` to change the 24 hours.

**Layers:**

| Layer | What it shows |
|---|---|
| Clouds | Cloud cover that drifts and changes shape over time. Optional **cloud symbols** (toggle next to the layer) draw the clouds as cartoon clouds: puffy, half-transparent white shapes with a dark outline (greyer and darker-edged where it rains) |
| Precipitation | Radar-style rain/snow intensity. Optional **rain effect** (toggle next to the layer): falling rain, or snowflakes below freezing |
| Temperature | Blended temperature (blue → red) |
| Wind | Arrows: direction blowing *to*, length and colour by strength |
| Magic storms | Storms from the generator's magic events, drifting downwind for a few days |

The **Opacity** slider fades all the weather drawn on the map, so the map underneath shows through.

**Wrapping east–west:** in **Place regions**, set **Varv runt (px)** to the number of unique pixel columns once around the world. Mundana is 3110, because its last 82 columns repeat the first 82. Regions near the east and west edges then reach across the edge, storms leaving one side come in on the other, and clouds continue across the seam.

**Scale:** in **Place regions**, set **Km per pixel** (pixels of the original map image) and a scale bar appears in the lower left corner. Mundana uses 9.28 km per pixel (`kmPerPixel` in `default-map/map.json`): 28 858 km around the equator over 3 110 unique columns (the last 82 columns repeat the first 82). This holds at the equator; the map is treated as flat for now. Storm speeds are set in km/h and turned into pixels with this scale (maps without a scale count 2 km per pixel).

### Height map (wind and terrain)

In **Place regions**, click **Height map…** and upload a greyscale image: black (0) is the lowest ground and white (255) the highest. It is stretched over the map, so it should have the same proportions (you're warned if it doesn't). Tick **Show height** to check that it lines up.

**Blank height map:** **Tom höjdkarta…** makes a new height map the size of the map, on the standard Mundana scale: sea level at value 120, 100 m per step (and the map gets that scale if it has none). Everything starts at one height, **Allt land** (+100 m, value 121) or **Allt hav** (−500 m, value 115); then you shape it with the height painter (Ås, Kust, brushes …). It replaces any height map the map already has.

The height map affects wind, clouds and rain on the map:

- **Blocking:** for each spot, the app looks upwind (about 9% of the map's width) for ground higher than the spot itself. Ground that rises **Fully blocks at** above the spot blocks 100% of the wind (default 200). Lower rises block proportionally, e.g. 100 → 50%. The effect fades with distance. A valley behind a 200-high mountain is therefore calm, while the mountain top and a high plateau still get wind.
- **Exposed high ground:** peaks and ridges that stand above the land the wind came over get up to 35% *more* wind.
- **Steering:** wind running into a slope is turned to flow along it, so arrows bend around mountain ranges.
- **Rain shadow:** where wind pushes air up a slope (windward side), clouds thicken and rain increases. Behind higher ground (lee side), the air has already lost its moisture: fewer clouds and less rain, recovering further downwind (about 15% of the map's width). Low rises such as coasts barely count, and the effect is weak on calm days. Rain never goes above the scale's top (6) unless the generator already said so. Clicking the map says when a spot is in a rain shadow (and how strong) or on a windward slope.
- On the map, sheltered arrows are faded or shown as dots. Clicking the map shows the local wind, how sheltered the spot is (in %), and its elevation.

The generator's daily weather per region is not changed; the height map only changes how it is spread across the map. The rules live in `terrainWind()` and `orographic()` in `fieldmap.js`.

### Leylines (kraftlinjer)

A leyline is a magic line belonging to one aspect. Mundana is a globe, so a line is a **great circle**: it goes all the way round the world and comes back to where it started. Two points fix it.

- **Drawing:** in **Placera områden**, set *Redigera* to **Kraftlinjer** and pick an aspect. Click the map: the first point (circle) goes where you clicked, and a second point (square) is put 20° east of it, so the new line starts out heading east. Drag either point to turn the line, for example dragging the square north makes the line run north-east. Right-click a point to remove the line. To change the aspect of an existing line, click one of its points, then pick another aspect.
- **Saving:** *Spara placeringar* saves the region points and the leylines together.
- **Showing:** the **Kraftlinjer** switch in the layer bar turns them on and off, just like clouds. Next to it, the aspect list (*Alla aspekter ▾*) lets you tick which aspects to show. Aspects that have lines on the map come first, with the number of lines. *Visa alla* / *Dölj alla* tick or untick everything. The choice is remembered in your browser and, when logged in, with your account. A new line drawn for a hidden aspect makes that aspect visible again. The legend lists the aspects that have lines. Clicking the map lists any leyline within 60 km of the spot.
- **Geometry:** one wrap width (*Varv runt*) is 360° of longitude, a pixel is as many degrees tall as wide, and the equator runs across the middle of the image. A line that crosses the wrap seam carries on from the other edge, and one that goes over a pole comes back down on the far side of the world. Without a wrap width the whole image counts as one turn round the world.
- **Colours** match the aspect symbols: Termotropi red, Kryotropi teal, Fototropi white, Skototropi black with a pale glow, Pyrotropi orange, Geotropi brown, Pneumotropi cyan, Hydrotropi blue, Biotropi green, Nekrotropi grey, Ikonotropi purple, and Ataxatropi a cycling rainbow. The aspects without a symbol get Kronotropi gold, Nomotropi steel, Heliotropi yellow, Selenotropi pale lilac and Astrotropi deep violet. They are set in `LEY_COLOURS` in `fieldmap.js`.
- **In the default map:** add `"leylines": [ { "aspect": "Pyrotropi", "a": {"x": 0.3, "y": 0.5}, "b": {"x": 0.36, "y": 0.5} } ]` to `map.json`.
- **API:** `GET` / `PUT /weather/api/maps/{id}/leylines` (at most 500 lines, owner only).

### Day and night

The **Dag och natt** switch in the layer bar shades the side of the world where the sun is down: full light by day, darkening through twilight to full night when the sun is 6° below the horizon (where civil twilight ends on Earth). It's computed on the globe like on Earth:

- **Global and local time.** The hour slider is *global time*: the solar time at Calnia in Consaber (the world's mean time). Every place has its own *local time* by how far east or west it lies, in a straight line on the map (15° of longitude = 1 hour; the map's width, with the wrap, is 360°). Next to the slider the page shows the local time in the selected region (the middle of its points), and the hourly chart marks that hour. Each region's weather on the map is taken at its own local hour, so it's afternoon weather in the east while it's morning in the west. The 3D view shows the local time where you stand. Where global time is counted from is `settings.clockX` in `map.json` (0–1 across the map; 0.6287 is Calnia, which is also the default).
- **Seasons:** the year is 336 days, with northern midsummer in month 6, and the axis is tilted 23.4° as on Earth. So the north has midnight sun around month 6 and polar night around month 12, and the south the other way round.
- **Popup:** clicking the map shows the local time there, and sunrise and sunset in local time (or *Midnattssol* / *Polarnatt*).
- **Where it's set:** `_sunState()` in `fieldmap.js` (tilt, midsummer day, and how dark night gets).

### High-magic areas (högmagiska områden)

An area of one aspect, drawn as a polygon and filled with small copies of that aspect's symbol. If no symbol has been uploaded for the aspect, small four-pointed stars in its leyline colour are used instead.

- **Drawing:** in **Placera områden**, set *Redigera* to **Högmagiska områden** and pick an aspect. Each click adds a corner to the area you're working on. Once it has three corners it's filled in, and further clicks go into the nearest edge, so you can add detail anywhere along the outline.
- **Editing:** drag a corner to move it, and right-click a corner to remove it. An area whose last corner is removed disappears. Click a corner of another area to select that area and continue on it. Pick another aspect while an area is selected to recolour it.
- **New area:** the **Nytt område** button (or Esc) starts the next click on a new area.
- **Saving:** *Spara placeringar* saves region points, leylines and areas together.
- **Showing:** the **Högmagiska områden** switch in the layer bar turns them on and off. The aspect list next to it hides or shows aspects for both leylines and areas. Clicking the map inside an area names it in the popup.
- **In the default map:** add `"zones": [ { "aspect": "Pyrotropi", "points": [ {"x": 0.30, "y": 0.30}, {"x": 0.40, "y": 0.28}, {"x": 0.36, "y": 0.45} ] } ]` to `map.json`.
- **API:** `GET` / `PUT /weather/api/maps/{id}/zones` (at most 300 areas of 300 corners each, owner only).

### Height map painter

In **Placera områden**, set *Redigera* to **Höjdkarta** to draw the height map right on the map. The height map is greyscale: 0 is black, 255 white.

- **Scale:** *Havsnivå* is the grey value of the sea surface, and *Meter per steg* how many metres one step is. The default is sea level 120 and 100 m per step, so 121 is 100 m above sea level, 140 is 2 000 m, 255 is 13 500 m, and 100 is sea 2 000 m deep. With a scale, the popup shows heights in metres, and wind and rain treat the sea as a flat surface whatever its depth.
- **Tools:**
  - **Pensel** sets the chosen height.
  - **Höj** and **Sänk** build up or wear down gradually (*Styrka* is steps per dab).
  - **Jämna ut** smooths steps into slopes.
  - **Erodera** wears mountains down like rain would: water gathers as it runs downhill under the brush, cuts gullies and valleys, wears peaks and sharp edges, and drops the debris where the slope eases. Ridges keep their shape. *Styrka* sets how much each pass takes; drag over the same place several times for more. The sea is left alone and land stays land.
  - **Ås** (ridge) builds a mountain ridge: click along the crest (right-click removes the last point), then *Skapa ås* or Enter. *Höjd* is the crest's height, *Bredd* how far out the slopes reach. The crest varies a little along its length (±12 %) and tapers down at both ends; the sides fall away steeply, with uneven flanks (spurs and gullies). It only raises the ground.
  - **Kust** (coast) slopes land gently down to the sea: click in pairs, first inland and then where the coast should be (an arrow shows each pair), then *Skapa kust* or Enter. From each inland point the ground is lowered smoothly to sea level at its coast point. Pairs clicked one after another along a coast are joined into one continuous slope (the band between them); a pair on its own, and the ends of a stretch, get a band *Bredd* pixels to the side that fades out. Pairs far apart are separate stretches. It only lowers the ground; beyond the coast point and inland of the inland point nothing changes.
  - **Platå** (plateau) lifts an area into a raised upland, like the high ground south of the long lake at Monoliten: click round the outline (right-click removes the last point), then *Skapa platå* or Enter. Inside, the ground rises over a short, steep edge (*Kantbredd*, height-map pixels: narrow = a cliff, wide = a softer rise) up to *Höjd*. The edge wanders a little, so it doesn't follow the clicked line exactly, and the top gets a gentle swell of about ±1 step where it was flat. The relief already there is kept (the area is lifted by the difference to its broad shape, not flattened), ground already higher than the plateau (peaks) is left alone, and the sea and lakes inside the outline stay. It only raises. Draw rivers across it afterwards (*Beräknad* cuts their valleys) and finish with *Ojämnhet* and *Erodera*.
  - **Ojämnhet** (roughness) makes the ground under the brush rougher: knolls, hollows and bumps, as much up as down, so the ground keeps its height on the whole. *Korn* sets their size (height-map pixels), *Styrka* how fast they grow. The pattern belongs to the place, so passing over the same spot again makes the same bumps bigger. Only adds roughness; the sea is left alone and land stays land.
- **Markera avvikande** (checkbox, in the painter for both heights and forest) marks in blue every pixel that sticks up or down sharply from nearly all its neighbours. That means at least *Gräns* steps (default 5 = 500 m) above the second highest of its 8 neighbours, or below the second lowest. So lone peaks and pits of one or two pixels are found, while slopes and coastlines are not. Each is drawn as a ring, or a small square when there are thousands, so it shows at any zoom, and the count is shown next to the limit. The marks update a moment after each stroke and after *Ångra*.
- **Vattendelare** (checkbox, heights only) shows what the drawn rivers say about the ground, using the map's rivers as they are now:
  - **Divides:** every land pixel within 40 pixels of a river is given to its nearest river (jump flooding, within the rivers' box). Where two rivers' areas meet, at least 3 pixels from both, there is a divide, but only where the spot really lies *between* the two rivers: their nearest points are more than 120° apart as seen from it. Beyond the head of a river, or where two rivers run on top of each other, the border between their areas is no divide; before v1.94 such borders made fans out into the plains, and solid blocks. It should stand above the *lower* of the two rivers' beds there, by a step per 15 pixels of distance (100 m per ~80 km). Not above the higher one: a river high on a mountainside has its divide on the slope beside it. Yellow means high enough, orange-red means too low. Water counts at its surface.
  - **Uphill:** a red ring marks where a river's course in the height map starts to climb 2 or more steps above somewhere upstream.
  - **The count:** pixels too low out of all divide pixels, then the number of uphill places.
  - **Updates:** a moment after each stroke, after *Ångra*, and when you come back to the painter (rivers may have changed meanwhile).
- **Höj vattendelarna** raises each too-low divide to what it needs, by at most 5 steps (500 m), so it nudges rather than reshapes. The ground rises with it only between the divide's own two rivers. It follows a ridge profile (`t^1.6`, steepest near the divide, easing out towards the river, nothing at the river itself), fades out towards the 40-pixel edge (so no round halos), and varies ±15 % along the way. It only raises, only land, and is one step to undo. Parts needing more than 5 steps stay orange-red, for you to look at.
  - **Polygon**: click corners, then *Fyll polygonen* or Enter. Right-click removes the last corner and Esc clears.
  - **Hink** fills a connected area. *Tolerans* lets it spread over heights that differ that much, and *Stanna vid kusten* keeps it on the same side of sea level, so tolerance 255 fills a whole continent or a whole ocean.
  - **Flod** carves a river valley. Click from the source to the mouth (right-click removes the last point), then press Enter or *Gräv floden*. The river bed never runs uphill: where the line crosses a ridge, a gorge is cut at the level of the river above it. *Djup* puts the bed that many steps below the valley floor. Around the line, the ground is lowered into a U-shaped valley *Bredd* pixels to each side. Nothing is raised, sea and lakes are left alone, and *Ångra* undoes the whole river.
  - **Pipett** picks up the height under the cursor.
  - **Flytta** pans the map. You can also hold Space and drag with any tool.
- *Storlek* is the brush radius in height-map pixels, and *Mjuk kant* gives a soft brush.
- **View:** *Visning* switches between colours (sea in blues, land green → brown → white) and plain greyscale. *Täckning* sets how strongly it covers the map. The cursor's height is shown as you move.
- **Undo:** *Ångra* or Ctrl+Z, up to 30 steps.
- **Starting points:**
  - *Hämta standardkartans* copies the default map's height map, together with its scale.
  - *Ny tom…* starts flat, as lowland or sea.
  - *Höjdkarta…* uploads an image.
- **Saving:** *Spara höjdkarta* saves it, and *Klar* also saves unsaved changes. Wind and rain use your changes as soon as each stroke is finished.
- **Export:** *Exportera PNG* downloads it as an 8-bit greyscale PNG, one grey value per pixel, readable by any image or terrain program.

**Viewing the height map:** the *Höjdkarta* layer toggle shows a map's height map in colours: blues for sea depth, and green → brown → white for land. Anyone can use it, logged in or not. It only appears on maps that have a height map. The popup shows the height at the spot you click.

**Walking in 3D:** *Gå i 3D* is available on maps with a height map, for everyone. Click it, then click the map where you want to start. The 3D view opens in the map area, and the rest of the app stays as it is.
- **Following you:** the side panel switches to the region you're in as you travel. Changing the date or hour in the app changes the weather and light in 3D at once.
- **Moving:** you start a few kilometres up, flying. W/S or the up/down arrows move you, A/D steps sideways, the left/right arrows turn, and Shift goes faster. F switches between walking and flying, and Space/C climbs and descends.
- **Looking:** click the view to steer with the mouse. On a touchscreen, drag to look and use the on-screen buttons to move.
- **Settings:** the speed slider runs from 5 to 5,000 km/h. Flying, that is multiplied by how high you are (a 16th of your height in metres above the ground, at least 1), up to 200,000 km/h, so you cross a continent in a minute from high up. While the detailed ground ahead of you is still being built, the coarse far ground covers it. Height exaggeration (×1–×10) makes the relief easier to see.
- **Leaving:** Esc releases the mouse, and Esc again or ✕ goes back to the flat map.
- **Keys:** H (or the ? button) shows all the keys, and M turns the weather on and off.

How the ground is built:
- **Pieces:** a piece of land about 870 km across is built around you. While you move, the next piece is built in the background a few milliseconds per frame, a little ahead of where you're heading, and swapped in when ready, so moving doesn't freeze the view.
- **Surface:** it uses the height map, with the detailed terrain where there is any. The painted map and zoom images are the surface.
- **Coasts:** where the drawing clearly shows water or land, the coast follows it. Names on the sea are sea, and drawn rivers don't cut trenches.

**Weather in 3D:** the *☁ Väder* button turns weather on and off.
- **Clouds:** two layers, where the map draws them, grey where it rains. Over low ground the lower layer is at 2.4 km and the upper 0.9 km above it; over mountains the layers bend up so they stay at least 1.5 km above the highest ground nearby, so peaks don't poke through. The **Höjdöverdrift** slider raises the clouds with the ground, and the air between the ground and the clouds grows a little faster than the ground (exaggeration^1.25), so the clouds clearly lift as you turn it up. The numbers are `CLOUD_BASE`, `CLOUD_GAP`, `CLOUD_CLEAR` and `CLOUD_POW` at the top of `walk3d.js`.
- **Rain and snow:** they fall around you when you're below the clouds where it rains. It snows when it's below freezing at your height: the weather's temperatures are for low ground, and it gets 6.5° colder per km up.
- **Sky:** the sky greys and visibility drops in heavy weather.
- **Light:** with the *Dag och natt* layer on, the sun stands where it really is for the date and hour, with dusk and dark nights.
- **Temperature:** the top bar shows the temperature at your height.

Run it with `python3 tools/detail-height.py height.png static/weather/tiles/mundana-1 static/weather/tiles/mundana-1/height [--area x0,y0,x1,y1]`. It needs numpy, scipy, Pillow and numba, and takes about 1 minute per piece and two hours for the whole world on two cores. `--area` (in map pixels) redoes only the pieces there. Pieces already made are kept in `_pieces` inside the output folder. Delete them after changing the height map.

The 3D view uses three.js 0.160 (MIT licence), kept in `static/vendor`.

**The default map's height map** (`default-map/height.png`, 5476 × 2818) is an automatic draft made from the painted map by `tools/draft-height.py`:
- **Sea:** depth comes from the shade of blue and the distance from the coast.
- **Coastlines:** taken straight from the map.
- **Land:** lowland rising gently inland.
- **Mountains:** where the map's relief drawings are, up to about 8–9 km where they're densest.
- **Ice sheets:** raised to about 2 km.

Mountain heights are estimates, so it's meant to be corrected with the painter.

The current version is the third draft, improved from two rounds of hand edits. Ice sheets are only raised near the poles. In the detailed regional maps, brown shading with pale olive highlights counts as mountains, which gives ridges along ranges like Thalamur's. Map lettering is painted out before looking for mountains, so names no longer become hills. Names printed on the sea no longer become islands, and sea names no longer dent the sea floor. Small lakes in the detailed regional maps are kept, and mountains there are picked up at a finer scale. To redo the draft without losing hand edits, run `python3 tools/draft-height.py map.jpg new.png --keep edited.png old-draft.png`: every pixel that differs between your edited export and the draft it was painted on keeps your value.

Version 4 (app 1.36) also cleans up after names with `tools/clean-labels.py`. It joins the map's lettering into words and fills each word from the ground around it. On the sea, letter-shaped shallows and specks of land go away (Luberos, Sinadera). On land, names that stand as a low bump or dip on even ground are flattened, while mountains drawn under a name are left alone. To force a whole area flat around a name, add `--box x0,y0,x1,y1` in map pixels (used for Stora slätterna and the western Norra isvidderna). Higher ground inside the box, like a mountain next to the name, is kept. Hand edits elsewhere are untouched. Run it as `python3 tools/clean-labels.py map.jpg height.png out.png [--box …] [--flat …]`. A `--flat` box flattens everything in it, for names drawn as hills like Ressiöknen.

Version 5 (app 1.37) has these changes:
- **Sea depth:** depth now follows the distance from the coast, with the map's shade adding only local detail. The regional maps paint their sea paler, and the seams where they were pasted in had made steps and fake trenches. This affected Raunbukten, Ödeshavet and Stormarnas hav, among others. The generator does the same from now on.
- **Hand corrections:**
  - Danamassivet: all of Danbréann now tops out at about 800 m.
  - Krolimbergen: about 4,500 m.
  - Terne: the islets south of Takalorr are now land.
  - Colostro: the grey coastal mountains are now about 2,500 m.
  - Ressiöknen: the name no longer makes hills.
  - Tokonmassivet (app 1.39): the mountains north of Consaber, about 4,000 m at most. The draft had missed the mountains drawn in the Consaber regional map, so they are now raised. The same cap covers the ridge down along Alarann.
  - Tokon seam (app 1.40): the older, softer drawing around the Consaber map had weak or missing mountains where the two maps meet. It is now read with a lower contrast threshold, under the same 4,000 m cap.
  - Urmamassivet (app 1.44): the mountains in the middle of Urma Bréann, about 1,400 m at most.
  - Coasts from the zoom images (app 1.48): `tools/coast-from-tiles.py` reads land and water from the zoom images, which are twice the map's size. Pale shallow water, grey lagoons and lake shores that the map image blurs into the land are now water, about 98,000 pixels in all, for example Shalakol. A little sea by the shore became land. Hand edits are kept with `--keep edited.png old.png`.

**Layer groups:** the layer switches are grouped as *Väder* (Moln, Nederbörd, Temperatur, Vind, Magiska stormar, Dag och natt), *Geografi* (Kraftlinjer, Högmagiska områden, Floder, Höjdkarta) and *Civilisation* (Nationer).

### Nations (nationer)

Areas drawn as polygons, each with a name and a colour, made of one or more parts (a mainland, islands, exclaves). Shown with the **Nationer** switch (under *Civilisation*), the name in the middle of the largest part; the map's info box names the nation at the spot.

- **Who draws them:** the map's owner, and for the default map the admins. *Placera områden* → *Redigera → Nationer*.
- **Drawing:** *Ny nation* asks for the name; then click around the border. Click the first corner, double-click or press Enter (or *Stäng konturen*) to close it. *Ny del* draws another part of the chosen nation.
- **Changing:** click inside a nation to choose it. Drag any corner to move it (also of a nation not chosen yet, and while drawing); corners shared with a neighbouring nation or subdivision move with it, and a corner dropped on (or clicked next to) another corner sticks to it, so borders can be shared exactly. Click on an edge for a new corner, right-click a corner to remove it. Name and colour in the bar; *Ta bort delen*, *Ta bort nationen*. Esc: stop drawing, then back from a subdivision to its nation, then let go.
- **Subdivisions** (provinces, counties…): choose a nation, press *Ny underindelning* and draw it like a nation (its corners snap onto the nation's corners nearby). Once the nation is chosen, a click inside a subdivision chooses that. They are drawn with dashed borders and smaller names (when zoomed in, or when their nation is chosen), share the nation's colour, and the info box names the nation and the subdivision. The bar shows a nation's area and how much of it its subdivisions cover, and a subdivision's area with its share of the whole nation. **Suggest a division:** tick *Föreslå indelning* in the new-subdivision dialog and say how many (2–60): the whole nation is divided into that many parts of about the same size, each in one piece, named "<name> 1 … n" north to south (the name defaults to *Provins*). Centres are spread evenly over the nation (k-means on points inside it), and each part is what is nearer its centre than any other, cut out of the nation's outline (with the bundled polygon-clipping library, MIT); corners on shared borders are the same corner, so moving one moves the border for both. It replaces the nation's subdivisions (after asking), and can then be adjusted by hand. A separate island becomes a part of its own.
- **Saving:** like the rivers: they save themselves a moment after each change (and *Spara nationer* or *Klar* save at once), with the same check against overwriting a newer version saved elsewhere. Corners are stored to 7 decimals, so they stay exactly where they were put.
- **Export:** *Exportera nationer* downloads them as `<map>-nationer.json` (`[{ id, name, color, parts: [[{x, y}, …], …], subs: [{ id, name, parts }] }]`, x and y from 0 to 1). Built into a release as `default-map/nations.json` with `"nations": "nations.json"` in `map.json` (installed unless they have been edited in the app since, like the rivers).

### Mountain ranges (bergskedjor)

Edited in *Placera områden* → **Bergskedjor**, shown with the **Bergskedjor** layer under *Geografi*.
- **New range:** **Ny bergskedja**, then click along the crest like a river. Enter, a double-click or *Klar med kammen* finishes; right-click removes the last point.
- **Editing:** click a crest to choose its range. Drag a point to move it, click on the crest to add a point there, right-click a point to remove it.
- **Continuing a range:** with the range chosen, click its first or last point, or press **Fortsätt rita** (which continues from the last point). Clicks then add points at that end until Enter, a double-click or *Klar med kammen*. Right-click takes back only the points added this time.
- **Width lines:** a chosen range shows a small ring on each side of every crest point. Drag one out to set how far the range reaches on that side; that is a width line. Right-click a set ring to clear it.
- **Footprint:** shaded between the width lines. Widths run straight between the points that have them, and an end of the crest without its own width line tapers to nothing.
- **Branches (förgreningar):** a range can split off another. **Ny förgrening**, then a click on the crest where it splits off, then along the new crest. Starting an ordinary new range with a click on an existing crest does the same, and so does dragging a range's first point onto another crest (dragging it off, or removing that point, lets go). The split point shows as an orange dot while editing, and the bar says which range it branches off. It stays on the other range's crest when that one is changed (it moves to the nearest spot), and is let go if that range is deleted. A range can't branch off one of its own branches. In the calculated height map a branch without a crest height of its own takes the height of the range it splits off.
- **Fields:** *Namn* and *Kamhöjd (m)*, the crest's rough height, optional. The bar shows the crest length and average total width in km, and at how many points width lines are set.

Saving works like the rivers and nations: a moment after each change, with the same check against changes made elsewhere. There is also **Exportera bergskedjor**. Stored as `map_ranges` with endpoint `GET/PUT /weather/api/maps/{id}/ranges`. Each range is `{id, name, height?, points: [{x, y, l?, r?}], from?: {range, x, y}}` (`from` for a branch), with widths in map pixels to the left and right as seen walking from the first point to the last. They're part of the admin export (`ranges.json`), and a release can ship them as `default-map/ranges.json` (`"ranges"` in `map.json`, `rangesRelease` as for the rivers).

### Rivers (floder)

Rivers are drawn on the map as a network: each river runs from its source to its mouth, and ends either in the sea or a lake, or on another river (a tributary).

- **Size:** every river has a size of its own from 1 (a small stream) to 10 (the Amazon). The flow downstream is calculated: the river's own size plus every tributary that has joined above that point. A size 2 flowing into a size 4 makes 6 below the junction; another stream of 1 further down makes 7. The line on the map gets wider with the flow, and clicking the map on a river shows its name and the size there.
- **Who draws them:** the map's owner, and for the default map the admins (Gemstone, Gemstone86). Press *Placera områden* (on the default map only *Floder* can be chosen) and choose *Redigera → Floder*.
- **Drawing:** click at the source, then click your way downstream. **Enter** or a **double-click** ends the river there (in the sea or a lake). Clicking **on another river** ends it there and makes it a tributary; the spot lights up when you are close enough. *Storlek* (the slider or the number box) sets the size of the next river, or of the chosen one.
- **Changing:** click a river to choose it (it gets a yellow edge, its points and arrows showing which way it runs). Drag a point to move it; dragging the mouth onto another river joins it there, dragging it off ends it free. Click the chosen river's line to add a point, right-click a point to remove it. *Namn* names it, *Ta bort floden* (or Delete) removes it: rivers that flowed into it stay but end where they are. *Ny flod* (or Esc) lets go of the chosen river. A river can't flow back into one of its own tributaries.
- **Carrying on a finished river:** choose it, then click its mouth (or press *Fortsätt rita*) to draw on downstream, or its source to draw on upstream. Click new points and finish with Enter or a double-click; downstream you can also click another river to flow into it. A river that already flowed into another lets go of it while you carry on (Esc puts it back if you add nothing).
- **Precision:** river points (and region points, leylines and high-magic areas) are stored to 7 decimals of the map's width and height (about 3 m). Before 1.78 the server rounded them to 3 decimals, which snapped every saved river point to a grid of about 30 × 15 km and turned rivers into staircases; rivers saved then need redrawing.
- **Carrying on a river** (*Fortsätt rita*, or a click on the chosen river's source or mouth) changes nothing until the new stretch is finished: Esc, *Klar* or another edit mode leave the river as it was, junction included. A finished stretch from the mouth joins the river it ends on, or ends where it stops. Rivers whose mouth lies exactly on another river but that lost the junction (versions before 1.77 cut it when carrying on was started and then left) join it again when loaded.
- **Length:** a chosen river shows its own length and the longest river course: the longest way water can flow to its mouth from any source upstream, through its tributaries (a tributary counts with the stretch of the river below where it joins; one joining at the top adds its whole length). In km with the map's scale, otherwise in map pixels.
- **Sizes on the map:** while editing rivers, each river's size where it ends (its own size plus everything that has joined it) is shown just past its mouth, at the sea or where it joins another river.
- **Rock on steep slopes (3D):** the map picture is laid on the ground from straight above, so on steep slopes it used to stretch into long streaks ("melting" mountains). Where the ground as shown (with the height exaggeration) is steeper than about 33°, the picture now gives way to rock, fully from about 57°: grey-brown with a little of the picture's colour, with horizontal strata and speckles that follow the real height.
- **In 3D:** the drawn rivers are painted on the ground (about 1 km wide for a stream, up to 4 km for the biggest), and each gets a bed that only goes down from source to mouth, and a tributary ends at or above the river it joins. The bed is half the lowest ground along the river so far and half the nearest heights that only go down (an isotonic fit). A ridge in the way is cut part way and a dip before it is filled part way, so one low spot doesn't drag the rest of the river into a deep trench. Water counts at its surface: a river crossing a lake or an arm of the sea used to be cut to the sea floor from there on, kilometres deep. The ground shown is shaped to that bed in a channel. The valley sides widen with how deep the cut (or fill) is, at most about 0.15 in true slope on average, so a cut through rising ground becomes a V-shaped valley instead of a narrow trench with smeared walls; the height map itself (and the weather) is not changed. The **≈ Floder** button in the 3D bar turns this off and on (remembered).
- **Saving:** river edits save themselves about 1.5 seconds after each change (and *Spara floder* or *Klar* save at once); the page warns before you leave with anything unsaved. If the rivers were saved from somewhere else since your page loaded them (another tab, another admin), the server refuses to overwrite them and you choose: *Behåll mina* (yours overwrite theirs) or *Ladda deras* (theirs are loaded, your latest changes dropped). The **Floder** switch in the layer bar shows or hides them.
- **Export:** *Exportera floder* downloads all rivers as `<map>-floder.json`: a list of `{ id, name, size, points: [{x, y}], joins: null, { river, x, y } or { lake, x, y }, from: { lake } (optional) }` and lakes `{ id, lake: true, name, x, y }` with x and y from 0 to 1 across the map. Send that file to get the rivers built into a release: as `default-map/rivers.json` with `"rivers": "rivers.json"` in `map.json`. A release's rivers are installed unless rivers have been edited in the app since (then the app's stay).
- **Lakes (sjöar):** a lake is a point in the network that rivers run into and out of, without being part of any river. *Ny sjö*, then a click on the map, puts one there (it shows as a blue disc with what flows into it, and → if it has an outflow or ⊘ if not). While drawing, a click on a lake ends the river in it (carrying on upstream, a click on a lake makes the river start from it). Click a lake to choose it (*Namn* names it, *Ta bort sjön* or Delete removes it: the rivers stay and end/start where they are); click the chosen lake again, or press *Rita utlopp*, to draw a river out of it. Dragging a lake moves the river ends attached to it; dragging a river's mouth or source onto a lake attaches it. **Flow:** everything that runs into a lake carries on through its outflow, on top of the outflow's own size (a lake fed by a 2 and a 3, with an outflow of size 1, gives 6 out). With several outflows the water is shared evenly (shown to one decimal); a lake without an outflow keeps it (an endorheic lake). Water can't run in a circle through lakes either. Stored in the same list as the rivers: `{ id, lake: true, name, x, y }`; a river ending in one has `joins: { lake, x, y }`, one starting from one `from: { lake }`. In 3D and the calculated height map a river into a lake just ends there.
- **Föreslå floder (suggested rivers):** a switch in the river bar. It shows, as dashed orange lines, where rivers most likely run according to the base height map: rain falls on all sloping land and runs the steepest way down to the sea or a lake; where enough has gathered (*Bara stora* ≈ 3 000 height pixels draining through, *Mellan* 800, *Många* 250, *Alla bäckar* 80) a river is suggested, wider the more water. Hollows fill up and spill over at their lowest edge, and across plains the water follows the lie of the land around it (the height map blurred over ~60 km); rain on dead-flat ground doesn't start a stream (it spreads as a sheet), but a river from the hills carries on across. Where a river is already drawn, nothing is suggested, so what is left is either rivers you haven't drawn yet, or places where the height map and your rivers disagree (a suggestion running beside a drawn river, or a terrace edge making streams where there should be none). It never changes the height map or the rivers. Worked out once per height map (about a second for Mundana), then updated as you draw (terrain.js `drainage`, `suggestRivers`).
- **Storage:** table `map_rivers` (one JSON list per map).
- **In the release:** `default-map/rivers.json` holds the rivers taken from the app's database on 14 October (25 rivers), so the default map ships with them.

### River currents (ström)

Every river has a current in km/h, used by the river boats in Restid.

- **Its own speed:** set by hand in the river bar (*Ström*, km/h), or, left empty, worked out from how steeply the river falls in the height map, over about 40 km either side of each stretch: km/h = 1 + 4 × √(fall in %), so flat ground gives 1 km/h, 0.5 % about 3.8, 2 % about 6.7, 5 % about 9.9, 10 % about 13.6, at most 20. On Mundana half the stretches come out below about 4 km/h and a tenth above about 9. The empty box shows the worked-out value greyed; the river's info shows the current at its source and at its mouth, and whether it is worked out or set.
- **Mixed with the tributaries:** where a tributary runs in, its water keeps the speed it had at its mouth, and below the junction the river flows at the average of all its water, weighted by how much there is of each: a size 1 river at 5 km/h into a size 20 river at 2 gives (1 × 5 + 20 × 2) / 21 ≈ 2.1 km/h (not rounded). A river out of a lake starts calm: all its water flows at its own speed.
- For reference: lowland rivers and deltas 1–3 km/h, ordinary rivers 3–5, upland rivers 5–8, mountain rivers 8–15, rapids 15–25.
- Saved with the rivers as `speed` (left out when worked out). A journey keeps the currents it was planned with (in its route), so changing a river later doesn't move journeys already on their way.

### Regional maps (sharper pieces)

A sharper map of one part of the world (e.g. the Jargien map) is put into the default map with `tools/insert-map.py`:

    python3 tools/insert-map.py src/main/resources/static/weather/tiles/mundana-1/ src/main/resources/default-map/map.jpg jargien.png 2752 742.5 7.92 8.23 --mask mask.png

The numbers are where the piece's top-left corner lies on `map.jpg` (map pixels) and how many of its own pixels make one map pixel across and down (the Jargien map: 7.92 × 8.23). The mask (white = use the piece) leaves out cut-outs and frames. It updates the zoom images at all three levels (making new ones where there were none), the manifest, and `map.jpg`; the edge blends over 1.5 map pixels. The placement was found by matching the coastlines of the piece against the map.

Already in: the Jargien map (at 2752, 742.5) and its six cut-outs at the same scale: Henok (2804, 626), Lothian (2654, 652), Lopnor (2669, 934), Lomar (2546, 1160), Colostro (2666, 1208) and Karakul (2495, 1333).
Also the Cermira map (Jarladömet Cermira, south of Mitheraskogen) at (3081.5, 754), 14.5 of its pixels per map pixel, with its title painted out.
Also the newer Drunok map (Kraalenbergen, Drunok, Cermira, Jarla down to Marek Pomian) at (2948.5, 727), 8.25 × 8.45 of its pixels per map pixel, with its own colours, but only inside the Drunok and Cermira realm borders (hand-traced mask); the more detailed Jargien map and the older Cermira map are kept around them.

**Map layers ("Kartbild").** Next to the map list, *Kartbild* opens a list of the detailed regional maps, each with a tick box: *Första Mundanakartan (där det var suddigt)* (the first map of Mundana, used where today's map was blurry; on by default), *Stora arkipelagen*, *Forion*, *Ebhron*, *Gordrion, Vambolien & Caserion*, *Asharien & Damarien*, *Egor–Nermada (Ivani, Ara)*, *Consaber (Urma Bréann, Danbréann)* (these seven are already part of the base map's zoom images, so ticking one shows that map as drawn, with its own colours and names, on top), then *Jargien* (with its cut-outs), *Cermira (äldre)*, *Drunok & Cermira (ny, rikena)* and *Drunok (ny, hela kartan)*. The ticked ones are drawn over the base map (*Grundkarta*, always at the bottom); maps lower in the list lie on top of those above them. *Standard* ticks the first three (exactly what the zoom images hold, so nothing extra is loaded); *Bara grundkartan* unticks all. The choice is remembered, and the 3D view uses it too. The base map's own zoom images (where they differ) are in `tiles/mundana-1/base/`, and each layer's see-through zoom images (WebP) and part of the map picture in `tiles/mundana-1/layers/<id>/`; `manifest.json` lists them under `"base"` and `"layers"`. They're made with

    python3 tools/make-layers.py src/main/resources/static/weather/tiles/mundana-1/ src/main/resources/default-map/map.jpg <base tiles> <base map image> layers.json

where the base tiles and map image are the ones from before any regional map was put in, and `layers.json` lists the layers in drawing order, each with its pieces (file, x, y, sx, sy, mask, feather, as for `insert-map.py`) and whether it's on by default. Run it again after a new regional map is added. Placements (top-left on `map.jpg`, its pixels per map pixel across × down): the first Mundana map (2312.5, 582) 2.48, used only where it is clearly sharper than what was there (local sharpness compared at twice the map's size; the mask covers about 30 % of it: Eumo, Ressiöknen, Momolan, Tarkas, Karagien, around Kamor, Kharabol and Monoliten, Melorion, Takalorr and smaller bits), with a 3-pixel soft edge. Since v1.90 it is also used over the whole Monoliten area (map x 2950–3250, y 585–725), so it's sharp like its surroundings; there the first map has no Monoliten name, nor Kharabol's. The strip north of y 582 is beyond the first map and stays as before; Stora arkipelagen (2834, 1288) 1.85, with its insets Sinadera (3312, 1675) 1.85 and Luberos (3408, 1278) 2.46; Forion (2241.5, 1061) 2.45 × 2.47; Ebhron (3564, 781.5) 2.47 × 2.45; Gordrion (2484.5, 583) 9.2, Vambolien (2900, 919.5) 9.4, Caserion (3142.5, 726) 9.9 (the Yol, Perdos and Colm insets left out); Asharien & Damarien (2997, 756) 7.6 × 7.65 (coats of arms left out); Egor–Nermada (3206, 703) 8.3; Consaber (3359.5, 683.5) 8.8. `/weather/api/tiles/check` checks the base and layer images too.

**Are all zoom pieces there?** Open `/weather/api/tiles/check` on the server (e.g. `https://<app>.azurewebsites.net/api/tiles/check`, or `http://localhost:8080/api/tiles/check` locally). It lists, for each zoom level, how many pieces the manifest names and which ones the server can't find (`"ok": true` means none are missing). Admins also get a red note in the page's corner when pieces are missing. The zoom pieces aren't in the normal zips (they're too big): they come in separate zoom-image zips, unpacked into the project folder before building.

### Base or calculated height map

Next to the **Höjdkarta** layer, **Grundhöjd / Beräknad höjd** chooses which height map the app uses: the height layer, wind and rain, and the 3D view. The choice is remembered.
- **Grundhöjd:** the stored height map, as painted.
- **Beräknad höjd:** made in the browser from the base (`terrain.js`, `EonTerrain.derive`), never saved, and made again 1.5 s after rivers or ranges change. On the standard map it takes about 1.5 s. It is built in three steps:
  1. **Mountain ranges raised:** from each crest out to its width lines (12 map pixels each side without them), the ground rises towards the crest height. That is the range's *Kamhöjd*, or else the highest ground on its crest, at least 1 500 m. The profile is `(1−u)^1.7`, steep near the crest, with ±12 % unevenness. It only raises; the sea stays the sea.
  2. **Divides lifted:** as *Höj vattendelarna* in the painter (at most 5 steps).
  3. **River valleys cut:** each river gets a bed that only goes down. Half of it is the lowest ground so far, half the nearest only-falling heights (as in 3D), and a tributary ends at or above the river it joins. V-shaped sides rise a step per 1.5 pixels, out to 8 pixels. It only lowers, never below sea level.
- **While painting the height map:** the base is shown, since that is what is painted and saved. **Använd beräknad** in the painter puts the calculated map into what you paint, as one step to undo; save it to make it the new base.

### Snow, glaciers and frozen rivers (3D)

In 3D, the ground shows snow and glacier ice from the regions' monthly mean temperatures (the `temperature` row in each region's YAML). These are taken to be at **sea level**, and it gets 6.5° colder per km up. They are blended between regions with the same weights as the weather, and between months for the date shown (each month's mean is for its middle day).

- **Snow** lies where the date's mean at that height is below freezing. It fades in from +1.5° and is full from −2.5°.
- **Glacier ice** (bluish white) lies where even the warmest month's mean is below freezing. That ice stays all year.
- Both have ragged edges and don't stay on the steepest rock.
- **Drawn rivers** turn to white-blue ice where the date's mean at their bed is below freezing, and are blue otherwise.

A new date updates the snow at once. Rivers freeze or thaw when the ground there is next built, for instance when you move on. The sea and lakes are not frozen.

**`base_heat_height`** in a region's YAML (also *Temperaturhöjd (m)* in the region editor) is the height in metres that its temperatures are for. The 3D view brings them down to sea level first (+6.5° per km), then applies the 6.5° per km again for the ground's own height. So at that height you get exactly the region's temperatures, colder above and warmer below. This applies to snow, ice and frozen rivers, to falling snow, and to the temperature shown in the 3D bar. The 2D map and the generated weather are unchanged. Empty or 0 means sea level.

Every region file has a value, taken from where the region is placed on the standard map: the median height in a square about 40 km across around each point, rounded to 50 m. Sea regions are 0. Regions whose points sit on peaks were set by hand:

- Drakbergen 950: Amdai-Shek (Södra) is about 500 m, and Drakbergen is meant to be 3° colder.
- Pantherabergen 1 400: another 3° colder.
- Mio-Enara 400, Godrion 800, Thalamur (Norra) 1 200, Thalamur (Södra) 800, Consaber (Urma Breann) 1 000 and Isöknen 800: the valley floors around their points.
- Miam, Kryddöarna, Dimmornas hav and Mistviken 0: sea-level climates.

### Forest (skog)

Each map can have a forest map: greyscale where 0 is no trees and 100 is trees everywhere, so dense that light barely reaches the ground (values above 100 count as 100). The **Skog** layer under *Geografi* shows it in green, darker the denser. Without a forest map the layer shows nothing.

Paint it in *Placera områden* → **Skog**. It uses the height painter with the same tools: pensel, öka, minska, jämna ut, polygon, hink, pipett. The height-only tools and settings are hidden. **Täthet** is 0–100, **Ladda upp…** takes a greyscale image, **Töm…** sets everything to 0, and **Spara skog** saves.

While painting forest, ground without trees is see-through (the map shows) and trees are green, darker the denser. The readout under the mouse gives the density (*Här: 45 % skog*), and the height map's own buttons are hidden. A suggestion is for one layer: painting a height suggestion can't be switched to forest (forest has its own suggestions). Heights and forest keep separate edits, undo and brush values while you switch between them. *Klar* saves both. The owner edits it (for the standard map, the admins), and everyone who can see the map sees it. Endpoints: `GET/PUT/DELETE /weather/api/maps/{id}/forest`.

It is part of the admin export (`forest.png`), and a release can ship one as `default-map/forest.png` (`"forest"` in `map.json`). As with the rivers, a forest map edited in the app is kept.

### Ice (is)

Glaciers and ice sheets are painted like the forest: *Placera områden* → **Is**, greyscale 0 (no ice) to 100 (all ice), with the same tools, **Ladda upp…**, **Töm…** and **Spara is**. The **Is** layer under *Geografi* shows it in white with a blue tint. In 3D, painted ice is shown as glacier ice (and snow) whatever the temperature, on top of the snow and ice the climate gives. On journeys it counts as deep snow. Stored in `map_ice`; endpoints `GET/PUT/DELETE /weather/api/maps/{id}/ice`; part of the admin export (`ice.png`) and shipped as `default-map/ice.png` (`"ice"` and `iceRelease` in `map.json`), with the same rules as the forest.

### Roads and paths (vägar)

Edited in *Placera områden* → **Vägar**, shown with the **Vägar** layer. Each road has a kind: **Stig** (path, a thin dashed brown line), **Väg** (road, light) or **Huvudväg** (highway, wide and yellow), and a name.
- **Drawing:** click on the map to start a road and click your way along. A click on another road joins it there and finishes (the spot lights up when you're close enough); Enter or a double-click finishes anywhere. *Ny väg* starts a new one; *Slag* sets the kind of the next road, or of the chosen one.
- **Changing:** click a road to choose it. Drag its points (an end dropped on another road joins it there), click its line for a new point, right-click a point to remove it, click its first or last point (or *Fortsätt rita*) to carry on drawing from there. *Ta bort vägen* (or Delete) removes it, Esc lets go.
- **Steepness:** while editing, stretches steeper than the road's kind takes are drawn **red**, and twice that **dark red**, so the road can be moved to where the ground suits it. The slope is the average over about three map pixels (15 km) along the line, from the height map shown (the painter's copy while painting). The limits are *Stig* 5 %, *Väg* 3 %, *Huvudväg* 2 % (settings in *Restid*); at the map's scale (5 km pixels) the steepest mountainsides average 5–15 %. The bar shows the chosen road's length, steepest stretch and how many stretches are too steep.
- **Saving:** like the rivers: a moment after each change, with the same check against changes saved elsewhere. **Exportera vägar** downloads them. Stored in `map_roads`; endpoint `GET/PUT /weather/api/maps/{id}/roads`; each road is `{ id, name, kind: "path" | "road" | "highway", points: [{x, y}] }`. Part of the admin export (`roads.json`), shipped as `default-map/roads.json` (`"roads"` and `roadsRelease` in `map.json`).

### Travel (restid)

**Restid** (next to *Gå i 3D*) opens the travel panel. It finds the way between two places, and follows travelling parties over the map as the app's clock runs.
- **A new journey:** *Ny resa*, click the start, then the destination (right-click: choose the start again). Four routes are suggested and drawn: **Snabbast** (pink: least time), **Lättast** (green: the easiest going: it keeps to roads and low ground even when that takes longer; roads count at their length, paths 1.25 times, open ground 1.6 times, and every 250 m uphill as an hour more) **Kortast** (yellow: least distance) and **Säkrast** (blue: the safest, keeping to roads, paths and nations and avoiding the wilderness: off the roads it counts 2 times the time plus 0.01 per km from the nearest road or nation, at most 6 times, more in forest, and inside a nation's borders 1.4 times; it never takes more than 3 times as long as Snabbast, otherwise the caution is eased off until it fits; the numbers are `safe` in the travel settings); routes that come out the same are shown once, with both names (*Snabbast och Lättast*). Each has its length, how much of it is on roads, how far it climbs, and how long it takes at a normal pace with the weather along the way. Click one (in the panel or on the map), give the party a name, a pace (*Långsam*, *Normal*, *Snabb* or your own km/h), the hour the day's travel starts, **how many hours a day it travels** (*Timmar per dag*: 16 for an exhausting forced march, 4 for a relaxed journey with many stops; the suggestions' arrival times follow it), and whether everyone may see it, then **Starta resan**. It departs at the time the calendar shows.
- **Speed** (km/h, worked out every quarter of an hour where the party is): the pace (3 / 4 / 5), plus the road (*Stig* +0.5, *Väg* +1, *Huvudväg* +1.5; nothing off the roads, and a further deduction there if `offRoad` is set, 0 by default); minus forest off the road and on paths (0.5 per 25 % trees, smoothly: −2 in dense forest); minus bad weather off the road and on paths (−1: precipitation from 2 or wind from 14 m/s); minus really bad weather everywhere (−1 more: precipitation from 6 or wind from 20 m/s); minus deep snow everywhere (up to −2: where the date's mean temperature at that height is below −2°, fully below −8°, or on painted ice); minus slopes everywhere (1 per 1 % average climb, 0.5 per 1 % down; off the roads and paths the ground's own steepness counts too, at least 70 % of it, even when the way runs across the slope rather than up it, so rough mountain ground is slow whichever way it is crossed). Below the lowest speed (1 km/h) further deductions still count, ever more gently (m² / (2m − v)), so a cliff stays much slower than merely hard going and routes go round mountains rather than over them; it never reaches 0. (Before 2.02: no off-road deduction, and half the slope deductions; settings saved then get the new slope values.) Roads ignore the forest and ordinary bad weather; slopes, snow and really bad weather slow them too.
- **Meander:** nobody walks or sails in a straight line, so stretches off the roads and rivers (and at sea) wander a little: a few gentle bends, up to about 2.5 map pixels (some 13 km on Mundana) to either side, and on a long stretch one slow bend of about 3 % of its length (at most 15 map pixels, some 80 km), fading out where the route meets a road. A bend never steps into the water (or, at sea, onto land): it gets smaller there; and the bends are made smaller where they would mean fording more. The same route always bends the same way. `wiggle` (1) sets how much: 0 gives straight lines, 2 twice as much. It applies to new journeys; journeys already on their way keep their route.
- **By boat (*Använd färjor*, *Havsresa*):** two boxes in the panel, ticked before *Ny resa* (ticking them while choosing between routes finds the routes again). The journey keeps what was ticked.
  - **Använd färjor:** on rivers big enough for boats (flow at least `boatMinFlow`, 4: the flow the river map shows, tributaries included) a party crosses by **ferry** in the boarding time (1 h) instead of fording, and may take a **river boat** along the river. The boat does `boat.still` (7.75 km/h) in still water and across lakes; downstream (the way the river is drawn, from source to mouth) it gets `boat.downShare` (half) of the river's current on top, upstream the whole current is taken off, and where less than `boat.minUp` (1 km/h) would be left there is no way up. So a current of 2 km/h gives 5.75 up and 8.75 down, 4.75 gives 3 up and 10.1 down, and from 6.75 the boat can't go up at all. Where a river runs into another the boats carry on. A river boat travels during the journey's hours a day.
  - **Havsresa:** a ship may sail at sea (everything below sea level in the height map): 9.9 km/h normally, 14.8 km/h in a good wind (from behind or on the quarter, at least 5 m/s), 4.9 km/h in a bad wind (against the way it sails, below 2 m/s, or a storm: the really-bad wind and more). The wind is the weather of the regions where the ship is, hour by hour (their wind strength, and the day's direction). A ship sails day and night (`seaAllDay`: 0 makes it keep the journey's hours), so the route finder counts a sea voyage's hours as fewer travel hours (× hours a day / 24).
  - **Getting on board** a river boat or a ship, or from one to the other, takes `boardHours` (1 h); getting off takes nothing. Ships can put in anywhere on the coast (there are no ports on the map yet).
  - The suggested routes show how far they go by river boat (down and up) and at sea, and how many times the party boards. On the map the boat stretches have a white dotted line along them.
  - *Kortast* uses boats too, counting each boarding as 5 km further.
- **Events (*Händelser*):** tick *Händelser* when starting a journey (or later, in the journey's row in the list). The journey then rolls for events once every 6 hours, at a random hour inside each 6-hour slot. The day is split into two 12-hour cycles, day (from 06, local time where the journey started) and night, and at most one event happens per cycle: after a hit the rest of that cycle is quiet. Each roll is *a in b* (an event if a b-sided die shows a or less), from `world/events.yaml`: a base chance (1 in 8, day and night apart) and the circumstance (*omständighet*) where the party is at that hour, read from the map: *Hav* and *Kust* at sea (within 10 km of land), *Landsväg* on a highway, *Småväg* on a road (a path counts as the land around it), *Skog* (at least 50 % trees), *Berg* (ground at least 8 % steep), *Kust* on land within 10 km of the sea, *Fält* on other land inside a nation and *Vildmark* outside every nation; a river boat is *Neutral*. The first that matches counts (`combine: first`; `all` adds them together). The table's other circumstances (*Byamark*, *Stadsmark*, *Dungeon*, *Grotta*, *Ruin*, *Underdark*, *moor*, *Träsk*, *Vilse*, *Warm Desert*) are listed at the end of the file: the map doesn't know them yet.
  - **When it happens:** the app's clock stops, the map centres on the party and only the journey's owner gets a box: *Visa*, *Försening…* (a delay from that moment) or *Fortsätt* (the clock runs on). If the calendar jumps past several events, one box lists them all. An event is shown once; after that it is ticked in the journey.
  - **The dice are fixed** per journey and slot (from a seed made when events are switched on), so the events are the same for everyone, and winding the clock back and forth changes nothing.
  - **Events belong to places on the route.** They are rolled on the journey as planned, without its delays (kept with the journey as its plan), so each event has its spot. A delay moves the coming events on in time by as much as the party is behind the plan at that spot: they still happen where they were going to, and nothing happens while the party waits. Events that have happened stay where they were. (Journeys from before 2.16 that have delays get their plan worked out when the map is opened.)
  - **Looking ahead:** the owner's *Händelser framåt* lists the journey's events with time, day or night, circumstance and chance, a *Visa* button and, for coming ones, *Slå om* (new dice for that one slot). Each has a checkbox: ticked, it pops up when the clock gets there. Coming events start ticked; once one has popped up its tick is cleared, so it won't pop up again; tick it again to see it once more (for example after winding the clock back), or untick a coming one to skip its box. The chosen journey's coming events are also marked on its route (small red diamonds, for its owner).
  - **The rules:** ⚙ → *Händelseregler…* shows them (YAML). An admin can save a version for everyone there (it replaces the file until *Återställ till filen*); YAML that can't be read is refused. The file explains every setting: `cycleStart`, `slotHours`, `base`, `combine`, `limits` (the die never gets fewer than 2 or more than 20 sides) and the `modifiers` with what each `when` can ask about (`travel`, `road`, `forest`, `ice`, `height`, `steep`, `coast`, `zone`, `nation`) and what it changes (`b: -3`, `a: 1`, `setA`, `setB`; `day`, `night` or `both`).
- **Rivers:** fording a drawn river with no road or path over it takes 0.25 h per size of the river there (its flow, tributaries included: size 32 = 8 hours), spent when the party gets there. Where the route crosses on a road or path the bridge is there: no time. *Snabbast* weighs this too, so it goes round to a bridge when that's quicker. The suggestions show how many fords a route has and how long they take.
- **Days:** the journey's hours a day (10 unless chosen otherwise) from the chosen hour (local time where the journey starts); the rest of the day the party stands still. If the hours run out mid-route it camps where it is.
- **Försening** (delay): the party stands still for that many hours of the clock, day and night alike (24 is a whole day), from the moment it is added (or from the departure); then it travels on as usual. Each delay is listed on the journey and can be removed (×). (Delays made before 2.16 counted travel hours, and keep doing so.)
- **On the map** (the **Resor** layer): the route travelled so far is solid, what's left dashed, and the token (the party's initial, with its name) is where the party is at the time shown. Before departure the route is faint; after arrival the token stays at the destination and the route fades out over 3 days, then they are no longer drawn (the journey stays in the list). *Visa* centres the map on the token.
- **Routes** are found on a grid over the map (a cell every 4 map pixels, about 20 km) joined with the roads (a point every map pixel, joined where roads meet): A* by time for *Snabbast* (the weather left out) and by distance for *Kortast*. A cell's steepness comes from every pixel of the height map in it (half its steepest spot, half its average), and a diagonal step also counts the two cells beside it, so a narrow ridge can't be slipped through between cell centres. *Kortast* is the shortest way that is still passable: ground slower than 0.5 km/h off the roads (mountains, cliffs) counts twenty times its length, so it is only crossed where there's no way round. Water (sea and lakes at or below the sea level) can't be crossed; rivers can. Off-road stretches are rounded off.
- **Visa hur svår marken är** (in the panel) colours the map by how fast a party gets on off the roads at a normal pace, without weather, on the date shown: see-through where it's easy, yellow 2–3 km/h, orange 1–2, red 0.5–1, dark purple under 0.5 (what the routes go round). In winter the snow shows up too.
- **Each journey is worked out once** when it starts (and again when a delay changes): how far it has come at every hour, with each hour's weather where the party is. So anyone looking at it later sees the token at the same place for the same time, without working anything out.
- **Settings:** every number above (paces, road bonuses, off-road, forest, weather thresholds and deductions, snow, slopes, lowest speed, hours a day, the day's start, how long arrived parties stay shown, and the roads' steepness limits) can be changed, in three layers, later ones winning:
  1. **`world/travel.yaml`**: the values everyone starts from, with a comment on each. Edit it like the region files; the app reads it again when it changes (on the server that means a new deploy, since the world folder is in the jar). A value left out keeps the app's built-in one.
  2. **The admins, in the app:** *Restid → ⚙ → Spara för alla* saves the values for everyone (stored in the database, table `app_settings`; endpoint `GET/PUT/DELETE /weather/api/travel`). They replace the file's until *Återställ allas* removes them.
  3. **Each user:** *⚙ → Spara för mig* keeps their own values with their account; *Återställ mina* drops them. The dialog says where the values come from.

  A journey keeps the times it was worked out with until it is worked out again (a delay added or removed). The roads' red stretches follow the same steepness limits.
- **Who sees what:** everyone with an account keeps their own journeys on a map; a journey marked *Visa för alla* (or *Delad* in the list) is seen by everyone who can see the map, logged in or not. Stored in `map_trips`; endpoints `GET/POST /weather/api/maps/{id}/trips`, `PUT/DELETE /weather/api/maps/{id}/trips/{tripId}` (only your own).

### Height map suggestions (förslag)

Everyone with an account can suggest changes to a map's height map, and everyone can see the suggestions. The map's owner decides; for the built-in default map, the server's admins decide (see *Who may change regions*).

- **Seeing them:** the **Förslag** button next to *Gå i 3D* (it shows how many are open) opens a panel over the map. Each suggestion's area is outlined on the map: yellow dashed for open, green for accepted, red for rejected. Click one in the list (or its outline on the map) to zoom there and see it. **Före / Efter / Skillnad** switches between today's heights, the suggested ones, and the difference (red higher, blue lower). For an accepted suggestion, *Före* is what it replaced.
- **Suggesting:** *Föreslå en ändring* opens the height painter with all its tools. Paint, then press **Skicka förslag…** and say what you changed and why. Only the rectangle around what you painted is sent (the new heights and which pixels changed), so suggestions in different places never get in each other's way. Nothing changes for anyone else until the suggestion is accepted.
- **Voting:** 👍 on a suggestion says you agree; the count shows in the list.
- **Deciding:** *Godkänn* writes the suggestion into the height map, *Avvisa* closes it; both take an optional reply to the author. *Ändra först* opens the suggestion in the painter so you can adjust it; *Skicka och godkänn* then accepts your version, and the original is marked as replaced. An accepted suggestion can be undone (*Ångra*): its pixels go back to what they were, except where something accepted later changed them again. Admins can also use *Föreslå en ändring* → *Skicka och godkänn* to change the default map's height map directly.
- **What the list tells you:** how much ground a suggestion changes, how much it raises and lowers (and by at most how much), and whether it turns sea into land or land into sea (*Ändrar kusten*). *Krock* means it was drawn on an older height map and something accepted since then covers the same ground; compare *Före* and *Efter* before accepting, since it would overwrite that.
- **Limits:** at most 30 open suggestions per person and map, and at most 4 million pixels per suggestion (split larger work).
- **Revision:** the height map has a revision number that goes up with every change (accept, undo, upload, or a new release). It shows on *Exportera höjdkartan (rev N)* in the panel (for those who decide), which downloads the current height map.
- **Releases don't undo the work:** a new release with a new `default-map/height.png` would replace the height map changed in the app. So when the default map is installed, every change accepted (or undone) in the app after the release's own height map is put back on top of it, in order. A release built from an exported height map says which revision it contains with `"heightRev": N` in the `settings` of `default-map/map.json`; only later changes are put back. Without it, all of them are (which is right when the release's height map came from somewhere else).
- **3D view:** the detailed 3D terrain is made from the release's height map. Where suggestions have been accepted since, the 3D view leaves the detail out (fading back in around the area) until the detail is rebuilt with `tools/detail-height.py` from an exported height map.
- **Own maps in 3D:** a map of your own that borrows the Mundana zoom images also gets the detailed terrain, which was made for the default height map. Where your height map differs from the default (painted, or a height map of your own), the 3D view leaves that detail out, fading it back in over a few map pixels around the changes, so your own heights show as you made them. Unsaved painting counts too.
- **Storage:** tables `height_suggestions` (the patch as a grey + alpha PNG, the replaced heights once accepted) and `height_votes`; `map_heights.rev`.

### Suggestions for the other layers (rivers, roads, mountain ranges, nations, forest, ice)

The same as for the height map, for every other layer: anyone with an account suggests, everyone sees, the map's owner (for the default map: the admins) decides. They share the **Förslag** panel with the height map's suggestions, newest first, each marked with its layer (*Floder #3*, *Skog #5* …).

- **Suggesting:** *Föreslå en ändring* asks which layer: *Höjdkarta*, *Skog*, *Is*, *Floder*, *Vägar*, *Bergskedjor* or *Nationer*. The layer's own editor opens with all its tools (draw new, move points, rename, delete, change size or kind), but **nothing is saved**: the layer's Save and Export buttons are hidden and the edits stay in the page. **Skicka förslag…** sends what changed against the layer as it was when you started, and the layer goes back to the server's version. *Avbryt förslaget* drops the edits. Forest and ice are painted, as with heights: only the rectangle around what you painted is sent.
- **What is sent (rivers, roads, ranges, nations):** the change by id: the items added, the items removed, and for each changed item how it was and how it is. Lakes count among the rivers, subdivisions belong to their nation. A suggestion that wouldn't fit the layer as it is now (for example removing a river that others still run into) is refused when sent.
- **Seeing one:** click it in the list to zoom there. **Före / Efter / Båda**: what it removes or changes is drawn red and dashed, what it adds or changes it to green. For forest and ice, *Efter* draws the painted area like the layer (a brown tint where trees or ice are taken away), *Skillnad* green where it adds and red where it takes away. The panel lists how many items are added, removed and changed, with their names, or how much ground the painting covers.
- **Deciding:** *Godkänn* puts the change into the layer **as it is now**: removed items go (if still there), changed items get the suggested version (and come back if they were removed meanwhile), added items are added; if an added item's id has been taken meanwhile it gets a new one, and rivers and branches that join it follow. The result is checked like any save (no rivers in a circle and so on); if it no longer fits, nothing changes and you are told why. *Avvisa* closes it. An accepted suggestion can be undone (*Ångra*): what it added goes, what it removed comes back, what it changed goes back to how it was. Reviewers can also *Skicka och godkänn* their own suggestion in one go.
- **Limits:** 30 open suggestions per person and map (counted apart from the height map's), 3 000 items per suggestion.
- **Endpoints:** `GET/POST /weather/api/maps/{id}/layer-suggestions` (POST: JSON `{ layer, comment, diff: { added, removed, changed: [{ before, after }] } }`, or a grey + alpha PNG with `?layer=forest|ice&x=&y=&iw=&ih=&comment=`); `GET …/{sid}/data` (the change), `…/{sid}/old` (what accepting replaced); `POST …/{sid}/vote|withdraw|reject|accept|undo`.
- **Storage:** tables `layer_suggestions` (the change as JSON or PNG, a summary as JSON, and once accepted what it replaced, for undoing) and `layer_votes`.

### Aspect symbols

Click **Symbols** (when logged in) and upload an image for each aspect. Transparent PNG or SVG works best. You can also upload one per force (Grundkrafter, Primalkrafter…), used as a fallback. Your symbols appear on every map you own, including for people viewing your public maps.

A storm shows the symbol(s) of its **dominant aspect(s)**, decided by the day the storm formed:

- The event names an aspect (*Kryotropisk Magistorm*) → that aspect.
- The event names a force (*Magistorm (Elementarkrafter 10)*) → the force's aspects that rule that day (year/month/week/day cycle). If two or more are tied, all of them are shown. If none rules, the force's symbol is shown.
- The event names neither (*Magistorm (Styrka 15)*) → the day's influx aspect, if there is one.

A storm without any matching symbol keeps the spiral. Clicking a storm on the map shows its dominant aspects.

**Time runs continuously.** The map keeps yesterday, today and tomorrow loaded and blends between days from 22:00 to 02:00, so nothing jumps at midnight. ▶ plays straight through into the next day.

Use the hour slider or ▶ to play through the day. Click anywhere on the map to see the weather at that spot, any storms over it, and a button that switches the left panel to that region.

**How the values are blended:** each spot on the map is a weighted mix of the nearest regions (inverse-distance weighting between your points). The values themselves come straight from the generator: each region's hourly temperature, wind and precipitation.

**Clouds move with the local wind.** Each part of the cloud pattern travels with the wind where it is: the regions' hourly wind is added up, so clouds stream along with the trade winds and the westerlies, at roughly 10–50 km/h depending on the wind. Two copies of the pattern take turns: each fades in, travels for a day and fades out, so clouds form, drift and dissolve without ever jumping. Rain follows the clouds.

**How much of the map is drawn under cloud:** a little less than the cloud number, so the map stays readable: 30 % cloud covers about 15 % of an area, 50 % about a third, 80 % about 70 %. Overcast stays overcast. The percentages shown when you click the map are the real values. The curve is `cloudArea()` in `fieldmap.js`.

**Rain falls only under clouds:** a region's rain is drawn only where the map shows cloud over it, both in the rain layer and the rain effect. So on a showery day part of the region stays dry. Clicking a spot shows the rain falling right there. The left panel still shows the region's own day.

**Cloud cover** isn't in the original engine. It is derived per region from that day's precipitation, the month's wetness, and fog, thunder or sandstorm events, using its own random seed, so it never changes the generated weather.

**Magic storms** are the events whose names contain *Magistorm*, *Högmagisk* or *alstra*:

- **Strength** comes from the name ("Styrka 15", "Hydrotropi 20", "Elementarkrafter 10", "+3 alstra" → 6). A Högmagisk event without a number counts as 8. That number is the storm's **peak**.
- **Lifecycle:** a storm forms at a random hour of the day its event was rolled and lasts `duration_min`–`duration_max` hours (e.g. Liten Magistorm 6–24 h, Svår Magistorm 12 h–4 days). It swells towards its peak and fades again following its `growth` value: 50 grows as fast as it dies, low values grow slowly and end abruptly, high values start abruptly and die away slowly.
- **Movement** is rolled once per storm from `follow_wind` and `wander` (chances in %): it follows its region's wind hour by hour, wanders randomly, or stays where it formed.
- **Speed:** each moving storm gets its own speed between `speed_min` and `speed_max` (default 5–20 km/h). Half the storms are slower and half faster than about 10 km/h. Storms following the wind go faster in strong wind (up to ×1.4) and slower in calm (down to ×0.6), but never outside their min–max range. Clicking a storm shows its speed. All storm events are set to follow_wind 50 / wander 20; Pneumotropi follows the wind at 80, Ataxatropi wanders at 80.
- `stay_in_region: true` keeps a storm inside the region it formed in; it still moves, but turns back or waits at the border (used by Summag).
- If the same region rolls the same kind of storm while one is still alive, that storm **swells again** instead of a twin appearing.
- The colour is the storm's force: Grundkrafter, Primalkrafter, Elementarkrafter, Livskrafter, Himlakrafter, Symbolkrafter or Själakrafter (aspects grouped as in the old `aspekt` enum; since 2.19 Topotropi is among the Grundkrafter, and Själakrafter holds Teotropi, Psykotropi and Daimotropi; since 2.20 Kosmotropi is among the Himlakrafter, Semotropi among the Symbolkrafter and Oneirotropi among the Själakrafter).
- If the **influx** at the storm's peak matches its aspect (or its force), the influx bonus is added to the peak.
- Clicking a storm shows its current strength out of its peak, whether it is growing or fading, how it moves and how many hours it has left.

The settings live on each storm event in `additional-events.yaml` and `regions/*.yaml`. Defaults and the per-aspect rules are in `world/magic-storms.yaml`, which also explains every value. Restart the app after editing.

## Making and changing regions in the app

Admins see two small buttons next to the region menu: **＋** makes a new region and **✎** edits the selected one. The form has:

- **Name** and **description** (the description becomes the comment at the top of the region file).
- **Start from:** for a new region, copy all values from an existing one and adjust.
- **Temperature, precipitation and wind per month.** Temperature is the day's average. Precipitation and wind are added to the generator's base values (0 = normal).
- **Day–night swing** (`temperature_drop`) and **sharpness** (`drop_speed`).
- **Prevailing wind** and the share of days it blows.
- **Cloud cover** and **keep within** (map-only settings).
- **Events:**
  - name, and how often ("1 in 7 days")
  - the change to temperature, rain and wind that day
  - under *Mer*: limits to certain months or weather, settings for magic storms (follows the wind, wanders, grows, how long, how fast), and variants
  - names starting with "Högmagisk" become magic storms on the map

**Where they're kept:** regions made in the app are stored in the database (table `custom_regions`), so they survive restarts and new deployments and are backed up with the database file. At startup the app puts the world together from `world/regions` plus these.

- **Built-in regions:** a region saved under the name of a built-in one replaces it, and the menu marks it *(ändrad)*. New regions are marked *(egen)*. *Ta bort* deletes a new region, or removes your changes to a built-in one so it goes back to its original.
- **Download:** *Ladda ner YAML* gives the region file in the same format as `world/regions`. Put it there to make it a permanent part of the world.
- **Renaming:** renaming a region you made moves its map points and campaigns along with it.
- **On the map:** a new region shows up there once you've placed a point for it in *Placera områden*.

**Who may change regions (the admins):** the accounts **Gemstone** and **Gemstone86** (any letter case), set in `Api.DEFAULT_ADMINS`. They also decide on height map suggestions for the default map. To use other names, set `EON_ADMINS` to a comma-separated list of usernames; it replaces the default list. Once one of the admin accounts exists, nobody else can register the other admin names. Everyone else only sees the regions.

## Version number

The bottom-right corner of the page shows the version, e.g. `v1.28`. If the server runs a newer version than the files your browser has cached, it shows both in gold (`v1.29 · sidan v1.28 — ladda om`), and a reload (Ctrl+F5) fixes it. The number lives in three places, which are changed together for each release: `Api.VERSION`, `CLIENT_VERSION` in `app.js`, and the `?v=` numbers in `index.html`.

## Putting it on the internet (Azure App Service)

The weather generator now runs inside the combined app (Root and Rune + the weather generator, see README.md): one
jar, `target/root-and-rune.jar`, with the weather generator at `/weather/`.

**Switching the existing weather web app over** (keeps everything):

1. **Back up first:** *Development Tools → Advanced Tools → Go → Debug console*, open `/home/data` and download
   `eonweather.mv.db`. Best: try the move on your own computer first: put the downloaded file in this project's
   `data/` folder (no `hub.mv.db` there), start the app, log in, and check that your maps, notes and journeys are there.
2. **Change the environment variables** (web app → *Settings → Environment variables*):

   | Remove | Add instead |
   |---|---|
   | `EON_DB_URL` | `DB_URL` = `jdbc:h2:file:/home/data/hub;MODE=PostgreSQL;NON_KEYWORDS=YEAR;DB_CLOSE_ON_EXIT=FALSE` |
   | `EON_DB_USER` / `EON_DB_PASSWORD` | `DB_USER` = `sa` (`DB_PASSWORD` only if you had one) |
   | `EON_SECURE_COOKIE` | `SECURE_COOKIE` = `true` |
   | `EON_REGISTRATION` | `REGISTRATION` = `true` (open) or `false` (closed) |

   Keep `PORT`, `WEBSITES_PORT`, `WEBSITE_DISABLE_OVERLAPPED_RECYCLING`, `EON_ADMINS`, `EON_DB_BACKUP_HOURS` /
   `EON_DB_BACKUPS` and *Always on*. The new database must be in `/home/data` (as above), or it is lost at the next
   deployment, and being next to `eonweather.mv.db` is how the move finds the old file.
3. **Upload the new jar:**
   `az webapp deploy --resource-group <group> --name <app> --src-path target/root-and-rune.jar --type jar`
4. **On the first start** the old database is copied into `/home/data/hub.mv.db` (README.md, *Moving from the separate
   weather generator*); the log says `Weather import: …`. The old file stays as it was, so going back is: the old jar
   and the old settings.
5. The weather generator is now at `https://<app>.azurewebsites.net/weather/`, the start page at `/` links both apps.
   Old bookmarks to `/` land on the start page.

**A new web app from scratch:** *App Services → Create → Web App*, Publish **Code**, **Java 21**, **Java SE (Embedded
Web Server)**, **Linux**, plan **Basic B1** (the Free plan sleeps). Set `PORT` and `WEBSITES_PORT` to `80`, `DB_URL` as
above, `SECURE_COOKIE=true`, `WEBSITE_DISABLE_OVERLAPPED_RECYCLING=1`, turn on *Always on*, and upload the jar as in
step 3. The first account registered becomes the admin.

**Updates are published automatically:** whenever something is merged into `main`, the GitHub action *Deploy to Azure*
(`.github/workflows/deploy.yml`) builds the jar, runs the tests, uploads it (only if they pass) and waits until the site
answers with the new version. Set up once in GitHub (repo → *Settings → Secrets and variables → Actions*): the variable
`AZURE_WEBAPP_NAME` (the web app's name) and the secret `AZURE_WEBAPP_PUBLISH_PROFILE` (Azure portal → the web app →
*Overview → Download publish profile*, paste the whole file; if the button is greyed out, turn on *SCM Basic Auth
Publishing Credentials* under *Settings → Configuration → General settings*). It can also be run by hand: *Actions →
Deploy to Azure → Run workflow*. By hand without GitHub: build a new jar (Eclipse: *Run As → Maven build…* →
`clean package`) and repeat step 3.

**The database file** is `/home/data/hub.mv.db`. How the app looks after it (`DbGuard`, only for the built-in H2 file):
- **One copy at a time.** File locks aren't reliable on App Service's `/home` network share, so a new version starting while the old one runs could write the file at the same time as the old one, which corrupts it. The copy using the file keeps `hub.owner` next to it (refreshed every 10 s); a new copy asks for the file (`hub.handover`), the old one closes the database cleanly and stops, and the new one takes over (waiting at most 2½ minutes). `WEBSITE_DISABLE_OVERLAPPED_RECYCLING=1` avoids the overlap in the first place.
- **Backups.** Every 6 hours (`EON_DB_BACKUP_HOURS`), 5 minutes after each start, the whole database is written as SQL to `/home/data/backups/hub-<date>.zip`; the newest 14 are kept (`EON_DB_BACKUPS`). Writing one reads every record, so a damaged file shows up there early: the admins get a message on the page.
- **Repair at start.** A file that can't be opened because it is corrupted ("File corrupted while reading record") is renamed to `hub.corrupt-<date>.mv.db` (never deleted) and everything readable is taken back from it with H2's recovery tool. If that fails, the newest backup that works is loaded; if none, the app starts empty (the standard map is installed again). The admins see what happened in a message when they open the page, and it is in the log.
- **H2 2.3.232.** Versions before it have known bugs that corrupt the file (2.2.224, which Spring Boot 3.3 brings, among them). `pom.xml` sets `h2.version` to 2.3.232, which opens the old files as they are.

**Repairing by hand** (if you'd rather): stop the app, download `/home/data/hub.mv.db`, and on your own computer run `java -cp h2-2.3.232.jar org.h2.tools.Recover -dir . -db hub`, then `java -cp h2-2.3.232.jar org.h2.tools.RunScript -url jdbc:h2:file:./new/hub -user sa -script hub.h2.sql`, and upload `new/hub.mv.db` in its place.

Keep the app at **one instance**: logins are held in the app's memory, so scaling out to several instances would log people out at random.

The other settings are in README.md (*Settings*). Tables are created automatically on first start.

## Data files (`world/`)

These have the same formats as before, only moved:

| Desktop app | Web version |
|---|---|
| `src/data/eon/*.yaml` | `world/regions/*.yaml` |
| `src/additional-events.yaml` | `world/additional-events.yaml` |
| `src/important_dates.yaml` | `world/important_dates.yaml` |
| `src/data/Influx.yaml` | `world/influx.yaml` |
| `src/data/eon.yaml` | `world/calendars.yaml` |

New in the web version: `world/magic-storms.yaml` (magic storms) and `world/travel.yaml` (the travel calculator's rules, see *Travel*; read again when it changes, no restart).

Region file names were made plain ASCII (`Forion-Ost.yaml`). The displayed name still comes from `name:` inside the file. Restart the app after editing these files.

**Southern hemisphere:** Mundana is like Earth, so regions in the far south (Ishavet, Isöknen, Vita havet, Södra isvidderna, Okända landet, Mistviken, Askhavet) have their seasons reversed in their files: coldest in June–July. Regions near the equator are left as they are.

**Prevailing wind:** each region file has, for example, `prevailing_wind: SW` (where the wind usually comes **from**) and `prevailing_chance: 45` (% of days). On the other days the wind is usually 45° off to either side, and now and then any direction. These are real weather values: the left panel, the wind arrows and the clouds all follow them. The values were set from each region's latitude on Mundana, following Earth's wind belts: trade winds (NE north of the equator, SE south of it, 60 %) up to 30°, westerlies (SW / NW, 45 %) from 30 to 60°, and polar easterlies (NE / SE, 50 %) beyond that. Change them freely. A region without the setting gets all eight directions equally often.

**Map-only region settings.** Two optional settings change how a region looks on the map without changing its generated weather:

- `cloud_cover: 2` gives more cloud. Each step adds about 10 percentage points of cloud on dry days and 4 on rainy days. Negative values give clearer skies. Use one number for the whole year, or a value per month like `precipitation`. As a test, Godrion at +2 went from 55% to 69% average cloud, with overcast days rising from 70 to 118 a year. At −2 it fell to 41%.
- `contained_radius: 0.015` keeps the region's weather to itself on the map. Within this distance of its points (as a share of the map's width; 0.015 ≈ 48 px on Mundana), the region takes over completely, with a soft edge. Outside it, the region has no influence at all. Use it for places that differ sharply from their neighbours, like Koyn-Doloz's warmth. To cover an odd-shaped area, place several points.

**Events every day:** `days: 1` now means every day (e.g. Dimmornas hav's daily sea mist). Before, an event with `days: 1` never happened.

**Mist:** any event with *dimma* in its name shows on the cloud layer as a grey haze. It is thickest at night and in the morning and burns off towards midday. *Tjock* mist is thicker. Clicking the map mentions mist where there is some.

## Security

- Passwords are hashed with PBKDF2-SHA256 (210,000 iterations, random salt).
- The session id changes at login. Cookies are HttpOnly and SameSite=Lax.
- Requests that change data must carry an `X-Eon-Request` header, which blocks cross-site request forgery.
- Login is throttled to 10 failed attempts per 15 minutes per username and address.
- Maps are private unless marked visible to everyone, and only the owner can change one.
- Logins are kept in server memory, so restarting the app logs everyone out. Notes and settings are in the database and are not affected.

## Changes to the engine

Kept to a minimum:

- **Negative precipitation counts.** A region's monthly `precipitation` value is added to the rain roll (obd6 + value ≥ 6 means rain) both ways. A −1 now makes rain rarer; the desktop app ignored values below 0.
- **No rain bonus from strong wind.** The desktop app added wind ÷ 2 to the rain roll when wind was above 5. That leftover quirk is removed, so windy regions no longer get extra rain days just for being windy.
- **"days: N" means 1 chance in N.** The desktop app rolled `nextInt(days − 1) + 1 < occurs + 1`, which is 1 in N − 1 (too often for short intervals), and it never fired for `days: 1`. Now `occurs: 1, days: 10` happens on average once every 10 days, and `days: 1` every day. Because every event is now rolled this way, the generated weather for a given date differs from older versions.
- **Wind direction.** The desktop app rolled N on 25 % of days and never NW (`nextInt(8)` gives 0–7, and 0 fell through to N). Now regions with a prevailing wind follow it (see *Data files*), and others get all eight directions equally often.
- **Event wind bonus applies on the same day.** In the desktop app, an event's `bonus_wind` (e.g. fog −4) was held over and added to whichever day you looked at *next*. Now it applies to the day the event happens.
- Each day carries its events as a list (some event names contain commas).
- Language is per request, so two people can use Swedish and English at the same time.
- Loaders take a file path instead of `basePath + "/src/..."`. `influx.yaml` is now found on Linux servers too (the desktop app looked for `influx.yaml` but the file was `Influx.yaml`).

Two things in the original engine look like bugs. I left them alone because fixing them would change generated weather:

- `Nation.getRain(month)` reads `rainfall[month]` rather than `rainfall[month - 1]`, so each month uses the *next* month's precipitation value.
- `getNonRandomDirection()` draws 0–7, but 0 maps to N through `default` and `case 8` (NW) can never happen, so N is twice as common and NW never occurs.

## Project layout

```
src/main/java/weather, date, context, gui   the original engine
src/main/java/com/eonweather/core           web logic: API, database, map data (plain Java)
src/main/java/com/eonweather/web            Spring Boot startup + one controller
src/main/resources/static                   the page (HTML/CSS/JS, no build step)
src/main/resources/default-map              the default map (Mundana): image, region points, symbols
src/test/java/DevServer.java                a no-Spring test server
world/                                      data files
```
