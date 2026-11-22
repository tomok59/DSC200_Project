"""Chicago traffic crash cleaning pipeline.

Single source of truth for every cleaning rule. The notebook
(notebook/chicago_crash_cleaning.ipynb) and the tests import this module.

Every rule has an ID (R01 ... R16). The same IDs appear in
  * this module and the notebook,
  * output/drop_summary.csv (RULE_ID column) and output/export_manifest.json,
  * the website (docs/data/meta.json -> "Methods" panel).

Usage:
    python3 pipeline/crash_pipeline.py            # run with default paths
"""
from __future__ import annotations

import gzip
import hashlib
import json
import os
import shutil
import sys
import tempfile
from collections import OrderedDict

import numpy as np
import pandas as pd
from matplotlib.path import Path

# --------------------------------------------------------------------------------------
# Rules
# --------------------------------------------------------------------------------------
RULES = OrderedDict([
    ("R01", dict(name="DATE_RANGE", kind="drop row", spec="Data filtering 1",
                 text="Keep only crashes from 2021-01-01 00:00 up to (not including) 2026-05-01 00:00.")),
    ("R02", dict(name="DUPLICATE_RECORD_ID", kind="drop row", spec="Data filtering 2",
                 text="Drop a row whose CRASH_RECORD_ID already appeared on an earlier row (first occurrence kept).")),
    ("R03", dict(name="DROP_COLUMNS", kind="drop column", spec="Data filtering 3 (first)",
                 text="Remove CRASH_DATE_EST_I, LANE_CNT, CRASH_TYPE, REPORT_TYPE, DATE_POLICE_NOTIFIED, "
                      "PHOTOS_TAKEN_I, NOT_RIGHT_OF_WAY_I, STATEMENTS_TAKEN_I, IDOT_CONTROL_NO, LOCATION.")),
    ("R04", dict(name="COORDINATES", kind="drop row", spec="Data filtering 3 (second)",
                 text="Drop rows whose coordinates are missing, zero, or outside lat 41.64-42.03 / lon -87.95 to -87.52. "
                      "Out-of-box points are also listed in out_of_bounds_points.csv.")),
    ("R05", dict(name="LATE_POLICE_NOTIFICATION", kind="drop row", spec="Data filtering 4",
                 text="Drop rows where DATE_POLICE_NOTIFIED is more than 30 days after CRASH_DATE.")),
    ("R06", dict(name="YES_NO_INDICATORS", kind="value", spec="Value cleaning 5",
                 text="Every remaining *_I column becomes YES when the value is Y, otherwise NO (blank -> NO).")),
    ("R07", dict(name="SPEED_LIMIT", kind="drop row + value", spec="Value cleaning 6",
                 text="Speeds 0-10 become the bucket '0-10'. Drop rows with a speed > 10 that is not a multiple of 5, "
                      "and rows with a speed > 55.")),
    ("R08", dict(name="INJURIES_MISSING_TO_ZERO", kind="value", spec="Value cleaning 7",
                 text="Missing injury counts become 0; counts are written as integers.")),
    ("R09", dict(name="NUM_UNITS_BUCKET", kind="value", spec="Value cleaning 8",
                 text="NUM_UNITS is bucketed into 1, 2, 3, 4+.")),
    ("R10", dict(name="MISSING_VALUES", kind="value", spec="Value cleaning 9",
                 text="WORK_ZONE_TYPE blank -> NOT A WORK ZONE (or UNKNOWN when WORK_ZONE_I = Y); blank "
                      "WORKERS_PRESENT_I / HIT_AND_RUN_I / DOORING_I / INTERSECTION_RELATED_I -> NO; blank "
                      "BEAT_OF_OCCURRENCE -> UNKNOWN.")),
    ("R11", dict(name="KSI", kind="new column", spec="Derived 10",
                 text="KSI = INJURIES_FATAL + INJURIES_INCAPACITATING (people killed or seriously injured).")),
    ("R12", dict(name="NEIGHBORHOOD", kind="new column", spec="Derived 11",
                 text="Name of the boundary polygon from data/igwz-8jzy.geojson (Chicago's 77 community areas) that "
                      "contains the crash point.")),
    ("R13", dict(name="ZIPCODE", kind="new column", spec="Derived 12",
                 text="'zip' of the ZIP-code polygon from data/unjd-c2ca.geojson that contains the crash point.")),
    ("R14", dict(name="OUTSIDE_CITY_BOUNDARIES", kind="drop row", spec="Added (needed for no-missing-values)",
                 text="Drop rows inside the bounding box but not inside any community-area polygon or any ZIP "
                      "polygon (e.g. suburbs such as Oak Park, Evanston edge, Cicero), so NEIGHBORHOOD and ZIPCODE "
                      "are never blank.")),
    ("R15", dict(name="OTHER_MISSING_VALUES", kind="value", spec="Added (needed for no-missing-values)",
                 text="Blank STREET_DIRECTION / STREET_NAME -> UNKNOWN. Blank MOST_SEVERE_INJURY is derived from the "
                      "injury counts when they exist, otherwise UNKNOWN. Any other blank text cell -> UNKNOWN.")),
    ("R16", dict(name="FORMAT_AND_ORDER", kind="value", spec="Added (reproducibility)",
                 text="CRASH_DATE written as ISO 'YYYY-MM-DD HH:MM:SS'; BEAT written as an integer; output sorted by "
                      "CRASH_DATE then CRASH_RECORD_ID so two runs give byte-identical files.")),
])

