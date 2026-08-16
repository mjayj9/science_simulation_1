# Generated engineering validation report

> Every numeric table below is rendered from schema-checked audit JSON. The report is written atomically only after its SHA-256 manifest and local links pass verification.

## Scope and calculation contracts

- Fair geometry: 18/18 cases passed instantaneous projection, swept occupation, and installed-world-height checks.
- Annual comparison: 8760 actual hourly intervals plus one closing endpoint; no representative-day scaling.
- Official ideal local-MPP convergence: PASS.
- Engineering connection convergence: NOT-EVALUATED; official ranking eligible = no. Reason: Engineering official ranking is not evaluated: the extended cylinder mesh check differed by 6.5273%, versus the pre-registered 2.00% tolerance. The production azimuth limit is 128, so a still-higher reference cannot be executed.
- Overall dual-model convergence gate: FAIL; this does not invalidate the separately passing official ideal upper-bound result.
- Engineering annual values are exploratory calculations at the audit low resolution (azimuth=16, meridional=4, phase=4, circuit=32). The extended cylinder evidence uses azimuth=64, meridional=16, phase=4, circuit=128 versus azimuth=128, meridional=32, phase=4, circuit=128 and remains FAIL; it is not the annual-row resolution.
- Wind-generated electricity is excluded. Active-motor demand is deducted from inverter AC and net generation is clipped at zero.
- Ideal local-MPP integration is an upper bound; explicit series/parallel/bypass wiring is reported as a separate engineering model.
- Natural rotation with no source-backed C_Q starts at and remains at exactly 0 RPM. User-C_Q auxiliary-rotor sensitivity is excluded from official ranks when full footprint, height, and shadow accounting is absent.

## Convergence evidence

| Model gate | Shape | Low Wh | High Wh | Relative difference | Tolerance | Verdict |
|---|---|---:|---:|---:|---:|---|
| Official ideal | plane | 17.560381 | 17.622153 | 0.350537% | 1.000000% | pass |
| Official ideal | cube | 67.366550 | 67.968870 | 0.886170% | 1.000000% | pass |
| Official ideal | cylinder | 110.576646 | 110.590678 | 0.012688% | 1.000000% | pass |
| Official ideal | sphere | 74.694983 | 74.692848 | 0.002859% | 1.000000% | pass |
| Official ideal | hemisphere | 48.016428 | 48.014755 | 0.003484% | 1.000000% | pass |
| Official ideal | cone | 52.496442 | 52.488962 | 0.014250% | 1.000000% | pass |
| Engineering preliminary | plane | 13.995836 | 14.132364 | 0.966063% | 2.000000% | pass |
| Engineering preliminary | cylinder | 58.663255 | 78.930743 | 25.677560% | 2.000000% | fail |

| Engineering extended fixture | Selected resolution | Reference resolution | Selected Wh | Reference Wh | Selected samples | Reference samples | Relative difference | Tolerance | Verdict | Day offsets | Elapsed ms |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---|---:|
| four independent actual-weather 24 h seasonal fixtures; never annual-scaled | azimuth=64, meridional=16, phase=4, circuit=128 | azimuth=128, meridional=32, phase=4, circuit=128 | 330.378768 | 353.449603 | 4096 | 16384 | 6.527334% | 2.000000% | fail | 19, 109, 201, 293 | 186698.000 |

## Actual full-year comparison groups

### static-land-matched:local-mpp-area-integral

Static designs sized so instantaneous horizontal projection equals A_land.

Official ranking eligible: yes; verdict: pass; calculation resolution: azimuth=16; meridional=4; phase<=4; ideal local-MPP.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 39.257503 | 0.000000 | 39.257503 | 785.150063 | 157.030013 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 39.091586 | 0.000000 | 39.091586 | 781.831728 | 156.366346 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 26.806723 | 0.000000 | 26.806723 | 536.134455 | 134.033614 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 18.818861 | 0.000000 | 18.818861 | 376.377215 | 168.321008 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.231525 | 0.000000 | 17.231525 | 344.630502 | 172.315251 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0577 | 1.155 | 13.315868 | 0.000000 | 13.315868 | 266.317364 | 230.637603 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### swept-held-static:local-mpp-area-integral

Pure-rotation baseline: rotating-envelope geometry held at 0 RPM.

Official ranking eligible: yes; verdict: pass; calculation resolution: azimuth=16; meridional=4; phase<=4; ideal local-MPP.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 39.257503 | 0.000000 | 39.257503 | 785.150063 | 157.030013 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 26.806723 | 0.000000 | 26.806723 | 536.134455 | 134.033614 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 23.957550 | 0.000000 | 23.957550 | 479.151000 | 150.529726 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 18.818861 | 0.000000 | 18.818861 | 376.377215 | 168.321008 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.231525 | 0.000000 | 17.231525 | 344.630502 | 172.315251 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 7.623472 | 0.000000 | 7.623472 | 152.469440 | 207.411730 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### controlled-kinematic:local-mpp-area-integral

Common controlled 2 RPM gross AC before an active motor demand is deducted.

Official ranking eligible: yes; verdict: pass; calculation resolution: azimuth=16; meridional=4; phase<=4; ideal local-MPP.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 39.257503 | 0.000000 | 39.257503 | 785.150063 | 157.030013 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 26.806723 | 0.000000 | 26.806723 | 536.134455 | 134.033614 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 24.123998 | 0.000000 | 24.123998 | 482.479960 | 151.575550 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 18.818861 | 0.000000 | 18.818861 | 376.377215 | 168.321008 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.231525 | 0.000000 | 17.231525 | 344.630502 | 172.315251 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 6.356156 | 0.000000 | 6.356156 | 127.123127 | 172.931885 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### controlled-motor-net:local-mpp-area-integral

Common controlled 2 RPM with active-motor demand deducted and net AC clipped at zero.

Official ranking eligible: yes; verdict: pass; calculation resolution: azimuth=16; meridional=4; phase<=4; ideal local-MPP.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 39.257503 | 0.004317 | 39.255456 | 785.109126 | 157.021825 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 26.806723 | 0.004317 | 26.804692 | 536.093848 | 134.023462 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 24.123998 | 0.004317 | 24.121975 | 482.439491 | 151.562836 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 18.818861 | 0.004317 | 18.816857 | 376.337141 | 168.303086 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.231525 | 0.004317 | 17.229532 | 344.590644 | 172.295322 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 6.356156 | 0.004317 | 6.354256 | 127.085115 | 172.880175 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### natural-no-cq:local-mpp-area-integral

Natural dynamics with absent C_Q; exact zero-RPM result reuses the identical static land-matched calculation.

Official ranking eligible: yes; verdict: pass; calculation resolution: azimuth=16; meridional=4; phase<=4; ideal local-MPP.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 39.257503 | 0.000000 | 39.257503 | 785.150063 | 157.030013 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 39.091586 | 0.000000 | 39.091586 | 781.831728 | 156.366346 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 26.806723 | 0.000000 | 26.806723 | 536.134455 | 134.033614 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 18.818861 | 0.000000 | 18.818861 | 376.377215 | 168.321008 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.231525 | 0.000000 | 17.231525 | 344.630502 | 172.315251 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0577 | 1.155 | 13.315868 | 0.000000 | 13.315868 | 266.317364 | 230.637603 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### static-land-matched:explicit-series-parallel-bypass

