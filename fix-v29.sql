-- ============================================================================
-- fix-v29.sql — ตาราง "สรุปการเช่า" แบบเจ้าของหอกรอกเอง
--
-- รันไฟล์นี้ใน Supabase -> SQL Editor -> New query -> วาง -> Run
-- รันซ้ำได้ ไม่พัง
--
-- ไฟล์นี้ครอบคลุมของใน fix-v28.sql ให้ด้วย (ถังเก็บรูปสัญญา)
-- ถ้ายังไม่ได้รัน v28 รันไฟล์นี้ไฟล์เดียวก็พอ
--
-- ⚠️ ความเป็นส่วนตัว: รูปสัญญามีชื่อ-สกุล เลขบัตร ลายเซ็นของผู้เช่า
--    จึงเก็บในถัง dorm-contracts แบบ private แยกจากรูปหอ (ซึ่งเป็นถังสาธารณะ)
--    เปิดดูได้เฉพาะเจ้าของไฟล์กับผู้ดูแลระบบ และต้องขอลิงก์ชั่วคราวทุกครั้ง
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ส่วนที่ 1: ตารางรายการเช่า
--
-- เจ้าของหอกรอกเองทั้งหมด ไม่ได้ดึงมาจากใบจอง
-- เพราะผู้เช่าจริงหลายคนไม่ได้จองผ่านเว็บ (เดินมาที่หอเลย / โทรมา / รุ่นพี่แนะนำ)
-- ถ้าดึงจากใบจองอย่างเดียว ตารางจะไม่ตรงกับความจริงของหอ
-- ---------------------------------------------------------------------------
create table if not exists rentals (
  id          uuid primary key default gen_random_uuid(),
  dorm_id     uuid references dorms(id) on delete cascade,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  rent_date   date,            -- วันที่เข้าอยู่ / วันที่ทำสัญญา
  room_no     text,            -- เลขห้อง (พิมพ์เอง ไม่ต้องผูกกับผังห้อง)
  tenant_name text,            -- ชื่อผู้เช่า
  tenant_phone text,           -- เบอร์ติดต่อ (ไม่บังคับ)
  note        text,            -- หมายเหตุ (ไม่บังคับ)
  contract_url text,           -- path รูปสัญญาในถัง dorm-contracts (ไม่ใช่ URL เต็ม)
  created_at  timestamptz not null default now()
);

comment on table rentals is
  'รายการผู้เช่าที่เจ้าของหอกรอกเอง ใช้ในหน้า "สรุปการเช่า" — ไม่เกี่ยวกับตาราง bookings';

create index if not exists rentals_owner_idx on rentals (owner_id, rent_date desc);
create index if not exists rentals_dorm_idx  on rentals (dorm_id);

alter table rentals enable row level security;

-- เห็นได้เฉพาะรายการของตัวเอง (ผู้ดูแลระบบเห็นหมด)
-- ไม่มีนโยบายให้ role anon = คนที่ยังไม่ล็อกอินอ่านไม่ได้เลย
drop policy if exists "rentals_select" on rentals;
create policy "rentals_select" on rentals for select
to authenticated
using (owner_id = auth.uid() or is_admin());

-- เพิ่มได้เฉพาะรายการที่ owner_id เป็นตัวเอง
-- (กันไม่ให้ยัดรายการเข้าไปในบัญชีเจ้าของหอคนอื่น)
drop policy if exists "rentals_insert" on rentals;
create policy "rentals_insert" on rentals for insert
to authenticated
with check (owner_id = auth.uid());

-- แก้ได้เฉพาะของตัวเอง และห้ามเปลี่ยน owner_id ไปเป็นของคนอื่น
drop policy if exists "rentals_update" on rentals;
create policy "rentals_update" on rentals for update
to authenticated
using (owner_id = auth.uid() or is_admin())
with check (owner_id = auth.uid() or is_admin());

drop policy if exists "rentals_delete" on rentals;
create policy "rentals_delete" on rentals for delete
to authenticated
using (owner_id = auth.uid() or is_admin());

-- กัน owner_id ถูกปลอม: บังคับให้เป็น auth.uid() เสมอตอน insert
-- (นโยบายด้านบนกันอยู่แล้ว อันนี้กันอีกชั้นเผื่อเผลอส่งค่าผิดมาจากหน้าเว็บ)
create or replace function set_rental_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null then
    new.owner_id := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_set_rental_owner on rentals;
create trigger trg_set_rental_owner
  before insert on rentals
  for each row execute function set_rental_owner();


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2: ถังเก็บรูปสัญญา (private) — เหมือนใน fix-v28.sql รันซ้ำได้
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('dorm-contracts', 'dorm-contracts', false)
on conflict (id) do update set public = false;

drop policy if exists "contracts_insert_own" on storage.objects;
create policy "contracts_insert_own" on storage.objects for insert
to authenticated
with check (
  bucket_id = 'dorm-contracts'
  and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "contracts_select_own" on storage.objects;
create policy "contracts_select_own" on storage.objects for select
to authenticated
using (
  bucket_id = 'dorm-contracts'
  and (auth.uid()::text = (storage.foldername(name))[1] or is_admin())
);

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

-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 แล้วเข้าเมนู "สรุปการเช่า"