DROP_ORDER = ["R01", "R02", "R04", "R05", "R07", "R14"]  # primary reason = first failing rule in this order

DROPPED_COLUMNS = ["CRASH_DATE_EST_I", "LANE_CNT", "CRASH_TYPE", "REPORT_TYPE", "DATE_POLICE_NOTIFIED",
                   "PHOTOS_TAKEN_I", "NOT_RIGHT_OF_WAY_I", "STATEMENTS_TAKEN_I", "IDOT_CONTROL_NO", "LOCATION"]
RAW_COLUMNS = [
    "CRASH_RECORD_ID", "CRASH_DATE_EST_I", "CRASH_DATE", "POSTED_SPEED_LIMIT", "TRAFFIC_CONTROL_DEVICE",
    "DEVICE_CONDITION", "WEATHER_CONDITION", "LIGHTING_CONDITION", "FIRST_CRASH_TYPE", "TRAFFICWAY_TYPE", "LANE_CNT",
    "ALIGNMENT", "ROADWAY_SURFACE_COND", "ROAD_DEFECT", "REPORT_TYPE", "CRASH_TYPE", "INTERSECTION_RELATED_I",
    "NOT_RIGHT_OF_WAY_I", "HIT_AND_RUN_I", "DAMAGE", "DATE_POLICE_NOTIFIED", "PRIM_CONTRIBUTORY_CAUSE",
    "SEC_CONTRIBUTORY_CAUSE", "STREET_NO", "STREET_DIRECTION", "STREET_NAME", "BEAT_OF_OCCURRENCE", "PHOTOS_TAKEN_I",
    "STATEMENTS_TAKEN_I", "DOORING_I", "WORK_ZONE_I", "WORK_ZONE_TYPE", "WORKERS_PRESENT_I", "NUM_UNITS",
    "CRASH_MONTH", "MOST_SEVERE_INJURY", "INJURIES_TOTAL", "INJURIES_FATAL", "INJURIES_INCAPACITATING",
    "INJURIES_NON_INCAPACITATING", "INJURIES_REPORTED_NOT_EVIDENT", "INJURIES_NO_INDICATION", "INJURIES_UNKNOWN",
    "CRASH_HOUR", "CRASH_DAY_OF_WEEK", "IDOT_CONTROL_NO", "LATITUDE", "LONGITUDE", "LOCATION"]
NEW_COLUMNS = ["KSI", "NEIGHBORHOOD", "ZIPCODE"]
CLEAN_COLUMNS = [c for c in RAW_COLUMNS if c not in DROPPED_COLUMNS] + NEW_COLUMNS
INJURY_COLUMNS = ["INJURIES_TOTAL", "INJURIES_FATAL", "INJURIES_INCAPACITATING", "INJURIES_NON_INCAPACITATING",
                  "INJURIES_REPORTED_NOT_EVIDENT", "INJURIES_NO_INDICATION", "INJURIES_UNKNOWN"]
YN_COLUMNS = ["INTERSECTION_RELATED_I", "HIT_AND_RUN_I", "DOORING_I", "WORK_ZONE_I", "WORKERS_PRESENT_I"]
TEXT_COLUMNS = ["TRAFFIC_CONTROL_DEVICE", "DEVICE_CONDITION", "WEATHER_CONDITION", "LIGHTING_CONDITION",
                "FIRST_CRASH_TYPE", "TRAFFICWAY_TYPE", "ALIGNMENT", "ROADWAY_SURFACE_COND", "ROAD_DEFECT", "DAMAGE",
                "PRIM_CONTRIBUTORY_CAUSE", "SEC_CONTRIBUTORY_CAUSE", "STREET_NO", "STREET_DIRECTION", "STREET_NAME"]

DATE_MIN = pd.Timestamp("2021-01-01 00:00:00")
DATE_END = pd.Timestamp("2026-05-01 00:00:00")  # exclusive
LAT_MIN, LAT_MAX = 41.64, 42.03
LON_MIN, LON_MAX = -87.95, -87.52
RAW_DATE_FMT = "%m/%d/%Y %I:%M:%S %p"
SEVERITY_FROM_COUNTS = ["FATAL", "INCAPACITATING INJURY", "NONINCAPACITATING INJURY", "REPORTED, NOT EVIDENT"]

