"""Tests on the REAL cleaned output (output/) and the site data (docs/data/).

Skipped with a message if the pipeline has not been run yet.
Run:  python3 -m unittest tests/test_output_data.py -v
"""
import json
import os
import sys
import unittest

import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "pipeline"))
import crash_pipeline as cp  # noqa: E402

OUT = os.path.join(ROOT, "output")
SITE_DATA = os.path.join(ROOT, "docs", "data")
CLEAN = os.path.join(OUT, cp.CLEAN_FILE)
NEIGH = os.path.join(ROOT, "data", "igwz-8jzy.geojson")
ZIPS = os.path.join(ROOT, "data", "unjd-c2ca.geojson")
NOTEBOOK = os.path.join(ROOT, "notebook", "chicago_crash_cleaning.ipynb")

_DF = None


def df():
    global _DF
    if _DF is None:
        _DF = pd.read_csv(CLEAN, dtype=str, keep_default_na=False)
    return _DF


@unittest.skipUnless(os.path.exists(CLEAN), "run the pipeline first (output/ missing)")
class RealOutput(unittest.TestCase):
    def test_UT01_FT01_no_missing_values(self):
        d = df()
        empty = (d.apply(lambda s: s.str.strip() == "")).sum()
        self.assertEqual(int(empty.sum()), 0, empty[empty > 0].to_dict())

    def test_UT02_every_row_has_zip_and_neighborhood(self):
        d = df()
        self.assertTrue(d.NEIGHBORHOOD.isin(cp.load_polygons(NEIGH, "community")[0]).all())
        self.assertTrue(d.ZIPCODE.isin(cp.load_polygons(ZIPS, "zip")[0]).all())

    def test_UT03_header(self):
        self.assertEqual(list(df().columns), cp.CLEAN_COLUMNS)
        self.assertEqual(len(df().columns), 42)

    def test_UT34a_R01_date_range(self):
        d = pd.to_datetime(df().CRASH_DATE, format="%Y-%m-%d %H:%M:%S")
        self.assertGreaterEqual(d.min(), pd.Timestamp("2021-01-01"))
        self.assertLess(d.max(), pd.Timestamp("2026-05-01"))

    def test_UT34b_R02_unique_ids(self):
        self.assertFalse(df().CRASH_RECORD_ID.duplicated().any())

    def test_UT34c_R04_bounding_box(self):
        la = df().LATITUDE.astype(float)
        lo = df().LONGITUDE.astype(float)
        self.assertTrue(la.between(41.64, 42.03).all())
        self.assertTrue(lo.between(-87.95, -87.52).all())

    def test_UT34d_R06_yes_no(self):
        for c in [c for c in df().columns if c.endswith("_I")]:
            self.assertTrue(df()[c].isin(["YES", "NO"]).all(), c)

    def test_UT34e_R07_speed_domain(self):
        ok = {"0-10"} | {str(v) for v in range(15, 60, 5)}
        self.assertTrue(df().POSTED_SPEED_LIMIT.isin(ok).all())

    def test_UT34f_R09_num_units(self):
        self.assertTrue(df().NUM_UNITS.isin(["1", "2", "3", "4+"]).all())

    def test_UT34g_R10_work_zone(self):
        d = df()
        self.assertTrue(d.WORK_ZONE_TYPE[d.WORK_ZONE_I == "YES"].ne("NOT A WORK ZONE").all())

    def test_UT34h_R11_ksi(self):
        d = df()
        self.assertTrue((d.KSI.astype(int) == d.INJURIES_FATAL.astype(int) + d.INJURIES_INCAPACITATING.astype(int)).all())

    def test_UT32_counts_add_up(self):
        m = json.load(open(os.path.join(OUT, cp.MANIFEST_FILE)))
        self.assertEqual(m["rows_in"], m["rows_out"] + m["rows_dropped"])
        self.assertEqual(m["rows_out"], len(df()))
        self.assertEqual(sum(r["rows_dropped"] for r in m["rules"]), m["rows_dropped"])

    def test_AT01_input_not_modified(self):
        import hashlib
        m = json.load(open(os.path.join(OUT, cp.MANIFEST_FILE)))
        h = hashlib.sha256()
        with open(os.path.join(ROOT, "data", "export.csv"), "rb") as f:
            for b in iter(lambda: f.read(1 << 22), b""):
                h.update(b)
        self.assertEqual(h.hexdigest(), m["input_sha256"])


class NonFunctional(unittest.TestCase):
    @unittest.skipUnless(os.path.isdir(SITE_DATA), "site data missing")
    def test_NFT02_download_size_under_10MB(self):
        total = sum(os.path.getsize(os.path.join(SITE_DATA, f)) for f in os.listdir(SITE_DATA))
        self.assertLessEqual(total, 10 * 1000 * 1000, f"{total/1e6:.2f} MB")

    @unittest.skipUnless(os.path.exists(NOTEBOOK), "notebook missing")
    def test_NFT04_notebook_mentions_every_rule(self):
        text = open(NOTEBOOK).read()
        for rid in cp.RULES:
            self.assertIn(rid, text, rid)

    @unittest.skipUnless(os.path.exists(NOTEBOOK), "notebook missing")
    def test_NFT07_notebook_uses_pipeline_module(self):
        nb = json.load(open(NOTEBOOK))
        code = "\n".join("".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code")
        self.assertIn("import crash_pipeline", code)

    @unittest.skipUnless(os.path.exists(os.path.join(SITE_DATA, "meta.json")), "site data missing")
    def test_NFT06_site_lists_every_rule(self):
        meta = json.load(open(os.path.join(SITE_DATA, "meta.json")))
        self.assertEqual({r["id"] for r in meta["rules"]}, set(cp.RULES))
        html = open(os.path.join(ROOT, "docs", "index.html")).read()
        self.assertIn("rules-list", html)  # Methods panel that renders meta.rules


if __name__ == "__main__":
    unittest.main(verbosity=2)
