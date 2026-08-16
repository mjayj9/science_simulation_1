# Actual full-year fair-comparison audit

Every annual row uses 8,760 actual hourly intervals plus a non-integrated closing endpoint. No representative-day conversion, shape multiplier, or research-rank fitting is used.

Static land-matched designs and swept-envelope rotation-effect baselines are intentionally separate. Controlled active rotation reports motor-net AC. Transient ideal and quasi-steady engineering results remain separate because their combined solver is unsupported.

Official ideal convergence: PASS. Engineering official ranking: NOT EVALUATED (All pre-registered engineering convergence checks passed.). Preflight 59.2 s.

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

Official rank: not evaluated. Ordered exploratory output only. All pre-registered engineering convergence checks passed.
Calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 23.045993 | 0.000000 | 23.045993 | 460.919854 | 92.183971 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 22.311687 | 0.000000 | 22.311687 | 446.233736 | 89.246747 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 15.210542 | 0.000000 | 15.210542 | 304.210845 | 76.052711 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 4 | plane | 0.0500 | 0.0577 | 1.155 | 12.310268 | 0.000000 | 12.310268 | 246.205355 | 213.220092 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 5 | cone | 0.0500 | 0.1118 | 2.236 | 10.890407 | 0.000000 | 10.890407 | 217.808138 | 97.406760 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |
| 6 | hemisphere | 0.0500 | 0.1000 | 2.000 | 10.734512 | 0.000000 | 10.734512 | 214.690242 | 107.345121 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | held static 0 RPM |

## swept-held-static:explicit-series-parallel-bypass

Pure-rotation baseline: rotating-envelope geometry held at 0 RPM.

Official rank: not evaluated. Ordered exploratory output only. All pre-registered engineering convergence checks passed.
Calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 23.045993 | 0.000000 | 23.045993 | 460.919854 | 92.183971 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 15.210542 | 0.000000 | 15.210542 | 304.210845 | 76.052711 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 13.197589 | 0.000000 | 13.197589 | 263.951773 | 82.922895 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 10.890407 | 0.000000 | 10.890407 | 217.808138 | 97.406760 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 10.734512 | 0.000000 | 10.734512 | 214.690242 | 107.345121 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 6.751196 | 0.000000 | 6.751196 | 135.023915 | 183.679718 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | held static 0 RPM |

## controlled-kinematic:explicit-series-parallel-bypass

Common controlled 2 RPM gross AC before an active motor demand is deducted.

Official rank: not evaluated. Ordered exploratory output only. All pre-registered engineering convergence checks passed.
Calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 23.067144 | 0.000000 | 23.067144 | 461.342882 | 92.268576 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 15.222061 | 0.000000 | 15.222061 | 304.441221 | 76.110305 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 13.190839 | 0.000000 | 13.190839 | 263.816771 | 82.880483 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 10.958179 | 0.000000 | 10.958179 | 219.163588 | 98.012936 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 10.495499 | 0.000000 | 10.495499 | 209.909986 | 104.954993 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 5.677947 | 0.000000 | 5.677947 | 113.558942 | 154.479853 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; kinematic gross AC before motor demand |

## controlled-motor-net:explicit-series-parallel-bypass

Common controlled 2 RPM with active-motor demand deducted and net AC clipped at zero.

Official rank: not evaluated. Ordered exploratory output only. All pre-registered engineering convergence checks passed.
Calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 23.067144 | 0.004317 | 23.065106 | 461.302128 | 92.260426 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 15.222061 | 0.004317 | 15.220059 | 304.401187 | 76.100297 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 13.190839 | 0.004317 | 13.188840 | 263.776800 | 82.867926 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 10.958179 | 0.004317 | 10.956195 | 219.123908 | 97.995191 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 10.495499 | 0.004317 | 10.493525 | 209.870503 | 104.935252 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 5.677947 | 0.004317 | 5.676050 | 113.520997 | 154.428234 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | swept-rotation-envelope | controlled 2 RPM; active motor net AC; tau=0.002 Nm; eta=0.85 |

## natural-no-cq:explicit-series-parallel-bypass

Natural dynamics with absent C_Q; exact zero-RPM result reuses the identical static land-matched calculation.

Official rank: not evaluated. Ordered exploratory output only. All pre-registered engineering convergence checks passed.
Calculation resolution: azimuth=16; meridional=4; phase=4; circuit=32; exploratory non-converged output.