Static designs sized so instantaneous horizontal projection equals A_land.

Official ranking eligible: no; verdict: not-evaluated; calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order (not an official rank) | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cube | 0.0500 | 0.2500 | 5.000 | 23.179101 | 0.000000 | 23.179101 | 463.582020 | 92.716404 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | cylinder | 0.0500 | 0.2500 | 5.000 | 21.718897 | 0.000000 | 21.718897 | 434.377946 | 86.875589 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 14.870907 | 0.000000 | 14.870907 | 297.418131 | 74.354533 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | hemisphere | 0.0500 | 0.1000 | 2.000 | 14.335540 | 0.000000 | 14.335540 | 286.710801 | 143.355400 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | plane | 0.0500 | 0.0577 | 1.155 | 11.359858 | 0.000000 | 11.359858 | 227.197164 | 196.758516 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | cone | 0.0500 | 0.1118 | 2.236 | 10.675096 | 0.000000 | 10.675096 | 213.501928 | 95.480965 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### swept-held-static:explicit-series-parallel-bypass

Pure-rotation baseline: rotating-envelope geometry held at 0 RPM.

Official ranking eligible: no; verdict: not-evaluated; calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order (not an official rank) | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 21.718897 | 0.000000 | 21.718897 | 434.377946 | 86.875589 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 14.870907 | 0.000000 | 14.870907 | 297.418131 | 74.354533 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | hemisphere | 0.0500 | 0.1000 | 2.000 | 14.335540 | 0.000000 | 14.335540 | 286.710801 | 143.355400 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cube | 0.0500 | 0.1592 | 3.183 | 13.223588 | 0.000000 | 13.223588 | 264.471761 | 83.086254 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | cone | 0.0500 | 0.1118 | 2.236 | 10.675096 | 0.000000 | 10.675096 | 213.501928 | 95.480965 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 6.072813 | 0.000000 | 6.072813 | 121.456265 | 165.222972 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### controlled-kinematic:explicit-series-parallel-bypass

Common controlled 2 RPM gross AC before an active motor demand is deducted.

Official ranking eligible: no; verdict: not-evaluated; calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order (not an official rank) | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 21.726371 | 0.000000 | 21.726371 | 434.527412 | 86.905482 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 14.752493 | 0.000000 | 14.752493 | 295.049859 | 73.762465 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | hemisphere | 0.0500 | 0.1000 | 2.000 | 14.032218 | 0.000000 | 14.032218 | 280.644362 | 140.322181 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cube | 0.0500 | 0.1592 | 3.183 | 13.083130 | 0.000000 | 13.083130 | 261.662593 | 82.203728 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | cone | 0.0500 | 0.1118 | 2.236 | 10.806862 | 0.000000 | 10.806862 | 216.137242 | 96.659513 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 5.074236 | 0.000000 | 5.074236 | 101.484719 | 138.054689 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### controlled-motor-net:explicit-series-parallel-bypass

Common controlled 2 RPM with active-motor demand deducted and net AC clipped at zero.

Official ranking eligible: no; verdict: not-evaluated; calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order (not an official rank) | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 21.726371 | 0.004317 | 21.724336 | 434.486716 | 86.897343 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 14.752493 | 0.004317 | 14.750490 | 295.009794 | 73.752449 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | hemisphere | 0.0500 | 0.1000 | 2.000 | 14.032218 | 0.004317 | 14.030231 | 280.604630 | 140.302315 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cube | 0.0500 | 0.1592 | 3.183 | 13.083130 | 0.004317 | 13.081131 | 261.622623 | 82.191171 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | cone | 0.0500 | 0.1118 | 2.236 | 10.806862 | 0.004317 | 10.804901 | 216.098014 | 96.641970 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 5.074236 | 0.004317 | 5.072359 | 101.447179 | 138.003622 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### natural-no-cq:explicit-series-parallel-bypass

Natural dynamics with absent C_Q; exact zero-RPM result reuses the identical static land-matched calculation.

Official ranking eligible: no; verdict: not-evaluated; calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order (not an official rank) | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cube | 0.0500 | 0.2500 | 5.000 | 23.179101 | 0.000000 | 23.179101 | 463.582020 | 92.716404 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | cylinder | 0.0500 | 0.2500 | 5.000 | 21.718897 | 0.000000 | 21.718897 | 434.377946 | 86.875589 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 14.870907 | 0.000000 | 14.870907 | 297.418131 | 74.354533 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | hemisphere | 0.0500 | 0.1000 | 2.000 | 14.335540 | 0.000000 | 14.335540 | 286.710801 | 143.355400 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | plane | 0.0500 | 0.0577 | 1.155 | 11.359858 | 0.000000 | 11.359858 | 227.197164 | 196.758516 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | cone | 0.0500 | 0.1118 | 2.236 | 10.675096 | 0.000000 | 10.675096 | 213.501928 | 95.480965 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### transient-static-land-matched:local-mpp-area-integral

Transient static designs sized to A_land.

Official ranking eligible: yes; verdict: pass; calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.072559 | 0.000000 | 40.072559 | 801.451173 | 160.290235 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 39.728507 | 0.000000 | 39.728507 | 794.570145 | 158.914029 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 27.416879 | 0.000000 | 27.416879 | 548.337580 | 137.084395 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.250082 | 0.000000 | 19.250082 | 385.001642 | 172.177968 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.692588 | 0.000000 | 17.692588 | 353.851750 | 176.925875 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0577 | 1.155 | 13.601257 | 0.000000 | 13.601257 | 272.025148 | 235.580688 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### transient-swept-held-static:local-mpp-area-integral

Transient pure-rotation E00 baseline on swept geometry.

Official ranking eligible: yes; verdict: pass; calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.072559 | 0.000000 | 40.072559 | 801.451173 | 160.290235 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 27.416879 | 0.000000 | 27.416879 | 548.337580 | 137.084395 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 24.383641 | 0.000000 | 24.383641 | 487.672813 | 153.206933 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.250082 | 0.000000 | 19.250082 | 385.001642 | 172.177968 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.692588 | 0.000000 | 17.692588 | 353.851750 | 176.925875 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 7.840353 | 0.000000 | 7.840353 | 156.807067 | 213.312419 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### transient-controlled-motor-net:local-mpp-area-integral

Transient E11 with controlled 2 RPM and active motor net AC.

Official ranking eligible: yes; verdict: pass; calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.116188 | 0.004317 | 40.114016 | 802.280321 | 160.456064 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 27.450185 | 0.004317 | 27.448043 | 548.960862 | 137.240215 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 24.554543 | 0.004317 | 24.552415 | 491.048301 | 154.267373 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.287822 | 0.004317 | 19.285721 | 385.714416 | 172.496731 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.720695 | 0.004317 | 17.718615 | 354.372294 | 177.186147 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 6.512353 | 0.004317 | 6.510508 | 130.210164 | 177.131334 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

### transient-natural-no-cq:local-mpp-area-integral

Transient no-C_Q natural result; exact zero schedule reuses the static land-matched calculation.

