# Engineering electrical mesh convergence audit (2026)

- Verdict: **PASS**
- Official engineering ranking eligible: **yes**
- Predeclared tolerance: 2.00% for 2 consecutive mesh pairs
- Fixed topology: 0.0025 m²/cell, 2 parallel strings, 10 cells/bypass substring
- Fixture: six deterministic clear-sky states under static-land and swept-rotation geometry contracts; engineering optical-mesh/cell-mapping/circuit convergence; never annual-scaled.

| Contract | Shape | Level | Samples | A_PV (m²) | Cells | Strings | Bypass groups | AC (Wh) | Δ from prior | Pass | Layout build (ms) | Repeated solve (ms) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|---:|---:|
| static-land-matched | plane | L0-coarse | 256 | 0.057735027 | 24 | 2 | 4 | 22.164584152 | — | — | 3.792 | 50.667 |
| static-land-matched | plane | L1-validated-minimum | 1024 | 0.057735027 | 24 | 2 | 4 | 22.164584152 | 0.000000% | PASS | 5.960 | 56.204 |
| static-land-matched | plane | L2-reference | 4096 | 0.057735027 | 24 | 2 | 4 | 22.164584152 | 0.000000% | PASS | 20.897 | 96.508 |
| static-land-matched | cube | L0-coarse | 1280 | 0.250000000 | 100 | 2 | 10 | 94.093034479 | — | — | 10.858 | 70.263 |
| static-land-matched | cube | L1-validated-minimum | 5120 | 0.250000000 | 100 | 2 | 10 | 94.093034479 | 0.000000% | PASS | 19.071 | 119.247 |
| static-land-matched | cube | L2-reference | 20480 | 0.250000000 | 100 | 2 | 10 | 94.093034479 | 0.000000% | PASS | 128.209 | 354.570 |
| static-land-matched | sphere | L0-coarse | 256 | 0.200000000 | 80 | 2 | 8 | 29.059115921 | — | — | 2.456 | 112.556 |
| static-land-matched | sphere | L1-validated-minimum | 1024 | 0.200000000 | 80 | 2 | 8 | 28.976216484 | 0.286095% | PASS | 11.235 | 120.343 |
| static-land-matched | sphere | L2-reference | 4096 | 0.200000000 | 80 | 2 | 8 | 28.964245028 | 0.041332% | PASS | 32.742 | 200.552 |
| static-land-matched | hemisphere | L0-coarse | 256 | 0.100000000 | 40 | 2 | 4 | 14.977557342 | — | — | 1.650 | 69.200 |
| static-land-matched | hemisphere | L1-validated-minimum | 1024 | 0.100000000 | 40 | 2 | 4 | 14.974272570 | 0.021936% | PASS | 10.037 | 92.203 |
| static-land-matched | hemisphere | L2-reference | 4096 | 0.100000000 | 40 | 2 | 4 | 14.957727330 | 0.110613% | PASS | 27.021 | 163.951 |
| static-land-matched | cylinder | L0-coarse | 512 | 0.250000000 | 100 | 2 | 10 | 42.847812747 | — | — | 5.919 | 113.259 |
| static-land-matched | cylinder | L1-validated-minimum | 2048 | 0.250000000 | 100 | 2 | 10 | 42.853245288 | 0.012677% | PASS | 18.085 | 168.278 |
| static-land-matched | cylinder | L2-reference | 8192 | 0.250000000 | 100 | 2 | 10 | 42.856712250 | 0.008090% | PASS | 66.513 | 351.241 |
| static-land-matched | cone | L0-coarse | 256 | 0.111803399 | 46 | 2 | 6 | 14.780276804 | — | — | 1.590 | 91.992 |
| static-land-matched | cone | L1-validated-minimum | 1024 | 0.111803399 | 46 | 2 | 6 | 14.736622184 | 0.296232% | PASS | 5.764 | 103.885 |
| static-land-matched | cone | L2-reference | 4096 | 0.111803399 | 46 | 2 | 6 | 14.695131202 | 0.282345% | PASS | 26.606 | 168.894 |
| swept-rotation-envelope | plane | L0-coarse | 256 | 0.036755260 | 16 | 2 | 2 | 25.615940481 | — | — | 1.331 | 802.899 |
| swept-rotation-envelope | plane | L1-validated-minimum | 1024 | 0.036755260 | 16 | 2 | 2 | 25.615940481 | 0.000000% | PASS | 4.687 | 1110.423 |
| swept-rotation-envelope | plane | L2-reference | 4096 | 0.036755260 | 16 | 2 | 2 | 25.615940481 | 0.000000% | PASS | 35.505 | 2414.855 |
| swept-rotation-envelope | cube | L0-coarse | 1280 | 0.159154943 | 70 | 2 | 8 | 30.268925859 | — | — | 11.694 | 1639.086 |
| swept-rotation-envelope | cube | L1-validated-minimum | 5120 | 0.159154943 | 70 | 2 | 8 | 30.268925859 | 0.000000% | PASS | 51.611 | 3247.146 |
| swept-rotation-envelope | cube | L2-reference | 20480 | 0.159154943 | 70 | 2 | 8 | 30.268925859 | 0.000000% | PASS | 156.198 | 10647.782 |
| swept-rotation-envelope | sphere | L0-coarse | 256 | 0.200000000 | 80 | 2 | 8 | 29.070566354 | — | — | 1.299 | 997.132 |
| swept-rotation-envelope | sphere | L1-validated-minimum | 1024 | 0.200000000 | 80 | 2 | 8 | 29.020594999 | 0.172193% | PASS | 5.608 | 1172.442 |
| swept-rotation-envelope | sphere | L2-reference | 4096 | 0.200000000 | 80 | 2 | 8 | 29.001640211 | 0.065358% | PASS | 22.122 | 1941.384 |
| swept-rotation-envelope | hemisphere | L0-coarse | 256 | 0.100000000 | 40 | 2 | 4 | 14.295761130 | — | — | 1.167 | 678.904 |
| swept-rotation-envelope | hemisphere | L1-validated-minimum | 1024 | 0.100000000 | 40 | 2 | 4 | 14.258871133 | 0.258716% | PASS | 4.559 | 866.356 |
| swept-rotation-envelope | hemisphere | L2-reference | 4096 | 0.100000000 | 40 | 2 | 4 | 14.238104490 | 0.145853% | PASS | 13.710 | 1575.084 |
| swept-rotation-envelope | cylinder | L0-coarse | 512 | 0.250000000 | 100 | 2 | 10 | 42.879519954 | — | — | 2.986 | 1039.254 |
| swept-rotation-envelope | cylinder | L1-validated-minimum | 2048 | 0.250000000 | 100 | 2 | 10 | 42.870333928 | 0.021427% | PASS | 11.337 | 1386.909 |
| swept-rotation-envelope | cylinder | L2-reference | 8192 | 0.250000000 | 100 | 2 | 10 | 42.867932071 | 0.005603% | PASS | 42.669 | 2898.973 |
| swept-rotation-envelope | cone | L0-coarse | 256 | 0.111803399 | 46 | 2 | 6 | 15.132912639 | — | — | 0.950 | 729.562 |
| swept-rotation-envelope | cone | L1-validated-minimum | 1024 | 0.111803399 | 46 | 2 | 6 | 15.062320573 | 0.468667% | PASS | 3.161 | 899.211 |
| swept-rotation-envelope | cone | L2-reference | 4096 | 0.111803399 | 46 | 2 | 6 | 15.045276289 | 0.113287% | PASS | 14.131 | 1621.182 |