CLEAN_FILE = "chicago_crashes_clean.csv"
DROP_FILE = "drop_summary.csv"
OOB_FILE = "out_of_bounds_points.csv"
MANIFEST_FILE = "export_manifest.json"
REPORT_FILE = "cleaning_report.md"

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULTS = dict(
    raw_csv=os.path.join(ROOT, "data", "export.csv"),
    out_dir=os.path.join(ROOT, "output"),
    site_dir=os.path.join(ROOT, "docs", "data"),
    neighborhoods_path=os.path.join(ROOT, "data", "igwz-8jzy.geojson"),
    zips_path=os.path.join(ROOT, "data", "unjd-c2ca.geojson"),
)


# --------------------------------------------------------------------------------------
# Geometry (R12, R13, R14)
# --------------------------------------------------------------------------------------
def _name_prop(path):
    with open(path) as f:
        props = json.load(f)["features"][0]["properties"]
    for k in ("pri_neigh", "community", "zip"):
        if k in props:
            return k
    raise KeyError(f"no name property in {path}")


def load_polygons(path, prop=None):
    """Return (sorted unique names, list of (name, exterior ring, [hole rings], bbox))."""
    prop = prop or _name_prop(path)
    with open(path) as f:
        g = json.load(f)
    parts = []
    for feat in g["features"]:
        name = str(feat["properties"][prop]).strip().upper()
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        for poly in polys:
            ext = np.asarray(poly[0], dtype=float)[:, :2]
            holes = [np.asarray(h, dtype=float)[:, :2] for h in poly[1:]]
            bbox = (ext[:, 0].min(), ext[:, 0].max(), ext[:, 1].min(), ext[:, 1].max())
            parts.append((name, ext, holes, bbox))
    parts.sort(key=lambda p: (p[0], p[3]))  # deterministic: alphabetical, first match wins on shared edges
    return sorted({p[0] for p in parts}), parts


def assign_polygons(lat, lon, parts):
    """Point-in-polygon. Returns an object array of names ('' = in no polygon)."""
    lat = np.asarray(lat, dtype=float)
    lon = np.asarray(lon, dtype=float)
    out = np.full(lat.shape[0], "", dtype=object)
    for name, ext, holes, (x0, x1, y0, y1) in parts:
        cand = np.flatnonzero((out == "") & (lon >= x0) & (lon <= x1) & (lat >= y0) & (lat <= y1))
        if cand.size == 0:
            continue
        pts = np.column_stack([lon[cand], lat[cand]])
        inside = Path(ext).contains_points(pts)
        for h in holes:
            inside &= ~Path(h).contains_points(pts)
        out[cand[inside]] = name
    return out


# --------------------------------------------------------------------------------------
# Row filtering (R01, R02, R04, R05, R07, R14)
# --------------------------------------------------------------------------------------
def _num(s):
    return pd.to_numeric(s, errors="coerce")


def evaluate_drop_rules(ch, seen_ids, neigh_parts, zip_parts):
    """Return (fails: dict rule->bool array, details: dict rule->str array, extras)."""
    n = len(ch)
    crash = pd.to_datetime(ch["CRASH_DATE"], format=RAW_DATE_FMT, errors="coerce")
    notified = pd.to_datetime(ch["DATE_POLICE_NOTIFIED"], format=RAW_DATE_FMT, errors="coerce")
    lat, lon = _num(ch["LATITUDE"]), _num(ch["LONGITUDE"])
    speed = _num(ch["POSTED_SPEED_LIMIT"])

    fails, details = {}, {}
    # R01
    f = (crash.isna() | (crash < DATE_MIN) | (crash >= DATE_END)).to_numpy()
    fails["R01"] = f
    details["R01"] = np.where(crash.isna(), "crash date missing or unparseable",
                              "crash date " + crash.dt.strftime("%Y-%m-%d %H:%M").fillna("") +
                              " outside 2021-01-01..2026-04-30")
    # R02 (file order; first occurrence kept)
    dup = np.zeros(n, dtype=bool)
    for i, rid in enumerate(ch["CRASH_RECORD_ID"].to_numpy()):
        if rid in seen_ids:
            dup[i] = True
        else:
            seen_ids.add(rid)
    fails["R02"] = dup
    details["R02"] = np.full(n, "CRASH_RECORD_ID already seen on an earlier row", dtype=object)
    # R04
    missing = (lat.isna() | lon.isna()).to_numpy()
    zero = (~missing) & ((lat == 0) | (lon == 0)).to_numpy()
    outbox = (~missing) & (~zero) & (~(lat.between(LAT_MIN, LAT_MAX) & lon.between(LON_MIN, LON_MAX))).to_numpy()
    fails["R04"] = missing | zero | outbox
    details["R04"] = np.select([missing, zero, outbox],
                               ["coordinates missing", "coordinates zero",
                                "outside bounding box (" + ch["LATITUDE"].fillna("") + ", " +
                                ch["LONGITUDE"].fillna("") + ")"], "")
    # R05
    delay_days = ((notified - crash).dt.total_seconds() / 86400.0).to_numpy()
    f05 = np.nan_to_num(delay_days, nan=0.0) > 30.0
    fails["R05"] = f05
    details["R05"] = np.char.add(np.char.add("police notified ", np.char.mod("%.1f", np.nan_to_num(delay_days))),
                                 " days after crash").astype(object)
    # R07
    sp = speed.to_numpy()
    over55 = np.nan_to_num(sp, nan=0) > 55
    notmult = (~over55) & (np.nan_to_num(sp, nan=0) > 10) & (np.mod(np.nan_to_num(sp, nan=0), 5) != 0)
    bad = np.isnan(sp)
    fails["R07"] = over55 | notmult | bad
    details["R07"] = np.select([bad, over55, notmult],
                               ["speed missing",
                                "speed " + ch["POSTED_SPEED_LIMIT"].fillna("") + " mph is over 55",
                                "speed " + ch["POSTED_SPEED_LIMIT"].fillna("") + " mph is over 10 and not a multiple of 5"],
                               "")
    # R14 (only meaningful when coordinates are valid)
    neigh = np.full(n, "", dtype=object)
    zipc = np.full(n, "", dtype=object)
    ok = ~fails["R04"]
    if ok.any():
        neigh[ok] = assign_polygons(lat[ok], lon[ok], neigh_parts)
        zipc[ok] = assign_polygons(lat[ok], lon[ok], zip_parts)
    no_n = ok & (neigh == "")
    no_z = ok & (zipc == "")
    fails["R14"] = no_n | no_z
    details["R14"] = np.select([no_n & no_z, no_n, no_z],
                               ["not inside any community area or ZIP polygon", "not inside any community area",
                                "not inside any ZIP polygon"], "")
    extras = dict(crash=crash, neigh=neigh, zip=zipc, lat=lat, lon=lon, outbox=outbox)
    return fails, details, extras