Official ranking eligible: yes; verdict: pass; calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC kWh/y | Motor kWh/y | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation | Weather/time |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.072559 | 0.000000 | 40.072559 | 801.451173 | 160.290235 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 39.728507 | 0.000000 | 39.728507 | 794.570145 | 158.914029 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 27.416879 | 0.000000 | 27.416879 | 548.337580 | 137.084395 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.250082 | 0.000000 | 19.250082 | 385.001642 | 172.177968 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.692588 | 0.000000 | 17.692588 | 353.851750 | 176.925875 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |
| 6 | plane | 0.0500 | 0.0577 | 1.155 | 13.601257 | 0.000000 | 13.601257 | 272.025148 | 235.580688 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM | offline/model-estimate; 60 min; actual 8760 intervals + closing endpoint |

## Ideal local-MPP upper bound versus engineering connection

Only groups with the same geometry, rotation, thermal, weather, and time contracts are paired. Engineering values and their order remain exploratory because the engineering convergence gate failed; they are not official ranks.

| Comparison family | Shape | Ideal AC kWh/y | Engineering AC kWh/y | Engineering - ideal |
|---|---|---:|---:|---:|
| static-land-matched | cylinder | 39.257503 | 21.718897 | -44.675806% |
| static-land-matched | cube | 39.091586 | 23.179101 | -40.705653% |
| static-land-matched | sphere | 26.806723 | 14.870907 | -44.525458% |
| static-land-matched | cone | 18.818861 | 10.675096 | -43.274481% |
| static-land-matched | hemisphere | 17.231525 | 14.335540 | -16.806319% |
| static-land-matched | plane | 13.315868 | 11.359858 | -14.689316% |
| swept-held-static | cylinder | 39.257503 | 21.718897 | -44.675806% |
| swept-held-static | sphere | 26.806723 | 14.870907 | -44.525458% |
| swept-held-static | cube | 23.957550 | 13.223588 | -44.804089% |
| swept-held-static | cone | 18.818861 | 10.675096 | -43.274481% |
| swept-held-static | hemisphere | 17.231525 | 14.335540 | -16.806319% |
| swept-held-static | plane | 7.623472 | 6.072813 | -20.340584% |
| controlled-kinematic | cylinder | 39.257503 | 21.726371 | -44.656769% |
| controlled-kinematic | sphere | 26.806723 | 14.752493 | -44.967189% |
| controlled-kinematic | cube | 24.123998 | 13.083130 | -45.767158% |
| controlled-kinematic | cone | 18.818861 | 10.806862 | -42.574302% |
| controlled-kinematic | hemisphere | 17.231525 | 14.032218 | -18.566592% |
| controlled-kinematic | plane | 6.356156 | 5.074236 | -20.168169% |
| controlled-motor-net | cylinder | 39.255456 | 21.724336 | -44.659067% |
| controlled-motor-net | sphere | 26.804692 | 14.750490 | -44.970494% |
| controlled-motor-net | cube | 24.121975 | 13.081131 | -45.770894% |
| controlled-motor-net | cone | 18.816857 | 10.804901 | -42.578611% |
| controlled-motor-net | hemisphere | 17.229532 | 14.030231 | -18.568703% |
| controlled-motor-net | plane | 6.354256 | 5.072359 | -20.173830% |
| natural-no-cq | cylinder | 39.257503 | 21.718897 | -44.675806% |
| natural-no-cq | cube | 39.091586 | 23.179101 | -40.705653% |
| natural-no-cq | sphere | 26.806723 | 14.870907 | -44.525458% |
| natural-no-cq | cone | 18.818861 | 10.675096 | -43.274481% |
| natural-no-cq | hemisphere | 17.231525 | 14.335540 | -16.806319% |
| natural-no-cq | plane | 13.315868 | 11.359858 | -14.689316% |

## Shape-specific annual transient E00/E10/E01/E11

| Shape | E00 Wh | E10 Wh | E01 Wh | E11 Wh | Optical Wh | Thermal Wh | Interaction Wh | Net Wh | Closure Wh | Heat residual | Warm-up |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| plane | 7840.353372 | 6510.504200 | 7838.543253 | 6510.508191 | -1329.849172 | -1.810119 | 1.814110e+0 | -1329.845181 | 0.000e+0 | 1.268e-12 | pass |
| cube | 24383.640660 | 24552.404409 | 24381.525307 | 24552.415047 | 168.763749 | -2.115354 | 2.125992e+0 | 168.774387 | 0.000e+0 | 8.816e-13 | pass |
| cylinder | 40072.558659 | 40113.986637 | 40070.418271 | 40114.016047 | 41.427978 | -2.140388 | 2.169798e+0 | 41.457388 | 0.000e+0 | 4.969e-13 | pass |
| sphere | 27416.878990 | 27448.021024 | 27414.760566 | 27448.043084 | 31.142034 | -2.118423 | 2.140484e+0 | 31.164095 | 0.000e+0 | 4.254e-13 | pass |
| hemisphere | 17692.587520 | 17718.595847 | 17690.527215 | 17718.614699 | 26.008326 | -2.060306 | 2.079158e+0 | 26.027179 | 0.000e+0 | 1.429e-12 | pass |
| cone | 19250.082087 | 19285.706181 | 19247.996372 | 19285.720814 | 35.624094 | -2.085714 | 2.100347e+0 | 35.638727 | 0.000e+0 | 1.139e-12 | pass |

## Monthly transient decomposition by shape