| Contract / shape | Topology invariant | Cell-area invariant | Pair deltas | Official eligible |
|---|:---:|:---:|---|:---:|
| static-land-matched / plane | PASS | PASS | 0.000000%, 0.000000% | yes |
| static-land-matched / cube | PASS | PASS | 0.000000%, 0.000000% | yes |
| static-land-matched / sphere | PASS | PASS | 0.286095%, 0.041332% | yes |
| static-land-matched / hemisphere | PASS | PASS | 0.021936%, 0.110613% | yes |
| static-land-matched / cylinder | PASS | PASS | 0.012677%, 0.008090% | yes |
| static-land-matched / cone | PASS | PASS | 0.296232%, 0.282345% | yes |
| swept-rotation-envelope / plane | PASS | PASS | 0.000000%, 0.000000% | yes |
| swept-rotation-envelope / cube | PASS | PASS | 0.000000%, 0.000000% | yes |
| swept-rotation-envelope / sphere | PASS | PASS | 0.172193%, 0.065358% | yes |
| swept-rotation-envelope / hemisphere | PASS | PASS | 0.258716%, 0.145853% | yes |
| swept-rotation-envelope / cylinder | PASS | PASS | 0.021427%, 0.005603% | yes |
| swept-rotation-envelope / cone | PASS | PASS | 0.468667%, 0.113287% | yes |

## Independent rotation-phase convergence (finest optical mesh)

| Shape | Phase levels | Consecutive AC deltas | Topology invariant | Pass |
|---|---|---|:---:|:---:|
| static-land-matched / plane | not-applicable-stationary-rpm0 | N/A | PASS | PASS |
| static-land-matched / cube | not-applicable-stationary-rpm0 | N/A | PASS | PASS |
| static-land-matched / sphere | not-applicable-stationary-rpm0 | N/A | PASS | PASS |
| static-land-matched / hemisphere | not-applicable-stationary-rpm0 | N/A | PASS | PASS |
| static-land-matched / cylinder | not-applicable-stationary-rpm0 | N/A | PASS | PASS |
| static-land-matched / cone | not-applicable-stationary-rpm0 | N/A | PASS | PASS |
| swept-rotation-envelope / plane | 8 / 16 / 32 | 0.015608%, 0.026015% | PASS | PASS |
| swept-rotation-envelope / cube | 8 / 16 / 32 | 1.100341%, 0.092170% | PASS | PASS |
| swept-rotation-envelope / sphere | 8 / 16 / 32 | 0.067432%, 0.024735% | PASS | PASS |
| swept-rotation-envelope / hemisphere | 8 / 16 / 32 | 0.011264%, 0.009557% | PASS | PASS |
| swept-rotation-envelope / cylinder | 8 / 16 / 32 | 0.007475%, 0.000087% | PASS | PASS |
| swept-rotation-envelope / cone | 8 / 16 / 32 | 0.115949%, 0.122556% | PASS | PASS |