# --------------------------------------------------------------------------------------
# Value cleaning (R03, R06, R08, R09, R10, R11, R15, R16)
# --------------------------------------------------------------------------------------
def clean_values(k, crash, neigh, zipc, counts):
    """k: kept raw rows (all str / NaN). Returns a DataFrame with CLEAN_COLUMNS, all strings."""
    out = pd.DataFrame(index=k.index)
    raw_wz = k["WORK_ZONE_I"]
    inj_raw = k[INJURY_COLUMNS]
    all_inj_missing = inj_raw.isna().all(axis=1)

    for c in RAW_COLUMNS:
        if c in DROPPED_COLUMNS:  # R03
            continue
        out[c] = k[c]

    # R16 dates
    out["CRASH_DATE"] = crash.dt.strftime("%Y-%m-%d %H:%M:%S")
    # R07 speed values (drops already applied)
    sp = _num(k["POSTED_SPEED_LIMIT"]).astype(int)
    out["POSTED_SPEED_LIMIT"] = np.where(sp <= 10, "0-10", sp.astype(str))
    counts["R07_bucketed_0_10"] += int((sp <= 10).sum())
    # R06 + R10 (Y -> YES, anything else / blank -> NO)
    for c in YN_COLUMNS:
        counts["R06_values_set"] += int(k[c].notna().sum())
        counts["R10_blank_to_NO"] += int(k[c].isna().sum())
        out[c] = np.where(k[c].fillna("").str.strip().str.upper() == "Y", "YES", "NO")
    # R08 injuries
    for c in INJURY_COLUMNS:
        v = _num(k[c])
        counts["R08_blank_to_0"] += int(v.isna().sum())
        out[c] = v.fillna(0).astype(int).astype(str)
    # R09
    u = _num(k["NUM_UNITS"]).fillna(0).astype(int)
    out["NUM_UNITS"] = np.where(u >= 4, "4+", u.clip(lower=1).astype(str))
    counts["R09_to_4plus"] += int((u >= 4).sum())
    # R10 work zone type, beat
    wzt = k["WORK_ZONE_TYPE"]
    is_y = raw_wz.fillna("").str.strip().str.upper() == "Y"
    counts["R10_wz_type_unknown"] += int((wzt.isna() & is_y).sum())
    counts["R10_wz_type_not_a_work_zone"] += int((wzt.isna() & ~is_y).sum())
    out["WORK_ZONE_TYPE"] = np.where(wzt.notna(), wzt, np.where(is_y, "UNKNOWN", "NOT A WORK ZONE"))
    beat = _num(k["BEAT_OF_OCCURRENCE"])
    counts["R10_beat_unknown"] += int(beat.isna().sum())
    out["BEAT_OF_OCCURRENCE"] = np.where(beat.isna(), "UNKNOWN",
                                         beat.fillna(0).astype(int).astype(str))
    # R15 most severe injury
    msi = k["MOST_SEVERE_INJURY"]
    fat = _num(k["INJURIES_FATAL"]).fillna(0)
    inc = _num(k["INJURIES_INCAPACITATING"]).fillna(0)
    non = _num(k["INJURIES_NON_INCAPACITATING"]).fillna(0)
    rne = _num(k["INJURIES_REPORTED_NOT_EVIDENT"]).fillna(0)
    derived = np.select([fat > 0, inc > 0, non > 0, rne > 0], SEVERITY_FROM_COUNTS, "NO INDICATION OF INJURY")
    fill = np.where(all_inj_missing, "UNKNOWN", derived)
    counts["R15_msi_unknown"] += int((msi.isna() & all_inj_missing).sum())
    counts["R15_msi_derived"] += int((msi.isna() & ~all_inj_missing).sum())
    out["MOST_SEVERE_INJURY"] = np.where(msi.notna(), msi, fill)
    # R15 any other blank text
    for c in TEXT_COLUMNS + ["CRASH_HOUR", "CRASH_MONTH", "CRASH_DAY_OF_WEEK"]:
        m = out[c].isna() | (out[c].astype(str).str.strip() == "")
        if m.any():
            counts[f"R15_blank_to_UNKNOWN_{c}"] += int(m.sum())
            out.loc[m, c] = "UNKNOWN"
    # R11, R12, R13
    out["KSI"] = (_num(out["INJURIES_FATAL"]).astype(int) + _num(out["INJURIES_INCAPACITATING"]).astype(int)).astype(str)
    out["NEIGHBORHOOD"] = neigh
    out["ZIPCODE"] = zipc
    return out[CLEAN_COLUMNS]