| Shape | Month | E00 Wh | E10 Wh | E01 Wh | E11 Wh | Optical Wh | Thermal Wh | Interaction Wh | Net Wh | Closure Wh |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| plane | 2025-01 | 387.904425 | 243.013162 | 387.781262 | 243.013203 | -144.891263 | -0.123164 | 1.232049e-1 | -144.891222 | 2.842e-14 |
| plane | 2025-02 | 492.927072 | 339.253509 | 492.801606 | 339.253606 | -153.673563 | -0.125466 | 1.255628e-1 | -153.673466 | 0.000e+0 |
| plane | 2025-03 | 685.035158 | 536.185430 | 684.878792 | 536.185675 | -148.849727 | -0.156366 | 1.566109e-1 | -148.849482 | 0.000e+0 |
| plane | 2025-04 | 808.855885 | 696.832373 | 808.694228 | 696.833075 | -112.023512 | -0.161657 | 1.623597e-1 | -112.022810 | 0.000e+0 |
| plane | 2025-05 | 852.770545 | 804.687694 | 852.599792 | 804.688642 | -48.082851 | -0.170752 | 1.717006e-1 | -48.081903 | 0.000e+0 |
| plane | 2025-06 | 848.139124 | 838.159355 | 847.959588 | 838.159824 | -9.979769 | -0.179536 | 1.800049e-1 | -9.979300 | 0.000e+0 |
| plane | 2025-07 | 846.694539 | 819.074569 | 846.512433 | 819.075072 | -27.619969 | -0.182105 | 1.826086e-1 | -27.619466 | 0.000e+0 |
| plane | 2025-08 | 837.807503 | 749.027214 | 837.638989 | 749.027619 | -88.780288 | -0.168514 | 1.689188e-1 | -88.779884 | 0.000e+0 |
| plane | 2025-09 | 712.909488 | 577.979914 | 712.750640 | 577.980119 | -134.929574 | -0.158848 | 1.590532e-1 | -134.929369 | 0.000e+0 |
| plane | 2025-10 | 584.350622 | 421.073513 | 584.208675 | 421.073807 | -163.277109 | -0.141947 | 1.422401e-1 | -163.276816 | 0.000e+0 |
| plane | 2025-11 | 429.851905 | 273.694407 | 429.726411 | 273.694461 | -156.157499 | -0.125494 | 1.255480e-1 | -156.157444 | 0.000e+0 |
| plane | 2025-12 | 353.107106 | 211.523059 | 352.990837 | 211.523086 | -141.584047 | -0.116269 | 1.162971e-1 | -141.584020 | 0.000e+0 |
| cube | 2025-01 | 1235.177647 | 1229.174965 | 1235.034949 | 1229.175121 | -6.002681 | -0.142698 | 1.428540e-1 | -6.002526 | 0.000e+0 |
| cube | 2025-02 | 1500.479434 | 1489.603786 | 1500.336457 | 1489.604121 | -10.875648 | -0.142977 | 1.433127e-1 | -10.875312 | 0.000e+0 |
| cube | 2025-03 | 2094.901531 | 2088.505431 | 2094.725029 | 2088.506253 | -6.396100 | -0.176502 | 1.773242e-1 | -6.395278 | 0.000e+0 |
| cube | 2025-04 | 2421.925164 | 2445.049317 | 2421.735556 | 2445.051233 | 23.124154 | -0.189608 | 1.915241e-1 | 23.126070 | 0.000e+0 |
| cube | 2025-05 | 2680.595359 | 2725.697415 | 2680.387776 | 2725.699563 | 45.102056 | -0.207584 | 2.097319e-1 | 45.104204 | 0.000e+0 |
| cube | 2025-06 | 2747.958749 | 2802.963371 | 2747.743574 | 2802.964432 | 55.004621 | -0.215175 | 2.162359e-1 | 55.005682 | 0.000e+0 |
| cube | 2025-07 | 2734.471168 | 2783.692842 | 2734.256736 | 2783.694092 | 49.221673 | -0.214432 | 2.156828e-1 | 49.222924 | 0.000e+0 |
| cube | 2025-08 | 2577.413110 | 2616.135134 | 2577.212710 | 2616.136137 | 38.722024 | -0.200400 | 2.014032e-1 | 38.723027 | 0.000e+0 |
| cube | 2025-09 | 2161.653048 | 2165.404536 | 2161.471380 | 2165.405124 | 3.751488 | -0.181668 | 1.822552e-1 | 3.752075 | 0.000e+0 |
| cube | 2025-10 | 1768.606058 | 1756.421935 | 1768.441742 | 1756.422996 | -12.184123 | -0.164316 | 1.653768e-1 | -12.183062 | 0.000e+0 |
| cube | 2025-11 | 1332.911782 | 1324.776764 | 1332.769129 | 1324.776959 | -8.135018 | -0.142653 | 1.428473e-1 | -8.134824 | 0.000e+0 |
| cube | 2025-12 | 1127.547609 | 1124.978911 | 1127.410269 | 1124.979015 | -2.568698 | -0.137340 | 1.374435e-1 | -2.568594 | 0.000e+0 |
| cylinder | 2025-01 | 2033.051498 | 2033.935777 | 2032.904645 | 2033.936234 | 0.884279 | -0.146853 | 1.473100e-1 | 0.884736 | 0.000e+0 |
| cylinder | 2025-02 | 2441.743496 | 2443.572009 | 2441.597170 | 2443.572968 | 1.828513 | -0.146326 | 1.472848e-1 | 1.829472 | 0.000e+0 |
| cylinder | 2025-03 | 3407.063204 | 3410.099994 | 3406.883154 | 3410.102161 | 3.036790 | -0.180050 | 1.822170e-1 | 3.038957 | 0.000e+0 |
| cylinder | 2025-04 | 3975.812979 | 3980.531441 | 3975.625218 | 3980.535674 | 4.718462 | -0.187761 | 1.919937e-1 | 4.722694 | 0.000e+0 |
| cylinder | 2025-05 | 4430.990268 | 4436.545191 | 4430.779715 | 4436.551681 | 5.554923 | -0.210553 | 2.170431e-1 | 5.561413 | 0.000e+0 |
| cylinder | 2025-06 | 4554.348198 | 4561.106047 | 4554.129648 | 4561.109007 | 6.757849 | -0.218550 | 2.215098e-1 | 6.760809 | 0.000e+0 |
| cylinder | 2025-07 | 4524.269406 | 4530.041322 | 4524.050485 | 4530.044777 | 5.771917 | -0.218920 | 2.223748e-1 | 5.775371 | 0.000e+0 |
| cylinder | 2025-08 | 4249.740301 | 4255.974902 | 4249.541386 | 4255.977741 | 6.234602 | -0.198914 | 2.017532e-1 | 6.237441 | 0.000e+0 |
| cylinder | 2025-09 | 3531.658349 | 3534.399467 | 3531.474309 | 3534.402064 | 2.741118 | -0.184040 | 1.866364e-1 | 2.743715 | 0.000e+0 |
| cylinder | 2025-10 | 2876.625355 | 2878.585027 | 2876.459849 | 2878.587408 | 1.959672 | -0.165506 | 1.678871e-1 | 1.962053 | 0.000e+0 |
| cylinder | 2025-11 | 2182.965236 | 2184.256611 | 2182.819475 | 2184.257172 | 1.291376 | -0.145761 | 1.463214e-1 | 1.291936 | 0.000e+0 |
| cylinder | 2025-12 | 1864.290370 | 1864.938846 | 1864.153217 | 1864.939161 | 0.648477 | -0.137153 | 1.374672e-1 | 0.648791 | 0.000e+0 |
| sphere | 2025-01 | 1354.686561 | 1355.366224 | 1354.543352 | 1355.366400 | 0.679663 | -0.143209 | 1.433852e-1 | 0.679838 | 0.000e+0 |
| sphere | 2025-02 | 1638.062739 | 1639.197436 | 1637.919845 | 1639.197913 | 1.134696 | -0.142894 | 1.433717e-1 | 1.135174 | 0.000e+0 |
| sphere | 2025-03 | 2307.141309 | 2309.556415 | 2306.961874 | 2309.557292 | 2.415106 | -0.179436 | 1.803126e-1 | 2.415983 | 0.000e+0 |
| sphere | 2025-04 | 2733.835421 | 2737.466952 | 2733.645158 | 2737.468291 | 3.631531 | -0.190264 | 1.916031e-1 | 3.632870 | 0.000e+0 |
| sphere | 2025-05 | 3083.864239 | 3087.919703 | 3083.655536 | 3087.924224 | 4.055465 | -0.208702 | 2.132228e-1 | 4.059985 | 0.000e+0 |
| sphere | 2025-06 | 3179.930547 | 3184.835410 | 3179.713097 | 3184.837101 | 4.904863 | -0.217450 | 2.191413e-1 | 4.906554 | 0.000e+0 |
| sphere | 2025-07 | 3152.748011 | 3157.009006 | 3152.533710 | 3157.011271 | 4.260995 | -0.214301 | 2.165664e-1 | 4.263260 | 0.000e+0 |
| sphere | 2025-08 | 2933.564449 | 2938.077574 | 2933.364613 | 2938.079141 | 4.513125 | -0.199836 | 2.014028e-1 | 4.514692 | 0.000e+0 |
| sphere | 2025-09 | 2401.686440 | 2404.285274 | 2401.510777 | 2404.292745 | 2.598835 | -0.175662 | 1.831333e-1 | 2.606305 | 0.000e+0 |
| sphere | 2025-10 | 1933.294305 | 1934.750076 | 1933.128486 | 1934.750783 | 1.455771 | -0.165819 | 1.665264e-1 | 1.456478 | 0.000e+0 |
| sphere | 2025-11 | 1457.337618 | 1458.206347 | 1457.193518 | 1458.206615 | 0.868729 | -0.144100 | 1.443681e-1 | 0.868997 | 0.000e+0 |
| sphere | 2025-12 | 1240.727349 | 1241.350607 | 1240.590599 | 1241.351307 | 0.623258 | -0.136750 | 1.374502e-1 | 0.623958 | 0.000e+0 |
| hemisphere | 2025-01 | 827.545775 | 827.955278 | 827.406984 | 827.955443 | 0.409504 | -0.138790 | 1.389548e-1 | 0.409668 | 0.000e+0 |
| hemisphere | 2025-02 | 1028.118028 | 1028.993414 | 1027.978501 | 1028.993815 | 0.875386 | -0.139527 | 1.399278e-1 | 0.875787 | 0.000e+0 |
| hemisphere | 2025-03 | 1483.561330 | 1485.538492 | 1483.389628 | 1485.539227 | 1.977162 | -0.171701 | 1.724371e-1 | 1.977898 | 0.000e+0 |
| hemisphere | 2025-04 | 1793.137943 | 1796.283592 | 1792.948461 | 1796.284732 | 3.145649 | -0.189482 | 1.906217e-1 | 3.146788 | 0.000e+0 |
| hemisphere | 2025-05 | 2033.602909 | 2037.086918 | 2033.403442 | 2037.090809 | 3.484009 | -0.199467 | 2.033575e-1 | 3.487900 | 0.000e+0 |
| hemisphere | 2025-06 | 2097.580013 | 2101.850399 | 2097.371677 | 2101.851835 | 4.270386 | -0.208336 | 2.097719e-1 | 4.271822 | 0.000e+0 |
| hemisphere | 2025-07 | 2073.762350 | 2077.491108 | 2073.552104 | 2077.492988 | 3.728757 | -0.210246 | 2.121269e-1 | 3.730638 | 0.000e+0 |
| hemisphere | 2025-08 | 1925.596582 | 1929.647250 | 1925.398953 | 1929.648570 | 4.050668 | -0.197629 | 1.989491e-1 | 4.051988 | 0.000e+0 |
| hemisphere | 2025-09 | 1554.612286 | 1556.707678 | 1554.441448 | 1556.714089 | 2.095392 | -0.170838 | 1.772491e-1 | 2.101802 | 0.000e+0 |
| hemisphere | 2025-10 | 1226.022332 | 1227.106682 | 1225.862618 | 1227.107286 | 1.084350 | -0.159714 | 1.603185e-1 | 1.084954 | 0.000e+0 |
| hemisphere | 2025-11 | 898.504239 | 899.088276 | 898.365518 | 899.088510 | 0.584037 | -0.138721 | 1.389549e-1 | 0.584271 | 0.000e+0 |
| hemisphere | 2025-12 | 750.543734 | 750.846760 | 750.407882 | 750.847396 | 0.303026 | -0.135853 | 1.364885e-1 | 0.303662 | 0.000e+0 |
| cone | 2025-01 | 938.468533 | 939.008664 | 938.327236 | 939.008776 | 0.540131 | -0.141297 | 1.414087e-1 | 0.540243 | 0.000e+0 |
| cone | 2025-02 | 1145.765915 | 1146.954145 | 1145.624772 | 1146.954432 | 1.188230 | -0.141142 | 1.414288e-1 | 1.188517 | 0.000e+0 |
| cone | 2025-03 | 1620.145933 | 1623.051982 | 1619.973025 | 1623.052509 | 2.906049 | -0.172908 | 1.734355e-1 | 2.906577 | 0.000e+0 |
| cone | 2025-04 | 1922.254829 | 1926.262558 | 1922.064496 | 1926.263362 | 4.007729 | -0.190333 | 1.911370e-1 | 4.008533 | 0.000e+0 |
| cone | 2025-05 | 2175.216920 | 2180.328401 | 2175.012869 | 2180.331086 | 5.111480 | -0.204051 | 2.067362e-1 | 5.114166 | 0.000e+0 |
| cone | 2025-06 | 2248.098135 | 2253.732450 | 2247.886866 | 2253.733457 | 5.634315 | -0.211269 | 2.122759e-1 | 5.635321 | 0.000e+0 |
| cone | 2025-07 | 2225.285469 | 2230.219825 | 2225.072690 | 2230.221267 | 4.934357 | -0.212779 | 2.142203e-1 | 4.935798 | 0.000e+0 |
| cone | 2025-08 | 2063.799211 | 2069.644615 | 2063.600159 | 2069.645533 | 5.845404 | -0.199052 | 1.999691e-1 | 5.846322 | 0.000e+0 |
| cone | 2025-09 | 1685.792429 | 1688.751848 | 1685.618734 | 1688.757393 | 2.959419 | -0.173694 | 1.792397e-1 | 2.964964 | 0.000e+0 |
| cone | 2025-10 | 1354.263653 | 1355.646024 | 1354.101000 | 1355.646465 | 1.382372 | -0.162652 | 1.630930e-1 | 1.382812 | 0.000e+0 |
| cone | 2025-11 | 1014.074215 | 1014.889754 | 1013.934440 | 1014.889923 | 0.815539 | -0.139775 | 1.399442e-1 | 0.815708 | 0.000e+0 |
| cone | 2025-12 | 856.916845 | 857.215914 | 856.780083 | 857.216611 | 0.299069 | -0.136762 | 1.374585e-1 | 0.299766 | 0.000e+0 |