## Independent circuit-coordinate convergence (finest optical mesh, selected phase)

| Shape | Circuit levels | Consecutive AC deltas | Topology invariant | Pass |
|---|---|---|:---:|:---:|
| static-land-matched / plane | 128 / 256 / 512 | 0.429304%, 0.212490% | PASS | PASS |
| static-land-matched / cube | 128 / 256 / 512 | 0.221638%, 0.180972% | PASS | PASS |
| static-land-matched / sphere | 128 / 256 / 512 | 0.140659%, 0.261202% | PASS | PASS |
| static-land-matched / hemisphere | 128 / 256 / 512 | 0.079768%, 0.080334% | PASS | PASS |
| static-land-matched / cylinder | 128 / 256 / 512 | 0.312565%, 0.184343% | PASS | PASS |
| static-land-matched / cone | 128 / 256 / 512 | 0.530457%, 0.293580% | PASS | PASS |
| swept-rotation-envelope / plane | 128 / 256 / 512 | 0.406105%, 0.201025% | PASS | PASS |
| swept-rotation-envelope / cube | 128 / 256 / 512 | 0.540345%, 0.276156% | PASS | PASS |
| swept-rotation-envelope / sphere | 128 / 256 / 512 | 0.124101%, 0.187389% | PASS | PASS |
| swept-rotation-envelope / hemisphere | 128 / 256 / 512 | 0.107832%, 0.070308% | PASS | PASS |
| swept-rotation-envelope / cylinder | 128 / 256 / 512 | 0.301681%, 0.177194% | PASS | PASS |
| swept-rotation-envelope / cone | 128 / 256 / 512 | 0.426614%, 0.252749% | PASS | PASS |

## Root cause and fix

- Old mapping: lexicographic quadrature-point samples were poured into one-dimensional nominal-area buckets, so optical refinement moved physical cell support and could cross a surface-zone seam.
- Fixed mapping: immutable per-zone two-dimensional material-space cell rectangles with exact boundary clipping and a precomputed sparse optical-support projection; topology/layout IDs are independent of optical mesh and phase.
- GL2 support: each equal-weight GL2 node owns its own half segment (left:[lower,mid], right:[mid,upper]), preserving linear-u means instead of flattening both nodes over the full segment.
- Circuit diagnostic: device/string states are evaluated at V_bus=V_terminal+I_array*R_array and string currents close to array current.
- Old cell sizing: the remainder of zone area / nominal cell area became one sliver cell; because a bypass substring wires its cells in series with no per-cell diode, that sliver's area-proportional photocurrent throttled the whole substring, and an odd cell count also left the two parallel strings with unequal series length. Under uniform illumination, where only resistive wiring should be lost, that cost 21.9% (static plane), 21.1% (swept cube), 14.2% (swept plane) and 11.0% (cone) while cube, sphere, hemisphere and cylinder — whose areas divide exactly at this land area — lost only 0.26-0.38%.
- Fixed cell sizing: each zone is tiled with uniform cells at or below the nominal area, with the count raised to a multiple of the parallel string count, so no cell throttles its series string and every string carries the same series length; the uniform-illumination spread across all six shapes falls from 20.8 to 0.38 percentage points.
- Old phase ladder: rotation-phase convergence was demonstrated over 4/8/16 samples, but the cube repeats every quarter turn, so 4 midpoint samples land one full symmetry period apart and alias onto a single orientation. The large phase-independent sliver loss dominated the ratio and made those degenerate levels appear converged.
- Fixed phase ladder: the official minimum phase resolution is 16, bracketed by 8/16/32 like the azimuth and circuit ladders; only the aliased 4-sample level is dropped. The measured cube sequence is 3.059% (4->8), 1.100% (8->16), 0.092% (16->32) and 0.032% (32->64), so the answer has settled by 16.

## Performance provenance

The old 186698.0292 ms result is **not comparable** to this audit because the fixture, shape count, and production cell topology changed.
For the same current cylinder input, 3 repeated solves took 30.415 ms with a prebuilt layout versus 38.135 ms rebuilding it each time; result relative difference=0.
End-to-end full-year Worker runtime is reported by the separate full-year audit.

Implementation SHA-256: `7dd7c055d17f8484ba4266fa988a868caecf81cde9128b1faa0b12e4a847056e`

