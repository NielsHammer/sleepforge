/**
 * expand-space-library.js — Generate 250 new images for Sleepless Astronomer
 *
 * Targets: spacecraft (Voyager, JWST, Hubble, Cassini, Curiosity, New Horizons, ISS, Apollo),
 * upcoming topic pool subjects (JWST discoveries, neutron stars, Andromeda collision,
 * exoplanets, dark matter, Titan, Pillars of Creation, gamma-ray bursts, gravitational waves,
 * Europa, Betelgeuse, Pluto, Pulsars, Quasars, Cassini/Saturn), and deep space supplementals.
 *
 * Output: assets/images/space-library-v2/<keyword>/<id>.jpg
 *         assets/images/space-library-v2/index.json
 *
 * Cost estimate: 250 × $0.003 = ~$0.75 (Flux Schnell)
 * Runtime: ~30-45 min on fast connection
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const FAL_KEY = process.env.FAL_KEY;
if (!FAL_KEY) { console.error('FAL_KEY not set'); process.exit(1); }

const V2_DIR = path.join(ROOT, 'assets', 'images', 'space-library-v2');
const V2_INDEX = path.join(V2_DIR, 'index.json');
const FLUX_URL = 'https://fal.run/fal-ai/flux/schnell';

fs.mkdirSync(V2_DIR, { recursive: true });

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── SUBJECT DEFINITIONS ─────────────────────────────────────────────────────
// 50 subjects × 5 prompt variants each = 250 images
// Spacecraft use photoreal NASA-style prompts
// Space phenomena use cinematic deep-space photography style

const SUBJECTS = [
  // ── SPACECRAFT (priority: AstroKobi critic always marks down "no spacecraft visible") ──
  {
    keyword: 'voyager',
    description: 'Voyager spacecraft in deep space',
    prompts: [
      'NASA Voyager 1 spacecraft floating in deep black interstellar space, golden foil insulation panels gleaming, antenna dish pointing toward distant Sun, photorealistic NASA archival style, 8k ultra detail, cinematic documentary photography',
      'Voyager probe cutaway diagram and actual spacecraft in space, technical blueprint aesthetic overlaid on real space background, golden record disc visible, NASA photoreal rendering, high detail',
      'Voyager 1 spacecraft silhouette against star field, Sun visible as bright star in distance 23 billion kilometers away, NASA documentary photography style, dramatic deep space lighting',
      'Twin Voyager probes side by side comparison in space, detailed surface texture of foil and electronics, heliopause boundary glowing behind them, photoreal space illustration NASA style',
      'Voyager spacecraft golden record close-up showing human civilization symbols, spacecraft arm extending in zero gravity, NASA photoreal archival photograph aesthetic, ultra detailed',
    ],
  },
  {
    keyword: 'jwst',
    description: 'James Webb Space Telescope',
    prompts: [
      'James Webb Space Telescope in orbit with 18-hexagon gold mirror unfolded, L2 orbit around Sun, Earth and Moon in background, NASA photoreal rendering, cinematic space photography',
      'JWST golden primary mirror reflecting infrared light, sunshield layers visible below, deep space background, photoreal NASA official imagery style, ultra high detail 8k',
      'James Webb Space Telescope deployment sequence, mirrors unfolding in space, solar panels extending, photorealistic NASA animation frame, documentary space photography',
      'JWST first deep field image context — telescope pointing toward distant galaxy cluster, infrared glow, photoreal composite, NASA official imagery aesthetic',
      'James Webb Space Telescope scale comparison — 6.5m mirror diameter with astronaut reference, orbital mechanics diagram overlay, NASA technical illustration photoreal style',
    ],
  },
  {
    keyword: 'hubble',
    description: 'Hubble Space Telescope',
    prompts: [
      'Hubble Space Telescope in low Earth orbit, solar panels extended, cylindrical body, Earth curved horizon below, photoreal NASA archival photography, dramatic lighting',
      'Hubble Space Telescope repair mission, astronaut in EVA suit floating alongside telescope, space shuttle in background, photoreal NASA documentary photograph, 8k detail',
      'Hubble telescope optical tube close-up, aperture door open, space background, NASA photoreal imagery, cinematic space documentary style',
      'Hubble Space Telescope silhouette against orbital sunrise, Earth limb glowing below, solar arrays catching sunlight, NASA photography aesthetic, dramatic documentary',
      'Hubble telescope being deployed from space shuttle cargo bay, robotic arm, Earth below, NASA photoreal archival photograph, 1990 deployment era aesthetic',
    ],
  },
  {
    keyword: 'cassini',
    description: 'Cassini Saturn probe',
    prompts: [
      'Cassini spacecraft orbiting Saturn with massive ring system visible below, photorealistic NASA rendering, golden probe with dish antenna, dramatic cinematic lighting',
      'Cassini probe entering Saturn atmosphere, heat shield glowing, rings visible in background, NASA photoreal illustration of grand finale 2017, documentary style',
      'Cassini spacecraft with Saturn and Titan moon in background, detailed spacecraft hardware visible, NASA official imagery photoreal style, 8k ultra detail',
      'Cassini-Huygens probe separation sequence, Huygens lander descending toward Titan, ringed Saturn in background, photoreal NASA illustration',
      'Cassini spacecraft silhouette against Saturn rings backlit by Sun, ring ice particles glowing, NASA photoreal documentary photography, dramatic space lighting',
    ],
  },
  {
    keyword: 'curiosity',
    description: 'Mars Curiosity Rover',
    prompts: [
      'NASA Mars Curiosity Rover on red Martian surface, Gale Crater landscape, rocky terrain, dust-covered wheels, photoreal NASA photography style, clear Martian sky',
      'Curiosity Rover selfie on Mars surface, radioisotope generator visible, drill arm extended, rust-red soil, Mount Sharp background, NASA photoreal photograph',
      'Curiosity Rover driving across Mars, dust plume behind, dramatic Martian sunset orange sky, NASA documentary photography, photoreal ultra detail',
      'Curiosity Rover close-up of sample drill mechanism, red Martian rock face, NASA photoreal technical photograph, geological sampling operation',
      'Mars Curiosity Rover approaching dark sand dunes, Martian rock formations, NASA photoreal landscape photography, isolated rover in vast alien terrain',
    ],
  },
  {
    keyword: 'new-horizons',
    description: 'New Horizons Pluto flyby',
    prompts: [
      'New Horizons spacecraft flying past Pluto, heart-shaped Tombaugh Regio nitrogen plains visible on Pluto surface, Charon moon nearby, NASA photoreal illustration 2015',
      'New Horizons probe silhouette, RTG power source visible, Pluto and Charon binary system in background, photoreal NASA rendering, deep space Kuiper Belt setting',
      'New Horizons spacecraft with Pluto close-up showing ice mountains and nitrogen plains, NASA official imagery style, cinematic space photography, historic flyby',
      'New Horizons transmission from 5 billion kilometers, faint Sun as bright star, spacecraft trajectory arc visible, NASA documentary photography style, deep space isolation',
      'New Horizons spacecraft detailed hardware — LORRI camera, antenna dish, gold foil insulation, photoreal NASA technical illustration, Pluto in background',
    ],
  },
  {
    keyword: 'iss',
    description: 'International Space Station',
    prompts: [
      'International Space Station ISS in low Earth orbit, solar panels extended, Earth curvature visible below with clouds, photoreal NASA photography, cinematic documentary',
      'ISS close-up of truss structure and solar arrays, astronaut EVA visible, Earth below, NASA official photograph aesthetic, ultra detail 8k',
      'International Space Station overhead view showing all modules connected, dramatic Earth terminator line below, NASA photoreal photograph, space documentary style',
      'ISS astronaut looking out cupola window at Earth below, interior lights glowing, photoreal NASA photograph, emotional human moment in space',
      'Space Shuttle docking with ISS, station silhouette against Earth, NASA photoreal archival photography, dramatic orbital mechanics visualization',
    ],
  },
  {
    keyword: 'apollo',
    description: 'Apollo lunar missions',
    prompts: [
      'Apollo Lunar Module on Moon surface, American flag planted, astronaut in spacesuit, Earth visible in black lunar sky, NASA archival photoreal photography 1969 aesthetic',
      'Apollo astronaut walking on Moon surface with Lunar Module and Saturn V rocket launch visible on Earth in background, NASA documentary photography style',
      'Apollo 11 lunar module Eagle ascending from Moon surface, exhaust plume, Earth in background, photoreal NASA archival illustration, historic moment',
      'Apollo astronaut planting American flag on Moon, bootprints in lunar dust visible, NASA photoreal archival photograph aesthetic, dramatic space documentary',
      'Saturn V rocket launch at night, massive exhaust and flame, Kennedy Space Center, NASA archival photography aesthetic, photoreal documentary style',
    ],
  },
  // ── TOPIC POOL SUBJECTS ──────────────────────────────────────────────────────
  {
    keyword: 'andromeda-collision',
    description: 'Andromeda galaxy merging with Milky Way',
    prompts: [
      'Andromeda galaxy and Milky Way merging in sky, two spiral galaxies colliding, billions of stars visible, dramatic space photography, cinematic NASA illustration',
      'Galaxy merger simulation — two spiral galaxies interacting, tidal tails of stars stretching between them, bright collision zone, photoreal astrophotography style',
      'Andromeda galaxy approaching Milky Way, both galaxies visible from above, gravitational tidal tails, NASA Hubble style deep space photography',
      'Binary galaxy collision — stars from two galaxies mixing, intense blue star formation triggered by collision, dramatic astrophotography, Hubble color palette',
      'Artist concept of night sky 4 billion years from now — Andromeda filling sky above Earth, two galaxy cores merging, photoreal NASA illustration, cinematic',
    ],
  },
  {
    keyword: 'exoplanet',
    description: 'Earth-like exoplanets',
    prompts: [
      'Earth-like exoplanet in habitable zone, blue oceans and green continents visible, parent star in background, photoreal NASA artist concept, atmospheric haze',
      'Super-Earth exoplanet transit across host star face, planet silhouette, NASA photoreal illustration, stellar disk background, transit photometry visualization',
      'Exoplanet with two moons above alien ocean, bioluminescent creatures implied, parent star setting on horizon, NASA artist concept photoreal, alien world',
      'Hot Jupiter exoplanet orbiting very close to star, tidally locked, permanent storm systems, star corona visible, photoreal NASA Hubble illustration',
      'Rocky exoplanet surface with alien sky showing multiple moons, stellar nursery in background, NASA artist concept photoreal, deep space documentary style',
    ],
  },
  {
    keyword: 'dark-matter',
    description: 'Dark matter and dark energy visualization',
    prompts: [
      'Dark matter web visualization — luminous filaments of dark matter connecting galaxy clusters, void regions between, NASA simulation rendering, blue purple cosmic web',
      'Bullet Cluster — two galaxy clusters colliding, X-ray gas shown in pink, dark matter shown in blue overlay, NASA Chandra photoreal composite, iconic astronomy image',
      'Dark energy expanding universe visualization — galaxies being pushed apart, cosmic expansion arrows, NASA conceptual illustration, deep space blue-black backdrop',
      'Gravitational lensing by dark matter halo — background galaxy arcs distorted into Einstein rings, cluster in foreground, Hubble photoreal photography style',
      'Dark matter distribution simulation — invisible scaffolding of universe shown as luminous blue web, galaxies forming at nodes, NASA simulation artistic rendering',
    ],
  },
  {
    keyword: 'gravitational-waves',
    description: 'Gravitational waves from merging black holes',
    prompts: [
      'Two black holes merging — binary black hole system spiraling together, gravitational wave ripples shown in spacetime grid, NASA LIGO artistic visualization, dramatic',
      'Gravitational wave detection visualization — spacetime fabric distorted by wave passing through, LIGO interferometer beam path shown, NASA conceptual illustration',
      'Neutron star merger kilonova — two neutron stars colliding, gamma-ray burst, gravitational waves rippling outward, gold synthesis visible, photoreal NASA illustration',
      'Spacetime curvature grid showing gravitational wave — Einstein equations background, ripples spreading from merger point, NASA conceptual science visualization',
      'LIGO laser interferometer aerial view — 4km L-shaped detector arms in Louisiana landscape, light beams, gravitational wave physics, documentary photography NASA',
    ],
  },
  {
    keyword: 'titan',
    description: "Saturn's moon Titan with methane lakes",
    prompts: [
      "Titan surface with methane lake shore, orange haze atmosphere, Saturn visible through thick clouds above, Cassini-Huygens Huygens probe data visualization, photoreal",
      "Titan moon from orbit — orange atmospheric haze, dark hydrocarbon lake visible in polar region, Saturn rings edge-on behind, NASA Cassini photoreal photograph",
      "Titan surface radar image colorized — dark methane seas and lighter landmasses, NASA Cassini RADAR data visualization, alien ocean world aesthetic",
      "Huygens probe descent through Titan atmosphere — orange haze layers, surface approaching, parachute deployed, NASA photoreal illustration, 2005 historic landing",
      "Titan hydrocarbon sea with ethane waves, orange sky above, Saturn as crescent in background, NASA artist concept photoreal, alien ocean world",
    ],
  },
  {
    keyword: 'pillars-of-creation',
    description: 'Eagle Nebula Pillars of Creation',
    prompts: [
      'Hubble Pillars of Creation Eagle Nebula — towering gas columns with stars forming inside, green blue brown colors, Hubble iconic photoreal imagery, star birth',
      'JWST James Webb Pillars of Creation infrared view — ethereal transparent columns showing embedded young stars, orange glow, 2022 JWST photograph style',
      'Eagle Nebula M16 star-forming region — pillars of gas and dust, ultraviolet light from nearby stars eroding columns, Hubble photoreal composite',
      'Pillars of Creation close-up — EGGs (evaporating gaseous globules) at pillar tips, new stars emerging, Hubble aesthetic, photoreal astrophotography',
      'Eagle Nebula wide field — Pillars of Creation small in context of vast star cluster and nebula, Hubble color palette, deep space astrophotography',
    ],
  },
  {
    keyword: 'gamma-ray-burst',
    description: 'Gamma-ray burst explosion',
    prompts: [
      'Gamma-ray burst jet — collapsing massive star unleashing most powerful explosion in universe, relativistic jet punching through star, NASA illustration photoreal',
      'GRB afterglow — gamma-ray burst aftermath, fading X-ray optical and radio emission, distant galaxy host, NASA Hubble photoreal composite, most energetic events',
      'Collapsar model — rotating massive star collapsing into black hole, accretion disk forming, twin jets launching, NASA CGI photoreal, gamma-ray burst physics',
      'Gamma-ray burst visible across universe — brilliant pinpoint of light outshining entire galaxy, NASA Fermi Telescope observation illustration, photoreal space',
      'Magnetar giant flare — neutron star with extreme magnetic field releasing gamma-ray burst, magnetic field lines visible, dramatic NASA conceptual illustration',
    ],
  },
  {
    keyword: 'europa',
    description: 'Europa ice moon with subsurface ocean',
    prompts: [
      'Europa moon surface — cracked ice shell with subsurface ocean visible through cracks, Jupiter huge in background, NASA Galileo photoreal photograph, alien world',
      'Europa subsurface ocean cross-section — ice shell above, liquid water ocean below, hydrothermal vents on ocean floor, NASA conceptual photoreal illustration',
      'Europa close-up surface — red-brown ice ridges and chaos terrain, tidal flexing patterns, Galileo spacecraft photography color enhanced NASA',
      'Europa Clipper spacecraft approaching Europa — NASA 2020s mission concept, Jupiter and other moons in background, photoreal NASA artist rendering',
      'Europa water plumes erupting from surface — ice geysers venting to space, Jupiter illuminating scene, NASA Hubble detection photoreal illustration',
    ],
  },
  {
    keyword: 'enceladus',
    description: 'Enceladus ice geysers',
    prompts: [
      "Enceladus ice geysers — Saturn's moon south pole with water vapor plumes erupting into space, Saturn and rings in background, Cassini photoreal photograph",
      "Enceladus close-up surface — white ice terrain with tiger stripe fractures at south pole, plumes visible, NASA Cassini enhanced color photograph",
      "Enceladus subsurface ocean concept — tiger stripes heated by tidal forces, water erupting through cracks, Saturn visible above, NASA illustration photoreal",
      "Cassini flying through Enceladus plume sampling water — spacecraft diving through geyser, Saturn in background, NASA photoreal mission illustration",
      "Enceladus backlit by Sun — ice plumes backlit showing water vapor and ice particles, Saturn in shadow, Cassini dramatic NASA photograph, stunning lighting",
    ],
  },
  {
    keyword: 'betelgeuse',
    description: 'Betelgeuse red supergiant star about to explode',
    prompts: [
      'Betelgeuse red supergiant star scale comparison — if centered in solar system would engulf Mars orbit, pulsating red surface, NASA photoreal illustration',
      'Betelgeuse dimming event 2019 — before and after comparison, massive cool spot and dust cloud causing Great Dimming, NASA illustration photoreal',
      'Betelgeuse supernova future — star beginning to explode, shock wave propagating outward, red orange yellow explosion, NASA conceptual photoreal illustration',
      'Orion constellation with Betelgeuse highlighted — red giant star glowing dramatically, constellation lines visible, night sky astrophotography photoreal style',
      'Betelgeuse convection cells on surface — massive gas bubbles larger than Sun visible on star surface, ALMA radio observation colorized, photoreal composite',
    ],
  },
  {
    keyword: 'pluto',
    description: 'Pluto with Tombaugh Regio heart',
    prompts: [
      "Pluto close-up — Tombaugh Regio heart-shaped nitrogen ice plain, Sputnik Planitia basin, New Horizons 2015 photoreal photograph, pale frozen world",
      "Pluto surface with nitrogen glaciers and ice mountains — Norgay Montes ice mountains, haze layers visible in atmosphere, New Horizons photograph style",
      "Pluto and Charon binary system — two dwarf planets orbiting common center, New Horizons spacecraft approaching, NASA photoreal illustration 2015",
      "Pluto backlit by distant Sun — haze layers in thin atmosphere glowing, nitrogen ice plains visible, New Horizons historic photograph, photoreal",
      "Pluto Wright Mons ice volcano — cryovolcano with water-ice lava flows frozen, alien glacial landscape, New Horizons photograph colorized NASA style",
    ],
  },
  {
    keyword: 'pulsar',
    description: 'Pulsar rotating neutron star lighthouse',
    prompts: [
      'Pulsar neutron star — rapidly spinning dense stellar remnant with twin gamma-ray jets sweeping space like lighthouse beams, NASA Fermi illustration photoreal',
      'Pulsar wind nebula — neutron star powering glowing nebula from high-energy particles, Crab Nebula Chandra X-ray Hubble composite photoreal',
      'Millisecond pulsar binary system — extremely fast spinning neutron star accreting matter from companion star, accretion disk glowing, NASA illustration',
      'Pulsar timing array — network of pulsars across galaxy used as gravitational wave detector, spacetime grid visualization, NASA conceptual illustration',
      'Pulsar planet system — rocky planets orbiting a millisecond pulsar, eerie blue-white light from neutron star, alien world, NASA photoreal artist concept',
    ],
  },
  {
    keyword: 'quasar',
    description: 'Quasar — brightest objects in universe',
    prompts: [
      'Quasar jet — supermassive black hole at galaxy center launching relativistic jet of plasma for millions of light-years, Hubble photoreal composite, brightest object',
      'Quasar accretion disk — extreme active galactic nucleus with billion solar mass black hole, disk glowing brighter than entire galaxy, NASA photoreal illustration',
      "Quasar host galaxy — quasar nucleus outshining surrounding galaxy stars, NASA Hubble deep field photograph, early universe's brightest beacons",
      'Quasar microlensing — gravitational lensing of quasar light by foreground galaxy creating Einstein cross pattern, Hubble photoreal photograph',
      'Blazar — quasar with jet pointing directly at Earth, blazing point source, gamma-ray and X-ray emission, Fermi Telescope NASA illustration photoreal',
    ],
  },
  {
    keyword: 'cosmic-web',
    description: 'Large-scale structure of the universe',
    prompts: [
      'Cosmic web simulation — galaxy filaments and voids, billions of galaxies arranged in web-like structure, NASA Millennium Simulation rendering, deep space blue',
      'Galaxy supercluster filament — hundreds of galaxies connected by dark matter thread, void regions in between, Hubble wide field photography style, photoreal',
      'Observable universe slice — cosmic large-scale structure showing filaments, walls, and voids, 2dFGRS or SDSS survey data visualization, NASA science illustration',
      'Cosmic void region — vast empty space between galaxy filaments, lonely galaxies at void edges, scale of billions of light-years, NASA conceptual illustration',
      'Galaxy cluster at cosmic web node — thousands of galaxies gravitationally bound, dark matter halo glowing, Hubble deep field aesthetic, photoreal composite',
    ],
  },
  {
    keyword: 'neutron-star',
    description: 'Neutron star — densest object you can touch',
    prompts: [
      'Neutron star surface — 20km diameter city-sized star with density of atomic nucleus, mountains 5mm tall, X-ray emission, NASA photoreal illustration scale comparison',
      'Neutron star merger — two neutron stars spiraling together, gravitational waves rippling, kilonova explosion creating gold and heavy elements, NASA illustration',
      'Magnetar — neutron star with strongest magnetic field in universe, field lines visible, X-ray flare erupting, NASA Chandra photoreal composite illustration',
      'Neutron star with companion — binary system with mass transfer, hot accretion disk, neutron star crushing incoming material, NASA photoreal science illustration',
      'Pulsar neutron star close-up — rotating 700 times per second, beam of radiation sweeping space, spacetime warped around it, NASA dramatic illustration',
    ],
  },
  {
    keyword: 'black-hole-close',
    description: 'Black hole close-up event horizon',
    prompts: [
      'Black hole accretion disk close-up — Interstellar-style gravitational lensing, Einstein ring, bright accretion disk, photon sphere, photoreal space visualization',
      'Event horizon shadow — actual EHT Event Horizon Telescope M87 black hole image style, orange glowing ring, dark shadow center, radio astronomy photoreal',
      'Stellar mass black hole — 10 solar mass black hole with blue accretion disk, relativistic jets launching, companion star visible, NASA Chandra illustration',
      'Black hole spaghettification — star being torn apart by tidal forces, tidal disruption event, star material spiraling into accretion disk, NASA photoreal',
      'Supermassive black hole Sagittarius A* — Milky Way galactic center, star orbits visible, NASA EHT image style, radio and infrared composite',
    ],
  },
  {
    keyword: 'saturn-close',
    description: 'Saturn rings close-up',
    prompts: [
      'Saturn ring system close-up — individual ring particles of ice and rock visible, ring gaps and divisions, Cassini spacecraft photography, photoreal ultra detail',
      'Saturn polar hexagon — mysterious six-sided storm at north pole, massive geometric storm system, Cassini composite image, photoreal NASA photography',
      'Saturn with moons visible — Titan, Rhea, Dione visible near rings, dramatic space photography, Cassini photoreal composite, cinematic deep space',
      'Saturn ring plane crossing — edge-on view of ring system with planet disk, ring shadow on planet, Cassini photograph style, photoreal dramatic',
      'Saturn aurora — ultraviolet aurora at poles, Hubble Space Telescope composite, rings glowing, dramatic planet portrait, photoreal space documentary',
    ],
  },
  {
    keyword: 'nebula-colorful',
    description: 'Colorful emission nebula',
    prompts: [
      'Crab Nebula supernova remnant — web of glowing filaments in blue green red, pulsar at center, Hubble photoreal composite, expanding shell of stellar explosion',
      'Orion Nebula star-forming region — young hot stars illuminating blue purple nebula, Trapezium cluster, Hubble photoreal photography, stellar nursery',
      'Butterfly Nebula NGC 6302 — bilobar planetary nebula, blue white hot dying star, orange outer ring, Hubble photoreal composite, dramatic stellar death',
      'Lagoon Nebula — pink and purple hydrogen emission, dark dust lanes, hot blue stars embedded, Hubble photoreal wide field, massive star-forming cloud',
      'Cat Eye Nebula — concentric rings of planetary nebula, hot blue central star, Chandra X-ray Hubble optical composite, complex structure photoreal',
    ],
  },
  {
    keyword: 'mars-surface',
    description: 'Mars landscape and missions',
    prompts: [
      'Mars Valles Marineris canyon system — largest canyon in solar system spanning continent, aerial orbital view, NASA MRO photoreal photograph, red ochre landscape',
      'Mars Olympus Mons volcano — largest volcano in solar system three times Everest height, orbital NASA photograph, shield volcano caldera visible, photoreal',
      'Mars surface sunset — two suns Phobos and Deimos in sky, rusty orange-red Martian soil, NASA InSight or Curiosity photograph style, alien sunset',
      'Mars polar ice cap — white CO2 dry ice and water ice cap, spiral channels, NASA MRO orbital photograph, dramatic seasonal change, photoreal',
      'Hellas Basin impact crater Mars — massive ancient impact basin, frost visible, orbital NASA MRO photograph, planet-scale geology, photoreal',
    ],
  },
  {
    keyword: 'milky-way',
    description: 'Milky Way galaxy',
    prompts: [
      'Milky Way galactic center panorama — dense star field, dark dust lanes, nebulae glowing, dark sky site astrophotography, Hubble infrared mosaic style, dramatic',
      'Milky Way arch over landscape — starry sky with galaxy band, Milky Way rising over mountain or desert, nightscape astrophotography, photoreal stunning',
      'Milky Way from outside — face-on view of our spiral galaxy, 400 billion stars, four spiral arms, central bar, NASA artist concept photoreal',
      'Galactic bulge — dense central region of Milky Way bulging with stars, infrared Spitzer telescope view, star clouds, dramatic astrophotography photoreal',
      'Milky Way satellite galaxies — Large and Small Magellanic Clouds visible as companion galaxies, Southern Hemisphere astrophotography, photoreal night sky',
    ],
  },
  {
    keyword: 'solar-system',
    description: 'Solar system overview',
    prompts: [
      'Solar system family portrait — all 8 planets lined up with Sun, relative size comparison, NASA Voyager inspiration, accurate orbital arrangement, photoreal composite',
      'Inner solar system — Sun Mercury Venus Earth Mars with correct relative sizes and distances, orbital paths visible, NASA photoreal illustration, 4K',
      'Outer solar system — Jupiter Saturn Uranus Neptune with moons, Kuiper Belt visible, NASA deep space illustration photoreal, scale accurate',
      'Sun and Earth comparison — vast Sun dwarfing Earth, sunspots and solar flares on Sun surface, dramatic scale visualization, NASA photoreal',
      'Solar system in context of local interstellar neighborhood — heliosphere bubble, nearby star systems labeled, NASA science illustration, star map photoreal',
    ],
  },
  {
    keyword: 'supernova',
    description: 'Supernova stellar explosion',
    prompts: [
      'Type II core-collapse supernova — massive star exploding, shockwave expanding at fraction of speed of light, brilliant explosion brighter than galaxy, NASA illustration',
      'Cassiopeia A supernova remnant — 300-year-old stellar explosion shell expanding, Chandra X-ray blue green Hubble optical composite, photoreal composite',
      'Supernova 1987A — closest supernova in 400 years visible from Earth, Hubble three-ring nebula structure, expanding blast wave, photoreal historic composite',
      'Eta Carinae hypernova candidate — massive unstable star with homunculus nebula lobes, about to explode, Hubble dramatic photograph, photoreal',
      'Type Ia thermonuclear supernova — white dwarf detonating after gaining mass from companion, symmetric explosion, NASA conceptual photoreal illustration, photometric standard candle',
    ],
  },
  {
    keyword: 'deep-field',
    description: 'Deep field galaxy survey',
    prompts: [
      'Hubble Ultra Deep Field — thousands of galaxies of all shapes ages and sizes packed into tiny patch of sky, 13 billion years of cosmic history, photoreal Hubble',
      'JWST deep field SMACS 0723 — Webb first deep field image, gravitationally lensed background galaxies, red-shifted ancient light, infrared photoreal 2022',
      'Galaxy zoo — hundreds of spiral elliptical irregular galaxies in Hubble field, diverse morphologies, ancient universe, photoreal deep field astrophotography',
      'Hubble Frontier Fields — galaxy cluster gravitational lens distorting background galaxies, Einstein arcs, deep field photoreal Hubble composite',
      'Cosmic deep time — Hubble time-lapse concept showing galaxy evolution from early universe to today, redshift visualization, NASA conceptual illustration photoreal',
    ],
  },
  {
    keyword: 'comet',
    description: 'Comet in space',
    prompts: [
      'Comet 67P Churyumov-Gerasimenko close-up — rubber duck shaped nucleus, jets of gas and dust from surface, Rosetta spacecraft context, ESA NASA photoreal photograph',
      'Bright comet near Sun — tail stretching millions of kilometers, dust and ion tails, nucleus glowing, dramatic space astrophotography photoreal, NEOWISE style',
      'Comet Hale-Bopp at peak brightness — two tails visible, bright inner coma, 1997 historical photograph reproduction, night sky astrophotography photoreal',
      'Comet impact — comet Shoemaker-Levy 9 hitting Jupiter, string of nuclei, impact sites glowing on Jupiter cloud tops, Hubble historical photoreal composite',
      'Oort Cloud comet journey — distant icy body beginning fall toward inner solar system, outer solar system context, NASA conceptual photoreal illustration',
    ],
  },
  {
    keyword: 'big-bang',
    description: 'Big Bang and early universe',
    prompts: [
      'Big Bang — universe expanding from singularity, first moments of time and space, photon plasma ball expanding, NASA WMAP conceptual illustration photoreal',
      'Cosmic microwave background — WMAP or Planck satellite temperature map of early universe, multicolored oval temperature anisotropy, NASA science visualization',
      'Inflation epoch visualization — universe expanding exponentially in first fraction of second, quantum fluctuations becoming cosmic structure, NASA conceptual art',
      'Recombination epoch — universe cooling enough for hydrogen atoms to form, CMB photons released, foggy early universe becoming transparent, NASA illustration',
      'First stars Population III — massive metal-free stars lighting up dark universe for first time, 200 million years after Big Bang, NASA Hubble concept photoreal',
    ],
  },
  {
    keyword: 'black-hole-jet',
    description: 'Black hole relativistic jet',
    prompts: [
      'M87 black hole jet — famous Hubble image of relativistic plasma jet launching from supermassive black hole, blue synchrotron radiation, photoreal Hubble composite',
      'Blazar relativistic jet head-on — black hole jet pointing at Earth, bright point source, radio lobes expanding, NASA multiwavelength composite photoreal',
      'Cygnus A radio galaxy — two massive jets from central black hole inflating radio lobes into intergalactic medium, VLA radio and Chandra X-ray composite NASA',
      'Black hole jet formation — accretion disk and magnetic field launching relativistic jet, plasma funnel, NASA simulation rendering photoreal, astrophysics',
      'Centaurus A — nearest active galaxy with jet, optical Hubble and radio VLA composite, dust lane galaxy with black hole jets, photoreal NASA composite',
    ],
  },
  {
    keyword: 'star-forming',
    description: 'Star-forming region nebula',
    prompts: [
      'Carina Nebula star-forming region — turbulent nursery of thousands of new stars, cosmic cliffs, Eta Carinae, Hubble and JWST photoreal composite, dramatic',
      'Omega Nebula star formation — warm pink hydrogen with embedded hot blue stars, dark dust lanes, Hubble photoreal astrophotography, stellar nursery',
      'Proplyd protoplanetary disk — young star surrounded by planet-forming disk in Orion Nebula, Hubble photograph, future solar system in the making, photoreal',
      'T Tauri young stellar object — newly formed star with jets and disk, Herbig-Haro objects from polar jets, Hubble photoreal composite, star birth',
      'Rho Ophiuchi cloud complex — nearby star-forming region, colorful clouds orange blue, WISE NASA infrared composite, dramatic star nursery photoreal',
    ],
  },
  {
    keyword: 'space-telescope',
    description: 'Space telescopes and observatories',
    prompts: [
      'Chandra X-ray Observatory in orbit — cylindrical telescope body, solar panels, X-ray astronomy mission, NASA photoreal, science observatory portrait',
      'Spitzer Space Telescope infrared observatory — infrared-cooled spacecraft, solar panels, red telescope tube, NASA photoreal archival photograph',
      'XMM-Newton ESA X-ray telescope — European space telescope, three nested X-ray mirror modules, orbital illustration, ESA NASA photoreal',
      'TESS Transiting Exoplanet Survey Satellite — small spacecraft surveying 200,000 stars for exoplanets, four wide-field cameras, NASA photoreal illustration',
      'Roman Space Telescope Nancy Grace — future Hubble successor with 300x wider field, gigapixel camera, NASA photoreal concept art, next generation observatory',
    ],
  },
  {
    keyword: 'space-walk',
    description: 'Astronaut spacewalk EVA',
    prompts: [
      'Astronaut spacewalk above Earth — EVA suit tethered to ISS, Earth curvature below, solar panels visible, NASA photoreal photograph, dramatic orbital view',
      'Astronaut Hubble repair EVA — servicing mission spacewalk, blue Earth below, Hubble telescope being repaired, NASA archival photoreal photograph',
      'Astronaut floating free in space — EMU suit, Milky Way background, space shuttle in distance, NASA photoreal archival photograph, scale and isolation of space',
      'Astronaut on Moon surface — Apollo EVA, white suit, lunar landscape, Earth visible above horizon, NASA 1969 archival photoreal photograph style',
      'Astronaut with Earth terminator — morning and night divide visible below, astronaut in golden suit against dark space, NASA photoreal photography',
    ],
  },
  {
    keyword: 'planetary-nebula',
    description: 'Planetary nebula dying star shells',
    prompts: [
      "Ring Nebula M57 — planetary nebula shells of dying star, concentric rings, white dwarf at center, Hubble JWST composite photoreal, NGC 6720",
      "Helix Nebula — large nearby planetary nebula with knots and tendrils, eye of god appearance, Hubble and Spitzer composite photoreal, dramatic colors",
      "Blinking Planetary NGC 6826 — bright planetary nebula that blinks when you look away, central hot white dwarf, Hubble photoreal photograph style",
      "Cat Eye Nebula NGC 6543 — intricate concentric shells, bipolar jets, Chandra X-ray and Hubble optical composite, complex dying star, photoreal",
      "Butterfly Nebula NGC 6302 — extreme bipolar planetary nebula, 500,000 C white dwarf at center, beautiful wing-like structure, Hubble photoreal composite",
    ],
  },
  {
    keyword: 'moon-detail',
    description: 'Moon surface detail',
    prompts: [
      'Moon crater close-up — Tycho crater fresh rays visible, mountains central peak, lunar surface detail, Apollo photograph or LRO orbital photoreal',
      "Moon full disk — high detail lunar surface, maria and highlands, Earth reflected Earthshine, NASA Lunar Reconnaissance Orbiter photograph style, photoreal",
      'Lunar highlands terrain — ancient heavily cratered terrain, Apollo landing site region, NASA LRO photoreal photograph, sharp shadows on crater walls',
      'Moon and Earth together — full Moon with full Earth in background, comparative size, Lunar Reconnaissance Orbiter LROC photograph, photoreal documentary',
      "South Pole Aitken Basin — Moon's largest and oldest crater, permanently shadowed regions with ice, Artemis program landing target, NASA photoreal orbital",
    ],
  },
  {
    keyword: 'solar-flare',
    description: 'Solar flare and space weather',
    prompts: [
      'Solar flare eruption — massive plasma loop erupting from Sun surface, X-class flare, SDO Solar Dynamics Observatory photoreal UV photograph, dramatic',
      'Coronal mass ejection CME — billion-ton plasma cloud launched from Sun toward Earth, SOHO LASCO coronagraph photograph style, space weather NASA photoreal',
      'Sun surface prominences — huge plasma arches on solar limb, SDO AIA multi-wavelength composite, 100,000km tall loops, NASA photoreal space science',
      'Sunspot region active — dark sunspots surrounded by solar granulation, X-ray bright regions above, SDO HMI magnetogram composite, NASA photoreal',
      'Solar wind interaction with Earth magnetosphere — bow shock, magnetopause, aurora zone visible, NASA conceptual photoreal illustration, space weather system',
    ],
  },
  {
    keyword: 'asteroid',
    description: 'Asteroids and Near-Earth Objects',
    prompts: [
      'Asteroid Bennu close-up — boulder-covered carbonaceous asteroid surface, OSIRIS-REx sample return mission, NASA photoreal photograph, rocky alien world',
      'Asteroid Ryugu — diamond shaped spinning top asteroid, Hayabusa2 spacecraft sample collection, JAXA NASA photoreal photograph, ancient carbon-rich body',
      'Double asteroid Didymos and Dimorphos — DART mission impact test, spacecraft deflecting small moonlet, NASA photoreal illustration planetary defense',
      'Asteroid belt overview — rocky bodies between Mars and Jupiter, Ceres and Vesta dwarf planets visible, NASA Dawn spacecraft context, solar system map',
      'Near-Earth asteroid close flyby — large rocky body passing Earth, Moon orbit scale comparison, NASA artist concept photoreal, planetary defense monitoring',
    ],
  },
  {
    keyword: 'galaxy-types',
    description: 'Different galaxy morphologies',
    prompts: [
      'Sombrero Galaxy M104 — edge-on spiral with massive bulge and dust lane ring, Hubble photoreal photograph, stunning iconic galaxy portrait, photoreal detail',
      'Antennae galaxies NGC 4038 — two interacting spirals with tidal tails and starburst regions, Hubble photoreal composite, galaxy merger in progress',
      'Elliptical galaxy M87 — massive 6.5 trillion solar mass elliptical, jet visible, Virgo Cluster, Hubble Chandra composite photoreal, supergiant galaxy',
      'Whirlpool Galaxy M51 — face-on grand design spiral with companion galaxy, two spiral arms, Hubble photoreal classic photograph, stunning pinwheel structure',
      'Irregular galaxy Small Magellanic Cloud — chaotic dwarf galaxy with star-forming regions, southern sky companion to Milky Way, ESO photoreal astrophotography',
    ],
  },
  {
    keyword: 'cosmos-scale',
    description: 'Scale of the universe visualization',
    prompts: [
      'Powers of ten scale visualization — zooming from quarks to observable universe, nested scales, NASA educational illustration photoreal, cosmic scale concept',
      'Observable universe sphere — 93 billion light-year diameter bubble, galaxy distribution, Milky Way at center not center of universe, NASA conceptual photoreal',
      'Cosmic calendar — Carl Sagan concept showing Big Bang to present compressed to one year, human history tiny fraction, educational space visualization',
      'Light travel time map — spheres showing how far light has traveled from Earth in 1 year to 13.8 billion years, NASA conceptual illustration photoreal',
      'Hubble volume — boundary of observable universe, light cone expanding since Big Bang, spacetime diagram, NASA astrophysics conceptual illustration photoreal',
    ],
  },
  {
    keyword: 'space-exploration',
    description: 'History of space exploration',
    prompts: [
      'Space exploration timeline — Sputnik to Apollo to Space Shuttle to ISS to SpaceX, key spacecraft in order, NASA historical educational photoreal composite',
      'SpaceX Falcon 9 booster landing — rocket returning to pad at Cape Canaveral, flame and landing legs deployed, dramatic night launch photography photoreal',
      'Artemis SLS rocket launch — massive Space Launch System with solid boosters, first launch 2022, NASA archival photoreal photograph, Moon mission',
      'Mars 2020 Perseverance rover landing — skycrane lowering rover, red Martian surface approaching, NASA EDL system photoreal illustration dramatic',
      'James Webb deployment — telescope in transit to L2, mirror panels unfolding, sun shield layers separating, NASA photoreal animation keyframe illustration',
    ],
  },
  {
    keyword: 'heat-death',
    description: 'Universe end scenarios',
    prompts: [
      'Heat death of universe — last black holes evaporating via Hawking radiation, cold dark expanding cosmos, temperature approaching absolute zero, NASA conceptual art',
      'Big Rip end of universe — dark energy tearing apart galaxies then solar systems then atoms, accelerating expansion, NASA conceptual photoreal illustration',
      'Last stars dying — red dwarf stars billions of years old cooling and fading, final stellar light in aging universe, NASA conceptual photoreal illustration',
      'White dwarf stellar graveyard — cool degenerate stars scattered in dark expanding universe, no new star formation, NASA long-future conceptual photoreal',
      'Proton decay — last matter in universe decaying if protons are unstable, 10^34 year future, particle physics future universe, NASA conceptual illustration',
    ],
  },
  {
    keyword: 'pale-blue-dot',
    description: 'Earth from space perspective',
    prompts: [
      'Pale Blue Dot — Earth as tiny point of light in Voyager 1 1990 photograph, Sun rays crossing image, cosmic perspective on human civilization, NASA photoreal',
      'Earth from Saturn — Cassini spacecraft photograph of Earth and Moon visible beyond Saturn rings, pale blue dot in ring gap, NASA authentic photoreal 2013',
      'Earth from Moon Apollo — Earthrise photograph, blue marble rising over lunar horizon, 1968 William Anders photograph, NASA iconic photoreal reproduction',
      'Earth from deep space — entire planet as blue marble, oceans clouds continents visible, Apollo 17 style 1972 NASA photograph, full disk photoreal',
      'Solar system family portrait Voyager 1 — all planets visible as pale dots including Saturn with rings visible, 1990 Voyager mosaic NASA photoreal composite',
    ],
  },
];

// ─── FAL.AI IMAGE GENERATOR ──────────────────────────────────────────────────

async function generateImage(prompt, outputPath, retries = 5) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await axios.post(
        FLUX_URL,
        { prompt, image_size: 'landscape_16_9', num_images: 1, num_inference_steps: 4, enable_safety_checker: false },
        { headers: { Authorization: `Key ${FAL_KEY}`, 'Content-Type': 'application/json' }, timeout: 120000 },
      );
      const imageUrl = resp.data.images[0].url;
      const imgResp = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
      fs.writeFileSync(outputPath, Buffer.from(imgResp.data));
      return outputPath;
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const isTransient = err?.code === 'ETIMEDOUT' || err?.code === 'ECONNRESET' || status === 429 || (status >= 500);
      if (isTransient && attempt < retries) {
        const wait = 5000 * attempt;
        console.log(`    [Fal] Attempt ${attempt} failed (${err.message.slice(0,60)}), waiting ${wait/1000}s...`);
        await sleep(wait);
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  // Load existing v2 index if it exists
  let existingIndex = [];
  if (fs.existsSync(V2_INDEX)) {
    existingIndex = JSON.parse(fs.readFileSync(V2_INDEX, 'utf-8'));
  }
  const existingPaths = new Set(existingIndex.map(e => e.path));

  let totalGenerated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const newEntries = [];

  for (const subject of SUBJECTS) {
    const keyword = subject.keyword;
    const subjectDir = path.join(V2_DIR, keyword);
    fs.mkdirSync(subjectDir, { recursive: true });

    console.log(`\n[${keyword}] Generating ${subject.prompts.length} images...`);

    for (let i = 0; i < subject.prompts.length; i++) {
      const prompt = subject.prompts[i];
      const filename = `${keyword}-${String(i + 1).padStart(2, '0')}.jpg`;
      const outPath = path.join(subjectDir, filename);
      const relPath = path.relative(ROOT, outPath).replace(/\\/g, '/');

      // Skip if already generated
      if (existingPaths.has(relPath) && fs.existsSync(outPath)) {
        console.log(`  [${i+1}/${subject.prompts.length}] SKIP (exists): ${filename}`);
        totalSkipped++;
        continue;
      }

      try {
        console.log(`  [${i+1}/${subject.prompts.length}] Generating: ${filename}`);
        await generateImage(prompt, outPath);
        const sizeKB = Math.round(fs.statSync(outPath).size / 1024);
        console.log(`    ✓ Saved ${filename} (${sizeKB}KB)`);

        newEntries.push({
          path: relPath,
          keyword,
          description: subject.description,
          keywords: [keyword],
          prompt_index: i,
          generated: new Date().toISOString(),
        });
        existingPaths.add(relPath);
        totalGenerated++;

        // Brief pause to avoid rate limiting
        if (i < subject.prompts.length - 1) await sleep(500);
      } catch (err) {
        console.error(`    ✗ Error generating ${filename}: ${err.message}`);
        totalErrors++;
      }
    }
  }

  // Build final index combining old entries + new entries
  const finalIndex = [
    ...existingIndex.filter(e => existingPaths.has(e.path) || fs.existsSync(path.join(ROOT, e.path))),
    ...newEntries,
  ];

  // Remove duplicates
  const seen = new Set();
  const dedupedIndex = finalIndex.filter(e => {
    if (seen.has(e.path)) return false;
    seen.add(e.path);
    return true;
  });

  fs.writeFileSync(V2_INDEX, JSON.stringify(dedupedIndex, null, 2));

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const cost = (totalGenerated * 0.003).toFixed(3);

  console.log('\n' + '='.repeat(60));
  console.log('Space Library v2 Expansion Complete');
  console.log('='.repeat(60));
  console.log(`Generated: ${totalGenerated} images`);
  console.log(`Skipped:   ${totalSkipped} (already existed)`);
  console.log(`Errors:    ${totalErrors}`);
  console.log(`Cost:      ~$${cost}`);
  console.log(`Time:      ${elapsed}s`);
  console.log(`Index:     ${dedupedIndex.length} total entries`);
  console.log(`Output:    ${V2_DIR}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
