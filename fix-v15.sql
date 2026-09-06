-- ============================================================================
-- DormCRU — fix-v15.sql
--
-- 1) ที่เก็บรูปภาพหอพัก (bucket "dorm-photos") — เจ้าของหออัปโหลดรูปจากเครื่องได้
-- 2) ตารางรีวิวจากผู้ใช้ (reviews) + คะแนนดาว 1-5
-- 3) ผู้ดูแลระบบ "ดูและลบ" หอของคนอื่นได้ แต่ "แก้ไขไม่ได้" แล้ว
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error
--
-- *** ต้องรันไฟล์นี้ก่อน แล้วค่อยอัปโหลดไฟล์เว็บชุดใหม่ขึ้น Vercel ***
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ฟังก์ชันช่วยเช็คสิทธิ์ (สร้างซ้ำไว้เผื่อยังไม่เคยรันไฟล์ก่อนหน้า)
-- ---------------------------------------------------------------------------
create or replace function is_admin() returns boolean
language sql stable security definer as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin');
$$;


-- ============================================================================
-- ส่วนที่ 1: ที่เก็บรูปภาพหอพัก
--
-- เดิมเจ้าของหอต้องหา "ลิงก์รูป" จากที่อื่นมาวางเอง (และต้องคั่นด้วย comma)
-- ตอนนี้อัปโหลดรูปจากเครื่องได้เลย ไฟล์จะเก็บไว้ใน Supabase Storage
-- โครงสร้างโฟลเดอร์:  dorm-photos/<user-id>/<ชื่อไฟล์>
-- ทำแบบนี้เพื่อให้เช็คสิทธิ์ได้ว่า "อัปโหลดได้เฉพาะในโฟลเดอร์ของตัวเอง"
-- ============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'dorm-photos', 'dorm-photos', true, 8388608,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
  set public = true,
      file_size_limit = 8388608,
      allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif'];

-- ใครก็ดูรูปได้ (นักศึกษาต้องเห็นรูปหอโดยไม่ต้องล็อกอิน)
drop policy if exists "dormphotos_read" on storage.objects;
create policy "dormphotos_read" on storage.objects for select
using (bucket_id = 'dorm-photos');

