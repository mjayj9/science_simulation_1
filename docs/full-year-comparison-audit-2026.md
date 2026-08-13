# Actual full-year fair-comparison audit

Every annual row uses 8,760 actual hourly intervals plus a non-integrated closing endpoint. No representative-day conversion, shape multiplier, or research-rank fitting is used.

Static land-matched designs and swept-envelope rotation-effect baselines are intentionally separate. Controlled active rotation reports motor-net AC. Transient ideal and quasi-steady engineering results remain separate because their combined solver is unsupported.

Official ideal convergence: PASS. Engineering official ranking: NOT EVALUATED (Engineering official ranking is not evaluated: the extended cylinder mesh check differed by 6.5273%, versus the pre-registered 2.00% tolerance. The production azimuth limit is 128, so a still-higher reference cannot be executed.). Preflight 238.5 s.

## static-land-matched:local-mpp-area-integral

Static designs sized so instantaneous horizontal projection equals A_land.

Official ranking eligible: yes.
Calculation resolution: azimuth=16; meridional=4; phase<=4; ideal local-MPP.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 39.257503 | 0.000000 | 39.257503 | 785.150063 | 157.030013 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 39.091586 | 0.000000 | 39.091586 | 781.831728 | 156.366346 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 26.806723 | 0.000000 | 26.806723 | 536.134455 | 134.033614 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 18.818861 | 0.000000 | 18.818861 | 376.377215 | 168.321008 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.231525 | 0.000000 | 17.231525 | 344.630502 | 172.315251 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 6 | plane | 0.0500 | 0.0577 | 1.155 | 13.315868 | 0.000000 | 13.315868 | 266.317364 | 230.637603 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |

## swept-held-static:local-mpp-area-integral

Pure-rotation baseline: rotating-envelope geometry held at 0 RPM.

Official ranking eligible: yes.
Calculation resolution: azimuth=16; meridional=4; phase<=4; ideal local-MPP.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 39.257503 | 0.000000 | 39.257503 | 785.150063 | 157.030013 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 26.806723 | 0.000000 | 26.806723 | 536.134455 | 134.033614 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 23.957550 | 0.000000 | 23.957550 | 479.151000 | 150.529726 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 18.818861 | 0.000000 | 18.818861 | 376.377215 | 168.321008 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.231525 | 0.000000 | 17.231525 | 344.630502 | 172.315251 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 7.623472 | 0.000000 | 7.623472 | 152.469440 | 207.411730 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |

## controlled-kinematic:local-mpp-area-integral

Common controlled 2 RPM gross AC before an active motor demand is deducted.

Official ranking eligible: yes.
Calculation resolution: azimuth=16; meridional=4; phase<=4; ideal local-MPP.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 39.257503 | 0.000000 | 39.257503 | 785.150063 | 157.030013 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 26.806723 | 0.000000 | 26.806723 | 536.134455 | 134.033614 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 24.123998 | 0.000000 | 24.123998 | 482.479960 | 151.575550 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 18.818861 | 0.000000 | 18.818861 | 376.377215 | 168.321008 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.231525 | 0.000000 | 17.231525 | 344.630502 | 172.315251 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 6.356156 | 0.000000 | 6.356156 | 127.123127 | 172.931885 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |

## controlled-motor-net:local-mpp-area-integral

Common controlled 2 RPM with active-motor demand deducted and net AC clipped at zero.

Official ranking eligible: yes.
Calculation resolution: azimuth=16; meridional=4; phase<=4; ideal local-MPP.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 39.257503 | 0.004317 | 39.255456 | 785.109126 | 157.021825 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 26.806723 | 0.004317 | 26.804692 | 536.093848 | 134.023462 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 24.123998 | 0.004317 | 24.121975 | 482.439491 | 151.562836 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 18.818861 | 0.004317 | 18.816857 | 376.337141 | 168.303086 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.231525 | 0.004317 | 17.229532 | 344.590644 | 172.295322 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 6.356156 | 0.004317 | 6.354256 | 127.085115 | 172.880175 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |

## natural-no-cq:local-mpp-area-integral

Natural dynamics with absent C_Q; exact zero-RPM result reuses the identical static land-matched calculation.

Official ranking eligible: yes.
Calculation resolution: azimuth=16; meridional=4; phase<=4; ideal local-MPP.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 39.257503 | 0.000000 | 39.257503 | 785.150063 | 157.030013 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 39.091586 | 0.000000 | 39.091586 | 781.831728 | 156.366346 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 26.806723 | 0.000000 | 26.806723 | 536.134455 | 134.033614 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 18.818861 | 0.000000 | 18.818861 | 376.377215 | 168.321008 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.231525 | 0.000000 | 17.231525 | 344.630502 | 172.315251 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 6 | plane | 0.0500 | 0.0577 | 1.155 | 13.315868 | 0.000000 | 13.315868 | 266.317364 | 230.637603 | local-mpp-area-integral | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |

