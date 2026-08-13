# Primary-source-equivalent reproduction audit

Generated at: 2026-08-12T10:30:41.821Z

No coefficient or multiplier was reverse-fitted to a reported output. Fixtures contain only values confirmed in a primary source or author-maintained public code. Studies A-D lack required inputs and are excluded from successful reproductions.

## Summary

- Studies: 6
- Numerically evaluated: 2
- pass / partial / fail / not-evaluated: 2 / 0 / 0 / 4

## Source condition matrix

| Study | Geometry | Area basis | Source and spectrum | Incidence | Weather | Albedo and reflector | Thermal and convection | Electrical connection | Measured quantity |
|---|---|---|---|---|---|---|---|---|---|
| research:A | GA-optimized open-box/funnel assemblies of 64 double-sided triangular cells | fixed 10 m x 10 m bounding footprint; heights 2, 4, 6, 8, 10 m; active area not tabulated as one reusable value | clear parallel p-polarized rays; refractive index 1.505; normal reflectance 4.1%; no spectral weather series | solar trajectory over a summer day; 12 min time step; source does not identify one executable calendar date | San Francisco summer day; clouds and external obstructions neglected; source-equivalent irradiance series unavailable | no ground reflection; at most one specular reflection among structure triangles | not modeled in the reported optical optimization | 6% conversion efficiency applied to independently illuminated double-sided triangles; full circuit topology not reported | simulated one-day generated energy relative to a flat comparator |
| research:B | flat silicon cells and mirrors assembled as open cubes and funnels; 35 mm indoor cube case | paper separately uses base area, bounding volume, cell area and flat-cell comparator area | 1300 W xenon arc lamp with AM1.5 filter at 1000 W/m2 indoors; clear-sky solar trajectory outdoors | lamp/structure geometry is not published as a complete machine-readable fixture; outdoor I-V sweeps every 12-15 min | MIT roof, Cambridge MA, June-December 2011; raw weather/I-V series not bundled | paper-specific cell/mirror ray tracing; exact indoor background and ground albedo unavailable | temperature/convection boundary conditions are not a complete executable source case | cells in parallel, one blocking diode in series with each cell | energy per base area, instantaneous I-V curves and indoor/outdoor relative output |
| research:C | corrugated interdigitated-back-contact monocrystalline silicon cell folded into a sphere | 10.7 cm2 projection, 11.34 cm2 ground area; 42.8 cm2 spherical area in the equal-ground thermal comparison | AM1.5G solar simulator, 1000 W/m2 with spectral mismatch correction | angle sweep with white background at 1 cm; separate background-height sweeps from 0 to 10 cm | indoor room-temperature solar-simulator tests | black 3% diffuse, sand 25% diffuse, white 85% diffuse, aluminium 88% specular, and a separate 45 degree cup | continuous one-sun exposure; temperatures sampled about every 1.5 min; sphere apex measured by IR sensor | corrugated IBC cell; complete spatial electrical network is not public as an executable circuit | maximum power, angular response, surface temperature and power degradation from 21 C |
| research:D | 0.3 m sphere/hemisphere supports tiled with rectangular flexible PV modules at 70% coverage | 0.07 m2 circular projection, 0.01 m2 support footprint, 0.099/0.198 m2 module area kept as distinct denominators | outdoor global irradiance; 890 W/m2 is only a single-module I-V condition, not a daily series | modules occupy discrete orientations; rear low-light modules are material to the comparison | outdoor daylight air temperature about 25-30 C; source raw irradiance/temperature series unavailable | ground reflection is not reported as a machine-readable albedo | configuration-specific module temperatures reported; convection coefficients and full histories unavailable | series/parallel arrangements vary by configuration; complete topology and bypass behavior unavailable | outdoor power/energy, module temperature and spacing-dependent shadow losses |
| source:E | convex sphere; analytic projected area pi R2 | unit spherical surface area and unit ground-occupied area are reported separately (4:1 ratio) | broadband direct-normal beam only; Gsc=1367 W/m2 and Hottel clear-sky transmittance | day 81 sunrise-to-sunset hour-angle integration; sphere projection is independent of beam direction | Tehran latitude 35.69 N; 1200 m and midlatitude-summer Hottel inputs from the authors' public implementation | sky diffuse and ground-reflected irradiance explicitly excluded | outside the study scope | outside the study scope; benchmark is intercepted optical beam energy | daily direct beam energy per m2 sphere surface and per m2 ground-occupied area |
| source:F | 0.2 m radius, 0.01 m thick polished aluminium disk rotating in still air | disk face area 0.1256 m2; experiment 1 radial evaluation line 0.005-0.194 m | electrical uniform heat flux; no solar spectrum | not an optical experiment | quiescent laboratory air; experiment 1 ambient 22.2 C | not applicable; emissivity 0.04 in energy balance and 0.07 for camera calibration | initial wall 52.1 C; 34.55 rad/s; local Nu=h r/k; Sutherland air properties; 100 s run | heater supplies uniform heat flux; rear losses reported below 1% through insulation | transient IR temperature-derived local heat-transfer coefficient, Reynolds and Nusselt numbers |

