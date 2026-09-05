#!/usr/bin/env python3
"""
build_site.py — อ่าน data/pubmed.nbib + data/scimagojr_*.csv + data/faculty.csv
                แล้วสร้าง index.html (ไฟล์เดียวจบ) ที่ราก repo

ใช้เฉพาะ standard library
"""

import collections
import csv
import glob
import json
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NBIB = os.path.join(ROOT, "data", "pubmed.nbib")
FACULTY = os.path.join(ROOT, "data", "faculty.csv")
TEMPLATE = os.path.join(ROOT, "build", "template.html")
APPJS = os.path.join(ROOT, "build", "app.js")
OUT = os.path.join(ROOT, "index.html")

# ประเภทเอกสาร
LETTER = {"Letter", "Comment", "Editorial", "Published Erratum",
          "Retraction of Publication"}
NONRES = {"News", "Biography", "Historical Article", "Congress"}
REVIEW = {"Review", "Systematic Review", "Meta-Analysis"}
CASE = {"Case Reports"}
GUIDE = {"Practice Guideline", "Guideline"}
BAD_TITLE = re.compile(
    r"^(in reply|in response|reply|response to|comment on|correspondence|"
    r"letter to|erratum|corrigendum|correction|retraction|author.s reply)", re.I)


# ------------------------------------------------------------------ utils --

def norm_name(s):
    return re.sub(r"[^a-z]", "", (s or "").lower())


def norm_issn(s):
    return re.sub(r"[^0-9Xx]", "", s or "").upper()


# ---------------------------------------------------------------- roster ---