## static-land-matched:explicit-series-parallel-bypass

Static designs sized so instantaneous horizontal projection equals A_land.

Official rank: not evaluated. Ordered exploratory output only. Engineering official ranking is not evaluated: the extended cylinder mesh check differed by 6.5273%, versus the pre-registered 2.00% tolerance. The production azimuth limit is 128, so a still-higher reference cannot be executed.
Calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cube | 0.0500 | 0.2500 | 5.000 | 23.179101 | 0.000000 | 23.179101 | 463.582020 | 92.716404 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 2 | cylinder | 0.0500 | 0.2500 | 5.000 | 21.718897 | 0.000000 | 21.718897 | 434.377946 | 86.875589 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 14.870907 | 0.000000 | 14.870907 | 297.418131 | 74.354533 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 4 | hemisphere | 0.0500 | 0.1000 | 2.000 | 14.335540 | 0.000000 | 14.335540 | 286.710801 | 143.355400 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 5 | plane | 0.0500 | 0.0577 | 1.155 | 11.359858 | 0.000000 | 11.359858 | 227.197164 | 196.758516 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 6 | cone | 0.0500 | 0.1118 | 2.236 | 10.675096 | 0.000000 | 10.675096 | 213.501928 | 95.480965 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |

## swept-held-static:explicit-series-parallel-bypass

Pure-rotation baseline: rotating-envelope geometry held at 0 RPM.

Official rank: not evaluated. Ordered exploratory output only. Engineering official ranking is not evaluated: the extended cylinder mesh check differed by 6.5273%, versus the pre-registered 2.00% tolerance. The production azimuth limit is 128, so a still-higher reference cannot be executed.
Calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 21.718897 | 0.000000 | 21.718897 | 434.377946 | 86.875589 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 14.870907 | 0.000000 | 14.870907 | 297.418131 | 74.354533 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 3 | hemisphere | 0.0500 | 0.1000 | 2.000 | 14.335540 | 0.000000 | 14.335540 | 286.710801 | 143.355400 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 4 | cube | 0.0500 | 0.1592 | 3.183 | 13.223588 | 0.000000 | 13.223588 | 264.471761 | 83.086254 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 5 | cone | 0.0500 | 0.1118 | 2.236 | 10.675096 | 0.000000 | 10.675096 | 213.501928 | 95.480965 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 6.072813 | 0.000000 | 6.072813 | 121.456265 | 165.222972 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |

## controlled-kinematic:explicit-series-parallel-bypass

Common controlled 2 RPM gross AC before an active motor demand is deducted.

Official rank: not evaluated. Ordered exploratory output only. Engineering official ranking is not evaluated: the extended cylinder mesh check differed by 6.5273%, versus the pre-registered 2.00% tolerance. The production azimuth limit is 128, so a still-higher reference cannot be executed.
Calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 21.726371 | 0.000000 | 21.726371 | 434.527412 | 86.905482 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 14.752493 | 0.000000 | 14.752493 | 295.049859 | 73.762465 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 3 | hemisphere | 0.0500 | 0.1000 | 2.000 | 14.032218 | 0.000000 | 14.032218 | 280.644362 | 140.322181 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 4 | cube | 0.0500 | 0.1592 | 3.183 | 13.083130 | 0.000000 | 13.083130 | 261.662593 | 82.203728 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 5 | cone | 0.0500 | 0.1118 | 2.236 | 10.806862 | 0.000000 | 10.806862 | 216.137242 | 96.659513 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 5.074236 | 0.000000 | 5.074236 | 101.484719 | 138.054689 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |

## controlled-motor-net:explicit-series-parallel-bypass

Common controlled 2 RPM with active-motor demand deducted and net AC clipped at zero.

Official rank: not evaluated. Ordered exploratory output only. Engineering official ranking is not evaluated: the extended cylinder mesh check differed by 6.5273%, versus the pre-registered 2.00% tolerance. The production azimuth limit is 128, so a still-higher reference cannot be executed.
Calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 21.726371 | 0.004317 | 21.724336 | 434.486716 | 86.897343 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 14.752493 | 0.004317 | 14.750490 | 295.009794 | 73.752449 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 3 | hemisphere | 0.0500 | 0.1000 | 2.000 | 14.032218 | 0.004317 | 14.030231 | 280.604630 | 140.302315 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 4 | cube | 0.0500 | 0.1592 | 3.183 | 13.083130 | 0.004317 | 13.081131 | 261.622623 | 82.191171 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 5 | cone | 0.0500 | 0.1118 | 2.236 | 10.806862 | 0.004317 | 10.804901 | 216.098014 | 96.641970 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 5.074236 | 0.004317 | 5.072359 | 101.447179 | 138.003622 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |

