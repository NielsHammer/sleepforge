/**
 * Generate 500 Flux Schnell-ready space image prompts via Claude Sonnet.
 *
 * Usage:
 *   node scripts/generate-space-prompts.js
 *
 * Cost: ~$0.12 (Sonnet, 34 batches of 15)
 * Output: data/space-prompts.json
 * Resumable: skips entries that already have a flux_prompt.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { callClaudeCLI } from "../src/claude-cli.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_PATH = path.join(ROOT, "data", "space-prompts.json");
const MODEL = "claude-sonnet-4-6";
const BATCH_SIZE = 15;

// ─── 500 SCENE SEEDS ──────────────────────────────────────────────────────────

const SPACE_SCENES = [
  // ── Deep space phenomena (80) ─────────────────────────────────────────────
  // Black holes (20)
  { category: "deep_space", primary_subject: "black-hole", scene: "M87* supermassive black hole glowing accretion disk, dual plasma jets shooting light-years into space, first imaged black hole" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Cygnus X-1 stellar mass black hole pulling streams of gas from its blue supergiant companion star in binary orbit" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Sagittarius A* galactic center black hole surrounded by orbiting S-stars moving at fractions of light speed" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Two stellar mass black holes spiraling together moments before merger, gravitational spacetime warping intensifying" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Black hole event horizon silhouette against brilliant accretion disk glow, luminous photon ring visible" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Star being stretched and consumed in tidal disruption event, glowing debris spiral infalling" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Binary black hole system locked in slow orbital decay, gravitational wave emission rippling outward" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Hawking radiation particle-antiparticle pair creation at event horizon edge, virtual particles separating" },
  { category: "deep_space", primary_subject: "quasar", scene: "Quasar 3C 273 relativistic jet emerging from active galactic nucleus, extending millions of light-years" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Black hole polar magnetic field channels guiding plasma into narrow twin jets above and below accretion plane" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Intermediate mass black hole in dense star cluster core, surrounded by tightly orbiting ancient stars" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Rotating Kerr black hole ergosphere region, frame dragging effect visibly warping surrounding spacetime" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Supermassive black hole at elliptical galaxy core, broad-line emission region glowing in infrared" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Gravitational lensing arc around foreground black hole, background galaxy stretched into glowing arc" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Black hole accretion disk viewed edge-on, relativistic beaming brightening one side dramatically" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Photon sphere at 1.5 Schwarzschild radii around black hole, light orbiting endlessly just outside horizon" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Binary supermassive black holes in merged galaxy core, final parsec separation slowly decaying" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Approach to black hole event horizon, Einstein ring distortion at maximum lensing angle" },
  { category: "deep_space", primary_subject: "blazar", scene: "Blazar jet aimed directly at observer, doppler-boosted extreme brightness across gamma spectrum" },
  { category: "deep_space", primary_subject: "black-hole", scene: "Magnetosphere of spinning Kerr black hole, complex tangled magnetic field topology visualization" },
  // Nebulae (20)
  { category: "deep_space", primary_subject: "nebula", scene: "Pillars of Creation Eagle Nebula, five-light-year gas columns with protostar cocoons in JWST infrared palette" },
  { category: "deep_space", primary_subject: "nebula", scene: "Orion Nebula stellar nursery, four massive Trapezium stars illuminating surrounding gas and dust" },
  { category: "deep_space", primary_subject: "nebula", scene: "Crab Nebula supernova remnant, expanding shockwave filaments in reds and blues, central pulsar visible" },
  { category: "deep_space", primary_subject: "nebula", scene: "Helix Nebula planetary nebula concentric shells from dying star, Eye of God appearance from above" },
  { category: "deep_space", primary_subject: "nebula", scene: "Ring Nebula M57 in Lyra, glowing donut of expelled stellar material, faint white dwarf at center" },
  { category: "deep_space", primary_subject: "nebula", scene: "Butterfly Nebula NGC 6302, twin lobes of ionized gas from hypergiant protoplanetary nebula eruption" },
  { category: "deep_space", primary_subject: "nebula", scene: "Horsehead Nebula in Orion, iconic dark pillar silhouetted against glowing IC 434 emission background" },
  { category: "deep_space", primary_subject: "nebula", scene: "Rosette Nebula star cluster carving cavity in surrounding molecular cloud, young hot stars illuminating" },
  { category: "deep_space", primary_subject: "nebula", scene: "Cat's Eye Nebula NGC 6543, nested concentric shells of expelled stellar atmospheres in X-ray and optical" },
  { category: "deep_space", primary_subject: "nebula", scene: "Tarantula Nebula 30 Doradus in Large Magellanic Cloud, most active star-forming region in Local Group" },
  { category: "deep_space", primary_subject: "nebula", scene: "Veil Nebula supernova remnant filaments in Cygnus, delicate glowing threads spreading across degrees of sky" },
  { category: "deep_space", primary_subject: "nebula", scene: "Carina Nebula with Eta Carinae hypergiant, turbulent star-forming panorama of immense scale" },
  { category: "deep_space", primary_subject: "nebula", scene: "Mystic Mountain in Carina Nebula, three-light-year towering pillar of dense gas and dust in infrared" },
  { category: "deep_space", primary_subject: "nebula", scene: "Boomerang Nebula coldest natural object at 1 Kelvin, bipolar outflow from dying asymptotic giant" },
  { category: "deep_space", primary_subject: "nebula", scene: "Bubble Nebula NGC 7635, seven-light-year gas sphere blown by stellar wind from single massive star" },
  { category: "deep_space", primary_subject: "nebula", scene: "IC 1805 Heart Nebula, hot young OB stars carving glowing cavity in constellation Cassiopeia" },
  { category: "deep_space", primary_subject: "nebula", scene: "Trifid Nebula M20, three-lobed emission reflection and dark absorption regions simultaneously visible" },
  { category: "deep_space", primary_subject: "nebula", scene: "Lagoon Nebula M8 in Sagittarius, star-forming cloud with dark bok globule columns in emission" },
  { category: "deep_space", primary_subject: "nebula", scene: "Omega Nebula M17 massive pillars of star-forming gas, embedded cluster illuminating cloud interior" },
  { category: "deep_space", primary_subject: "nebula", scene: "California Nebula NGC 1499, glowing hydrogen filament stretched hundreds of light-years in Perseus" },
  // Supernovae (10)
  { category: "deep_space", primary_subject: "supernova", scene: "SN 1987A supernova in Large Magellanic Cloud, triple ring structure lit by expanding shockwave collision" },
  { category: "deep_space", primary_subject: "supernova", scene: "Tycho Supernova Remnant 1572 in X-ray, expanding bubble of hot shocked gas glowing across spectrum" },
  { category: "deep_space", primary_subject: "supernova", scene: "Cassiopeia A supernova remnant 300 years old, silicone-rich ejecta knots glowing in X-ray" },
  { category: "deep_space", primary_subject: "supernova", scene: "Core collapse supernova moment of explosion, shockwave breaking through stellar surface with light" },
  { category: "deep_space", primary_subject: "supernova", scene: "Type Ia white dwarf supernova ignition moment, thermonuclear runaway consuming entire star" },
  { category: "deep_space", primary_subject: "supernova", scene: "Kepler Supernova Remnant 1604, last naked-eye supernova seen from Earth expanding still today" },
  { category: "deep_space", primary_subject: "supernova", scene: "W44 pulsar wind nebula, neutron star wind inflating glowing bubble inside supernova remnant" },
  { category: "deep_space", primary_subject: "supernova", scene: "G292.0+1.8 oxygen-rich supernova remnant, young neutron star at center of structured ejecta" },
  { category: "deep_space", primary_subject: "supernova", scene: "Supernova shockwave rings expanding at tens of thousands of kilometers per second into surrounding ISM" },
  { category: "deep_space", primary_subject: "supernova", scene: "Supernova 2014J in M82 starburst galaxy, brilliant Type Ia point source amid dense galactic dust" },
  // Other deep space (30)
  { category: "deep_space", primary_subject: "magnetar", scene: "Magnetar SGR 1806-20 enormous X-ray flare, briefly outshining entire Milky Way for fractions of a second" },
  { category: "deep_space", primary_subject: "pulsar", scene: "Pulsar radio beam lighthouse sweeping interstellar medium, two cones of radiation from magnetic poles" },
  { category: "deep_space", primary_subject: "dark-matter", scene: "Dark matter web filaments connecting galaxy clusters, rendered visible through weak gravitational lensing" },
  { category: "deep_space", primary_subject: "gamma-ray-burst", scene: "Gamma ray burst GRB 080319B jet aimed toward Earth, brightest optical transient ever recorded" },
  { category: "deep_space", primary_subject: "kilonova", scene: "Kilonova GW170817 neutron star merger afterglow, r-process heavy element creation gold and platinum" },
  { category: "deep_space", primary_subject: "pulsar", scene: "Binary neutron star inspiral final seconds, gravitational wave emission tightening orbital decay" },
  { category: "deep_space", primary_subject: "stellar", scene: "Wolf-Rayet star WR 124 with surrounding nebula M1-67, extreme stellar wind bubble expanding" },
  { category: "deep_space", primary_subject: "stellar", scene: "Galactic center stellar nursery, dense OB stars orbiting within one light-year of Sgr A* black hole" },
  { category: "deep_space", primary_subject: "stellar", scene: "Luminous Blue Variable eruption, massive star shedding outer layers in giant historical eruption" },
  { category: "deep_space", primary_subject: "stellar", scene: "Population III first stars in early universe, metal-free massive stars illuminating primordial hydrogen gas" },
  { category: "deep_space", primary_subject: "galaxy", scene: "Galactic wind from starburst galaxy M82, superheated ionized gas plumes streaming kiloparsecs above disk" },
  { category: "deep_space", primary_subject: "dark-matter", scene: "Dark energy field abstract visualization, space visibly expanding between galaxy clusters on cosmic scale" },
  { category: "deep_space", primary_subject: "void", scene: "Cosmic void interior, vast emptiness hundreds of millions light-years across, faint filament walls at edge" },
  { category: "deep_space", primary_subject: "stellar", scene: "T Tauri protostellar disk in infrared, clearing surrounding cloud cocoon as young star ignites" },
  { category: "deep_space", primary_subject: "stellar", scene: "Herbig-Haro object HH 211, narrow protostellar jet piercing dark molecular cloud in Perseus" },
  { category: "deep_space", primary_subject: "stellar", scene: "AGB star asymptotic giant thermal pulse, carbon dredge-up glowing in circumstellar envelope" },
  { category: "deep_space", primary_subject: "microquasar", scene: "Microquasar Cygnus X-3 scaled radio jets in Milky Way, galactic-scale blazar in home galaxy" },
  { category: "deep_space", primary_subject: "stellar", scene: "Post-AGB proto-planetary nebula, rapid transition from red giant to white dwarf in millennia" },
  { category: "deep_space", primary_subject: "fast-radio-burst", scene: "Fast radio burst millisecond pulse crossing intergalactic megaparsecs, dispersion visible" },
  { category: "deep_space", primary_subject: "cosmic-web", scene: "Milky Way center infrared panorama, stellar populations dense bulge, dust clouds, ionized filaments" },
  { category: "deep_space", primary_subject: "stellar", scene: "Symbiotic nova outburst, red giant companion feeding white dwarf in wide binary system" },
  { category: "deep_space", primary_subject: "stellar", scene: "Young stellar cluster NGC 3603, massive OB stars in cluster illuminating surrounding HII region" },
  { category: "deep_space", primary_subject: "stellar", scene: "Herbig Ae/Be intermediate mass pre-main-sequence star, disk emission and surrounding reflection nebula" },
  { category: "deep_space", primary_subject: "stellar", scene: "Bok globule B68 dark absorbing cloud against background stars, stellar embryo hidden inside" },
  { category: "deep_space", primary_subject: "stellar", scene: "Runaway massive star zeta Ophiuchi, bow shock visible from stellar wind plowing through ISM" },
  { category: "deep_space", primary_subject: "pulsar", scene: "Rotating radio transient sparse pulses from neutron star, irregular emission pattern" },
  { category: "deep_space", primary_subject: "stellar", scene: "Be star with equatorial decretion disk, rapid rotation creating circumstellar ring in H-alpha" },
  { category: "deep_space", primary_subject: "stellar", scene: "FU Orionis outburst young star, accretion disk brightening dramatically over months" },
  { category: "deep_space", primary_subject: "cosmic-ray", scene: "Ultra-high energy cosmic ray primary particle entering atmosphere, extensive air shower cascade" },
  { category: "deep_space", primary_subject: "stellar", scene: "Carbon star CW Leo thick dust shell, carbon-rich evolved AGB star invisible in optical wavelengths" },

  // ── Planets and moons (80) ───────────────────────────────────────────────
  // Mercury (4)
  { category: "planetary", primary_subject: "mercury", scene: "Mercury heavily cratered surface from MESSENGER orbital panorama, blazing Sun enormous nearby" },
  { category: "planetary", primary_subject: "mercury", scene: "Mercury transit across solar disk 2016, tiny black dot crossing photosphere among sunspot fields" },
  { category: "planetary", primary_subject: "mercury", scene: "Caloris Basin Mercury 1500km impact scar, radial fractures and secondary crater chains visible" },
  { category: "planetary", primary_subject: "mercury", scene: "Mercury crescent in space, sunlit sliver against black sky, surface temperatures scorching on sunside" },
  // Venus (4)
  { category: "planetary", primary_subject: "venus", scene: "Venus upper atmosphere sulfuric acid cloud layers from Akatsuki orbit, swirling banded patterns" },
  { category: "planetary", primary_subject: "venus", scene: "Venus surface radar false-color map from Magellan, volcanic highlands and vast lava plains visible" },
  { category: "planetary", primary_subject: "venus", scene: "Venus thermal infrared glow at night, volcanic heat emanating through dense cloud deck" },
  { category: "planetary", primary_subject: "venus", scene: "Venus brilliant crescent in visible light, cloud tops against deep black space, brightest planet" },
  // Earth (5)
  { category: "planetary", primary_subject: "earth", scene: "Earth reentry view, plasma sheath glowing orange and white around spacecraft entering atmosphere" },
  { category: "planetary", primary_subject: "earth", scene: "Earth magnetic field Aurora Borealis from ISS over Canada, green curtains over darkened surface" },
  { category: "planetary", primary_subject: "earth", scene: "Earth crescent from cis-lunar space, thin blue atmospheric limb luminous against black sky" },
  { category: "planetary", primary_subject: "earth", scene: "Earth Mediterranean from ISS, recognizable coastlines Italy Greece, dust plumes over Sahara" },
  { category: "planetary", primary_subject: "earth", scene: "Earth city lights nightside, civilization network glowing rivers in darkness from above" },
  // Moon (5)
  { category: "planetary", primary_subject: "moon", scene: "Moon far side ancient highlands, heavily cratered terrain never directly visible from Earth" },
  { category: "planetary", primary_subject: "moon", scene: "Moon rising over Earth from ISS, crescent moon above cloud-covered terminator line" },
  { category: "planetary", primary_subject: "moon", scene: "Moon south polar Shackleton crater interior, permanently shadowed potential ice deposits inside" },
  { category: "planetary", primary_subject: "moon", scene: "Moon Tycho crater sunrise rays, bright ejecta rays extending thousands of kilometers from center" },
  { category: "planetary", primary_subject: "moon", scene: "Moon full disk from orbit, detailed near side topography, mare and highlands contrast" },
  // Mars (8)
  { category: "planetary", primary_subject: "mars", scene: "Olympus Mons from orbit, solar system tallest volcano 22km height, caldera complex at summit" },
  { category: "planetary", primary_subject: "mars", scene: "Valles Marineris canyon system from orbit, 4000km long 7km deep scar across Martian equator" },
  { category: "planetary", primary_subject: "mars", scene: "Mars global dust storm 2018, planet-encircling ochre veil obscuring surface features below" },
  { category: "planetary", primary_subject: "mars", scene: "Mars sunset blue twilight, iron dust particles scattering photons into blue dusk sky" },
  { category: "planetary", primary_subject: "mars", scene: "Curiosity rover at Gale Crater rim, Mt Sharp layered sediment record in background distance" },
  { category: "planetary", primary_subject: "mars", scene: "Mars ancient river delta in Jezero Crater, layered sediment fan from past flowing water" },
  { category: "planetary", primary_subject: "mars", scene: "Mars polar ice cap seasonal CO2 dry ice, spiral troughs carved by katabatic winds" },
  { category: "planetary", primary_subject: "mars", scene: "Phobos and Deimos tiny moons close approach, irregular captured asteroid bodies in Mars orbit" },
  // Jupiter (8)
  { category: "planetary", primary_subject: "jupiter", scene: "Jupiter Great Red Spot storm system from Juno close pass, intricate vortex turbulence structure" },
  { category: "planetary", primary_subject: "jupiter", scene: "Jupiter south polar aurora rings in ultraviolet, moon footprint auroras from Io Europa Ganymede" },
  { category: "planetary", primary_subject: "io", scene: "Io volcanic eruption Loki Patera active lava lake, sulfur plumes rising hundreds of kilometers" },
  { category: "planetary", primary_subject: "europa", scene: "Europa icy surface crisscrossing ridges and chaos terrain, hints of subsurface ocean below" },
  { category: "planetary", primary_subject: "ganymede", scene: "Ganymede magnetic field aurora Hubble ultraviolet, largest moon in solar system glowing" },
  { category: "planetary", primary_subject: "jupiter", scene: "Callisto ancient cratered dark surface with Valhalla multi-ring impact basin centered" },
  { category: "planetary", primary_subject: "jupiter", scene: "Jupiter south equatorial belt disruption, white oval formation emerging from disturbed cloud belt" },
  { category: "planetary", primary_subject: "jupiter", scene: "Jupiter faint ring system in infrared, backlit by Sun from Galileo spacecraft angle" },
  // Saturn (8)
  { category: "planetary", primary_subject: "saturn", scene: "Saturn rings edge-on ultra-thin plane, entire ring system visible as single thin luminous line" },
  { category: "planetary", primary_subject: "saturn", scene: "Saturn rings face-on from Cassini orbit, rainbow-gradient color from particle size sorting" },
  { category: "planetary", primary_subject: "saturn", scene: "Saturn hexagonal polar storm in infrared, stable geometric vortex at north pole" },
  { category: "planetary", primary_subject: "titan", scene: "Titan nitrogen-methane haze from Cassini, thick orange smog obscuring surface in visible light" },
  { category: "planetary", primary_subject: "enceladus", scene: "Enceladus south polar geysers plumes rising 200km, moon eclipsed against dark space" },
  { category: "planetary", primary_subject: "saturn", scene: "Saturn F ring braided structure, Prometheus shepherd moon creating waves and kinks" },
  { category: "planetary", primary_subject: "saturn", scene: "Saturn polar aurora ultraviolet glow, magnetic field lines guiding electron precipitation" },
  { category: "planetary", primary_subject: "saturn", scene: "Saturn Cassini Division dark gap between A and B rings, void carved by Mimas resonance" },
  // Uranus (3)
  { category: "planetary", primary_subject: "uranus", scene: "Uranus pale blue-green disk methane atmosphere, tilted ring system edge-on visible" },
  { category: "planetary", primary_subject: "uranus", scene: "Miranda Uranian moon with Verona Rupes cliff, tallest known cliff in solar system" },
  { category: "planetary", primary_subject: "uranus", scene: "Uranus magnetic field offset and tilted, complex interaction with solar wind visualized" },
  // Neptune (3)
  { category: "planetary", primary_subject: "neptune", scene: "Neptune Great Dark Spot storm vortex from Voyager 2 1989, temporary anticyclone" },
  { category: "planetary", primary_subject: "triton", scene: "Triton retrograde moon with nitrogen geysers, captured Kuiper belt object orbiting Neptune" },
  { category: "planetary", primary_subject: "neptune", scene: "Neptune thin ring system backlit by Sun from Voyager 2, Adams ring arc segments" },
  // Pluto (4)
  { category: "planetary", primary_subject: "pluto", scene: "Pluto Tombaugh Regio heart-shaped nitrogen ice plain, jagged water ice mountains at border" },
  { category: "planetary", primary_subject: "pluto", scene: "Pluto Tenzing Montes water ice mountains 3km high framing Sputnik Planitia edge" },
  { category: "planetary", primary_subject: "pluto", scene: "Charon with red Mordor Macula polar cap, Pluto rising above horizon over Serenity Chasma" },
  { category: "planetary", primary_subject: "pluto", scene: "Arrokoth Ultima Thule New Horizons flyby 2019, bilobed contact binary Kuiper belt object" },
  // Special moons (35)
  { category: "planetary", primary_subject: "europa", scene: "Europa subsurface ocean concept, hydrothermal vents on ocean floor beneath kilometers of ice" },
  { category: "planetary", primary_subject: "titan", scene: "Titan methane lake Ligeia Mare shoreline, liquid hydrocarbon sea reflecting nitrogen sky" },
  { category: "planetary", primary_subject: "enceladus", scene: "Enceladus tiger stripe fractures south pole cross-section, tidal heating mechanism" },
  { category: "planetary", primary_subject: "io", scene: "Io sulfur volcanic lava plain with active flows, Jupiter Io plasma torus glowing nearby" },
  { category: "planetary", primary_subject: "ganymede", scene: "Ganymede subsurface ocean stratigraphy diagram, largest known moon layers visualization" },
  { category: "planetary", primary_subject: "saturn", scene: "Mimas Death Star appearance Herschel crater, tiny icy moon dwarfed by Saturn rings" },
  { category: "planetary", primary_subject: "saturn", scene: "Tethys Ithaca Chasma, 2000km long canyon spanning nearly entire moon from Voyager" },
  { category: "planetary", primary_subject: "saturn", scene: "Hyperion sponge-like porous potato shaped moon, chaotic tumbling rotation in Saturn orbit" },
  { category: "planetary", primary_subject: "saturn", scene: "Iapetus two-tone hemisphere, dark carbon-rich leading face and bright trailing ice" },
  { category: "planetary", primary_subject: "saturn", scene: "Pan Saturn gap shepherd moon flying saucer shape, equatorial ridge from ring accretion" },
  { category: "planetary", primary_subject: "saturn", scene: "Prometheus F ring shepherd moon, gravitational channeling creating F ring spiral kinks" },
  { category: "planetary", primary_subject: "neptune", scene: "Triton slowly spiraling inward Neptune orbit, will become ring system in distant future" },
  { category: "planetary", primary_subject: "uranus", scene: "Oberon outermost large Uranian moon, ancient dark cratered surface mysterious origin" },
  { category: "planetary", primary_subject: "uranus", scene: "Titania Uranus largest moon, Messina Chasmata rift canyon system extending across surface" },
  { category: "planetary", primary_subject: "saturn", scene: "Phoebe Saturn captured retrograde moon, hints of Kuiper belt object origin from composition" },
  { category: "planetary", primary_subject: "mars", scene: "Deimos tiny irregular Martian moon from close orbit, smooth regolith-covered ancient asteroid" },
  { category: "planetary", primary_subject: "asteroid", scene: "Ceres bright Occator crater, sodium carbonate salt deposits from subsurface brine upwelling" },
  { category: "planetary", primary_subject: "asteroid", scene: "Vesta giant asteroid Rheasilvia basin, central peak tower revealing deep interior material" },
  { category: "planetary", primary_subject: "asteroid", scene: "Psyche metallic core asteroid, potential ancient iron-nickel planetary core exposed by collisions" },
  { category: "planetary", primary_subject: "asteroid", scene: "Bennu rubble pile asteroid OSIRIS-REx TAG sample collection contact, puff of material ejected" },
  { category: "planetary", primary_subject: "asteroid", scene: "Ryugu C-type diamond shape asteroid from Hayabusa2, 1km altitude detailed surface mapping" },
  { category: "planetary", primary_subject: "saturn", scene: "Methone Saturn egg-shaped moonlet, smooth surface suggesting fresh ice coating" },
  { category: "planetary", primary_subject: "pluto", scene: "Nix Pluto small moon tumbling chaotic rotation from New Horizons close pass" },
  { category: "planetary", primary_subject: "saturn", scene: "Rhea icy bright surface with Saturn rings and Titan visible in distance" },
  { category: "planetary", primary_subject: "saturn", scene: "Dione ice cliffs Padua Chasmata, bright wispy terrain on Saturn's fourth-largest moon" },
  { category: "planetary", primary_subject: "neptune", scene: "Proteus Neptune irregular dark moon, Voyager 2 encounter revealing pockmarked surface" },
  { category: "planetary", primary_subject: "saturn", scene: "Aegaeon Saturn ring-embedded tiny moonlet, faint G ring region visualization" },
  { category: "planetary", primary_subject: "jupiter", scene: "Amalthea innermost large Jupiter moon, red irregular body in intense radiation belt" },
  { category: "planetary", primary_subject: "uranus", scene: "Ariel brightest Uranian moon, heavily cratered terrain with smooth valley floors" },
  { category: "planetary", primary_subject: "mars", scene: "Phobos grooves from tidal stress, slow orbital decay bringing it toward Mars" },
  { category: "planetary", primary_subject: "pluto", scene: "Pluto nitrogen atmosphere haze layers from New Horizons backlit view, blue horizon rings" },
  { category: "planetary", primary_subject: "saturn", scene: "Saturn A ring density waves and spiral structure from Cassini VIMS spectrometer" },
  { category: "planetary", primary_subject: "jupiter", scene: "Jupiter system from afar, four Galilean moons in alignment visible from distance" },
  { category: "planetary", primary_subject: "saturn", scene: "Saturn F ring kink and clumps from Cassini, shepherded by Prometheus gravitational stirring" },
  { category: "planetary", primary_subject: "earth", scene: "Moon from lunar orbit, entire near side visible with Earth rising above horizon" },

  // ── Galaxies and clusters (60) ───────────────────────────────────────────
  // Milky Way (12)
  { category: "galactic", primary_subject: "milky-way", scene: "Milky Way galactic center infrared panorama, stellar populations in dense central bulge glow" },
  { category: "galactic", primary_subject: "milky-way", scene: "Milky Way arc over Atacama desert night sky, entire galaxy tilted overhead in deep darkness" },
  { category: "galactic", primary_subject: "milky-way", scene: "Milky Way spiral structure visualization, four main arms traced by HII regions and young stars" },
  { category: "galactic", primary_subject: "milky-way", scene: "Milky Way disk cross-section, thin disk and thick disk stellar populations in relief" },
  { category: "galactic", primary_subject: "milky-way", scene: "Milky Way warp in outer disk, bent by gravitational interaction with Magellanic Clouds" },
  { category: "galactic", primary_subject: "milky-way", scene: "Galactic center molecular cloud zone 50 parsecs from Sgr A*, dense gas reservoirs glowing" },
  { category: "galactic", primary_subject: "milky-way", scene: "Milky Way satellite dwarf galaxies overview, LMC SMC and faint spheroidals orbiting halo" },
  { category: "galactic", primary_subject: "globular-cluster", scene: "Globular cluster Omega Centauri NGC 5104, half million ancient stars in tight gravitational sphere" },
  { category: "galactic", primary_subject: "milky-way", scene: "Fermi bubbles two lobes extending 25000 light-years above galactic plane, gamma emission" },
  { category: "galactic", primary_subject: "milky-way", scene: "Milky Way central bar structure, inner ring resonance stellar orbits from above" },
  { category: "galactic", primary_subject: "globular-cluster", scene: "Globular cluster 47 Tucanae NGC 104, dense stellar city in Milky Way halo near SMC" },
  { category: "galactic", primary_subject: "milky-way", scene: "Milky Way from external vantage point concept, oblique top-down view showing spiral arms" },
  // Andromeda and Local Group (6)
  { category: "galactic", primary_subject: "andromeda", scene: "Andromeda Galaxy M31 full disk, dust lanes and satellite galaxies M32 and M110 nearby" },
  { category: "galactic", primary_subject: "andromeda", scene: "Andromeda dust lane infrared structure, inner spiral arm tracing through galaxy" },
  { category: "galactic", primary_subject: "galaxy", scene: "Triangulum Galaxy M33, third largest Local Group member face-on HII region rich" },
  { category: "galactic", primary_subject: "galaxy", scene: "Large Magellanic Cloud irregular galaxy, Tarantula Nebula prominent in star-forming region" },
  { category: "galactic", primary_subject: "galaxy", scene: "Small Magellanic Cloud, compact irregular galaxy Wing connecting to Magellanic Bridge" },
  { category: "galactic", primary_subject: "galaxy", scene: "Magellanic Stream neutral hydrogen gas bridge, trailing LMC SMC toward Milky Way" },
  // Spiral galaxies (10)
  { category: "galactic", primary_subject: "galaxy", scene: "M51 Whirlpool Galaxy interacting with companion NGC 5195, star-forming bridge connecting them" },
  { category: "galactic", primary_subject: "galaxy", scene: "NGC 1300 barred spiral perfect example, long central bar funneling gas toward nucleus" },
  { category: "galactic", primary_subject: "galaxy", scene: "M74 Phantom Galaxy NGC 628 JWST infrared, dust lanes and star-forming rings revealed" },
  { category: "galactic", primary_subject: "galaxy", scene: "M100 grand design spiral in Virgo Cluster, symmetric arms with bright HII regions" },
  { category: "galactic", primary_subject: "galaxy", scene: "M64 Black Eye Galaxy dark dust absorption band over bright nucleus, striking contrast" },
  { category: "galactic", primary_subject: "galaxy", scene: "M83 Southern Pinwheel southern hemisphere spiral, HII region rich with star formation" },
  { category: "galactic", primary_subject: "galaxy", scene: "NGC 6744 Milky Way twin in Pavo constellation, nearly identical spiral structure to home galaxy" },
  { category: "galactic", primary_subject: "galaxy", scene: "NGC 4622 peculiar galaxy counter-winding arms, reverse rotation evidence from Hubble" },
  { category: "galactic", primary_subject: "galaxy", scene: "M81 Bode Galaxy grand design spiral in Ursa Major, companion M82 nearby" },
  { category: "galactic", primary_subject: "galaxy", scene: "NGC 2903 isolated field spiral, massive central bar with active star-forming ends" },
  // Elliptical and mergers (6)
  { category: "galactic", primary_subject: "galaxy", scene: "M87 giant elliptical galaxy with relativistic jet extending 5000 light-years, Virgo Cluster dominant" },
  { category: "galactic", primary_subject: "galaxy", scene: "IC 1101 largest known galaxy, 6 million light-year diameter in center of Abell 2029 cluster" },
  { category: "galactic", primary_subject: "galaxy", scene: "Centaurus A NGC 5128 peculiar elliptical, dramatic dark dust lane from absorbed spiral galaxy" },
  { category: "galactic", primary_subject: "galaxy", scene: "NGC 1316 Fornax A elliptical with loop shells from ancient galactic merger history" },
  { category: "galactic", primary_subject: "galaxy", scene: "NGC 4889 brightest Coma Cluster galaxy, massive elliptical with ultramassive black hole" },
  { category: "galactic", primary_subject: "galaxy", scene: "M60 galaxy with ultra-compact dwarf companion in orbit, extreme galactic density" },
  // Galactic collisions (8)
  { category: "galactic", primary_subject: "galaxy-collision", scene: "Antennae Galaxies NGC 4038/4039 collision, tidal tails and super star clusters forming" },
  { category: "galactic", primary_subject: "galaxy-collision", scene: "NGC 7727 two galactic nuclei close together in final stages before black hole merger" },
  { category: "galactic", primary_subject: "galaxy-collision", scene: "Tadpole Galaxy ARP 188, enormous 280000 light-year tidal tail streaming behind disrupted galaxy" },
  { category: "galactic", primary_subject: "galaxy-collision", scene: "Mice Galaxies NGC 4676, two spirals in early interaction with parallel tidal tails extending" },
  { category: "galactic", primary_subject: "galaxy-collision", scene: "NGC 6240 triple nuclei system, two active black holes approaching merger in gas-rich merger" },
  { category: "galactic", primary_subject: "galaxy-collision", scene: "Stephan's Quintet compact group in Pegasus, ongoing high-speed collision shock heating visible" },
  { category: "galactic", primary_subject: "galaxy-collision", scene: "NGC 3921 post-merger shells, disrupted disk galaxy material orbiting new combined nucleus" },
  { category: "galactic", primary_subject: "andromeda", scene: "Andromeda Milky Way collision simulation 4 billion years future, overlapping spiral structure" },
  // Galaxy clusters (10)
  { category: "galactic", primary_subject: "galaxy-cluster", scene: "Virgo Cluster center region, M87 dominant with 2000+ galaxies visible in deep image" },
  { category: "galactic", primary_subject: "galaxy-cluster", scene: "Coma Cluster X-ray emission, hot intracluster medium glowing between galaxies" },
  { category: "galactic", primary_subject: "galaxy-cluster", scene: "Bullet Cluster 1E 0657-56, dark matter and hot gas separated after high-speed cluster merger" },
  { category: "galactic", primary_subject: "galaxy-cluster", scene: "El Gordo ACT-CL J0102 most massive cluster at cosmic noon, two subclusters colliding" },
  { category: "galactic", primary_subject: "galaxy-cluster", scene: "Perseus Cluster sound waves rippling outward through hot intracluster medium in X-ray" },
  { category: "galactic", primary_subject: "galaxy-cluster", scene: "Abell 1689 gravitational lens, over 100 arc images of background galaxies smeared around cluster" },
  { category: "galactic", primary_subject: "galaxy-cluster", scene: "Abell 2744 Pandora Box cluster merger, dark matter map from lensing around disturbed system" },
  { category: "galactic", primary_subject: "galaxy-cluster", scene: "MS0735 galaxy cluster with enormous radio cavities carved by AGN jets bubbling outward" },
  { category: "galactic", primary_subject: "galaxy-cluster", scene: "Fornax Cluster compact and nearby, NGC 1399 dominant cD galaxy at cluster center" },
  { category: "galactic", primary_subject: "galaxy-cluster", scene: "Abell 520 dark core enigma, dark matter apparently decoupled from galaxies after merger" },
  // Deep fields (8)
  { category: "deep_field", primary_subject: "deep-field", scene: "Hubble Deep Field 1995 discovery image, 3000 galaxies in 5.3 arcminute patch of empty sky" },
  { category: "deep_field", primary_subject: "deep-field", scene: "Hubble Ultra Deep Field 2004, 10000 galaxies spanning 13 billion years of cosmic history" },
  { category: "deep_field", primary_subject: "deep-field", scene: "Hubble Extreme Deep Field XDF 2012, 5500 galaxies in 2.4 arcminute patch near Orion" },
  { category: "deep_field", primary_subject: "deep-field", scene: "JWST First Deep Field July 2022, SMACS 0723 cluster lensing ancient background galaxies" },
  { category: "deep_field", primary_subject: "deep-field", scene: "JWST GLASS-z13 earliest confirmed galaxy, 300 million years after Big Bang first light" },
  { category: "deep_field", primary_subject: "deep-field", scene: "JWST Cosmic Cliffs NGC 3324, towering gas pillars in Carina revealed in infrared" },
  { category: "deep_field", primary_subject: "deep-field", scene: "Hubble Frontier Fields program cluster lens, dozens of distorted arcs from background galaxies" },
  { category: "deep_field", primary_subject: "deep-field", scene: "JWST early universe proto-cluster, galaxies assembling in cosmic dawn just after reionization" },

  // ── Stars and stellar (60) ───────────────────────────────────────────────
  // Sun (8)
  { category: "stellar", primary_subject: "sun", scene: "Sun solar surface granulation convection cells and sunspot active region in high resolution" },
  { category: "stellar", primary_subject: "sun", scene: "Sun prominence eruption, hot plasma loop arching 100000km above surface back to chromosphere" },
  { category: "stellar", primary_subject: "sun", scene: "Sun coronal mass ejection leaving solar disk, billion-ton cloud of plasma hurled into space" },
  { category: "stellar", primary_subject: "sun", scene: "Sun corona during total solar eclipse, streamers and polar plumes revealed by dark Moon" },
  { category: "stellar", primary_subject: "sun", scene: "Sun soft X-ray view, chromospheric network visible, dark coronal holes at poles" },
  { category: "stellar", primary_subject: "sun", scene: "Solar flare M-class event at chromosphere, magnetic reconnection brightening footpoints" },
  { category: "stellar", primary_subject: "sun", scene: "Sun during solar maximum, multiple active regions with complex sunspot groups" },
  { category: "stellar", primary_subject: "sun", scene: "Solar wind heliosphere bubble, heliopause boundary interaction with interstellar medium" },
  // Red giants and hypergiants (8)
  { category: "stellar", primary_subject: "red-giant", scene: "Betelgeuse variable supergiant with convection cells on surface from VLTI resolved imaging" },
  { category: "stellar", primary_subject: "red-giant", scene: "Mira Ceti long-period variable, enormous pulsating red giant with expelled mass shell" },
  { category: "stellar", primary_subject: "red-giant", scene: "VY Canis Majoris hypergiant, shedding mass at enormous rate forming dusty circumstellar nebula" },
  { category: "stellar", primary_subject: "red-giant", scene: "NML Cygni red hypergiant, one of largest stars by radius surrounded by ejected dust" },
  { category: "stellar", primary_subject: "red-giant", scene: "UY Scuti proposed largest star by volume, embedded in Milky Way inner region" },
  { category: "stellar", primary_subject: "red-giant", scene: "Antares supergiant with companion blue star orbit inside vastly expanded envelope" },
  { category: "stellar", primary_subject: "red-giant", scene: "Mu Cephei garnet star in OB association, deep red hue visible from surface temperature" },
  { category: "stellar", primary_subject: "red-giant", scene: "R Doradus nearest resolvable star disk other than Sun, resolved surface at Atacama" },
  // White dwarfs (5)
  { category: "stellar", primary_subject: "white-dwarf", scene: "Sirius B white dwarf companion, blue glare of Sirius A overwhelming tiny dense remnant" },
  { category: "stellar", primary_subject: "white-dwarf", scene: "WD 1145+017 white dwarf with disintegrating planet transiting, debris disk fragments" },
  { category: "stellar", primary_subject: "white-dwarf", scene: "White dwarf with orbiting asteroid debris disk, planetary remnants being tidally disrupted" },
  { category: "stellar", primary_subject: "white-dwarf", scene: "Cooling white dwarf sequence in cluster, different temperature colors blue to dull red" },
  { category: "stellar", primary_subject: "white-dwarf", scene: "Chandrasekhar limit approaching, white dwarf accreting from companion nearing critical threshold" },
  // Binary systems and novae (8)
  { category: "stellar", primary_subject: "binary-star", scene: "Eta Carinae binary system Homunculus Nebula, Great Eruption 1840 mass loss bipolar lobes" },
  { category: "stellar", primary_subject: "binary-star", scene: "SS 433 precessing relativistic jets corkscrew geometry, X-ray binary with accretion disk" },
  { category: "stellar", primary_subject: "binary-star", scene: "RS Ophiuchi recurrent nova eruption, white dwarf and red giant binary system outburst" },
  { category: "stellar", primary_subject: "binary-star", scene: "AM Canum Venaticorum ultracompact double white dwarf binary, 18-minute orbital period" },
  { category: "stellar", primary_subject: "binary-star", scene: "V404 Cygni X-ray nova outburst, black hole transient dramatically brightening" },
  { category: "stellar", primary_subject: "binary-star", scene: "T Pyxidis recurrent nova system, shells from previous eruptions layered around binary" },
  { category: "stellar", primary_subject: "binary-star", scene: "Algol eclipsing binary minimum, fainter subgiant partially eclipsing orange giant primary" },
  { category: "stellar", primary_subject: "binary-star", scene: "CH Cygni symbiotic star, red giant wind feeding white dwarf in wide 800-day orbit" },
  // Star formation (10)
  { category: "stellar", primary_subject: "star-formation", scene: "Bok globule B68 dark absorbing cloud against background stars, protostar hidden inside" },
  { category: "stellar", primary_subject: "star-formation", scene: "Herbig-Haro object HH 211 narrow jet, protostellar beam piercing dark cloud in Perseus" },
  { category: "stellar", primary_subject: "star-formation", scene: "Protoplanetary disk HL Tauri ALMA image, gap rings from planet formation already underway" },
  { category: "stellar", primary_subject: "star-formation", scene: "Rho Ophiuchi cloud complex stellar nursery, reflection and dark nebulae in visible and infrared" },
  { category: "stellar", primary_subject: "star-formation", scene: "Taurus molecular cloud filaments, hundreds of protostars at various development stages" },
  { category: "stellar", primary_subject: "star-formation", scene: "W5 ionized bubble, O star stellar wind sweeping clear cavity in molecular cloud wall" },
  { category: "stellar", primary_subject: "star-formation", scene: "Infrared dark cloud IRDC G11.11 dense cold filament, embedded protostars just igniting" },
  { category: "stellar", primary_subject: "star-formation", scene: "R136 super star cluster in 30 Doradus, most massive stars known crammed in one region" },
  { category: "stellar", primary_subject: "star-formation", scene: "IC 1396 Elephant Trunk Nebula, dark pillar in HII region with young stars forming inside" },
  { category: "stellar", primary_subject: "star-formation", scene: "Cepheus OB association, massive young stars dispersing natal molecular cloud complex" },
  // Other stellar (21)
  { category: "stellar", primary_subject: "variable-star", scene: "Cepheid variable pulsating, radius change over days linked to period-luminosity relation" },
  { category: "stellar", primary_subject: "variable-star", scene: "RR Lyrae horizontal branch star pulsating in globular cluster, standard candle timing" },
  { category: "stellar", primary_subject: "neutron-star", scene: "Millisecond pulsar recycled by accretion, fastest rotating neutron stars in universe" },
  { category: "stellar", primary_subject: "neutron-star", scene: "Magnetar XTE J1810-197 transient radio pulses, strongly magnetized neutron star" },
  { category: "stellar", primary_subject: "neutron-star", scene: "PSR B1919+21 first pulsar discovery, regular radio pulses arriving from neutron star" },
  { category: "stellar", primary_subject: "neutron-star", scene: "Neutron star merging inspiral Hulse-Taylor binary, orbital decay confirmed by timing" },
  { category: "stellar", primary_subject: "stellar", scene: "Be star with equatorial decretion disk, rapid rotation creating circumstellar emission ring" },
  { category: "stellar", primary_subject: "stellar", scene: "Wolf-Rayet star WR 104 pinwheel nebula, binary stellar wind collision spiral pattern" },
  { category: "stellar", primary_subject: "stellar", scene: "Blue straggler star in old cluster core, anomalously young appearance from mass transfer" },
  { category: "stellar", primary_subject: "stellar", scene: "Delta Scuti asteroseismology pulsating, multiple oscillation modes probing interior" },
  { category: "stellar", primary_subject: "stellar", scene: "Carbon star CW Leo IRC+10216, carbon-rich evolved AGB star with thick obscuring dust shell" },
  { category: "stellar", primary_subject: "stellar", scene: "Population II halo star with very low metallicity, born in first billion years of universe" },
  { category: "stellar", primary_subject: "stellar", scene: "Runaway star zeta Ophiuchi bow shock visible from stellar wind plowing through ISM" },
  { category: "stellar", primary_subject: "stellar", scene: "Solar twin 18 Scorpii, nearly identical parameters to our Sun found in Scorpius constellation" },
  { category: "stellar", primary_subject: "stellar", scene: "Lithium-rich giant star, anomalous abundance possibly from recently engulfed planet" },
  { category: "stellar", primary_subject: "stellar", scene: "Post-AGB star in rapid transition phase, outer layers expelled as inner core shrinks" },
  { category: "stellar", primary_subject: "stellar", scene: "Magnetar outburst burst forest, quasi-periodic oscillations from neutron star crust fracture" },
  { category: "stellar", primary_subject: "stellar", scene: "Massive star losing mass in LBV eruption, visible change over human lifetime" },
  { category: "stellar", primary_subject: "stellar", scene: "OH/IR star extreme mass loss, circumstellar envelope so thick star invisible optically" },
  { category: "stellar", primary_subject: "stellar", scene: "Thorne-Zytkow object concept, neutron star absorbed into red supergiant convective zone" },
  { category: "stellar", primary_subject: "stellar", scene: "Colliding stellar winds in massive binary, X-ray bright wind-wind collision zone" },

  // ── Telescopes and probes (40) ────────────────────────────────────────────
  { category: "telescope", primary_subject: "hubble", scene: "Hubble Space Telescope in orbit above Earth, solar panels extended, blue Earth below" },
  { category: "telescope", primary_subject: "jwst", scene: "James Webb Space Telescope at L2, 18 golden hexagonal mirror segments deployed cold" },
  { category: "telescope", primary_subject: "telescope", scene: "Chandra X-ray Observatory in high orbit, grazing incidence mirrors in spacecraft bay" },
  { category: "telescope", primary_subject: "telescope", scene: "Spitzer Space Telescope infrared, trailing Earth in solar orbit before decommission" },
  { category: "telescope", primary_subject: "telescope", scene: "Kepler space telescope pointing at Cygnus field, planet-hunting photometry mission" },
  { category: "telescope", primary_subject: "telescope", scene: "TESS satellite wide-field survey, four cameras covering southern sky for exoplanet transits" },
  { category: "telescope", primary_subject: "telescope", scene: "Fermi Gamma-ray Space Telescope, scanning all-sky for transients and blazars" },
  { category: "telescope", primary_subject: "telescope", scene: "XMM-Newton X-ray telescope in orbit, large multi-mirror collecting area for spectroscopy" },
  { category: "telescope", primary_subject: "telescope", scene: "Gaia astrometry satellite at L2, measuring billion-star parallaxes to map Milky Way" },
  { category: "telescope", primary_subject: "telescope", scene: "Nancy Roman Space Telescope concept art, wide-field infrared eye for dark energy survey" },
  { category: "probe", primary_subject: "voyager", scene: "Voyager 1 golden record panel in interstellar space, final image before cameras powered down" },
  { category: "probe", primary_subject: "voyager", scene: "Voyager 2 Neptune encounter 1989, closest approach revealing Great Dark Spot" },
  { category: "probe", primary_subject: "probe", scene: "Pioneer 10 in outer solar system with plaque silhouette, first spacecraft past asteroid belt" },
  { category: "probe", primary_subject: "cassini", scene: "Cassini Grand Finale Saturn atmospheric entry 2017, final plunge with instruments active" },
  { category: "probe", primary_subject: "new-horizons", scene: "New Horizons approaching Pluto July 2015, Tombaugh Regio heart visible in approach frame" },
  { category: "probe", primary_subject: "probe", scene: "Juno spacecraft polar Jupiter orbit, spinning instruments mapping magnetic field and gravity" },
  { category: "probe", primary_subject: "probe", scene: "Galileo probe entering Jupiter atmosphere 1995, parachute deployment in hydrogen cloud" },
  { category: "probe", primary_subject: "probe", scene: "MESSENGER Mercury orbit final days, low-altitude surface mapping before planned impact" },
  { category: "probe", primary_subject: "probe", scene: "Dawn ion propulsion leaving Vesta for Ceres, gentle thrust across asteroid belt" },
  { category: "probe", primary_subject: "probe", scene: "Hayabusa2 Ryugu sample return capsule entering Earth atmosphere, streaking fireball" },
  { category: "probe", primary_subject: "probe", scene: "OSIRIS-REx Bennu TAG contact sampling, puff of material ejected on touch" },
  { category: "probe", primary_subject: "probe", scene: "Parker Solar Probe closest solar approach, heat shield facing fierce radiation at 10 solar radii" },
  { category: "probe", primary_subject: "probe", scene: "BepiColombo dual spacecraft Mercury trajectory, solar array wings in cruise configuration" },
  { category: "probe", primary_subject: "probe", scene: "Europa Clipper concept art, ice-penetrating radar sweeping moon surface on flyby" },
  { category: "probe", primary_subject: "probe", scene: "Mars Science Laboratory Curiosity EDL sky crane, rover lowered to surface on cables" },
  { category: "probe", primary_subject: "probe", scene: "Dragonfly rotorcraft on Titan surface concept, methane lake shore in orange atmosphere" },
  { category: "probe", primary_subject: "probe", scene: "Perseverance Ingenuity helicopter first powered flight Mars, historic moment" },
  { category: "probe", primary_subject: "probe", scene: "InSight seismometer dome on Mars surface, detecting marsquakes from interior" },
  { category: "observatory", primary_subject: "observatory", scene: "VLT Very Large Telescope Paranal Chile, four unit telescopes under Milky Way" },
  { category: "observatory", primary_subject: "observatory", scene: "FAST Five-hundred-meter Aperture Spherical Telescope China, world's largest radio dish" },
  { category: "observatory", primary_subject: "observatory", scene: "ELT Extremely Large Telescope under construction Chile, 39m primary mirror framework" },
  { category: "observatory", primary_subject: "observatory", scene: "LIGO Hanford interferometer aerial view, two 4km arms perfectly perpendicular in desert" },
  { category: "observatory", primary_subject: "observatory", scene: "IceCube Neutrino Observatory Antarctic ice, drill holes with sensor strings deployed" },
  { category: "observatory", primary_subject: "observatory", scene: "ALMA array Atacama plateau Chile, 66 antennas in formation at 5000m altitude" },
  { category: "observatory", primary_subject: "observatory", scene: "Keck twin telescope domes Mauna Kea summit, laser adaptive optics star visible" },
  { category: "observatory", primary_subject: "observatory", scene: "SKA Square Kilometre Array concept, thousands of low-frequency dipoles in Australian field" },
  { category: "telescope", primary_subject: "telescope", scene: "AMS-02 Alpha Magnetic Spectrometer on ISS exterior, particle detector in vacuum" },
  { category: "telescope", primary_subject: "telescope", scene: "NuSTAR hard X-ray focusing telescope, segmented mirror technology in low orbit" },
  { category: "telescope", primary_subject: "telescope", scene: "Planck satellite at L2, CMB temperature anisotropy all-sky measurement" },
  { category: "telescope", primary_subject: "telescope", scene: "Herschel far-infrared observatory L2, cold instrument detecting cold dust in galaxies" },

  // ── Astronauts and missions (40) ─────────────────────────────────────────
  { category: "astronaut", primary_subject: "spacewalk", scene: "Hubble Space Telescope servicing EVA, astronaut replacing Wide Field Camera in payload bay" },
  { category: "astronaut", primary_subject: "spacewalk", scene: "ISS main truss EVA, astronaut dwarfed by enormous solar array structure against Earth" },
  { category: "astronaut", primary_subject: "spacewalk", scene: "Gemini 12 Buzz Aldrin spacewalk 1966, handrails and foot restraints enabling first successful EVA" },
  { category: "astronaut", primary_subject: "spacewalk", scene: "McCandless MMU untethered spacewalk 1984, first astronaut floating freely 300 feet from Challenger" },
  { category: "astronaut", primary_subject: "moon-landing", scene: "Apollo 15 David Scott lunar surface salute, rover in background, Hadley Rille mountain beyond" },
  { category: "astronaut", primary_subject: "spacewalk", scene: "Astronaut in ISS cupola photographing Earth, blue marble compressed in fisheye view" },
  { category: "astronaut", primary_subject: "spacewalk", scene: "Astronaut on ISS truss assembly EVA, working in vacuum above sunlit cloud-covered Earth" },
  { category: "astronaut", primary_subject: "mars-mission", scene: "Mars surface EVA concept, pressurized suit against pink sky, Perseverance rover nearby" },
  { category: "astronaut", primary_subject: "apollo", scene: "Apollo 11 lunar module Eagle descending toward Moon, Columbia orbiting above" },
  { category: "astronaut", primary_subject: "moon-landing", scene: "Buzz Aldrin bootprint in lunar regolith 1969, first human footprint on another world" },
  { category: "astronaut", primary_subject: "moon-landing", scene: "Apollo 17 Harrison Schmitt last human on Moon sampling orange soil at Shorty Crater" },
  { category: "astronaut", primary_subject: "apollo", scene: "Apollo 13 service module oxygen tank explosion damage, venting to space from Odyssey view" },
  { category: "astronaut", primary_subject: "moon-landing", scene: "Apollo 8 Earthrise photograph 1968, first color image of Earth rising over lunar horizon" },
  { category: "astronaut", primary_subject: "apollo", scene: "Apollo command module reentry, glowing heat shield contrail over Pacific recovery zone" },
  { category: "astronaut", primary_subject: "apollo", scene: "Mission control Apollo 11 celebration, controllers cheering at consoles, cigars lit" },
  { category: "astronaut", primary_subject: "moon-landing", scene: "Apollo lunar surface experiment ALSEP deployment, astronaut at seismometer setup" },
  { category: "astronaut", primary_subject: "apollo", scene: "Lunar module ascent stage firing from surface, plume against black lunar sky" },
  { category: "astronaut", primary_subject: "moon-landing", scene: "Charlie Duke young family photo left on lunar surface, still lying there undisturbed" },
  { category: "astronaut", primary_subject: "apollo", scene: "Apollo 16 Young Mattingly lunar orbit rendezvous, command module above crater-pocked surface" },
  { category: "astronaut", primary_subject: "moon-landing", scene: "Apollo 11 Neil Armstrong in lunar module window, Earth visible over shoulder through glass" },
  { category: "astronaut", primary_subject: "iss", scene: "ISS cupola observation window, astronaut floating looking down at Pacific Ocean" },
  { category: "astronaut", primary_subject: "iss", scene: "ISS interior Columbus module, experiment racks and tools floating in microgravity" },
  { category: "astronaut", primary_subject: "iss", scene: "ISS solar panel sunrise silhouette, orbital sunset lighting the long truss golden" },
  { category: "astronaut", primary_subject: "iss", scene: "Soyuz capsule docking approach to ISS, docking camera view of berthing ring" },
  { category: "astronaut", primary_subject: "iss", scene: "Dragon Crew capsule approach docking ISS from below, station growing larger" },
  { category: "astronaut", primary_subject: "iss", scene: "Astronaut sleeping anchored to ISS wall, sleeping bag hovering in free fall" },
  { category: "astronaut", primary_subject: "iss", scene: "ISS Harmony node interior passageway, connecting laboratory modules in orbital outpost" },
  { category: "astronaut", primary_subject: "iss", scene: "ISS full station from SpaceX Dragon, entire complex visible against blue Earth" },
  { category: "astronaut", primary_subject: "mars-mission", scene: "Curiosity arm deployment Mars Gale Crater, Mt Sharp layered sediment record close" },
  { category: "astronaut", primary_subject: "mars-mission", scene: "Opportunity rover Victoria Crater rim overlook, 750m diameter ancient impact" },
  { category: "astronaut", primary_subject: "mars-mission", scene: "Viking 1 first Mars surface panorama 1976, alien russet sky at sunset" },
  { category: "astronaut", primary_subject: "future-mission", scene: "Artemis crewed lunar south pole landing concept, permanently shadowed crater nearby" },
  { category: "astronaut", primary_subject: "future-mission", scene: "Gateway lunar orbital station concept, capsule docking above Moon surface" },
  { category: "astronaut", primary_subject: "future-mission", scene: "Mars crewed mission surface habitat, pressurized greenhouse solar panels on red surface" },
  { category: "astronaut", primary_subject: "future-mission", scene: "Starship lunar lander on Moon concept, retro-futuristic landing legs on regolith" },
  { category: "astronaut", primary_subject: "future-mission", scene: "O Neill cylinder habitat interior, sunlight streaming through axial windows of space colony" },
  { category: "astronaut", primary_subject: "future-mission", scene: "Generation ship interstellar ark deep space, multi-generational voyage vessel" },
  { category: "astronaut", primary_subject: "future-mission", scene: "Asteroid mining operation, heavy machinery on carbonaceous chondrite surface" },
  { category: "astronaut", primary_subject: "future-mission", scene: "Mars terraforming early stage concept, green patches emerging from dust on surface" },
  { category: "astronaut", primary_subject: "future-mission", scene: "Dyson swarm fragment around Sun, partial energy-harvesting megastructure ring segment" },

  // ── Cosmic structure (40) ────────────────────────────────────────────────
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "Cosmic web Millennium Simulation filaments, galaxy clusters at nodes connected by dark matter threads" },
  { category: "cosmic_structure", primary_subject: "void", scene: "Intergalactic void center visualization, bubble-like emptiness 300 million light-years across" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "Laniakea supercluster visualization, Milky Way on periphery of 500 million light-year structure" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "Perseus-Pisces supercluster filament, chain of galaxy clusters in Perseus constellation" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "Great Attractor direction toward Norma Cluster, invisible mass anomaly pulling Local Group" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "Baryon acoustic oscillation imprint visualization, standard ruler in galaxy distribution" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "SDSS galaxy redshift survey 3D map, cosmic web slice through observable universe" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "Milky Way local sheet visualization, flat arrangement of nearby galaxies on cosmic scale" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "Cosmic filament cross-section, galaxies aligned along dark matter thread between clusters" },
  { category: "cosmic_structure", primary_subject: "observable-universe", scene: "Observable universe boundary sphere, maximum extent of light that could have reached us" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Einstein ring perfect alignment, quasar lens galaxy and observer in exact line" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Giant gravitational arc blue galaxy stretched around red foreground cluster" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Einstein Cross quadruple quasar image, four point sources around gravitational lens" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Abell 2744 Pandora cluster strong lensing, dozens of arcs from background galaxies" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Microlensing event light curve, background star brightened by unseen foreground object" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Abell 2218 strong lens, hundreds of lensed arcs multiple colors surrounding cluster" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Time delay lensing quasar, same quasar imaged at different lookback times simultaneously" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Dark matter substructure lensing, smooth gravitational arc perturbed by invisible clump" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "CMB gravitational lensing signal, large-scale structure imprinting on microwave background" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Galaxy-galaxy lensing ring, tangential alignment of background sources around lens" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Cluster lensing magnification, background galaxy appearing dozens of times brighter" },
  { category: "cosmic_structure", primary_subject: "gravitational-lensing", scene: "Flux ratio anomaly in quad lens, dark matter subhalo causing deviation from smooth model" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "2dF Galaxy Redshift Survey completion image, two-degree field redshift boundaries in 3D" },
  { category: "cosmic_structure", primary_subject: "cmb", scene: "Cosmic microwave background Planck 2018, tiny temperature anisotropies all-sky map" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "BAO acoustic peak in galaxy correlation function at 490 million light-year scale" },
  { category: "cosmic_structure", primary_subject: "cmb", scene: "Sunyaev-Zel'dovich effect cluster detection, CMB decrement from hot intracluster electrons" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "Integrated Sachs-Wolfe effect, CMB photons gaining energy from decaying gravitational potentials" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "Redshift space distortions, galaxy peculiar velocities creating fingers of god elongation" },
  { category: "cosmic_structure", primary_subject: "dark-energy", scene: "Dark energy acceleration discovery 1998, Type Ia supernovae dimmer than expected at distance" },
  { category: "cosmic_structure", primary_subject: "dark-energy", scene: "Hubble tension two measurements disagreeing, CMB versus distance ladder discrepancy" },
  { category: "cosmic_structure", primary_subject: "cosmology", scene: "Inflation field quantum fluctuations, microscopic seeds of all large-scale structure" },
  { category: "cosmic_structure", primary_subject: "cosmology", scene: "Bubble universes eternal inflation, pocket universes nucleating in inflationary background" },
  { category: "cosmic_structure", primary_subject: "cosmology", scene: "Penrose conformal cyclic cosmology, previous eons cycling through Big Bangs" },
  { category: "cosmic_structure", primary_subject: "cosmology", scene: "Loop quantum gravity spin network, discrete spacetime at Planck scale abstract visualization" },
  { category: "cosmic_structure", primary_subject: "cosmology", scene: "String theory extra dimension Calabi-Yau manifold, compact geometry at every point in space" },
  { category: "cosmic_structure", primary_subject: "cosmology", scene: "Holographic principle AdS/CFT, information on cosmic boundary encoding interior volume" },
  { category: "cosmic_structure", primary_subject: "entropy", scene: "Arrow of time second law entropy increasing, disorder growing from Big Bang forward" },
  { category: "cosmic_structure", primary_subject: "cosmology", scene: "Causal structure Penrose diagram, entire spacetime history compressed in compact triangle" },
  { category: "cosmic_structure", primary_subject: "cosmology", scene: "Power spectrum of galaxy clustering, comparison with theoretical model predictions" },
  { category: "cosmic_structure", primary_subject: "cosmic-web", scene: "Observable universe structure nested spheres, shells representing lookback time in light" },

  // ── Solar system events (40) ─────────────────────────────────────────────
  { category: "solar_system", primary_subject: "eclipse", scene: "Total solar eclipse corona revealed, streamers and prominences around dark disk" },
  { category: "solar_system", primary_subject: "eclipse", scene: "Annular solar eclipse ring of fire, Moon too far to cover entire solar disk" },
  { category: "solar_system", primary_subject: "eclipse", scene: "Total lunar eclipse blood moon, reddened by Earth atmospheric shadow" },
  { category: "solar_system", primary_subject: "eclipse", scene: "Mercury transit 2016 across solar disk, tiny black dot among sunspot fields" },
  { category: "solar_system", primary_subject: "eclipse", scene: "Venus transit 2012 last until 2117, larger black dot with atmospheric aureole rim" },
  { category: "solar_system", primary_subject: "eclipse", scene: "Total solar eclipse from ISS altitude, Moon shadow cone on Earth surface below" },
  { category: "solar_system", primary_subject: "eclipse", scene: "Diamond ring effect at second contact, Baily's beads and chromosphere flash" },
  { category: "solar_system", primary_subject: "eclipse", scene: "Penumbral lunar eclipse subtle darkening, partial entry into Earth umbra and penumbra" },
  { category: "solar_system", primary_subject: "aurora", scene: "Aurora borealis from ISS night pass, curtains of green and red over dark Canada" },
  { category: "solar_system", primary_subject: "aurora", scene: "Aurora australis southern lights from orbit, glowing oval ring over Antarctic continent" },
  { category: "solar_system", primary_subject: "aurora", scene: "Jupiter auroral oval rings ultraviolet Hubble, moon footprint auroras from Io" },
  { category: "solar_system", primary_subject: "aurora", scene: "Saturn auroral rings ultraviolet Cassini, polar auroras driven by solar wind interaction" },
  { category: "solar_system", primary_subject: "aurora", scene: "Ganymede ultraviolet aurora JWST discovery, rocking motion confirms subsurface ocean" },
  { category: "solar_system", primary_subject: "comet", scene: "Comet Halley 1986 Giotto encounter, dusty peanut-shaped nucleus with active jets" },
  { category: "solar_system", primary_subject: "comet", scene: "Comet Hale-Bopp 1997 double tail, blue ion and white dust tails diverging" },
  { category: "solar_system", primary_subject: "comet", scene: "Comet NEOWISE 2020 seen from ISS, long dust tail curving over Earth limb" },
  { category: "solar_system", primary_subject: "comet", scene: "Comet 67P Churyumov-Gerasimenko Rosetta orbit, nucleus jets active in close view" },
  { category: "solar_system", primary_subject: "comet", scene: "Comet Shoemaker-Levy 9 fragment train aligned for Jupiter impact 1994" },
  { category: "solar_system", primary_subject: "meteor", scene: "Perseid meteor shower streaks from ISS altitude, flashes entering atmosphere below" },
  { category: "solar_system", primary_subject: "meteor", scene: "Leonid 1999 storm hundreds per minute, historic peak over Pacific darkness" },
  { category: "solar_system", primary_subject: "meteor", scene: "Chelyabinsk meteor entry contrail 2013, long bright streak over Russian landscape" },
  { category: "solar_system", primary_subject: "meteor", scene: "Meteor impact flash on lunar dark side, brief brilliant point in permanent shadow" },
  { category: "solar_system", primary_subject: "comet", scene: "Comet ion tail pointing exactly away from Sun, plasma driven by solar wind" },
  { category: "solar_system", primary_subject: "solar-system", scene: "Planetary alignment five planets in evening sky, rare multi-world conjunction" },
  { category: "solar_system", primary_subject: "saturn", scene: "Saturn ring plane crossing from Earth, rings vanishing as edge-on view passes through" },
  { category: "solar_system", primary_subject: "solar-system", scene: "Jupiter retrograde arc motion, planet reversing direction over months in sky" },
  { category: "solar_system", primary_subject: "asteroid", scene: "Trojan asteroid clouds at Jupiter L4 L5 points, 7000 asteroids at Lagrange" },
  { category: "solar_system", primary_subject: "asteroid", scene: "Kuiper belt object distribution beyond Neptune, scattered disk inclinations visualized" },
  { category: "solar_system", primary_subject: "solar-system", scene: "Oort cloud comet reservoir, spherical halo trillion objects extending light-year radius" },
  { category: "solar_system", primary_subject: "solar-system", scene: "Solar system barycenter wobble, Sun moving around center of mass with Jupiter" },
  { category: "solar_system", primary_subject: "solar-system", scene: "Zodiacal light pre-dawn cone, sunlight scattered by interplanetary dust toward ecliptic" },
  { category: "solar_system", primary_subject: "solar-system", scene: "Gegenschein antisolar glow, interplanetary dust backscattering at opposition point" },
  { category: "solar_system", primary_subject: "earth-atmosphere", scene: "Noctilucent clouds at mesosphere altitude, electric blue ice clouds at 80km" },
  { category: "solar_system", primary_subject: "earth-atmosphere", scene: "Sprite lightning from above, transient luminous event above thunderstorm from orbit" },
  { category: "solar_system", primary_subject: "earth-atmosphere", scene: "Earth upper atmosphere limb airglow, molecular emission layers at 90 to 100km" },
  { category: "solar_system", primary_subject: "moon", scene: "Moonrise over Earth terminator, Moon emerging as Earth rotates below" },
  { category: "solar_system", primary_subject: "moon", scene: "Earthshine on crescent Moon, sunlit Earth illuminating the dark side of young Moon" },
  { category: "solar_system", primary_subject: "moon", scene: "Lunar libration monthly rocking, revealing more than half of Moon surface over time" },
  { category: "solar_system", primary_subject: "aurora", scene: "Io plasma torus ultraviolet glow, sulfur ions trapped in Jupiter magnetosphere" },
  { category: "solar_system", primary_subject: "solar-system", scene: "Heliosphere bubble boundary at interstellar medium, termination shock visualization" },

  // ── Conceptual and abstract (40) ─────────────────────────────────────────
  { category: "conceptual", primary_subject: "black-hole", scene: "Information paradox at event horizon, quantum information firewall debate visualization" },
  { category: "conceptual", primary_subject: "black-hole", scene: "Hawking radiation particle-antiparticle pair creation at event horizon, virtual particles separating" },
  { category: "conceptual", primary_subject: "black-hole", scene: "Ergosphere of Kerr black hole, frame dragging effect Penrose process energy extraction" },
  { category: "conceptual", primary_subject: "black-hole", scene: "Spaghettification of infalling observer at stellar mass black hole horizon, tidal stretching" },
  { category: "conceptual", primary_subject: "gravitational-wave", scene: "Black hole merger final inspiral, plus and cross gravitational wave polarization expanding" },
  { category: "conceptual", primary_subject: "black-hole", scene: "Photon sphere at 1.5 Schwarzschild radii, light spiraling multiple orbits before escape" },
  { category: "conceptual", primary_subject: "black-hole", scene: "Cauchy horizon inside charged black hole, inner horizon instability and spacetime structure" },
  { category: "conceptual", primary_subject: "wormhole", scene: "Einstein-Rosen bridge wormhole interior topology, two entrances through black holes" },
  { category: "conceptual", primary_subject: "wormhole", scene: "Traversable wormhole Kip Thorne concept, throat stabilized by exotic negative energy" },
  { category: "conceptual", primary_subject: "wormhole", scene: "Wormhole spacetime embedding diagram, two curved bowls connected by cylindrical throat" },
  { category: "conceptual", primary_subject: "wormhole", scene: "Inter-universe wormhole connecting separate spacetimes, baby universe budding off" },
  { category: "conceptual", primary_subject: "wormhole", scene: "Alcubierre warp drive metric, spacetime compression ahead and expansion behind vessel" },
  { category: "conceptual", primary_subject: "time-dilation", scene: "Twin paradox visualization, one twin on Earth and one returning from relativistic journey" },
  { category: "conceptual", primary_subject: "time-dilation", scene: "Gravitational time dilation near neutron star, clocks running visibly slower in deep gravity" },
  { category: "conceptual", primary_subject: "time-dilation", scene: "Spacetime curvature rubber sheet analogy, massive objects creating gravity wells in fabric" },
  { category: "conceptual", primary_subject: "time-dilation", scene: "Length contraction relativistic, measuring rod visibly compressed in direction of motion" },
  { category: "conceptual", primary_subject: "time-dilation", scene: "Frame dragging Gravity Probe B gyroscopes, slow precession from rotating Earth spacetime" },
  { category: "conceptual", primary_subject: "gravitational-wave", scene: "Gravitational wave interference LIGO detection, spacetime ripple interferometer signal" },
  { category: "conceptual", primary_subject: "time-dilation", scene: "Light cone structure in curved spacetime, future and past cones distorted near black hole" },
  { category: "conceptual", primary_subject: "time-dilation", scene: "Penrose-Terrell rotation optical distortion, fast-moving sphere appearing rotated" },
  { category: "conceptual", primary_subject: "multiverse", scene: "Many-worlds quantum branching, universe splitting at quantum measurement event" },
  { category: "conceptual", primary_subject: "multiverse", scene: "Eternal inflation bubble nucleation, pocket universes emerging with different physical constants" },
  { category: "conceptual", primary_subject: "quantum", scene: "Quantum superposition abstract, probability amplitude wave function before measurement" },
  { category: "conceptual", primary_subject: "quantum", scene: "Quantum entanglement Bell pair, correlated particles separated by vast astronomical distance" },
  { category: "conceptual", primary_subject: "quantum", scene: "Decoherence wave function collapse, quantum-to-classical transition at macroscopic boundary" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Anthropic principle fine-tuning, narrow range of constants allowing complex structures to exist" },
  { category: "conceptual", primary_subject: "multiverse", scene: "String theory landscape vast vacua, different physical constants in each bubble universe" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Loop quantum gravity discrete spacetime, atoms of space at Planck length visualization" },
  { category: "conceptual", primary_subject: "entropy", scene: "Heat death of universe far future, maximum entropy dark cold final state of cosmos" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Big Rip phantom dark energy, expansion accelerating until tearing apart atoms themselves" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Big Bounce cyclic cosmology, universe collapsing and rebounding from previous cycle" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Conformal cyclic cosmology Penrose, Hawking radiation circles of previous aeons on CMB" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Simulation hypothesis digital grid, fundamental resolution of physical space as computation" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Fermi paradox Great Silence, radio telescope scanning empty sky for no signal" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Drake equation parameter space, each factor of cosmic life probability visualized" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Kardashev Type III civilization energy scale, Dyson sphere galactic energy use" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Cosmic calendar Sagan all history in one year, humans arriving at December 31" },
  { category: "conceptual", primary_subject: "quantum", scene: "Quantum gravity foam Planck scale, spacetime discrete at 10 to the minus 35 meters" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Observable universe light cone, maximum causal contact boundary from Big Bang forward" },
  { category: "conceptual", primary_subject: "cosmology", scene: "Arrow of time entropy increasing, disorder growing irreversibly from hot dense beginning" },

  // ── Earth from space (20) ────────────────────────────────────────────────
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth full disk Apollo 17 Blue Marble 1972, entire sphere in sunlight below crew" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth thin atmospheric limb crescent, fragile blue shell visible from 400km altitude" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth nightside city lights composite mosaic, civilization network glowing below" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth hurricane Irma eye from ISS, perfect spiral structure with clear central eye" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Amazon river braiding from Landsat orbit, green rainforest on both banks" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Himalayan shadow at dawn from ISS, mountain chain shadow extending across plains" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Sahara desert sand dunes from orbit, geometric patterns orange and tan" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Antarctic ice sheet from orbit, ice shelf edge and meltwater bay waters" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Greenland outlet glacier calving front, turquoise meltwater ponds visible" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Great Barrier Reef from orbit, coral reef structure in clear tropical water" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth volcanic eruption Sarychev from ISS, anvil cloud and pyroclastic column" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Lake Baikal winter ice from orbit, blue fracture patterns in frozen surface" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Nile Delta green agriculture triangle against beige desert from orbit" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Patagonia glaciers and turquoise lakes, Andean peaks and ice fields below" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Pacific hemisphere whole disk from geostationary orbit, vast ocean blue" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth atmospheric reentry glow from capsule window, plasma orange trail" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earthrise Apollo 8 photograph, Earth appearing above barren lunar horizon" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth shadow cone in space, penumbra extending into darkness behind planet" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth Strait of Gibraltar from ISS, Mediterranean and Atlantic separated by narrow pass" },
  { category: "earth_from_space", primary_subject: "earth", scene: "Earth from Moon surface Apollo 17, small blue marble in black lunar sky above horizon" },
];

// ─── BATCH PROMPT ─────────────────────────────────────────────────────────────

const STYLE_ANCHOR = `cinematic photorealistic 4K, dramatic lighting, deep moody atmosphere, hyper-detailed, awe-inspiring scale, sleep-friendly calm tone, dark backgrounds with rich color accents, Hubble/JWST telescope aesthetic, no text, no labels, no humans in modern clothing, no UFO/alien speculation`;

function buildBatchPrompt(batch) {
  const seeds = batch.map((e, i) => `[${i + 1}] ${e.scene}`).join("\n");
  return `You are a Flux Schnell image prompt engineer for a cinematic space documentary YouTube channel. Each image must be visually distinct and photorealistic.

STYLE ANCHOR — start every flux_prompt with exactly this string:
"${STYLE_ANCHOR} —"

Then add 40-60 words of specific visual description covering:
- The exact astronomical object and its key visual features
- Camera angle / framing (wide-field, close-up, edge-on, from above, etc.)
- Dominant colors and light sources
- Mood and atmosphere (vast, ancient, violent, serene, awe-inspiring, etc.)
- Scale cues
- No generic filler ("beautiful", "amazing") — be specific and visual

For tags: 5-8 lowercase keywords useful for matching narration text.
Include: primary subject, phenomena, category terms.
Examples: ["black-hole", "accretion-disk", "plasma-jets", "event-horizon", "deep-space"]

Return JSON array of exactly ${batch.length} objects:
[{"flux_prompt": "...", "tags": ["kw1", "kw2", ...]}]

No other text. Scene seeds:
${seeds}`;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });

  let existing = [];
  if (fs.existsSync(OUT_PATH)) {
    try { existing = JSON.parse(fs.readFileSync(OUT_PATH, "utf-8")); } catch {}
  }
  const doneIds = new Set(existing.filter((e) => e.flux_prompt).map((e) => e.id));

  const todo = SPACE_SCENES
    .map((s, i) => ({
      id: String(i + 1).padStart(3, "0"),
      category: s.category,
      primary_subject: s.primary_subject,
      scene_description: s.scene,
    }))
    .filter((e) => !doneIds.has(e.id));

  console.log(`\nSpace prompt generator — Sonnet`);
  console.log(`Total scenes: ${SPACE_SCENES.length} | To generate: ${todo.length} | Done: ${doneIds.size}`);
  if (todo.length === 0) { console.log("All done."); return; }

  const results = existing.filter((e) => doneIds.has(e.id));
  const totalBatches = Math.ceil(todo.length / BATCH_SIZE);

  for (let i = 0; i < todo.length; i += BATCH_SIZE) {
    const batch = todo.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    process.stdout.write(`  Batch ${batchNum}/${totalBatches} (${batch.length} scenes)... `);

    let claudeResults;
    try {
      const raw = await callClaudeCLI(buildBatchPrompt(batch), { model: MODEL, timeoutMs: 300000 });
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("No JSON array in response");
      claudeResults = JSON.parse(match[0]);
      if (!Array.isArray(claudeResults) || claudeResults.length !== batch.length) {
        throw new Error(`Expected ${batch.length} results, got ${claudeResults?.length}`);
      }
      console.log("ok");
    } catch (err) {
      console.log(`FAILED (${err.message.slice(0, 80)})`);
      claudeResults = batch.map(() => null);
    }

    for (let j = 0; j < batch.length; j++) {
      const entry = batch[j];
      const cr = claudeResults[j];
      results.push({
        id: entry.id,
        category: entry.category,
        primary_subject: entry.primary_subject,
        scene_description: entry.scene_description,
        flux_prompt: cr?.flux_prompt ?? `${STYLE_ANCHOR} — ${entry.scene_description}, dramatic scale, deep space atmosphere`,
        tags: cr?.tags ?? [entry.primary_subject, entry.category.replace(/_/g, "-")],
      });
    }

    fs.writeFileSync(OUT_PATH, JSON.stringify(results, null, 2));
  }

  console.log(`\n✓ ${results.length} prompts saved to data/space-prompts.json`);
}

main().catch((err) => { console.error("Fatal:", err.message); process.exit(1); });