## Executed results

### research:A: Three-dimensional photovoltaics

- Scope: original A-D source case
- Reported result or trend: At fixed 10 m x 10 m footprint, optimized one-day energy increases approximately linearly across the 2-10 m height sweep and the daily curve is flatter than the flat comparator.
- Simulated result: Not run under a complete source-equivalent case; the ordinary Seoul six-shape comparison is not evidence for this study.
- Verdict: **not-evaluated**
- Matched conditions: The research namespace preserves the 100 m2 footprint, 10 m selected height, optical constants, and 12 minute source time step.
- Unmatched conditions: No source 64-triangle coordinates or GA optimizer are implemented by the preset adapter.; The exact San Francisco date/latitude and a source-equivalent irradiance series are not reported as executable inputs.; The general continuous-skin geometries are not the paper's double-sided triangular open-box/funnel structures.
- Possible difference causes: different geometry and active material area; different weather, latitude, date, and diffuse-radiation treatment; different reflection order, polarization, and electrical topology

No numerical run: required source inputs are missing, so this study remains `not-evaluated`.

### research:B: Solar energy generation in three dimensions

- Scope: original A-D source case
- Reported result or trend: The reported structures increase energy per footprint and flatten daily/seasonal output, while generally using more PV material per generated energy than a flat panel.
- Simulated result: Not run under a complete source-equivalent case; the ordinary Seoul cube result uses a different continuous active area and comparator.
- Verdict: **not-evaluated**
- Matched conditions: The indoor metadata preserves the 35 mm cube base/height, 1000 W/m2 lamp, 14% cover reflectivity, and isolated research namespace.
- Unmatched conditions: The exact five-cell placement, active cell area, support, lamp geometry, and blocking-diode I-V behavior are not represented by the continuous-skin comparison.; The reported 2-20x cases span different structures, heights, latitudes, seasons, mirror areas, and flat comparator poses.; No source outdoor raw weather and I-V time series is bundled.
- Possible difference causes: active-area and denominator mismatch; continuous local-MPP skin versus parallel discrete cells and blocking diodes; different reflector, latitude, season, weather, and flat-panel orientation

No numerical run: required source inputs are missing, so this study remains `not-evaluated`.

### research:C: Nature-inspired spherical silicon solar cell for three-dimensional light harvesting, improved dust and thermal management

- Scope: original A-D source case
- Reported result or trend: The sphere is angularly insensitive and captures more reflected light for the tested backgrounds; the strongest +101% observation occurs only with the 1 cm aluminium cup, while measured maximum temperature is below the flat comparator.
- Simulated result: Not run under a complete source-equivalent case; no general sphere result is labelled as reproducing a reflector or thermal observation.
- Verdict: **not-evaluated**
- Matched conditions: The selected metadata preserves equal-ground/equal-projection denominators, 1000 W/m2 AM1.5G, white diffuse reflectance, and the 1 cm angular-test gap.; Black, white, sand, aluminium paper, aluminium cup, and no-reflector observations remain separate source conditions.
- Unmatched conditions: The corrugated IBC sphere, etched area, exact diameter, electrical network, lamp geometry, cup geometry, and spectral mismatch are not fully represented.; The app's diffuse ground model is not a substitute for a finite close background or a specular/concentrating cup.; The source thermal comparisons use different area denominators and measurement definitions.
- Possible difference causes: finite background/cup geometry and scattering mismatch; active-area, corrugation, and comparator-denominator mismatch; different convection boundary conditions and temperature measurement definitions

No numerical run: required source inputs are missing, so this study remains `not-evaluated`.

### research:D: Harnessing solar power with aesthetic innovation: An in-depth study on spherical and hemispherical photovoltaic configurations

