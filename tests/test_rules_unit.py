"""Unit tests for every cleaning rule, run on a small synthetic fixture.

Written before the pipeline existed. Each test checks one rule on its own.
Run:  python3 -m unittest tests/test_rules_unit.py -v
"""
import csv
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))

import crash_pipeline as cp  # noqa: E402

NEIGH = os.path.join(ROOT, "data", "igwz-8jzy.geojson")
ZIPS = os.path.join(ROOT, "data", "unjd-c2ca.geojson")

RAW_COLUMNS = [
    "CRASH_RECORD_ID", "CRASH_DATE_EST_I", "CRASH_DATE", "POSTED_SPEED_LIMIT",
    "TRAFFIC_CONTROL_DEVICE", "DEVICE_CONDITION", "WEATHER_CONDITION",
    "LIGHTING_CONDITION", "FIRST_CRASH_TYPE", "TRAFFICWAY_TYPE", "LANE_CNT",
    "ALIGNMENT", "ROADWAY_SURFACE_COND", "ROAD_DEFECT", "REPORT_TYPE",
    "CRASH_TYPE", "INTERSECTION_RELATED_I", "NOT_RIGHT_OF_WAY_I", "HIT_AND_RUN_I",
    "DAMAGE", "DATE_POLICE_NOTIFIED", "PRIM_CONTRIBUTORY_CAUSE",
    "SEC_CONTRIBUTORY_CAUSE", "STREET_NO", "STREET_DIRECTION", "STREET_NAME",
    "BEAT_OF_OCCURRENCE", "PHOTOS_TAKEN_I", "STATEMENTS_TAKEN_I", "DOORING_I",
    "WORK_ZONE_I", "WORK_ZONE_TYPE", "WORKERS_PRESENT_I", "NUM_UNITS",
    "CRASH_MONTH", "MOST_SEVERE_INJURY", "INJURIES_TOTAL", "INJURIES_FATAL",
    "INJURIES_INCAPACITATING", "INJURIES_NON_INCAPACITATING",
    "INJURIES_REPORTED_NOT_EVIDENT", "INJURIES_NO_INDICATION", "INJURIES_UNKNOWN",
    "CRASH_HOUR", "CRASH_DAY_OF_WEEK", "IDOT_CONTROL_NO", "LATITUDE", "LONGITUDE",
    "LOCATION",
]

DROPPED = ["CRASH_DATE_EST_I", "LANE_CNT", "CRASH_TYPE", "REPORT_TYPE",
           "DATE_POLICE_NOTIFIED", "PHOTOS_TAKEN_I", "NOT_RIGHT_OF_WAY_I",
           "STATEMENTS_TAKEN_I", "IDOT_CONTROL_NO", "LOCATION"]
EXPECTED_HEADER = [c for c in RAW_COLUMNS if c not in DROPPED] + ["KSI", "NEIGHBORHOOD", "ZIPCODE"]

WRIGLEY = ("41.9484", "-87.6553")      # Lake View, ZIP 60613
OAK_PARK = ("41.8850", "-87.7845")     # inside bounding box, outside Chicago