# --------------------------------------------------------------------------------------
# Driver
# --------------------------------------------------------------------------------------
def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def run(raw_csv=None, out_dir=None, site_dir=None, neighborhoods_path=None, zips_path=None,
        chunksize=200_000, verbose=False):
    raw_csv = raw_csv or DEFAULTS["raw_csv"]
    out_dir = out_dir or DEFAULTS["out_dir"]
    neighborhoods_path = neighborhoods_path or DEFAULTS["neighborhoods_path"]
    zips_path = zips_path or DEFAULTS["zips_path"]
    os.makedirs(out_dir, exist_ok=True)
    input_sha = sha256(raw_csv)

    neigh_names, neigh_parts = load_polygons(neighborhoods_path)
    zip_names, zip_parts = load_polygons(zips_path, "zip")

    tmp_dir = tempfile.mkdtemp(prefix="crash_pipeline_")
    tmp_clean = os.path.join(tmp_dir, "clean_unsorted.csv")
    drop_path = os.path.join(out_dir, DROP_FILE)
    oob_path = os.path.join(out_dir, OOB_FILE)
    seen = set()
    counts = {k: 0 for k in ["R06_values_set", "R07_bucketed_0_10", "R08_blank_to_0", "R09_to_4plus",
                             "R10_blank_to_NO", "R10_wz_type_unknown", "R10_wz_type_not_a_work_zone",
                             "R10_beat_unknown", "R15_msi_unknown", "R15_msi_derived"]}
    counts = DefaultCounter(counts)
    drops_by_rule = {r: 0 for r in DROP_ORDER}
    fails_any_by_rule = {r: 0 for r in DROP_ORDER}
    rows_in = rows_out = 0
    first = True

    reader = pd.read_csv(raw_csv, dtype=str, chunksize=chunksize, keep_default_na=False, na_values=[""])
    for ch in reader:
        ch = ch.reset_index(drop=True)
        missing_cols = [c for c in RAW_COLUMNS if c not in ch.columns]
        if missing_cols:
            raise ValueError(f"input is missing columns: {missing_cols}")
        rows_in += len(ch)
        fails, details, ex = evaluate_drop_rules(ch, seen, neigh_parts, zip_parts)

        primary = np.full(len(ch), "", dtype=object)
        detail = np.full(len(ch), "", dtype=object)
        allf = np.full(len(ch), "", dtype=object)
        for r in DROP_ORDER:
            f = fails[r]
            fails_any_by_rule[r] += int(f.sum())
            take = f & (primary == "")
            primary[take] = r
            detail[take] = np.asarray(details[r], dtype=object)[take]
            allf[f] = np.where(allf[f] == "", r, allf[f] + "|" + r)
        dropped = primary != ""
        for r in DROP_ORDER:
            drops_by_rule[r] += int((primary == r).sum())

        drop_df = pd.DataFrame({
            "CRASH_RECORD_ID": ch["CRASH_RECORD_ID"][dropped].to_numpy(),
            "CRASH_DATE": ch["CRASH_DATE"][dropped].fillna("").to_numpy(),
            "RULE_ID": primary[dropped],
            "RULE_NAME": [RULES[r]["name"] for r in primary[dropped]],
            "DETAIL": detail[dropped],
            "ALL_FAILED_RULES": allf[dropped],
        })
        drop_df.to_csv(drop_path, mode="w" if first else "a", header=first, index=False, lineterminator="\n")

        ob = ex["outbox"]
        oob_df = pd.DataFrame({
            "CRASH_RECORD_ID": ch["CRASH_RECORD_ID"][ob].to_numpy(),
            "CRASH_DATE": ch["CRASH_DATE"][ob].to_numpy(),
            "LATITUDE": ch["LATITUDE"][ob].to_numpy(),
            "LONGITUDE": ch["LONGITUDE"][ob].to_numpy(),
            "IN_DATE_RANGE": np.where(fails["R01"][ob], "NO", "YES"),
        })
        oob_df.to_csv(oob_path, mode="w" if first else "a", header=first, index=False, lineterminator="\n")

        keep = ~dropped
        k = ch[keep]
        clean = clean_values(k, ex["crash"][keep], ex["neigh"][keep], ex["zip"][keep], counts)
        clean.to_csv(tmp_clean, mode="w" if first else "a", header=first, index=False, lineterminator="\n")
        rows_out += len(clean)
        first = False
        if verbose:
            print(f"  processed {rows_in:,} rows, kept {rows_out:,}", flush=True)

    # R16 deterministic sort + final write
    low_card = [c for c in CLEAN_COLUMNS if c not in ("CRASH_RECORD_ID", "CRASH_DATE", "LATITUDE", "LONGITUDE")]
    final = pd.read_csv(tmp_clean, dtype={**{c: "category" for c in low_card},
                                          "CRASH_RECORD_ID": str, "CRASH_DATE": str, "LATITUDE": str,
                                          "LONGITUDE": str},
                        keep_default_na=False)
    final = final.sort_values(["CRASH_DATE", "CRASH_RECORD_ID"], kind="mergesort").reset_index(drop=True)
    clean_path = os.path.join(out_dir, CLEAN_FILE)
    final.to_csv(clean_path, index=False, lineterminator="\n")
    shutil.rmtree(tmp_dir, ignore_errors=True)

    rows_dropped = rows_in - rows_out
    rules_out = []
    for rid, r in RULES.items():
        rules_out.append(dict(id=rid, name=r["name"], kind=r["kind"], spec=r["spec"], text=r["text"],
                              rows_dropped=drops_by_rule.get(rid, 0),
                              rows_failing_incl_secondary=fails_any_by_rule.get(rid, 0)))
    value_counts = {k: v for k, v in sorted(counts.items())}
    manifest = OrderedDict(
        input=os.path.basename(raw_csv), input_sha256=input_sha,
        rows_in=rows_in, rows_out=rows_out, rows_dropped=rows_dropped,
        columns_out=len(CLEAN_COLUMNS), column_names=CLEAN_COLUMNS,
        rules=rules_out, value_changes=value_counts,
        out_of_bounds_points=int(pd.read_csv(oob_path, dtype=str).shape[0]),
        boundary_files=dict(neighborhoods=os.path.basename(neighborhoods_path), neighborhoods_count=len(neigh_names),
                            zips=os.path.basename(zips_path), zips_count=len(zip_names)),
        outputs={CLEAN_FILE: sha256(clean_path), DROP_FILE: sha256(drop_path), OOB_FILE: sha256(oob_path)},
    )
    if site_dir:
        manifest["site_outputs"] = export_site(final, site_dir, rules_out, neighborhoods_path, zips_path,
                                               manifest)
    with open(os.path.join(out_dir, MANIFEST_FILE), "w") as f:
        json.dump(manifest, f, indent=2)
    write_report(manifest, os.path.join(out_dir, REPORT_FILE))
    return manifest


