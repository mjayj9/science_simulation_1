# Shape-specific natural-rotation audit

The official case has no measured or literature C_Q(lambda). All symmetric structures therefore remain at 0 RPM. Wind-generated electricity is excluded.

## Official no-C_Q case

| Shape | A_projected (m2) | I_y (kg m2) | Annual RPM | C_Q input | Confidence | Official |
|---|---:|---:|---:|---|---|---|
| plane | 0.018378 | 0.00233991 | 0.000000 | absent | low | yes |
| cube | 0.031831 | 0.01013212 | 0.000000 | absent | low | yes |
| cylinder | 0.063662 | 0.02387324 | 0.000000 | absent | low | yes |
| sphere | 0.050000 | 0.01527887 | 0.000000 | absent | low | yes |
| hemisphere | 0.025000 | 0.00763944 | 0.000000 | absent | low | yes |
| cone | 0.031831 | 0.00640586 | 0.000000 | absent | low | yes |

## Unverified user-C_Q sensitivity (excluded)

| Shape | A_projected (m2) | I_y (kg m2) | Annual RPM | C_Q input | Confidence | Official |
|---|---:|---:|---:|---|---|---|
| plane | 0.018378 | 0.00233991 | 0.000000 | user-supplied | low | no |
| cube | 0.031831 | 0.01013212 | 0.000000 | user-supplied | low | no |
| cylinder | 0.063662 | 0.02387324 | 0.069411 | user-supplied | low | no |
| sphere | 0.050000 | 0.01527887 | 0.005671 | user-supplied | low | no |
| hemisphere | 0.025000 | 0.00763944 | 0.000000 | user-supplied | low | no |
| cone | 0.031831 | 0.00640586 | 0.000000 | user-supplied | low | no |

This sensitivity omits a fair auxiliary rotor footprint, complete height, and PV-shadow model. It is deliberately excluded from the official ranking and is not a prediction.