| Exploratory order | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 23.045993 | 0.000000 | 23.045993 | 460.919854 | 92.183971 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 22.311687 | 0.000000 | 22.311687 | 446.233736 | 89.246747 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 15.210542 | 0.000000 | 15.210542 | 304.210845 | 76.052711 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 4 | plane | 0.0500 | 0.0577 | 1.155 | 12.310268 | 0.000000 | 12.310268 | 246.205355 | 213.220092 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 5 | cone | 0.0500 | 0.1118 | 2.236 | 10.890407 | 0.000000 | 10.890407 | 217.808138 | 97.406760 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |
| 6 | hemisphere | 0.0500 | 0.1000 | 2.000 | 10.734512 | 0.000000 | 10.734512 | 214.690242 | 107.345121 | explicit-series-parallel-bypass | 준정상 광학 회전·열이력 미포함 | static-land-matched | shape dynamics; no C_Q; exact 0 RPM; static footprint contract |

## transient-static-land-matched:local-mpp-area-integral

Transient static designs sized to A_land.

Official ranking eligible: yes.
Calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.072560 | 0.000000 | 40.072560 | 801.451191 | 160.290238 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 39.728509 | 0.000000 | 39.728509 | 794.570181 | 158.914036 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 27.416879 | 0.000000 | 27.416879 | 548.337589 | 137.084397 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.250082 | 0.000000 | 19.250082 | 385.001646 | 172.177970 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.692588 | 0.000000 | 17.692588 | 353.851755 | 176.925877 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |
| 6 | plane | 0.0500 | 0.0577 | 1.155 | 13.601258 | 0.000000 | 13.601258 | 272.025167 | 235.580705 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | held static 0 RPM |

## transient-swept-held-static:local-mpp-area-integral

Transient pure-rotation E00 baseline on swept geometry.

Official ranking eligible: yes.
Calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.072560 | 0.000000 | 40.072560 | 801.451191 | 160.290238 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 27.416879 | 0.000000 | 27.416879 | 548.337589 | 137.084397 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 24.383641 | 0.000000 | 24.383641 | 487.672827 | 153.206937 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.250082 | 0.000000 | 19.250082 | 385.001646 | 172.177970 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.692588 | 0.000000 | 17.692588 | 353.851755 | 176.925877 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 7.840354 | 0.000000 | 7.840354 | 156.807073 | 213.312428 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | held static 0 RPM |

## transient-controlled-motor-net:local-mpp-area-integral

Transient E11 with controlled 2 RPM and active motor net AC.

Official ranking eligible: yes.
Calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.116189 | 0.004317 | 40.114017 | 802.280338 | 160.456068 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |
| 2 | sphere | 0.0500 | 0.2000 | 4.000 | 27.450185 | 0.004317 | 27.448043 | 548.960869 | 137.240217 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |
| 3 | cube | 0.0500 | 0.1592 | 3.183 | 24.554543 | 0.004317 | 24.552416 | 491.048312 | 154.267377 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.287822 | 0.004317 | 19.285721 | 385.714420 | 172.496733 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.720695 | 0.004317 | 17.718615 | 354.372298 | 177.186149 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |
| 6 | plane | 0.0500 | 0.0368 | 0.735 | 6.512353 | 0.004317 | 6.510508 | 130.210168 | 177.131339 | local-mpp-area-integral | annual actual-clock transient thermal history included | swept-rotation-envelope | controlled 2 RPM; active motor net AC |

## transient-natural-no-cq:local-mpp-area-integral

Transient no-C_Q natural result; exact zero schedule reuses the static land-matched calculation.

Official ranking eligible: yes.
Calculation resolution: optical phase=6; thermal nodes=6; maximum substep=900s.

| Rank | Shape | A_land | A_PV | A_PV/A_land | Gross AC | Motor | Net AC kWh/y | kWh/m2-land/y | kWh/m2-PV/y | Electrical | Thermal | Geometry | Rotation |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---|
| 1 | cylinder | 0.0500 | 0.2500 | 5.000 | 40.072560 | 0.000000 | 40.072560 | 801.451191 | 160.290238 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
| 2 | cube | 0.0500 | 0.2500 | 5.000 | 39.728509 | 0.000000 | 39.728509 | 794.570181 | 158.914036 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
| 3 | sphere | 0.0500 | 0.2000 | 4.000 | 27.416879 | 0.000000 | 27.416879 | 548.337589 | 137.084397 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
| 4 | cone | 0.0500 | 0.1118 | 2.236 | 19.250082 | 0.000000 | 19.250082 | 385.001646 | 172.177970 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
| 5 | hemisphere | 0.0500 | 0.1000 | 2.000 | 17.692588 | 0.000000 | 17.692588 | 353.851755 | 176.925877 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
| 6 | plane | 0.0500 | 0.0577 | 1.155 | 13.601258 | 0.000000 | 13.601258 | 272.025167 | 235.580705 | local-mpp-area-integral | annual actual-clock transient thermal history included | static-land-matched | shape dynamics; no C_Q; exact 0 RPM |