class DefaultCounter(dict):
    def __missing__(self, key):
        return 0

    def __getitem__(self, key):
        if key not in self:
            self[key] = 0
        return dict.__getitem__(self, key)


def write_report(m, path):
    lines = ["# Cleaning report", "",
             f"Input: `{m['input']}` (sha256 `{m['input_sha256'][:16]}…`)", "",
             f"* Rows in: **{m['rows_in']:,}**",
             f"* Rows kept: **{m['rows_out']:,}**",
             f"* Rows dropped: **{m['rows_dropped']:,}**",
             f"* Output columns: **{m['columns_out']}**",
             f"* Points outside the bounding box (non-missing, non-zero): **{m['out_of_bounds_points']}**", "",
             "| Rule | Name | Kind | Rows dropped (primary) | Rows failing (incl. secondary) |",
             "|---|---|---|---:|---:|"]
    for r in m["rules"]:
        lines.append(f"| {r['id']} | {r['name']} | {r['kind']} | {r['rows_dropped']:,} | "
                     f"{r['rows_failing_incl_secondary']:,} |")
    lines += ["", "## Value changes on kept rows", "", "| Change | Cells |", "|---|---:|"]
    for k, v in m["value_changes"].items():
        lines.append(f"| {k} | {v:,} |")
    with open(path, "w") as f:
        f.write("\n".join(lines) + "\n")


