#!/usr/bin/env python3
"""
fetch_pubmed.py — ดึงผลงานตีพิมพ์จาก PubMed ด้วย E-utilities API

ใช้รายชื่ออาจารย์จาก data/faculty.csv สร้าง query อัตโนมัติ
แล้วบันทึกผลเป็นไฟล์ MEDLINE ที่ data/pubmed.nbib

ใช้เฉพาะ standard library ไม่ต้องลงอะไรเพิ่ม

ตัวแปรสภาพแวดล้อม (ไม่บังคับ แต่แนะนำ):
  NCBI_API_KEY   คีย์จาก NCBI account -> เพิ่ม rate limit จาก 3 เป็น 10 req/sec
  NCBI_EMAIL     อีเมลติดต่อ (NCBI ขอให้ระบุ)
  START_YEAR     ปีเริ่มต้น (ค่าเริ่มต้น 2021)
"""

import csv
import os
import sys
import time
import urllib.parse
import urllib.request

BASE = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FACULTY = os.path.join(ROOT, "data", "faculty.csv")
OUT = os.path.join(ROOT, "data", "pubmed.nbib")

API_KEY = os.environ.get("NCBI_API_KEY", "").strip()
EMAIL = os.environ.get("NCBI_EMAIL", "").strip()
TOOL = "siriraj-anes-publications"
START_YEAR = os.environ.get("START_YEAR", "2021").strip()
BATCH_NAMES = 30      # จำนวนชื่อต่อหนึ่ง query ป้องกัน query ยาวเกิน
FETCH_SIZE = 200      # จำนวนเรคอร์ดต่อการ efetch หนึ่งครั้ง
# ไม่มี API key -> 3 req/sec, มี key -> 10 req/sec เผื่อไว้ให้ช้ากว่าลิมิตเล็กน้อย
DELAY = 0.15 if API_KEY else 0.40


def log(msg):
    print(msg, flush=True)


def common_params():
    p = {"tool": TOOL}
    if EMAIL:
        p["email"] = EMAIL
    if API_KEY:
        p["api_key"] = API_KEY
    return p


def post(endpoint, params, retries=4):
    """เรียก E-utilities ด้วย POST (query ยาวเกินกว่าจะใส่ใน URL)"""
    url = f"{BASE}/{endpoint}.fcgi"
    data = urllib.parse.urlencode(params).encode("utf-8")
    last_err = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=data,
                                         headers={"User-Agent": TOOL})
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.read().decode("utf-8", errors="replace")
        except Exception as e:                      # noqa: BLE001
            last_err = e
            wait = 2 ** attempt
            log(f"  ! {endpoint} ล้มเหลว ({e}) รออีก {wait}s แล้วลองใหม่")
            time.sleep(wait)
    raise RuntimeError(f"{endpoint} ล้มเหลวหลังลอง {retries} ครั้ง: {last_err}")


def load_names():
    names = []
    with open(FACULTY, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            pm = (row.get("pubmed") or "").strip()
            if pm:
                names.append(pm)
    # ตัดชื่อซ้ำโดยรักษาลำดับเดิม
    seen, out = set(), []
    for n in names:
        k = n.lower()
        if k not in seen:
            seen.add(k)
            out.append(n)
    return out


def build_terms(names):
    """แบ่งรายชื่อเป็นชุด แล้วสร้าง query term ต่อชุด"""
    terms = []
    for i in range(0, len(names), BATCH_NAMES):
        chunk = names[i:i + BATCH_NAMES]
        ors = " OR ".join(f'"{n}"[au]' for n in chunk)
        terms.append(f"({ors}) AND {START_YEAR}:3000[dp]")
    return terms


def esearch_pmids(term):
    """คืน list ของ PMID ที่ตรงกับ term"""
    params = common_params()
    params.update({"db": "pubmed", "term": term, "retmax": "100000",
                   "retmode": "json"})
    txt = post("esearch", params)
    import json
    data = json.loads(txt)
    return data.get("esearchresult", {}).get("idlist", [])


def efetch_medline(pmids):
    """ดึงเรคอร์ด MEDLINE ทีละชุด"""
    chunks = []
    for i in range(0, len(pmids), FETCH_SIZE):
        batch = pmids[i:i + FETCH_SIZE]
        params = common_params()
        params.update({"db": "pubmed", "id": ",".join(batch),
                       "rettype": "medline", "retmode": "text"})
        log(f"  efetch {i + 1}-{i + len(batch)} จาก {len(pmids)}")
        chunks.append(post("efetch", params))
        time.sleep(DELAY)
    return "\n".join(chunks)


def main():
    names = load_names()
    log(f"รายชื่ออาจารย์: {len(names)} คน")
    if not names:
        sys.exit("ไม่พบรายชื่อใน data/faculty.csv (ต้องมีคอลัมน์ pubmed)")

    terms = build_terms(names)
    log(f"แบ่งเป็น {len(terms)} query")

    all_pmids = []
    seen = set()
    for i, term in enumerate(terms, 1):
        ids = esearch_pmids(term)
        new = [p for p in ids if p not in seen]
        seen.update(new)
        all_pmids.extend(new)
        log(f"  query {i}/{len(terms)}: พบ {len(ids)} (ใหม่ {len(new)})")
        time.sleep(DELAY)

    log(f"รวม PMID ที่ไม่ซ้ำ: {len(all_pmids)}")
    if not all_pmids:
        sys.exit("ไม่พบผลงานเลย — ตรวจ query หรือการเชื่อมต่อ")

    text = efetch_medline(all_pmids)

    # ตรวจความสมเหตุสมผลก่อนเขียนทับ กัน API คืนค่าว่างแล้วข้อมูลหาย
    got = text.count("\nPMID- ") + (1 if text.startswith("PMID- ") else 0)
    log(f"เรคอร์ดที่ได้รับ: {got}")
    if got < len(all_pmids) * 0.9:
        sys.exit(f"ได้เรคอร์ดไม่ครบ ({got}/{len(all_pmids)}) — ยกเลิกเพื่อไม่ให้ข้อมูลเดิมเสียหาย")

    if os.path.exists(OUT):
        old = open(OUT, encoding="utf-8", errors="replace").read()
        old_n = old.count("\nPMID- ") + (1 if old.startswith("PMID- ") else 0)
        if got < old_n * 0.8:
            sys.exit(f"ข้อมูลใหม่ ({got}) น้อยกว่าเดิม ({old_n}) มากผิดปกติ — ยกเลิก")

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(text)
    log(f"บันทึก {OUT}")


if __name__ == "__main__":
    main()
