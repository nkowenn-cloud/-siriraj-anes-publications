# ทะเบียนผลงานตีพิมพ์ — ภาควิชาวิสัญญีวิทยา ศิริราช

เว็บไซต์ค้นหาผลงานตีพิมพ์รายบุคคลและสถิติภาควิชา ดึงข้อมูลจาก PubMed อัตโนมัติทุกสัปดาห์

## ติดตั้งครั้งแรก

1. สร้าง repo ใหม่บน GitHub (public) แล้วอัปโหลดไฟล์ทั้งหมดในโฟลเดอร์นี้ขึ้นไป
2. ไปที่ **Settings → Pages** → Source เลือก branch `main` โฟลเดอร์ `/ (root)` → Save
3. ไปที่ **Settings → Actions → General** → เลื่อนลงหา **Workflow permissions** →
   เลือก **Read and write permissions** → Save
   (ถ้าไม่ตั้งข้อนี้ Actions จะ push ผลลัพธ์กลับเข้า repo ไม่ได้)
4. ไปที่แท็บ **Actions** → เลือก workflow *Update publications from PubMed* →
   กด **Run workflow** เพื่อทดสอบรันครั้งแรก

เว็บจะอยู่ที่ `https://<username>.github.io/<repo-name>/`

## แนะนำ (ไม่บังคับ): ใส่ NCBI API key

ช่วยให้ดึงข้อมูลเร็วขึ้นและเสถียรกว่า (จาก 3 เป็น 10 request/วินาที)

1. สมัคร/ล็อกอิน NCBI → Account settings → API Key Management → สร้างคีย์
2. ใน repo ไปที่ **Settings → Secrets and variables → Actions → New repository secret**
   - ชื่อ `NCBI_API_KEY` ค่า = คีย์ที่ได้
   - ชื่อ `NCBI_EMAIL` ค่า = อีเมลของคุณ (NCBI ขอให้ระบุผู้ติดต่อ)

## โครงสร้างไฟล์

```
index.html                     เว็บที่ build แล้ว (Actions สร้างให้ อย่าแก้มือ)
build/
  fetch_pubmed.py              ดึงข้อมูลจาก PubMed E-utilities → data/pubmed.nbib
  build_site.py                รวมข้อมูล + Scimago → index.html
  template.html                โครงหน้าเว็บและ CSS
  app.js                       ตรรกะการค้นหา/กรอง/กราฟ
data/
  faculty.csv                  รายชื่ออาจารย์ (แก้ไฟล์นี้เมื่อมีคนเข้า/ออก)
  scimagojr_2025.csv           ฐาน quartile จาก Scimago
  pubmed.nbib                  ข้อมูลดิบล่าสุด (Actions อัปเดตให้)
.github/workflows/update.yml   ตารางเวลารันอัตโนมัติ
```

## งานที่ต้องทำเป็นระยะ

**เมื่อมีอาจารย์เข้าใหม่หรือเปลี่ยนชื่อ** — แก้ `data/faculty.csv` เพิ่มบรรทัดใหม่

| คอลัมน์ | ตัวอย่าง | หมายเหตุ |
|---|---|---|
| `full` | Nuanprae Kitisin | ชื่อที่แสดงบนเว็บ |
| `given` | Nuanprae | ชื่อต้น |
| `family` | Kitisin | นามสกุล |
| `pubmed` | Kitisin N | รูปแบบที่ PubMed ใช้ (นามสกุล + อักษรย่อ) |

commit แล้ว Actions จะ rebuild ให้เอง

**ทุกต้นปี** — ดาวน์โหลด Scimago ปีใหม่จาก
[scimagojr.com/journalrank.php](https://www.scimagojr.com/journalrank.php)
(ตั้ง Subject Area = All, Type = Journals, เลือกปี แล้วกด Download data)
วางไว้ใน `data/` ชื่อ `scimagojr_<ปี>.csv` — สคริปต์จะเลือกไฟล์ปีใหม่สุดให้เอง
ลบไฟล์ปีเก่าออกได้หรือเก็บไว้ก็ได้

## ตารางเวลารันอัตโนมัติ

รันทุกวันจันทร์ 08:00 น. เวลาไทย และรันทุกครั้งที่แก้ไฟล์ใน `build/` หรือ `data/`
กดรันเองได้ตลอดจากแท็บ Actions

## ข้อจำกัดที่ควรรู้

- **ค้นด้วยชื่อ ไม่ใช่ affiliation** — ผลงานที่อาจารย์ตีพิมพ์ภายใต้สังกัดอื่นก็จะติดมาด้วย
  และคนที่สะกดชื่อในวารสารต่างจากใน `faculty.csv` จะค้นไม่เจอ
- **ชื่อซ้ำ** — จับคู่ด้วยนามสกุล + อักษรย่อชื่อต้น ถ้ามีคนนามสกุลเดียวกันและอักษรย่อ
  เดียวกันจะแยกไม่ออก ทางแก้ที่แม่นกว่าคือใช้ ORCID/Scopus Author ID
- **Quartile ใช้ปีเดียวกับทุกปีที่ตีพิมพ์** — ถ้ารายงานคณะฯ ต้องการ quartile ของปีที่
  ตีพิมพ์จริง ต้องดาวน์โหลด Scimago หลายปีและแก้ `build_site.py` ให้เลือกตามปี
- **วารสารที่ขึ้นว่า "ไม่อยู่ใน Scopus"** = ไม่พบใน Scimago ปีนั้น (ถูกถอดออกจากฐาน
  หรือไม่เคยถูกจัดทำดัชนี) ไม่ได้แปลว่าข้อมูลผิด
- ตัวเลขจากเว็บนี้เป็นข้อมูลอ้างอิงเบื้องต้น ควรตรวจสอบก่อนนำไปใช้ในรายงานราชการ
