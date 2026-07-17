-- ============================================================================
-- DormCRU — schema-update.sql
-- สำหรับคนที่รัน schema.sql เวอร์ชันก่อนหน้าไปแล้ว: รันไฟล์นี้เพิ่มใน SQL Editor
-- เพื่ออัปเกรดตารางให้รองรับช่องทางติดต่อ + สถานะยืนยันข้อมูล + โหมดจองก่อนทำสัญญา
-- (ถ้าตั้งโปรเจคใหม่ตั้งแต่ต้น ใช้ schema.sql ไฟล์เดียวพอ ไม่ต้องรันไฟล์นี้)
-- ============================================================================

alter table dorms add column if not exists phone text;
alter table dorms add column if not exists line_id text;
alter table dorms add column if not exists facebook text;
alter table dorms add column if not exists verified boolean not null default false;

alter table bookings add column if not exists contact_phone text;
alter table bookings add column if not exists note text;
