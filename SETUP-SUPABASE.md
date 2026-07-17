# คู่มือติดตั้ง DormCRU — GitHub + Vercel + Supabase

โครงสร้างเวอร์ชันนี้เป็นไฟล์แบนราบ (ไม่มีโฟลเดอร์ assets) ตั้งใจให้ deploy ผ่าน
**Vercel** โดยดึงโค้ดจาก **GitHub** และใช้ **Supabase** เป็นฐานข้อมูล/auth/ที่เก็บไฟล์

---

## ขั้นที่ 1: อัปโหลดโค้ดขึ้น GitHub

1. เข้า https://github.com → สร้าง repository ใหม่ (New repository) เช่นชื่อ `dormcru`
   (Public หรือ Private ก็ได้ ถ้า Private ต้องเชื่อม Vercel ด้วยบัญชี GitHub เดียวกัน)
2. อัปโหลดไฟล์ทั้งหมดในโปรเจคนี้ขึ้น repo (ลากไฟล์วางในหน้า GitHub ผ่านเว็บได้เลย ถ้ายังไม่ถนัด
   คำสั่ง git — เมนู "Add file" → "Upload files")
3. ตรวจว่าไฟล์ `index.html`, `login.html`, `admin.html`, `app.js`, `admin.js`, `db.js`,
   `style.css`, `vercel.json` อยู่ที่ **ราก repo โดยตรง** ไม่อยู่ในโฟลเดอร์ย่อยใดๆ (สำคัญมาก
   — นี่คือจุดที่ทำให้เวอร์ชันก่อนหน้าพังตอน deploy)

## ขั้นที่ 2: สร้างโปรเจค Supabase + รัน schema.sql

เหมือนเดิมทุกประการกับคู่มือ Supabase ก่อนหน้า:

1. https://supabase.com → New project → เลือก region Singapore
2. **SQL Editor** → วางเนื้อหาไฟล์ `schema.sql` ทั้งหมด → Run
3. **Storage** → New bucket ชื่อ `slips` → เปิด Public bucket
4. **Authentication → Providers → Email** → ปิด **Confirm email**
5. **Project Settings → API** → คัดลอก Project URL และ anon public key

## ขั้นที่ 3: ใส่ค่า Supabase ลงใน db.js

เปิดไฟล์ `db.js` ในโปรเจค (อยู่ที่รากไฟล์เลย ไม่ใช่ในโฟลเดอร์ assets แล้ว) แก้ 2 บรรทัดนี้
ที่อยู่บนสุดของไฟล์:

```js
const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_PUBLIC_KEY";
```

แทนที่ด้วยค่าจริง แล้ว commit/push ขึ้น GitHub อีกครั้ง (หรืออัปโหลดไฟล์ใหม่ทับ)

> **เว็บจะไม่มีวันขึ้นหน้าว่างเปล่าอีกแล้ว** แม้ยังไม่ได้แก้ค่านี้ — จะขึ้นแบนเนอร์สีเหลือง
> แจ้งเตือนด้านบนแทน (ฟีเจอร์ค้นหา/หน้าตาเว็บยังใช้งานได้ปกติ แค่ล็อคอิน/จองยังไม่ทำงาน)

## ขั้นที่ 4: เชื่อม Vercel กับ GitHub repo

1. https://vercel.com → Log in ด้วยบัญชี GitHub เดียวกับที่ใช้อัปโหลดโค้ด
2. **Add New → Project** → เลือก repo `dormcru` ที่สร้างไว้ → **Import**
3. หน้า Configure Project: **Framework Preset เลือก "Other"** (เพราะเป็น static HTML ธรรมดา
   ไม่มี build step) ปล่อย Build Command / Output Directory ว่างไว้ได้เลย
4. กด **Deploy** รอประมาณ 30 วินาที จะได้ลิงก์ เช่น `https://dormcru-xxxx.vercel.app`
5. ครั้งต่อไปที่แก้โค้ดแล้ว push ขึ้น GitHub, Vercel จะ deploy เวอร์ชันใหม่ให้อัตโนมัติทันที

## ขั้นที่ 5: ตั้งบัญชีแอดมินคนแรก

1. เปิดเว็บที่ deploy แล้ว → สมัครผ่านแท็บ **"สมัครเจ้าของหอ"** ในหน้า `/login`
2. Supabase Dashboard → **Table Editor** → ตาราง `profiles` → หาแถวอีเมลที่สมัคร →
   แก้ `role` เป็น `admin` และ `approved` เป็น `true`
3. ล็อกอินใหม่ → เข้า `/admin` จะเห็นเมนูแอดมินครบ (รวม "อนุมัติเจ้าของหอพัก")
4. กด **"โหลดข้อมูลหอพักตัวอย่าง"** เพื่อทดสอบระบบ

## โครงสร้างไฟล์ (ตั้งใจให้แบนราบ ไม่มีโฟลเดอร์ย่อย)

```
dormcru/
├── index.html   หน้าแรก + ค้นหา + รายละเอียดหอพัก + จอง + wishlist (โมดัลทั้งหมดในหน้าเดียว)
├── login.html   เข้าสู่ระบบ/สมัครนักศึกษา/สมัครเจ้าของหอ (3 แท็บในหน้าเดียว)
├── admin.html   หลังบ้าน (โครง HTML)
├── admin.js     หลังบ้าน (ตรรกะ)
├── app.js       ฟังก์ชันร่วม (nav, toast, auth guard)
├── db.js        ชั้นข้อมูล Supabase — แก้ config ตรงนี้
├── style.css    สไตล์ทั้งหมด
├── schema.sql   รันใน Supabase SQL Editor ครั้งเดียวตอนตั้งค่า
└── vercel.json  ตั้งค่า clean URL ให้ /login และ /admin ใช้ได้โดยไม่ต้องพิมพ์ .html
```

## ทำไมแบบนี้ถึง deploy ได้เสถียรกว่าเดิม
- ไม่มีโฟลเดอร์ `assets/` ให้ path ผิดพลาดตอน deploy
- `db.js` เช็คตัวเองก่อนทุกครั้งว่า Supabase พร้อมหรือยัง ถ้ายังไม่พร้อมจะไม่ throw error
  ที่ทำให้ทั้งหน้าเว็บพัง แค่ฟีเจอร์ที่ต้องใช้ฐานข้อมูลจะใช้ไม่ได้ชั่วคราว
- `<script>` ทั้งหมดอยู่ท้าย `<body>` เสมอ HTML/CSS หลักของหน้าเว็บแสดงผลได้ก่อน
  ไม่ขึ้นกับความสำเร็จของ JavaScript