def load_roster():
    roster = []
    with open(FACULTY, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            fam = (row.get("family") or "").strip()
            giv = (row.get("given") or "").strip()
            if not fam:
                continue
            roster.append({"family_norm": norm_name(fam),
                           "initial": giv[:1].upper(),
                           "display": f"{giv} {fam}".strip()})
    return roster


def match_roster(author_str, roster):
    s = (author_str or "").replace(",", " ").strip()
    parts = s.split()
    if len(parts) < 2:
        return None
    cands = [(" ".join(parts[:-1]), parts[-1][:1].upper()),
             (" ".join(parts[1:]), parts[0][:1].upper())]
    for surname, initial in cands:
        sn = norm_name(surname)
        if not sn:
            continue
        for r in roster:
            if r["family_norm"] == sn and r["initial"] == initial:
                return r["display"]
    return None


# --------------------------------------------------------------- medline ---

def parse_medline(path):
    records, cur, tag = [], None, None

    def flush():
        if cur and (cur["authors"] or cur["title"]):
            while len(cur["affils"]) < len(cur["authors"]):
                cur["affils"].append("")
            records.append(cur)

    with open(path, encoding="utf-8", errors="replace") as f:
        for raw in f:
            line = raw.rstrip("\r\n")
            if not line.strip():
                continue
            if line.startswith("PMID- "):
                flush()
                cur = {"pmid": line[6:].strip(), "year": "", "title": "",
                       "journal": "", "journal_full": "", "doi": "",
                       "authors": [], "affils": [], "ptypes": [], "issns": []}
                tag = None
                continue
            if cur is None:
                continue
            m = re.match(r"^([A-Z]{2,4})\s*-\s(.*)$", line)
            if m:
                tag, val = m.group(1), m.group(2)
                if tag == "AU":
                    cur["authors"].append(val.strip())
                    while len(cur["affils"]) < len(cur["authors"]) - 1:
                        cur["affils"].append("")
                elif tag == "AD":
                    if len(cur["affils"]) < len(cur["authors"]):
                        cur["affils"].append(val.strip())
                    else:
                        cur["affils"][-1] += " " + val.strip()
                elif tag == "TI":
                    cur["title"] = val.strip()
                elif tag == "TA":
                    cur["journal"] = val.strip()
                elif tag == "JT":
                    cur["journal_full"] = val.strip()
                elif tag == "IS":
                    cur["issns"].append(norm_issn(val.split("(")[0]))
                elif tag == "PT":
                    cur["ptypes"].append(val.strip())
                elif tag == "DP":
                    ym = re.search(r"(19|20)\d{2}", val)
                    if ym:
                        cur["year"] = ym.group(0)
                elif tag in ("LID", "AID") and "doi" in val.lower():
                    if not cur["doi"]:
                        cur["doi"] = val.split()[0].strip().lower()
            else:
                cont = line.strip()
                if tag == "TI":
                    cur["title"] += " " + cont
                elif tag == "AD" and cur["affils"]:
                    cur["affils"][-1] += " " + cont
    flush()
    return records


def doctype(rec):
    pts = set(rec["ptypes"])
    title = (rec["title"] or "").strip()
    if BAD_TITLE.match(title) or (pts & LETTER):
        return "letter"
    if pts & NONRES:
        return "other"
    if pts & REVIEW:
        return "review"
    if pts & CASE:
        return "case_report"
    if pts & GUIDE:
        return "guideline"
    return "original"


# --------------------------------------------------------------- scimago ---

def load_scimago():
    """ใช้ไฟล์ scimagojr_*.csv ที่ปีใหม่สุดใน data/"""
    files = sorted(glob.glob(os.path.join(ROOT, "data", "scimagojr_*.csv")))
    if not files:
        print("! ไม่พบไฟล์ Scimago — quartile จะว่างทั้งหมด")
        return {}, ""
    path = files[-1]
    year = re.search(r"(\d{4})", os.path.basename(path))
    year = year.group(1) if year else "?"
    by_issn = {}
    with open(path, encoding="utf-8-sig") as f:
        for row in csv.DictReader(f, delimiter=";"):
            rec = {"best_q": (row.get("SJR Best Quartile") or "").strip(),
                   "categories": (row.get("Categories") or "").strip('" '),
                   "title": (row.get("Title") or "").strip('" ')}
            for raw in (row.get("Issn") or "").replace('"', "").split(","):
                i = norm_issn(raw)
                if len(i) == 8:
                    by_issn.setdefault(i, rec)
    print(f"Scimago {year}: {len(by_issn)} ISSN")
    return by_issn, year


# ----------------------------------------------------------------- build ---

def main():
    if not os.path.exists(NBIB):
        sys.exit(f"ไม่พบ {NBIB} — รัน build/fetch_pubmed.py ก่อน")

    roster = load_roster()
    print(f"รายชื่ออาจารย์: {len(roster)}")

    recs = parse_medline(NBIB)
    print(f"เรคอร์ดจาก PubMed: {len(recs)}")

    sci, sci_year = load_scimago()

    def qinfo(rec):
        for i in rec["issns"]:
            if i in sci:
                return (sci[i]["best_q"] or ""), sci[i]
        return ("not-indexed" if sci else ""), None

    papers, jmeta = [], {}
    for r in recs:
        n = len(r["authors"])
        dept = []
        for i, a in enumerate(r["authors"]):
            who = match_roster(a, roster)
            if not who:
                continue
            pos = "first" if i == 0 else ("last" if (i == n - 1 and n > 1) else "middle")
            dept.append({"person": who, "pos": pos})
        if not dept:
            continue
        q, hit = qinfo(r)
        j = r["journal"] or r["journal_full"] or "(ไม่ระบุวารสาร)"
        if j not in jmeta:
            jmeta[j] = {"q": q,
                        "categories": hit["categories"] if hit else "",
                        "sci_title": hit["title"] if hit else ""}
        y = int(r["year"]) if str(r["year"]).isdigit() else None
        papers.append({"pmid": r["pmid"], "doi": r["doi"], "year": y,
                       "journal": j, "title": (r["title"] or "").strip(),
                       "nau": n, "doctype": doctype(r), "q": q,
                       "qconf": f"scimago{sci_year}" if hit else "unmatched",
                       "dept": dept})

    papers = [p for p in papers if p["year"]]
    years = sorted({p["year"] for p in papers})
    print(f"บทความที่มีอาจารย์ภาควิชา: {len(papers)} | ปี {years[0]}-{years[-1]}")
    print("quartile:", dict(collections.Counter(p["q"] for p in papers)))

    jc = collections.Counter(p["journal"] for p in papers)
    journals = [{"name": nm, "n": cnt, "q": jmeta[nm]["q"],
                 "conf": "scimago", "categories": jmeta[nm]["categories"],
                 "sci_title": jmeta[nm]["sci_title"]}
                for nm, cnt in sorted(jc.items(), key=lambda x: (-x[1], x[0]))]
    notidx = [j for j in journals if j["q"] == "not-indexed"]
    print(f"วารสาร: {len(journals)} | ไม่อยู่ใน Scopus: {len(notidx)}")

    data = {
        "generated_note": f"PubMed | Quartile = SJR Best Quartile จาก Scimago {sci_year}",
        "generated_at": __import__("datetime").datetime.now(
            __import__("datetime").timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "sci_year": sci_year,
        "years": years,
        "roster": sorted({r["display"] for r in roster}),
        "papers": papers,
        "journals": journals,
    }

    tmpl = open(TEMPLATE, encoding="utf-8").read()
    app = open(APPJS, encoding="utf-8").read()
    dj = json.dumps(data, ensure_ascii=False).replace("</script", "<\\/script")
    html = tmpl.replace("__DATA_JSON__", dj).replace("__APP_JS__", app)
    with open(OUT, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"เขียน {OUT} ({len(html)} bytes)")


if __name__ == "__main__":
    main()