## Independent annual transient thermal audit

Coverage: 8761 boundaries, 8760 intervals, 8760 h.

| E00 Wh | E10 Wh | E01 Wh | E11 Wh | Optical Wh | Thermal Wh | Interaction Wh | Net Wh | Closure residual Wh |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 38561.615393 | 38652.134236 | 38561.620582 | 38652.138435 | 90.518843 | 0.005189678 | -9.908870e-4 | 90.523042 | 0.000e+0 |

Heat-ledger relative residual: 2.217333e-12. Reduced thermal-mesh convergence: pass.

## Quasi-steady versus transient thermal result

| Rotation | Quasi-steady AC Wh | Transient AC Wh | Difference Wh | Difference |
|---|---:|---:|---:|---:|
| Static | 37704.729804 | 38561.615393 | 856.885589 | 2.272621% |
| Controlled RPM | 37709.676551 | 38652.138435 | 942.461884 | 2.499257% |

## Shape-specific natural RPM

| Shape | Official no-C_Q RPM | Confidence | Official eligible | Unverified user-C_Q RPM | Sensitivity eligible |
|---|---:|---|---|---:|---|
| plane | 0.000000 | low | yes | 0.000000 | no (auxiliary-footprint-not-in-A_land, auxiliary-height-not-in-H_max, auxiliary-shadow-not-in-PV-yield) |
| cube | 0.000000 | low | yes | 0.000000 | no (auxiliary-footprint-not-in-A_land, auxiliary-height-not-in-H_max, auxiliary-shadow-not-in-PV-yield) |
| cylinder | 0.000000 | low | yes | 0.000000 | no (auxiliary-footprint-not-in-A_land, auxiliary-height-not-in-H_max, auxiliary-shadow-not-in-PV-yield) |
| sphere | 0.000000 | low | yes | 0.000000 | no (auxiliary-footprint-not-in-A_land, auxiliary-height-not-in-H_max, auxiliary-shadow-not-in-PV-yield) |
| hemisphere | 0.000000 | low | yes | 0.000000 | no (auxiliary-footprint-not-in-A_land, auxiliary-height-not-in-H_max, auxiliary-shadow-not-in-PV-yield) |
| cone | 0.000000 | low | yes | 0.000000 | no (auxiliary-footprint-not-in-A_land, auxiliary-height-not-in-H_max, auxiliary-shadow-not-in-PV-yield) |