def base_row(rid, **over):
    r = {c: "" for c in RAW_COLUMNS}
    r.update({
        "CRASH_RECORD_ID": rid, "CRASH_DATE": "06/15/2023 02:22:00 PM",
        "DATE_POLICE_NOTIFIED": "06/15/2023 02:35:00 PM", "POSTED_SPEED_LIMIT": "30",
        "TRAFFIC_CONTROL_DEVICE": "NO CONTROLS", "DEVICE_CONDITION": "NO CONTROLS",
        "WEATHER_CONDITION": "CLEAR", "LIGHTING_CONDITION": "DAYLIGHT",
        "FIRST_CRASH_TYPE": "REAR END", "TRAFFICWAY_TYPE": "NOT DIVIDED", "LANE_CNT": "2",
        "ALIGNMENT": "STRAIGHT AND LEVEL", "ROADWAY_SURFACE_COND": "DRY",
        "ROAD_DEFECT": "NO DEFECTS", "REPORT_TYPE": "ON SCENE",
        "CRASH_TYPE": "NO INJURY / DRIVE AWAY", "DAMAGE": "OVER $1,500",
        "PRIM_CONTRIBUTORY_CAUSE": "FOLLOWING TOO CLOSELY",
        "SEC_CONTRIBUTORY_CAUSE": "NOT APPLICABLE", "STREET_NO": "1060",
        "STREET_DIRECTION": "W", "STREET_NAME": "ADDISON ST", "BEAT_OF_OCCURRENCE": "1923",
        "NUM_UNITS": "2", "CRASH_MONTH": "6", "MOST_SEVERE_INJURY": "NO INDICATION OF INJURY",
        "INJURIES_TOTAL": "0", "INJURIES_FATAL": "0", "INJURIES_INCAPACITATING": "0",
        "INJURIES_NON_INCAPACITATING": "0", "INJURIES_REPORTED_NOT_EVIDENT": "0",
        "INJURIES_NO_INDICATION": "2", "INJURIES_UNKNOWN": "0", "CRASH_HOUR": "14",
        "CRASH_DAY_OF_WEEK": "5", "IDOT_CONTROL_NO": "X1",
        "LATITUDE": WRIGLEY[0], "LONGITUDE": WRIGLEY[1],
        "LOCATION": f"POINT ({WRIGLEY[1]} {WRIGLEY[0]})",
    })
    r.update(over)
    return r


def fixture_rows():
    R = []
    R.append(base_row("keep_base"))
    R.append(base_row("r01_old", CRASH_DATE="12/31/2020 11:59:00 PM", DATE_POLICE_NOTIFIED="01/01/2021 12:30:00 AM"))
    R.append(base_row("r01_new", CRASH_DATE="05/01/2026 12:00:00 AM", DATE_POLICE_NOTIFIED="05/01/2026 01:00:00 AM"))
    R.append(base_row("edge_start", CRASH_DATE="01/01/2021 12:00:00 AM", DATE_POLICE_NOTIFIED="01/01/2021 01:00:00 AM"))
    R.append(base_row("edge_end", CRASH_DATE="04/30/2026 11:59:00 PM", DATE_POLICE_NOTIFIED="05/01/2026 12:20:00 AM"))
    R.append(base_row("keep_base", STREET_NAME="DUPLICATE COPY"))          # R02
    R.append(base_row("r04_missing", LATITUDE="", LONGITUDE="", LOCATION=""))
    R.append(base_row("r04_zero", LATITUDE="0", LONGITUDE="0"))
    R.append(base_row("r04_outbox", LATITUDE="42.0500", LONGITUDE="-87.6800"))
    R.append(base_row("r05_late", DATE_POLICE_NOTIFIED="07/16/2023 02:23:00 PM"))   # 31 days + 1 min
    R.append(base_row("keep_30d", DATE_POLICE_NOTIFIED="07/15/2023 02:22:00 PM"))   # exactly 30 days
    R.append(base_row("spd_0", POSTED_SPEED_LIMIT="0"))
    R.append(base_row("spd_7", POSTED_SPEED_LIMIT="7"))
    R.append(base_row("spd_10", POSTED_SPEED_LIMIT="10"))
    R.append(base_row("r07_12", POSTED_SPEED_LIMIT="12"))
    R.append(base_row("r07_39", POSTED_SPEED_LIMIT="39"))
    R.append(base_row("spd_55", POSTED_SPEED_LIMIT="55"))
    R.append(base_row("r07_60", POSTED_SPEED_LIMIT="60"))
    R.append(base_row("r07_99", POSTED_SPEED_LIMIT="99"))
    R.append(base_row("yn_Y", INTERSECTION_RELATED_I="Y", HIT_AND_RUN_I="Y", DOORING_I="Y",
                      WORK_ZONE_I="Y", WORK_ZONE_TYPE="CONSTRUCTION", WORKERS_PRESENT_I="Y"))
    R.append(base_row("yn_N", INTERSECTION_RELATED_I="N", HIT_AND_RUN_I="N", DOORING_I="N",
                      WORK_ZONE_I="N", WORKERS_PRESENT_I="N"))
    R.append(base_row("inj_missing", MOST_SEVERE_INJURY="", INJURIES_TOTAL="", INJURIES_FATAL="",
                      INJURIES_INCAPACITATING="", INJURIES_NON_INCAPACITATING="",
                      INJURIES_REPORTED_NOT_EVIDENT="", INJURIES_NO_INDICATION="",
                      INJURIES_UNKNOWN=""))
    R.append(base_row("ksi_3", MOST_SEVERE_INJURY="FATAL", INJURIES_TOTAL="3", INJURIES_FATAL="1",
                      INJURIES_INCAPACITATING="2"))
    for n in ["1", "3", "4", "7"]:
        R.append(base_row(f"units_{n}", NUM_UNITS=n))
    R.append(base_row("wz_unknown", WORK_ZONE_I="Y", WORK_ZONE_TYPE=""))
    R.append(base_row("beat_missing", BEAT_OF_OCCURRENCE=""))
    R.append(base_row("beat_float", BEAT_OF_OCCURRENCE="811.0"))
    R.append(base_row("r14_oakpark", LATITUDE=OAK_PARK[0], LONGITUDE=OAK_PARK[1]))
    R.append(base_row("dir_missing", STREET_DIRECTION=""))
    return R


