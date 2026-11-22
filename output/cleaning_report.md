# Cleaning report

Input: `export.csv` (sha256 `26d7de115deadb21…`)

* Rows in: **1,108,694**
* Rows kept: **577,130**
* Rows dropped: **531,564**
* Output columns: **42**
* Points outside the bounding box (non-missing, non-zero): **0**

| Rule | Name | Kind | Rows dropped (primary) | Rows failing (incl. secondary) |
|---|---|---|---:|---:|
| R01 | DATE_RANGE | drop row | 524,644 | 524,644 |
| R02 | DUPLICATE_RECORD_ID | drop row | 0 | 0 |
| R03 | DROP_COLUMNS | drop column | 0 | 0 |
| R04 | COORDINATES | drop row | 5,527 | 8,762 |
| R05 | LATE_POLICE_NOTIFICATION | drop row | 960 | 1,887 |
| R06 | YES_NO_INDICATORS | value | 0 | 0 |
| R07 | SPEED_LIMIT | drop row + value | 194 | 461 |
| R08 | INJURIES_MISSING_TO_ZERO | value | 0 | 0 |
| R09 | NUM_UNITS_BUCKET | value | 0 | 0 |
| R10 | MISSING_VALUES | value | 0 | 0 |
| R11 | KSI | new column | 0 | 0 |
| R12 | NEIGHBORHOOD | new column | 0 | 0 |
| R13 | ZIPCODE | new column | 0 | 0 |
| R14 | OUTSIDE_CITY_BOUNDARIES | drop row | 239 | 449 |
| R15 | OTHER_MISSING_VALUES | value | 0 | 0 |
| R16 | FORMAT_AND_ORDER | value | 0 | 0 |

## Value changes on kept rows

| Change | Cells |
|---|---:|
| R06_values_set | 332,373 |
| R07_bucketed_0_10 | 17,942 |
| R08_blank_to_0 | 9,135 |
| R09_to_4plus | 8,682 |
| R10_beat_unknown | 0 |
| R10_blank_to_NO | 2,553,277 |
| R10_wz_type_not_a_work_zone | 575,302 |
| R10_wz_type_unknown | 0 |
| R15_blank_to_UNKNOWN_STREET_DIRECTION | 1 |
| R15_msi_derived | 4 |
| R15_msi_unknown | 1,305 |
