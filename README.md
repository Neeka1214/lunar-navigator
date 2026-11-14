# Lunar Landing Site Navigator

NASA Space Apps Challenge 2026 · Challenge: **Lunar Landing Site Navigator** · Local event: Taipei

**Live tool:** https://neeka1214.github.io/lunar-navigator/ · **Slides:** https://neeka1214.github.io/lunar-navigator/slides/slides.pdf

A web tool for quickly comparing lunar landing sites and dates. For each site and date it shows
where the Sun and Earth sit relative to the real terrain horizon. That tells you whether the lander gets solar power and
whether it can talk directly to Earth, and for how long.

## Features
- **Sky panorama**: the real LOLA terrain horizon, with the Sun and Earth at their true angular size and their paths over the next 30 days
- **Go / No-go verdict**, time until sunset or Earthset, longest darkness, solar-panel output
- **24 curated sites** from NASA Moon Trek: 13 Artemis III candidate regions, 7 CLPS missions, plus ISRO Chandrayaan-3, JAXA SLIM, Apollo 11 and the floor of Shackleton crater. You can also click the map or type coordinates to add any site
- **Side-by-side comparison** of sites or dates; the best option is highlighted
- **Landing-window finder**: dates when the Sun and Earth stay in view together for N days or more
- **Seasons**: sunlit, Earth-visible and both-visible percentages for every lunar day from 2026 to 2028
- **Nearby alternatives**: a heatmap of the ±15 km around a site (1 km cells)
- **3D terrain view**: LOLA terrain lit by the real Sun position, with live shadows
- **LROC NAC image coverage** for each site, from LROC QuickMap
- **"Learn why" mode** for students and the public
- **Astronaut View**: walk on real LOLA terrain (W A S D keys) with a live check of whether the Sun and Earth are visible; see which face of Earth points at you, its time zones, and which cities and Deep Space Network antennas can see the Moon right now
- **Chang'e & Jade Rabbit** (嫦娥 · 玉兔), optional and can be switched off: the real Earth–Moon distance, how long the trip would take at different speeds, and a find-the-rabbits game

## NASA data and resources used
| Resource | How it is used |
|---|---|
| **JPL Horizons System** (API) | Hourly sub-solar and sub-Earth points on the Moon plus Earth–Moon distance, and sub-Moon and sub-solar points on Earth (`scripts/fetch_earthview.py`), 2026-11 → 2028-12 (DE441). From these we compute the Sun and Earth azimuth and elevation at any lunar site. Checked against direct Horizons topocentric queries to better than 0.01° (`scripts/fetch_horizons.py`) |
| **NASA Moon Trek** | Artemis III Candidate Landing Regions (`A3_Named_regions`), the CLPS sites layer, and the *LOLA Permanently Shadowed Regions Southpole 240m* map, which we use for validation (`scripts/build_sites.py`, `scripts/validate_psr.py`) |
| **LROC QuickMap** | Features API, `nac` collection: LROC NAC image footprints and metadata covering each site (`scripts/quickmap_nac.py`) |
| **LRO LOLA** topography (NASA PDS; the same data Moon Trek and QuickMap display) | LDEM_80S_80M and LDEM_75S_240M, used for terrain horizons, heatmaps, the 3D view and the basemap (`scripts/compute_horizons.py`, `scripts/site_tiles.py`) |
| **CSA** Moon Exploration | Linked in the education content |
| **ISRO / JAXA** (Space Agency Partners) | Chandrayaan-3 and SLIM landing sites, used as comparison sites |

## Validation
We compared our Sun-visibility model (JPL Horizons + LOLA terrain horizon) with NASA Moon Trek's LOLA permanently shadowed regions map at 300 random south-pole points. The two agree on **98.7%** of points (`web/data/validation.json`).

## Other references
- Natural Earth 1:110m land (public domain), via world-atlas: Earth coastlines in the Astronaut View
- three.js (MIT), d3 (ISC), numpy, Pillow

## How it works
1. `scripts/fetch_horizons.py`: downloads the ephemeris from JPL Horizons
2. `scripts/build_sites.py`: downloads the Artemis III regions and CLPS sites from Moon Trek
3. `scripts/compute_horizons.py`: computes a 720-azimuth terrain horizon for each site from LOLA, including lunar curvature. There is no atmosphere, so no refraction correction is applied
4. `scripts/quickmap_nac.py`: queries LROC NAC coverage through QuickMap
5. `scripts/site_tiles.py`: builds the nearby-alternatives heatmaps and the 3D terrain tiles
6. `scripts/validate_psr.py`: runs the validation against the Moon Trek PSR map
7. `scripts/fetch_earthview.py`: downloads the Earth-facing geometry used by the Astronaut View
8. `web/`: a static website (HTML, JavaScript, Canvas, three.js) that needs no server-side code

Raw LOLA files go in `data_raw/`; see the URLs in the scripts.

## Limitations
- Site coordinates are representative points: the centre of each Artemis III region, the Moon Trek CLPS point, or published landing coordinates. IM-2 uses its actual Mons Mouton landing point instead of the original target listed in Moon Trek.
- "Visible" means the centre of the Sun or Earth is above the terrain horizon, as seen from 2 m above the ground.
- Custom sites use 960 m terrain in the browser; curated sites use 80 m terrain.

## Use of AI (Super Intelligence) tools
The code and data-processing scripts of this project were written with the help of an AI assistant (Claude, by Anthropic). Each AI-assisted source file says so in its header.