def write_csv(path, rows):
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=RAW_COLUMNS, quoting=csv.QUOTE_ALL)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def read_csv(path):
    with open(path, newline="") as f:
        return list(csv.DictReader(f))


def sha(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class RulesOnFixture(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.raw = os.path.join(cls.tmp, "raw.csv")
        write_csv(cls.raw, fixture_rows())
        cls.raw_sha_before = sha(cls.raw)
        cls.out = os.path.join(cls.tmp, "out")
        cls.site = os.path.join(cls.tmp, "site")
        cls.manifest = cp.run(cls.raw, cls.out, site_dir=cls.site,
                              neighborhoods_path=NEIGH, zips_path=ZIPS, chunksize=7)
        cls.clean = read_csv(os.path.join(cls.out, cp.CLEAN_FILE))
        cls.by_id = {r["CRASH_RECORD_ID"]: r for r in cls.clean}
        cls.drops = read_csv(os.path.join(cls.out, cp.DROP_FILE))
        cls.drop_rule = {}
        for d in cls.drops:
            cls.drop_rule.setdefault(d["CRASH_RECORD_ID"], []).append(d["RULE_ID"])
        with open(os.path.join(cls.out, cp.CLEAN_FILE), newline="") as f:
            cls.header = next(csv.reader(f))

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    # --- Spec unit tests -------------------------------------------------
    def test_UT01_no_missing_values(self):
        empty = [(r["CRASH_RECORD_ID"], k) for r in self.clean for k, v in r.items() if v is None or v.strip() == ""]
        self.assertEqual(empty, [])

    def test_UT02_every_row_has_zip_and_neighborhood(self):
        neigh = set(cp.load_polygons(NEIGH, "community")[0])
        zips = set(cp.load_polygons(ZIPS, "zip")[0])
        for r in self.clean:
            self.assertIn(r["NEIGHBORHOOD"], neigh, r["CRASH_RECORD_ID"])
            self.assertIn(r["ZIPCODE"], zips, r["CRASH_RECORD_ID"])

    def test_UT03_output_header(self):
        self.assertEqual(self.header, EXPECTED_HEADER)
        self.assertEqual(len(self.header), 42)

    # --- One test per rule --------------------------------------------------
    def test_UT10_R01_before_2021_dropped(self):
        self.assertEqual(self.drop_rule.get("r01_old"), ["R01"])

    def test_UT11_R01_after_april_2026_dropped(self):
        self.assertEqual(self.drop_rule.get("r01_new"), ["R01"])

    def test_UT12_R01_boundaries_kept(self):
        self.assertIn("edge_start", self.by_id)
        self.assertIn("edge_end", self.by_id)

    def test_UT13_R02_duplicate_second_copy_dropped(self):
        self.assertEqual(self.drop_rule.get("keep_base"), ["R02"])
        self.assertIn("keep_base", self.by_id)
        self.assertEqual(self.by_id["keep_base"]["STREET_NAME"], "ADDISON ST")  # first copy kept

    def test_UT14_R03_columns_removed(self):
        for c in DROPPED:
            self.assertNotIn(c, self.header)

    def test_UT15_R04_missing_coordinates(self):
        self.assertEqual(self.drop_rule.get("r04_missing"), ["R04"])

    def test_UT16_R04_zero_coordinates(self):
        self.assertEqual(self.drop_rule.get("r04_zero"), ["R04"])

    def test_UT17_R04_outside_box_dropped_and_listed(self):
        self.assertEqual(self.drop_rule.get("r04_outbox"), ["R04"])
        listed = [r["CRASH_RECORD_ID"] for r in read_csv(os.path.join(self.out, cp.OOB_FILE))]
        self.assertIn("r04_outbox", listed)
        self.assertNotIn("r04_zero", listed)  # zeros are "missing", not "outside the box"

    def test_UT18_R05_late_notification(self):
        self.assertEqual(self.drop_rule.get("r05_late"), ["R05"])
        self.assertIn("keep_30d", self.by_id)

    def test_UT19_R06_yes_no(self):
        for c in ["INTERSECTION_RELATED_I", "HIT_AND_RUN_I", "DOORING_I", "WORK_ZONE_I", "WORKERS_PRESENT_I"]:
            self.assertEqual(self.by_id["yn_Y"][c], "YES", c)
            self.assertEqual(self.by_id["yn_N"][c], "NO", c)
            self.assertEqual(self.by_id["keep_base"][c], "NO", c)  # blank
        for r in self.clean:
            for c in self.header:
                if c.endswith("_I"):
                    self.assertIn(r[c], {"YES", "NO"})

    def test_UT20_R07_low_speeds_bucketed(self):
        for rid in ["spd_0", "spd_7", "spd_10"]:
            self.assertEqual(self.by_id[rid]["POSTED_SPEED_LIMIT"], "0-10", rid)

    def test_UT21_R07_non_multiple_of_5_dropped(self):
        self.assertEqual(self.drop_rule.get("r07_12"), ["R07"])
        self.assertEqual(self.drop_rule.get("r07_39"), ["R07"])

    def test_UT22_R07_over_55_dropped(self):
        self.assertEqual(self.drop_rule.get("r07_60"), ["R07"])
        self.assertEqual(self.drop_rule.get("r07_99"), ["R07"])
        self.assertEqual(self.by_id["spd_55"]["POSTED_SPEED_LIMIT"], "55")

    def test_UT23_R08_missing_injuries_zero(self):
        r = self.by_id["inj_missing"]
        for c in cp.INJURY_COLUMNS:
            self.assertEqual(r[c], "0", c)

    def test_UT24_R09_num_units_bucket(self):
        self.assertEqual(self.by_id["units_1"]["NUM_UNITS"], "1")
        self.assertEqual(self.by_id["keep_base"]["NUM_UNITS"], "2")
        self.assertEqual(self.by_id["units_3"]["NUM_UNITS"], "3")
        self.assertEqual(self.by_id["units_4"]["NUM_UNITS"], "4+")
        self.assertEqual(self.by_id["units_7"]["NUM_UNITS"], "4+")

    def test_UT25_R10_work_zone_type(self):
        self.assertEqual(self.by_id["wz_unknown"]["WORK_ZONE_TYPE"], "UNKNOWN")
        self.assertEqual(self.by_id["keep_base"]["WORK_ZONE_TYPE"], "NOT A WORK ZONE")
        self.assertEqual(self.by_id["yn_Y"]["WORK_ZONE_TYPE"], "CONSTRUCTION")

    def test_UT26_R10_beat(self):
        self.assertEqual(self.by_id["beat_missing"]["BEAT_OF_OCCURRENCE"], "UNKNOWN")
        self.assertEqual(self.by_id["beat_float"]["BEAT_OF_OCCURRENCE"], "811")

    def test_UT27_R11_ksi(self):
        self.assertEqual(self.by_id["ksi_3"]["KSI"], "3")
        for r in self.clean:
            self.assertEqual(int(r["KSI"]), int(r["INJURIES_FATAL"]) + int(r["INJURIES_INCAPACITATING"]))

    def test_UT28_R12_R13_point_in_polygon(self):
        r = self.by_id["keep_base"]
        self.assertEqual(r["NEIGHBORHOOD"], "LAKE VIEW")
        self.assertEqual(r["ZIPCODE"], "60613")

    def test_UT29_R14_outside_city_dropped(self):
        self.assertEqual(self.drop_rule.get("r14_oakpark"), ["R14"])

    def test_UT30_R15_other_missing(self):
        self.assertEqual(self.by_id["dir_missing"]["STREET_DIRECTION"], "UNKNOWN")
        self.assertEqual(self.by_id["inj_missing"]["MOST_SEVERE_INJURY"], "UNKNOWN")

    def test_UT31_R16_formats(self):
        self.assertEqual(self.by_id["keep_base"]["CRASH_DATE"], "2023-06-15 14:22:00")
        for r in self.clean:
            for c in cp.INJURY_COLUMNS + ["KSI", "CRASH_HOUR", "CRASH_MONTH", "CRASH_DAY_OF_WEEK"]:
                self.assertRegex(r[c], r"^\d+$", c)

    def test_UT32_drop_summary_accounts_for_every_row(self):
        with open(os.path.join(self.out, cp.DROP_FILE), newline="") as f:
            hdr = next(csv.reader(f))
        self.assertEqual(hdr, ["CRASH_RECORD_ID", "CRASH_DATE", "RULE_ID", "RULE_NAME", "DETAIL", "ALL_FAILED_RULES"])
        self.assertEqual(len(self.clean) + len(self.drops), len(fixture_rows()))

    def test_UT33_drop_rule_ids_known(self):
        known = set(cp.RULES)
        for d in self.drops:
            self.assertIn(d["RULE_ID"], known)
            for x in d["ALL_FAILED_RULES"].split("|"):
                self.assertIn(x, known)

    # --- Acceptance --------------------------------------------------------
    def test_AT01_input_not_modified(self):
        self.assertEqual(sha(self.raw), self.raw_sha_before)

    def test_AT02_two_runs_identical(self):
        out2 = os.path.join(self.tmp, "out2")
        site2 = os.path.join(self.tmp, "site2")
        cp.run(self.raw, out2, site_dir=site2, neighborhoods_path=NEIGH, zips_path=ZIPS, chunksize=5)
        for name in [cp.CLEAN_FILE, cp.DROP_FILE, cp.OOB_FILE]:
            self.assertEqual(sha(os.path.join(self.out, name)), sha(os.path.join(out2, name)), name)
        for name in sorted(os.listdir(self.site)):
            self.assertEqual(sha(os.path.join(self.site, name)), sha(os.path.join(site2, name)), name)

    def test_NFT05_manifest_lists_rule_ids(self):
        with open(os.path.join(self.out, cp.MANIFEST_FILE)) as f:
            m = json.load(f)
        ids = {r["id"] for r in m["rules"]}
        self.assertEqual(ids, set(cp.RULES))

    def test_NFT06_site_meta_lists_rule_ids(self):
        with open(os.path.join(self.site, "meta.json")) as f:
            meta = json.load(f)
        self.assertEqual({r["id"] for r in meta["rules"]}, set(cp.RULES))


if __name__ == "__main__":
    unittest.main(verbosity=2)