# --------------------------------------------------------------------------------------
# Website data export (docs/data)
# --------------------------------------------------------------------------------------
SITE_DIMS = [  # (site key, csv column, label, ordering)
    ("neighborhood", "NEIGHBORHOOD", "Neighborhood (community area)", "alpha"),
    ("zip", "ZIPCODE", "ZIP code", "alpha"),
    ("beat", "BEAT_OF_OCCURRENCE", "Police beat", "numeric"),
    ("weather", "WEATHER_CONDITION", "Weather", "freq"),
    ("lighting", "LIGHTING_CONDITION", "Lighting", "freq"),
    ("surface", "ROADWAY_SURFACE_COND", "Road surface", "freq"),
    ("defect", "ROAD_DEFECT", "Road defect", "freq"),
    ("alignment", "ALIGNMENT", "Road alignment", "freq"),
    ("trafficway", "TRAFFICWAY_TYPE", "Trafficway type", "freq"),
    ("control", "TRAFFIC_CONTROL_DEVICE", "Traffic control device", "freq"),
    ("device", "DEVICE_CONDITION", "Control device condition", "freq"),
    ("speed", "POSTED_SPEED_LIMIT", "Posted speed limit (mph)", "speed"),
    ("crashType", "FIRST_CRASH_TYPE", "First crash type", "freq"),
    ("cause1", "PRIM_CONTRIBUTORY_CAUSE", "Primary cause", "freq"),
    ("cause2", "SEC_CONTRIBUTORY_CAUSE", "Secondary cause", "freq"),
    ("damage", "DAMAGE", "Damage", "damage"),
    ("units", "NUM_UNITS", "Units involved", "alpha"),
    ("intersection", "INTERSECTION_RELATED_I", "Intersection related", "yn"),
    ("hitRun", "HIT_AND_RUN_I", "Hit and run", "yn"),
    ("dooring", "DOORING_I", "Dooring", "yn"),
    ("workZone", "WORK_ZONE_I", "Work zone", "yn"),
    ("workZoneType", "WORK_ZONE_TYPE", "Work zone type", "freq"),
    ("workers", "WORKERS_PRESENT_I", "Workers present", "yn"),
    ("severity", "MOST_SEVERE_INJURY", "Most severe injury", "severity"),
    ("streetDir", "STREET_DIRECTION", "Street direction", "alpha"),
]
SEVERITY_ORDER = ["NO INDICATION OF INJURY", "REPORTED, NOT EVIDENT", "NONINCAPACITATING INJURY",
                  "INCAPACITATING INJURY", "FATAL", "UNKNOWN"]
DAMAGE_ORDER = ["$500 OR LESS", "$501 - $1,500", "OVER $1,500"]


def _ordered_values(series, how):
    vals = list(series.astype(str).unique())
    if how == "freq":
        vc = series.astype(str).value_counts()
        return sorted(vals, key=lambda v: (-int(vc[v]), v))
    if how == "numeric":
        return sorted(vals, key=lambda v: (not v.isdigit(), int(v) if v.isdigit() else 0, v))
    if how == "speed":
        return sorted(vals, key=lambda v: -1 if v == "0-10" else int(v))
    if how == "yn":
        return [v for v in ["YES", "NO"] if v in vals]
    if how == "severity":
        return [v for v in SEVERITY_ORDER if v in vals] + sorted(set(vals) - set(SEVERITY_ORDER))
    if how == "damage":
        return [v for v in DAMAGE_ORDER if v in vals] + sorted(set(vals) - set(DAMAGE_ORDER))
    return sorted(vals)


def _simplify_geojson(path, prop, decimals=4):
    with open(path) as f:
        g = json.load(f)
    feats = []
    for feat in sorted(g["features"], key=lambda f: str(f["properties"][prop])):
        geom = feat["geometry"]
        polys = geom["coordinates"] if geom["type"] == "MultiPolygon" else [geom["coordinates"]]
        new = []
        for poly in polys:
            rings = []
            for ring in poly:
                pts, last = [], None
                for x, y, *_ in ring:
                    p = [round(x, decimals), round(y, decimals)]
                    if p != last:
                        pts.append(p)
                        last = p
                if len(pts) >= 4:
                    rings.append(pts)
            if rings:
                new.append(rings)
        feats.append({"type": "Feature", "properties": {"name": str(feat["properties"][prop]).strip().upper()},
                      "geometry": {"type": "MultiPolygon", "coordinates": new}})
    return {"type": "FeatureCollection", "features": feats}


