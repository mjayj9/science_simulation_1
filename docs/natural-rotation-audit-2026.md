# Shape-specific natural-rotation audit

The official case has no measured or literature C_Q(lambda). All symmetric structures therefore remain at 0 RPM. Wind-generated electricity is excluded.

## Official no-C_Q case

| Shape | mean A_projected (m2) | mean R_ref (m) | thin-skin I_y (kg m2) | Annual RPM | C_Q input | C_Q reference | phase closure (rad) | Official |
|---|---:|---:|---:|---:|---|---|---:|---|
| plane | 0.011657 | 0.113746 | 0.00233991 | 0.000000 | absent | absent | 0.000e+0 | yes |
| cube | 0.040587 | 0.113746 | 0.01823781 | 0.000000 | absent | absent | 0.000e+0 | yes |
| cylinder | 0.063662 | 0.126157 | 0.04297183 | 0.000000 | absent | absent | 0.000e+0 | yes |
| sphere | 0.050000 | 0.126157 | 0.02546479 | 0.000000 | absent | absent | 0.000e+0 | yes |
| hemisphere | 0.025000 | 0.126157 | 0.01273240 | 0.000000 | absent | absent | 0.000e+0 | yes |
| cone | 0.031831 | 0.126157 | 0.01067644 | 0.000000 | absent | absent | 0.000e+0 | yes |

## Unverified user-C_Q sensitivity (excluded)

| Shape | mean A_projected (m2) | mean R_ref (m) | thin-skin I_y (kg m2) | Annual RPM | C_Q input | C_Q reference | phase closure (rad) | Official |
|---|---:|---:|---:|---:|---|---|---:|---|
| plane | 0.010000 | 0.060000 | 0.00233991 | 0.000000 | user-supplied | auxiliary-rotor-fixed-reference | 0.000e+0 | no |
| cube | 0.010000 | 0.060000 | 0.01823781 | 0.000000 | user-supplied | auxiliary-rotor-fixed-reference | 0.000e+0 | no |
| cylinder | 0.010000 | 0.060000 | 0.04297183 | 0.000000 | user-supplied | auxiliary-rotor-fixed-reference | 0.000e+0 | no |
| sphere | 0.010000 | 0.060000 | 0.02546479 | 0.000000 | user-supplied | auxiliary-rotor-fixed-reference | 0.000e+0 | no |
| hemisphere | 0.010000 | 0.060000 | 0.01273240 | 0.000000 | user-supplied | auxiliary-rotor-fixed-reference | 0.000e+0 | no |
| cone | 0.010000 | 0.060000 | 0.01067644 | 0.000000 | user-supplied | auxiliary-rotor-fixed-reference | 0.000e+0 | no |

The sensitivity uses explicit auxiliary C_Q A_ref=0.01 m2, R_ref=0.06 m and a stated lambda=3 linear zero. Its footprint, complete height and 2% shadow are not applied to A_land, H_max or PV yield, so it is excluded and is not a prediction.
