-- ============================================================================
-- DormCRU — schema-update.sql
-- รันไฟล์นี้ใน Supabase SQL Editor เพื่ออัปเดตฐานข้อมูลที่ตั้งไว้แล้ว
-- ให้รองรับ "เจ้าของหอใช้งานได้ทันที ไม่ต้องรอแอดมินอนุมัติ"
-- รันซ้ำได้ไม่ error
-- ============================================================================

-- 1) คอลัมน์เสริม (เผื่อฐานข้อมูลตั้งจาก schema เวอร์ชันเก่า)
alter table dorms add column if not exists phone text;
alter table dorms add column if not exists line_id text;
alter table dorms add column if not exists facebook text;
alter table dorms add column if not exists verified boolean not null default false;
alter table bookings add column if not exists contact_phone text;
alter table bookings add column if not exists note text;

-- 2) เจ้าของหอไม่ต้องรออนุมัติอีกต่อไป
alter table profiles alter column approved set default true;
update profiles set approved = true where role = 'owner' and approved = false;

-- 3) ฟังก์ชัน "รับช่วงดูแลหอพัก" — ให้เจ้าของหอตัวจริงกดรับหอที่ยังไม่มีใครยืนยันดูแลได้เอง
create or replace function claim_dorm(p_dorm_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_dorm dorms%rowtype;
begin
  select * into v_dorm from dorms where id = p_dorm_id;
  if v_dorm.id is null then
    raise exception 'ไม่พบหอพักนี้';
  end if;
  if v_dorm.verified then
    raise exception 'หอพักนี้มีเจ้าของยืนยันดูแลอยู่แล้ว หากเป็นของคุณกรุณาติดต่อผู้ดูแลระบบ';
  end if;
  if not (is_admin() or is_approved_owner()) then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีเจ้าของหอพักก่อน';
  end if;

  update dorms set owner_id = auth.uid() where id = p_dorm_id;
end;
$$;

-- 4) อนุญาตให้ระยะทางจากประตูเป็น "ยังไม่ระบุ" (null) ได้ สำหรับหอที่เจ้าของยังไม่กรอกข้อมูล
alter table dorms alter column gate1 drop not null;
alter table dorms alter column gate2 drop not null;
alter table dorms alter column gate3 drop not null;
alter table dorms alter column gate1 drop default;
alter table dorms alter column gate2 drop default;
alter table dorms alter column gate3 drop default;