def export_site(df, site_dir, rules_out, neighborhoods_path, zips_path, manifest):
    """Write docs/data/crashes.bin.gz + meta.json + boundary files (deterministic)."""
    os.makedirs(site_dir, exist_ok=True)
    n = len(df)
    dt = pd.to_datetime(df["CRASH_DATE"], format="%Y-%m-%d %H:%M:%S")
    lat = df["LATITUDE"].astype(float).to_numpy()
    lon = df["LONGITUDE"].astype(float).to_numpy()
    qlat = np.clip(np.round((lat - LAT_MIN) / (LAT_MAX - LAT_MIN) * 65535), 0, 65535).astype(np.uint16)
    qlon = np.clip(np.round((lon - LON_MIN) / (LON_MAX - LON_MIN) * 65535), 0, 65535).astype(np.uint16)

    # spatial (Morton) order -> much better gzip compression; ties by date then id
    def spread(v):
        v = v.astype(np.uint64)
        v = (v | (v << 8)) & 0x00FF00FF
        v = (v | (v << 4)) & 0x0F0F0F0F
        v = (v | (v << 2)) & 0x33333333
        v = (v | (v << 1)) & 0x55555555
        return v
    morton = spread(qlat >> 4) | (spread(qlon >> 4) << np.uint64(1))
    order = np.lexsort((df["CRASH_RECORD_ID"].astype(str).to_numpy(dtype=str),
                        df["CRASH_DATE"].astype(str).to_numpy(dtype=str), morton))
    df = df.iloc[order].reset_index(drop=True)
    dt, qlat, qlon = dt.iloc[order].reset_index(drop=True), qlat[order], qlon[order]

    cols, meta_cols = [], []

    def add(key, arr, label=None, values=None, kind="code"):
        arr = np.ascontiguousarray(arr)
        nbytes = arr.dtype.itemsize
        meta_cols.append(dict(key=key, bytes=nbytes, kind=kind, label=label, values=values))
        if nbytes == 1:
            cols.append(arr.astype(np.uint8).tobytes())
        else:  # byte planes (low then high) compress better
            a = arr.astype(np.uint16)
            cols.append((a & 0xFF).astype(np.uint8).tobytes())
            cols.append((a >> 8).astype(np.uint8).tobytes())

    day = ((dt - DATE_MIN).dt.days).to_numpy().astype(np.uint16)
    tod = (dt.dt.hour * 60 + dt.dt.minute).to_numpy().astype(np.uint16)
    add("day", day, "Days since 2021-01-01", kind="int")
    add("tod", tod, "Minute of day", kind="int")
    add("qlat", qlat, kind="int")
    add("qlon", qlon, kind="int")
    for key, col, label, how in SITE_DIMS:
        vals = _ordered_values(df[col], how)
        lut = {v: i for i, v in enumerate(vals)}
        codes = df[col].astype(str).map(lut).to_numpy()
        add(key, codes.astype(np.uint16 if len(vals) > 255 else np.uint8), label, vals)
    for key, col in [("injuries", "INJURIES_TOTAL"), ("fatal", "INJURIES_FATAL"),
                     ("incap", "INJURIES_INCAPACITATING")]:
        add(key, np.clip(df[col].astype(int).to_numpy(), 0, 255).astype(np.uint8), col, kind="int")
    street_no = pd.to_numeric(df["STREET_NO"], errors="coerce").fillna(0).astype(int).to_numpy()
    add("block", np.clip(street_no // 100, 0, 65535).astype(np.uint16), "Street number // 100", kind="int")
    streets = sorted(df["STREET_NAME"].astype(str).unique())
    lut = {v: i for i, v in enumerate(streets)}
    add("street", df["STREET_NAME"].astype(str).map(lut).to_numpy().astype(np.uint16), "Street name", streets)

    blob = b"".join(cols)
    gz = gzip.compress(blob, compresslevel=9, mtime=0)
    with open(os.path.join(site_dir, "crashes.bin.gz"), "wb") as f:
        f.write(gz)

    neigh = _simplify_geojson(neighborhoods_path, _name_prop(neighborhoods_path))
    zips = _simplify_geojson(zips_path, "zip")
    for name, g in [("neighborhoods.geojson", neigh), ("zipcodes.geojson", zips)]:
        with open(os.path.join(site_dir, name), "w") as f:
            json.dump(g, f, separators=(",", ":"))

    meta = OrderedDict(
        n=n, day0="2021-01-01", days=int(day.max()) + 1, bbox=[LAT_MIN, LAT_MAX, LON_MIN, LON_MAX],
        quant=65535, columns=meta_cols,
        rules=[dict(id=r["id"], name=r["name"], kind=r["kind"], text=r["text"], rows_dropped=r["rows_dropped"])
               for r in rules_out],
        rows_in=manifest["rows_in"], rows_out=manifest["rows_out"], rows_dropped=manifest["rows_dropped"],
        input_sha256=manifest["input_sha256"],
    )
    with open(os.path.join(site_dir, "meta.json"), "w") as f:
        json.dump(meta, f, separators=(",", ":"))
    return {name: os.path.getsize(os.path.join(site_dir, name)) for name in sorted(os.listdir(site_dir))}


if __name__ == "__main__":
    m = run(site_dir=DEFAULTS["site_dir"], verbose=True)
    print(json.dumps({k: m[k] for k in ("rows_in", "rows_out", "rows_dropped")}, indent=2))
    for r in m["rules"]:
        print(f"{r['id']} {r['name']:<28} dropped {r['rows_dropped']:>8,}")
    print("site:", m.get("site_outputs"))
    sys.exit(0)
