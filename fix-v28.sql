-- ============================================================================
-- fix-v28.sql — เก็บ "รูปสัญญาเช่า" ของแต่ละรายการเช่า
--
-- รันไฟล์นี้ใน Supabase -> SQL Editor -> New query -> วาง -> Run
-- รันซ้ำได้ ไม่พัง (ใช้ if not exists / drop policy if exists ทุกจุด)
--
-- ⚠️ สำคัญเรื่องความเป็นส่วนตัว:
--    สัญญาเช่ามีข้อมูลส่วนตัวของนักศึกษา (ชื่อ-สกุล เลขบัตร ลายเซ็น)
--    จึง "ห้าม" เก็บในถังรูปสาธารณะ (dorm-photos) ที่ใครมีลิงก์ก็เปิดดูได้
--    ไฟล์นี้จึงสร้างถังใหม่ dorm-contracts แบบ private แยกต่างหาก
--    และเปิดให้เฉพาะเจ้าของไฟล์ (เจ้าของหอที่อัปโหลด) กับผู้ดูแลระบบเท่านั้นที่เปิดดูได้
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ส่วนที่ 1: คอลัมน์เก็บที่อยู่ไฟล์สัญญา
-- ---------------------------------------------------------------------------
-- เก็บเป็น "path ในถัง" ไม่ใช่ URL เต็ม เพราะถังเป็น private
-- เวลาจะเปิดดูต้องขอลิงก์ชั่วคราว (signed URL) เอาตอนนั้น
alter table bookings add column if not exists contract_url text;

comment on column bookings.contract_url is
  'path ของรูปสัญญาเช่าในถัง dorm-contracts (เช่น <uid>/xxxx.jpg) — ว่างได้';

-- นโยบายแก้ไข bookings เดิม (จาก fix-open-listing.sql) อนุญาตให้เจ้าของหอที่ผ่านอนุมัติ
-- แก้ไขใบจองของหอตัวเองได้อยู่แล้ว จึงครอบคลุมคอลัมน์ใหม่นี้ด้วย ไม่ต้องแก้เพิ่ม
-- (ย้ำไว้ตรงนี้เผื่อใครเผลอไปแก้ทีหลัง: นักศึกษาต้องแนบสัญญาเองไม่ได้)


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2: ถังเก็บไฟล์สัญญา (private)
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('dorm-contracts', 'dorm-contracts', false)
on conflict (id) do update set public = false;   -- กันกรณีเคยสร้างเป็น public ไว้

-- อัปโหลดได้เฉพาะเข้าโฟลเดอร์ที่ชื่อตรงกับ uid ของตัวเอง
-- เช่น เจ้าของหอ uid = abc จะเขียนได้แค่ไฟล์ที่ขึ้นต้นด้วย abc/
drop policy if exists "contracts_insert_own" on storage.objects;
create policy "contracts_insert_own" on storage.objects for insert
to authenticated
with check (
  bucket_id = 'dorm-contracts'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- เปิดดูได้เฉพาะไฟล์ของตัวเอง หรือผู้ดูแลระบบ
drop policy if exists "contracts_select_own" on storage.objects;
create policy "contracts_select_own" on storage.objects for select
to authenticated
using (
  bucket_id = 'dorm-contracts'
  and (auth.uid()::text = (storage.foldername(name))[1] or is_admin())
);

-- ลบ/แทนที่ได้เฉพาะไฟล์ของตัวเอง หรือผู้ดูแลระบบ
drop policy if exists "contracts_delete_own" on storage.objects;
create policy "contracts_delete_own" on storage.objects for delete
to authenticated
using (
  bucket_id = 'dorm-contracts'
  and (auth.uid()::text = (storage.foldername(name))[1] or is_admin())
);

drop policy if exists "contracts_update_own" on storage.objects;
create policy "contracts_update_own" on storage.objects for update
to authenticated
using (
  bucket_id = 'dorm-contracts'
  and (auth.uid()::text = (storage.foldername(name))[1] or is_admin())
)
with check (
  bucket_id = 'dorm-contracts'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- ไม่มีนโยบายสำหรับ role anon = คนที่ยังไม่ล็อกอินเปิดไฟล์สัญญาไม่ได้เลย

-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 แล้วเข้าเมนู "สรุปการเช่า"