-- อัปโหลดได้เฉพาะผู้ที่ล็อกอิน และต้องลงในโฟลเดอร์ที่ชื่อตรงกับ id ตัวเองเท่านั้น
drop policy if exists "dormphotos_insert" on storage.objects;
create policy "dormphotos_insert" on storage.objects for insert to authenticated
with check (
  bucket_id = 'dorm-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- แก้ไข/ทับไฟล์ได้เฉพาะไฟล์ของตัวเอง
drop policy if exists "dormphotos_update" on storage.objects;
create policy "dormphotos_update" on storage.objects for update to authenticated
using (
  bucket_id = 'dorm-photos'
  and auth.uid()::text = (storage.foldername(name))[1]
);

-- ลบได้เฉพาะไฟล์ของตัวเอง (ผู้ดูแลระบบลบได้ทุกไฟล์ เผื่อมีรูปไม่เหมาะสม)
drop policy if exists "dormphotos_delete" on storage.objects;
create policy "dormphotos_delete" on storage.objects for delete to authenticated
using (
  bucket_id = 'dorm-photos'
  and (auth.uid()::text = (storage.foldername(name))[1] or is_admin())
);


-- ============================================================================
-- ส่วนที่ 2: รีวิวจากผู้ใช้
--
-- 1 คน รีวิวได้ 1 ครั้งต่อ 1 หอ (แก้ไขรีวิวเดิมของตัวเองได้)
-- เจ้าของหอรีวิวหอของตัวเองไม่ได้ — กันการปั้นคะแนนให้ตัวเอง
-- ============================================================================
create table if not exists reviews (
  id          uuid primary key default gen_random_uuid(),
  dorm_id     uuid not null references dorms(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  user_name   text,
  rating      int  not null check (rating between 1 and 5),
  body        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (dorm_id, user_id)
);

create index if not exists idx_reviews_dorm on reviews(dorm_id);

alter table reviews enable row level security;

-- ชื่อผู้เขียนและเจ้าของรีวิวถูกเติมโดยฐานข้อมูล ไม่รับค่าจากฝั่งเว็บ
-- (กันการสวมชื่อคนอื่นเวลาเขียนรีวิว)
create or replace function fill_review_meta()
returns trigger language plpgsql security definer as $$
declare v_name text;
begin
  new.user_id := auth.uid();
  select name into v_name from profiles where id = auth.uid();
  new.user_name  := coalesce(nullif(trim(v_name), ''), 'ผู้ใช้ DormCRU');
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.created_at := old.created_at;   -- ห้ามแก้วันที่เขียนครั้งแรก
  end if;
  return new;
end $$;

drop trigger if exists trg_fill_review_meta on reviews;
create trigger trg_fill_review_meta
  before insert or update on reviews
  for each row execute function fill_review_meta();

-- ทุกคนอ่านรีวิวได้ (รวมคนที่ยังไม่ล็อกอิน)
drop policy if exists "reviews_select" on reviews;
create policy "reviews_select" on reviews for select using (true);

-- เขียนรีวิวได้เฉพาะคนที่ล็อกอิน และห้ามรีวิวหอของตัวเอง
drop policy if exists "reviews_insert" on reviews;
create policy "reviews_insert" on reviews for insert to authenticated
with check (
  user_id = auth.uid()
  and not exists (select 1 from dorms d where d.id = dorm_id and d.owner_id = auth.uid())
);

-- แก้ไขได้เฉพาะรีวิวของตัวเอง
drop policy if exists "reviews_update" on reviews;
create policy "reviews_update" on reviews for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

-- ลบได้เฉพาะรีวิวของตัวเอง (ผู้ดูแลระบบลบรีวิวไม่เหมาะสมได้)
drop policy if exists "reviews_delete" on reviews;
create policy "reviews_delete" on reviews for delete to authenticated
using (user_id = auth.uid() or is_admin());


-- ============================================================================
-- ส่วนที่ 3: ผู้ดูแลระบบแก้ไขหอของคนอื่นไม่ได้แล้ว
--
-- เดิม policy เขียนว่า  using (is_admin() or owner_id = auth.uid())
-- แปลว่าแอดมินแก้ราคา/ห้องว่าง/ช่องทางติดต่อของหอคนอื่นได้ ซึ่งไม่ควร
--
-- ของใหม่: แก้ไขได้เฉพาะเจ้าของหอเท่านั้น
-- ผู้ดูแลระบบยังทำได้ 2 อย่างคือ "ดูข้อมูล" (policy select) และ "ลบ" (policy delete)
-- รวมถึงสั่งซ่อน/เผยแพร่หอผ่านฟังก์ชัน approve_dorm / reject_dorm เหมือนเดิม
-- ============================================================================
drop policy if exists "dorms_update" on dorms;
create policy "dorms_update" on dorms for update
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

-- ดูได้: หอที่เผยแพร่แล้วใครก็เห็น / เจ้าของเห็นหอตัวเองเสมอ / แอดมินเห็นทั้งหมด
drop policy if exists "dorms_select_public" on dorms;
create policy "dorms_select_public" on dorms for select
using (published or owner_id = auth.uid() or is_admin());

-- ลบได้: เจ้าของหอของตัวเอง หรือผู้ดูแลระบบ
drop policy if exists "dorms_delete" on dorms;
create policy "dorms_delete" on dorms for delete
using (is_admin() or owner_id = auth.uid());


-- ============================================================================
-- ส่วนที่ 4: เก็บกวาดระบบ "รับช่วงดูแลหอ" ที่ถอดออกจากเว็บแล้ว
--
-- เมนูนี้ถูกเอาออกจากหน้าเว็บ เพราะตอนนี้เจ้าของหอสร้างหอของตัวเองได้เลย
-- ตารางเดิมยังเก็บไว้ (ไม่ลบข้อมูลเก่าทิ้ง) แค่ปิดไม่ให้ยื่นคำขอใหม่
-- ถ้าอยากลบทิ้งจริง ๆ ให้ลบเครื่องหมาย -- หน้า 2 บรรทัดล่างสุดออกแล้วรันใหม่
-- ============================================================================
do $$
begin
  if to_regclass('public.dorm_claims') is not null then
    execute 'drop policy if exists "dorm_claims_insert" on dorm_claims';
  end if;
end $$;

-- drop table if exists dorm_claims cascade;
-- drop function if exists request_dorm_claim(uuid, text);


-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 หนึ่งครั้ง
-- จากนั้นเข้าหลังบ้าน จะเห็นหน้าโปรไฟล์หอพักของคุณ พร้อมปุ่มอัปโหลดรูปจากเครื่อง