## Primary-source reproduction audit

Evaluated 2/6; pass 2, partial 0, fail 0, not-evaluated 4.

Input policy: source inputs only; missing values were not estimated; no calibration factors, shape multipliers, or reported-output solver targets were permitted.

### Source-equivalent condition matrix

| Study | Geometry | Area basis | Source/spectrum | Incidence | Weather | Albedo/reflector | Thermal/convection | Electrical connection | Measured quantity | Primary sources |
|---|---|---|---|---|---|---|---|---|---|---|
| research:A: Three-dimensional photovoltaics | GA-optimized open-box/funnel assemblies of 64 double-sided triangular cells | fixed 10 m x 10 m bounding footprint; heights 2, 4, 6, 8, 10 m; active area not tabulated as one reusable value | clear parallel p-polarized rays; refractive index 1.505; normal reflectance 4.1%; no spectral weather series | solar trajectory over a summer day; 12 min time step; source does not identify one executable calendar date | San Francisco summer day; clouds and external obstructions neglected; source-equivalent irradiance series unavailable | no ground reflection; at most one specular reflection among structure triangles | not modeled in the reported optical optimization | 6% conversion efficiency applied to independently illuminated double-sided triangles; full circuit topology not reported | simulated one-day generated energy relative to a flat comparator | [1](https://doi.org/10.1063/1.3308490) [2](https://authors.library.caltech.edu/records/7bv9y-j0563) [3](https://authors.library.caltech.edu/records/7bv9y-j0563/files/1.3308490.pdf) |
| research:B: Solar energy generation in three dimensions | flat silicon cells and mirrors assembled as open cubes and funnels; 35 mm indoor cube case | paper separately uses base area, bounding volume, cell area and flat-cell comparator area | 1300 W xenon arc lamp with AM1.5 filter at 1000 W/m2 indoors; clear-sky solar trajectory outdoors | lamp/structure geometry is not published as a complete machine-readable fixture; outdoor I-V sweeps every 12-15 min | MIT roof, Cambridge MA, June-December 2011; raw weather/I-V series not bundled | paper-specific cell/mirror ray tracing; exact indoor background and ground albedo unavailable | temperature/convection boundary conditions are not a complete executable source case | cells in parallel, one blocking diode in series with each cell | energy per base area, instantaneous I-V curves and indoor/outdoor relative output | [1](https://doi.org/10.1039/C2EE21170J) [2](https://pubs.rsc.org/en/content/articlelanding/2012/ee/c2ee21170j) [3](https://www.rsc.org/suppdata/ee/c2/c2ee21170j/c2ee21170j.pdf) |
| research:C: Nature-inspired spherical silicon solar cell for three-dimensional light harvesting, improved dust and thermal management | corrugated interdigitated-back-contact monocrystalline silicon cell folded into a sphere | 10.7 cm2 projection, 11.34 cm2 ground area; 42.8 cm2 spherical area in the equal-ground thermal comparison | AM1.5G solar simulator, 1000 W/m2 with spectral mismatch correction | angle sweep with white background at 1 cm; separate background-height sweeps from 0 to 10 cm | indoor room-temperature solar-simulator tests | black 3% diffuse, sand 25% diffuse, white 85% diffuse, aluminium 88% specular, and a separate 45 degree cup | continuous one-sun exposure; temperatures sampled about every 1.5 min; sphere apex measured by IR sensor | corrugated IBC cell; complete spatial electrical network is not public as an executable circuit | maximum power, angular response, surface temperature and power degradation from 21 C | [1](https://doi.org/10.1557/mrc.2020.44) [2](https://www.cambridge.org/core/journals/mrs-communications/article/natureinspired-spherical-silicon-solar-cell-for-three-dimensional-light-harvesting-improved-dust-and-thermal-management/0EE382BEDC3D233365B27E4C3777FDC4) [3](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/0EE382BEDC3D233365B27E4C3777FDC4/S2159685920000440a.pdf/natureinspired_spherical_silicon_solar_cell_for_threedimensional_light_harvesting_improved_dust_and_thermal_management.pdf) |
| research:D: Harnessing solar power with aesthetic innovation: An in-depth study on spherical and hemispherical photovoltaic configurations | 0.3 m sphere/hemisphere supports tiled with rectangular flexible PV modules at 70% coverage | 0.07 m2 circular projection, 0.01 m2 support footprint, 0.099/0.198 m2 module area kept as distinct denominators | outdoor global irradiance; 890 W/m2 is only a single-module I-V condition, not a daily series | modules occupy discrete orientations; rear low-light modules are material to the comparison | outdoor daylight air temperature about 25-30 C; source raw irradiance/temperature series unavailable | ground reflection is not reported as a machine-readable albedo | configuration-specific module temperatures reported; convection coefficients and full histories unavailable | series/parallel arrangements vary by configuration; complete topology and bypass behavior unavailable | outdoor power/energy, module temperature and spacing-dependent shadow losses | [1](https://doi.org/10.1002/ese3.1717) [2](https://scijournals.onlinelibrary.wiley.com/doi/full/10.1002/ese3.1717) |
| source:E: Evaluation of direct beam energy received by convex solar collectors and their optimal orientations | convex sphere; analytic projected area pi R2 | unit spherical surface area and unit ground-occupied area are reported separately (4:1 ratio) | broadband direct-normal beam only; Gsc=1367 W/m2 and Hottel clear-sky transmittance | day 81 sunrise-to-sunset hour-angle integration; sphere projection is independent of beam direction | Tehran latitude 35.69 N; 1200 m and midlatitude-summer Hottel inputs from the authors' public implementation | sky diffuse and ground-reflected irradiance explicitly excluded | outside the study scope | outside the study scope; benchmark is intercepted optical beam energy | daily direct beam energy per m2 sphere surface and per m2 ground-occupied area | [1](https://doi.org/10.1063/5.0161277) [2](https://www.researchgate.net/publication/375023238_Evaluation_of_direct_beam_energy_received_by_convex_solar_collectors_and_their_optimal_orientations) [3](https://github.com/aaghamohammadi/pysolorie) |
| source:F: Investigation of Convective Heat Transfer and Stability on a Rotating Disk: A Novel Experimental Method and Thermal Modeling | 0.2 m radius, 0.01 m thick polished aluminium disk rotating in still air | disk face area 0.1256 m2; experiment 1 radial evaluation line 0.005-0.194 m | electrical uniform heat flux; no solar spectrum | not an optical experiment | quiescent laboratory air; experiment 1 ambient 22.2 C | not applicable; emissivity 0.04 in energy balance and 0.07 for camera calibration | initial wall 52.1 C; 34.55 rad/s; local Nu=h r/k; Sutherland air properties; 100 s run | heater supplies uniform heat flux; rear losses reported below 1% through insulation | transient IR temperature-derived local heat-transfer coefficient, Reynolds and Nusselt numbers | [1](https://doi.org/10.3390/fluids9070167) [2](https://www.mdpi.com/2311-5521/9/7/167) |

### Study verdicts and condition matching

| Study | Verdict | Reported value/trend | Simulation result | Conditions matched | Conditions not matched | Primary sources |
|---|---|---|---|---|---|---|
| research:A: Three-dimensional photovoltaics | not-evaluated | At fixed 10 m x 10 m footprint, optimized one-day energy increases approximately linearly across the 2-10 m height sweep and the daily curve is flatter than the flat comparator. | Not run under a complete source-equivalent case; the ordinary Seoul six-shape comparison is not evidence for this study. | The research namespace preserves the 100 m2 footprint, 10 m selected height, optical constants, and 12 minute source time step. | No source 64-triangle coordinates or GA optimizer are implemented by the preset adapter.; The exact San Francisco date/latitude and a source-equivalent irradiance series are not reported as executable inputs.; The general continuous-skin geometries are not the paper's double-sided triangular open-box/funnel structures. | [1](https://doi.org/10.1063/1.3308490) [2](https://authors.library.caltech.edu/records/7bv9y-j0563) [3](https://authors.library.caltech.edu/records/7bv9y-j0563/files/1.3308490.pdf) |
| research:B: Solar energy generation in three dimensions | not-evaluated | The reported structures increase energy per footprint and flatten daily/seasonal output, while generally using more PV material per generated energy than a flat panel. | Not run under a complete source-equivalent case; the ordinary Seoul cube result uses a different continuous active area and comparator. | The indoor metadata preserves the 35 mm cube base/height, 1000 W/m2 lamp, 14% cover reflectivity, and isolated research namespace. | The exact five-cell placement, active cell area, support, lamp geometry, and blocking-diode I-V behavior are not represented by the continuous-skin comparison.; The reported 2-20x cases span different structures, heights, latitudes, seasons, mirror areas, and flat comparator poses.; No source outdoor raw weather and I-V time series is bundled. | [1](https://doi.org/10.1039/C2EE21170J) [2](https://pubs.rsc.org/en/content/articlelanding/2012/ee/c2ee21170j) [3](https://www.rsc.org/suppdata/ee/c2/c2ee21170j/c2ee21170j.pdf) |
| research:C: Nature-inspired spherical silicon solar cell for three-dimensional light harvesting, improved dust and thermal management | not-evaluated | The sphere is angularly insensitive and captures more reflected light for the tested backgrounds; the strongest +101% observation occurs only with the 1 cm aluminium cup, while measured maximum temperature is below the flat comparator. | Not run under a complete source-equivalent case; no general sphere result is labelled as reproducing a reflector or thermal observation. | The selected metadata preserves equal-ground/equal-projection denominators, 1000 W/m2 AM1.5G, white diffuse reflectance, and the 1 cm angular-test gap.; Black, white, sand, aluminium paper, aluminium cup, and no-reflector observations remain separate source conditions. | The corrugated IBC sphere, etched area, exact diameter, electrical network, lamp geometry, cup geometry, and spectral mismatch are not fully represented.; The app's diffuse ground model is not a substitute for a finite close background or a specular/concentrating cup.; The source thermal comparisons use different area denominators and measurement definitions. | [1](https://doi.org/10.1557/mrc.2020.44) [2](https://www.cambridge.org/core/journals/mrs-communications/article/natureinspired-spherical-silicon-solar-cell-for-three-dimensional-light-harvesting-improved-dust-and-thermal-management/0EE382BEDC3D233365B27E4C3777FDC4) [3](https://www.cambridge.org/core/services/aop-cambridge-core/content/view/0EE382BEDC3D233365B27E4C3777FDC4/S2159685920000440a.pdf/natureinspired_spherical_silicon_solar_cell_for_threedimensional_light_harvesting_improved_dust_and_thermal_management.pdf) |
| research:D: Harnessing solar power with aesthetic innovation: An in-depth study on spherical and hemispherical photovoltaic configurations | not-evaluated | The source reports a hemisphere producing 32% more energy than its sphere comparison and links the difference to oppositely oriented low-light modules; multiple structures incur spacing-dependent shadow losses. | Not run under a complete source-equivalent case; approximately 32% is not forced and the ordinary sphere/hemisphere ranking is not a reproduction. | The metadata preserves 0.3 m diameter, module counts, 70% coverage, active areas, projected area, and support footprint as separate fields. | The ordinary ideal sphere/hemisphere skins have 100% continuous coverage and local MPP rather than the source's rectangular modules, gaps, and wiring.; The article's 0.01 m2 support denominator and 0.07 m2 projected footprint cannot be merged into one land-area comparison.; Raw irradiance, module temperature, I-V, albedo, rear low-light response, and full wiring time series are unavailable as executable inputs. | [1](https://doi.org/10.1002/ese3.1717) [2](https://scijournals.onlinelibrary.wiley.com/doi/full/10.1002/ese3.1717) |
| source:E: Evaluation of direct beam energy received by convex solar collectors and their optimal orientations | pass | A sphere receives 8.36 MJ/m2 of its surface and 33.44 MJ/m2 of ground-occupied area on day 81 at Tehran. | Independent Simpson integration with the simulator's exact sphere projection produced 8.353533 and 33.414133 MJ/m2. | sphere projection pi R2 and 4 pi R2 active surface; Tehran latitude 35.69 N and day-of-year 81; author-published 1200 m midlatitude-summer Hottel inputs; Gsc=1367 W/m2, 0.033 orbital correction and 7.15e-5 rad/s hour-angle rate; direct beam only; diffuse and ground reflection disabled | the study computes intercepted optical energy, not spectral PV conversion, temperature or a circuit; the paper does not publish its original numerical integration mesh | [1](https://doi.org/10.1063/5.0161277) [2](https://www.researchgate.net/publication/375023238_Evaluation_of_direct_beam_energy_received_by_convex_solar_collectors_and_their_optimal_orientations) [3](https://github.com/aaghamohammadi/pysolorie) |
| source:F: Investigation of Convective Heat Transfer and Stability on a Rotating Disk: A Novel Experimental Method and Thermal Modeling | pass | Experiment 1 remains laminar over the evaluated radius and follows Nu=0.36 sqrt(Re_omega); Table 5 reports Re_omega=83,908. | Sutherland air properties at the reported film temperature give Re=82955.051 and Nu=103.686907. | experiment 1 omega=34.55 rad/s and outer evaluated radius 0.194 m; reported wall 52.1 C and ambient 22.2 C film-temperature method; reported Sutherland reference viscosity, temperature and constant; paper's laminar coefficient K=0.36; production external-convection API cati-laminar-rotating-disk branch; paper uncertainty is used as the pre-registered tolerance, not as a fitted multiplier | raw IR pixel temperatures and fitted local h(r) data are not published as machine-readable data; uniform heater heat flux magnitude is not tabulated for experiment 1; this heated aluminium disk is not a PV laminate and has no optical or electrical conversion | [1](https://doi.org/10.3390/fluids9070167) [2](https://www.mdpi.com/2311-5521/9/7/167) |

### Numeric benchmark metrics

| Study | Verdict | Metric | Reported | Simulated | Absolute error | Relative error | Tolerance | Tolerance basis | Metric verdict |
|---|---|---|---:|---:|---:|---:|---:|---|---|
| research:A | not-evaluated | insufficient source-equivalent inputs | ?? | ?? | ?? | ?? | ?? | not evaluated | not-evaluated |
| research:B | not-evaluated | insufficient source-equivalent inputs | ?? | ?? | ?? | ?? | ?? | not evaluated | not-evaluated |
| research:C | not-evaluated | insufficient source-equivalent inputs | ?? | ?? | ?? | ?? | ?? | not evaluated | not-evaluated |
| research:D | not-evaluated | insufficient source-equivalent inputs | ?? | ?? | ?? | ?? | ?? | not evaluated | not-evaluated |
| source:E | pass | daily direct beam energy per sphere surface area (MJ/m2-surface/day) | 8.360000000 | 8.353533265 | 0.006466735 | 0.077353% | 1.000% | pre-registered 1% numerical tolerance; source values are rounded to 0.01 MJ/m2 | pass |
| source:E | pass | daily direct beam energy per ground-occupied area (MJ/m2-land/day) | 33.440000000 | 33.414133062 | 0.025866938 | 0.077353% | 1.000% | pre-registered 1% numerical tolerance; source values are rounded to 0.01 MJ/m2 | pass |
| source:F | pass | local rotational Reynolds number at r=0.194 m (dimensionless) | 83908.000000000 | 82955.051260227 | 952.948739773 | 1.135707% | 1.720% | pre-registered from the paper's Table 2 Reynolds relative uncertainty (1.72%) | pass |
| source:F | pass | laminar local Nusselt number Nu=0.36 sqrt(Re_omega) (dimensionless) | 104.280759491 | 103.686906808 | 0.593852683 | 0.569475% | 2.160% | pre-registered conservative end of the paper's Table 2 Nusselt uncertainty (2.10-2.16%) | pass |

### Difference causes and sensitivity

| Study | Possible difference causes |
|---|---|
| research:A | different geometry and active material area; different weather, latitude, date, and diffuse-radiation treatment; different reflection order, polarization, and electrical topology |
| research:B | active-area and denominator mismatch; continuous local-MPP skin versus parallel discrete cells and blocking diodes; different reflector, latitude, season, weather, and flat-panel orientation |
| research:C | finite background/cup geometry and scattering mismatch; active-area, corrugation, and comparator-denominator mismatch; different convection boundary conditions and temperature measurement definitions |
| research:D | active coverage and PV-area mismatch; series/parallel mismatch from rear low-light modules; self-shading, inter-structure shadows, ground reflection, and temperature differences; support-footprint versus swept-projection denominator |
| source:E | rounding of the two-decimal reported values; integration quadrature resolution; using a different astronomical or clear-sky convention would no longer be source-equivalent |
| source:F | Table 5 Reynolds is rounded and may use spatially varying film properties; OCR-rendered air-property precision is limited to the digits printed in Table 4; ambient-property evaluation instead of the reported film-temperature method changes the result |

| Study | Parameter | Lower case/value | Baseline case/value | Upper case/value | Unit |
|---|---|---|---|---|---|
| research:A | not evaluated | ?? | ?? | ?? | ?? |
| research:B | not evaluated | ?? | ?? | ?? | ?? |
| research:C | not evaluated | ?? | ?? | ?? | ?? |
| research:D | not evaluated | ?? | ?? | ?? | ?? |
| source:E | Simpson interval count | 1,440 intervals: 8.352737896 | 14,400 intervals: 8.353533265 | reported rounded value: 8.360000000 | MJ/m2-surface/day |
| source:F | air-property evaluation temperature | film temperature (paper method): 82955.051260227 | reported Table 5: 83908.000000000 | ambient temperature only: 86158.088089885 | Re_omega |

## Interpretation boundaries

- Source E validates direct-beam convex-sphere geometry, not PV electrical or thermal behavior.
- Source F validates a heated aluminium rotating-disk Reynolds/Nusselt calculation, not an annual PV laminate model.
- A-D remain not-evaluated and are excluded from the validation-success count.
- The engineering connection uses equal-density cells, strings, bypass substrings, and wiring resistance, but remains a configurable topology rather than a manufacturer-specific module layout.
- The offline annual weather fixture is deterministic model-estimate data, not measured Seoul TMY. Rankings apply only to the stated inputs.
- Annual transient + explicit engineering circuit is unsupported and is not silently presented as a combined result.

## Machine-readable artifacts and executable audit code

- [Annual transient audit JSON](./annual-transient-audit-2026.json)
- [Fair geometry audit JSON](./fair-geometry-audit-2026.json)
- [Full-year comparison audit JSON](./full-year-comparison-audit-2026.json)
- [Natural rotation audit JSON](./natural-rotation-audit-2026.json)
- [Research source-equivalent audit JSON](./research-source-equivalent-audit.json)
- [Thermal comparison audit JSON](./thermal-model-comparison-audit-2026.json)
- [SHA-256 manifest](./validation-audit-manifest-2026.json)
- [Annual transient audit code](../scripts/audit-annual-transient.ts)
- [Fair geometry audit code](../scripts/audit-fair-geometry.ts)
- [Full-year comparison audit code](../scripts/audit-full-year-comparison-v2.ts)
- [Natural rotation audit code](../scripts/audit-natural-rotation.ts)
- [Research benchmark audit code](../scripts/audit-research-benchmarks.ts)
- [Thermal comparison audit code](../scripts/audit-thermal-model-comparison.ts)

## Provenance

- Manifest generated: 2026-08-13T16:41:45.999Z
- Source-set SHA-256: `c9980f7bcaf177edb59a38079826c5501e6d7be461fca9bf77388d5ab49ab004`
- Audit-set SHA-256: `1388fc45ae5d4a67f6dd2d691a6e73eb4ef9d32db8dc9f88c5efd2ff0a076d54`
- Hashed source files: 55; hashed audit JSON files: 6.