- Scope: original A-D source case
- Reported result or trend: The source reports a hemisphere producing 32% more energy than its sphere comparison and links the difference to oppositely oriented low-light modules; multiple structures incur spacing-dependent shadow losses.
- Simulated result: Not run under a complete source-equivalent case; approximately 32% is not forced and the ordinary sphere/hemisphere ranking is not a reproduction.
- Verdict: **not-evaluated**
- Matched conditions: The metadata preserves 0.3 m diameter, module counts, 70% coverage, active areas, projected area, and support footprint as separate fields.
- Unmatched conditions: The ordinary ideal sphere/hemisphere skins have 100% continuous coverage and local MPP rather than the source's rectangular modules, gaps, and wiring.; The article's 0.01 m2 support denominator and 0.07 m2 projected footprint cannot be merged into one land-area comparison.; Raw irradiance, module temperature, I-V, albedo, rear low-light response, and full wiring time series are unavailable as executable inputs.
- Possible difference causes: active coverage and PV-area mismatch; series/parallel mismatch from rear low-light modules; self-shading, inter-structure shadows, ground reflection, and temperature differences; support-footprint versus swept-projection denominator

No numerical run: required source inputs are missing, so this study remains `not-evaluated`.

### source:E: Evaluation of direct beam energy received by convex solar collectors and their optimal orientations

- Scope: source-equivalent direct-beam geometry and Hottel clear-sky integration; not a PV electrical validation
- Reported result or trend: A sphere receives 8.36 MJ/m2 of its surface and 33.44 MJ/m2 of ground-occupied area on day 81 at Tehran.
- Simulated result: Independent Simpson integration with the simulator's exact sphere projection produced 8.353533 and 33.414133 MJ/m2.
- Verdict: **pass**
- Matched conditions: sphere projection pi R2 and 4 pi R2 active surface; Tehran latitude 35.69 N and day-of-year 81; author-published 1200 m midlatitude-summer Hottel inputs; Gsc=1367 W/m2, 0.033 orbital correction and 7.15e-5 rad/s hour-angle rate; direct beam only; diffuse and ground reflection disabled
- Unmatched conditions: the study computes intercepted optical energy, not spectral PV conversion, temperature or a circuit; the paper does not publish its original numerical integration mesh
- Possible difference causes: rounding of the two-decimal reported values; integration quadrature resolution; using a different astronomical or clear-sky convention would no longer be source-equivalent

| Metric | Reported | Simulated | Absolute error | Relative error | Pre-registered tolerance | Verdict |
|---|---:|---:|---:|---:|---:|---|
| daily direct beam energy per sphere surface area | 8.360000000 MJ/m2-surface/day | 8.353533265 | 0.00646673 | 0.077353% | 1.00% | pass |
| daily direct beam energy per ground-occupied area | 33.44000000 MJ/m2-land/day | 33.41413306 | 0.0258669 | 0.077353% | 1.00% | pass |

### source:F: Investigation of Convective Heat Transfer and Stability on a Rotating Disk: A Novel Experimental Method and Thermal Modeling

- Scope: source-equivalent experiment-1 rotating-flow heat-transfer dimensionless benchmark; not a PV module calibration
- Reported result or trend: Experiment 1 remains laminar over the evaluated radius and follows Nu=0.36 sqrt(Re_omega); Table 5 reports Re_omega=83,908.
- Simulated result: Sutherland air properties at the reported film temperature give Re=82955.051 and Nu=103.686907.
- Verdict: **pass**
- Matched conditions: experiment 1 omega=34.55 rad/s and outer evaluated radius 0.194 m; reported wall 52.1 C and ambient 22.2 C film-temperature method; reported Sutherland reference viscosity, temperature and constant; paper's laminar coefficient K=0.36; paper uncertainty is used as the pre-registered tolerance, not as a fitted multiplier
- Unmatched conditions: raw IR pixel temperatures and fitted local h(r) data are not published as machine-readable data; uniform heater heat flux magnitude is not tabulated for experiment 1; this heated aluminium disk is not a PV laminate and has no optical or electrical conversion
- Possible difference causes: Table 5 Reynolds is rounded and may use spatially varying film properties; OCR-rendered air-property precision is limited to the digits printed in Table 4; ambient-property evaluation instead of the reported film-temperature method changes the result

| Metric | Reported | Simulated | Absolute error | Relative error | Pre-registered tolerance | Verdict |
|---|---:|---:|---:|---:|---:|---|
| local rotational Reynolds number at r=0.194 m | 83908.00000 dimensionless | 82955.05126 | 952.949 | 1.135707% | 1.72% | pass |
| laminar local Nusselt number Nu=0.36 sqrt(Re_omega) | 104.2807595 dimensionless | 103.6869068 | 0.593853 | 0.569475% | 2.16% | pass |

## Interpretation boundary

Source E validates direct-beam geometry integration. Source F validates laminar rotational Reynolds and Nusselt calculations for a heated rotating disk. E is not a PV electrical or thermal validation; F is not a PV laminate or annual-energy validation. Inputs remain insufficient for full source-equivalent execution of studies A-D.