## natural-no-cq:explicit-series-parallel-bypass

Natural dynamics with absent C_Q; exact zero-RPM result reuses the identical static land-matched calculation.

Official rank: not evaluated. Ordered exploratory output only. Engineering official ranking is not evaluated: the extended cylinder mesh check differed by 6.5273%, versus the pre-registered 2.00% tolerance. The production azimuth limit is 128, so a still-higher reference cannot be executed.
Calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cube | 0.0500 | 0.2500 | 5.000 | 23.179101 | 0.000000 | 23.179101 | 463.582020 | 92.716404 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 2 | cylinder | 0.0500 | 0.2500 | 5.000 | 21.718897 | 0.000000 | 21.718897 | 434.377946 | 86.875589 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 14.870907 | 0.000000 | 14.870907 | 297.418131 | 74.354533 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 4 | hemisphere | 0.0500 | 0.1000 | 2.000 | 14.335540 | 0.000000 | 14.335540 | 286.710801 | 143.355400 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 5 | plane | 0.0500 | 0.0577 | 1.155 | 11.359858 | 0.000000 | 11.359858 | 227.197164 | 196.758516 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 6 | cone | 0.0500 | 0.1118 | 2.236 | 10.675096 | 0.000000 | 10.675096 | 213.501928 | 95.480965 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |

## transient-static-land-matched:local-mpp-area-integral

Transient static designs sized to A_land.

Official ranking eligible: yes.
Calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.072559 | 0.000000 | 40.072559 | 801.451173 | 160.290235 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 39.728507 | 0.000000 | 39.728507 | 794.570145 | 158.914029 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 27.416879 | 0.000000 | 27.416879 | 548.337580 | 137.084395 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.250082 | 0.000000 | 19.250082 | 385.001642 | 172.177968 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.692588 | 0.000000 | 17.692588 | 353.851750 | 176.925875 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |
| 6 | plane | 0.0500 | 0.0577 | 1.155 | 13.601257 | 0.000000 | 13.601257 | 272.025148 | 235.580688 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |

## transient-swept-held-static:local-mpp-area-integral

Transient pure-rotation E00 baseline on swept geometry.

Official ranking eligible: yes.
Calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.072559 | 0.000000 | 40.072559 | 801.451173 | 160.290235 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 27.416879 | 0.000000 | 27.416879 | 548.337580 | 137.084395 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 24.383641 | 0.000000 | 24.383641 | 487.672813 | 153.206933 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.250082 | 0.000000 | 19.250082 | 385.001642 | 172.177968 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.692588 | 0.000000 | 17.692588 | 353.851750 | 176.925875 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 7.840353 | 0.000000 | 7.840353 | 156.807067 | 213.312419 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |

## transient-controlled-motor-net:local-mpp-area-integral

Transient E11 with controlled 2 RPM and active motor net AC.

Official ranking eligible: yes.
Calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.116188 | 0.004317 | 40.114016 | 802.280321 | 160.456064 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 27.450185 | 0.004317 | 27.448043 | 548.960862 | 137.240215 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 24.554543 | 0.004317 | 24.552415 | 491.048301 | 154.267373 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.287822 | 0.004317 | 19.285721 | 385.714416 | 172.496731 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.720695 | 0.004317 | 17.718615 | 354.372294 | 177.186147 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 6.512353 | 0.004317 | 6.510508 | 130.210164 | 177.131334 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |

## transient-natural-no-cq:local-mpp-area-integral

Transient no-C_Q natural result; exact zero schedule reuses the static land-matched calculation.

Official ranking eligible: yes.
Calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.072559 | 0.000000 | 40.072559 | 801.451173 | 160.290235 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 39.728507 | 0.000000 | 39.728507 | 794.570145 | 158.914029 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 27.416879 | 0.000000 | 27.416879 | 548.337580 | 137.084395 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.250082 | 0.000000 | 19.250082 | 385.001642 | 172.177968 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.692588 | 0.000000 | 17.692588 | 353.851750 | 176.925875 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
| 6 | plane | 0.0500 | 0.0577 | 1.155 | 13.601257 | 0.000000 | 13.601257 | 272.025148 | 235.580688 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
