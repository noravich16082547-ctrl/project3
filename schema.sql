-- ============================================================================
-- DormCRU — Supabase schema.sql
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางไฟล์นี้ทั้งหมด -> Run
-- รันครั้งเดียวตอนตั้งค่าโปรเจคใหม่
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ตาราง profiles: ข้อมูลผู้ใช้เพิ่มเติมจาก auth.users (นักศึกษา/เจ้าของหอพัก/แอดมิน)
-- ----------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('student','owner','admin')),
  name text,
  email text,
  phone text,
  sid text,          -- รหัสนักศึกษา (เฉพาะ role = student)
  org_name text,      -- ชื่อกิจการ/หอพัก (เฉพาะ role = owner)
  approved boolean not null default false, -- เฉพาะ owner ต้องรอแอดมินอนุมัติ
  wishlist uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ตาราง dorms: ข้อมูลหอพัก
-- ----------------------------------------------------------------------------
create table if not exists dorms (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id),
  name text not null,
  hall_type text not null,
  gate1 double precision not null default 0,
  gate2 double precision not null default 0,
  gate3 double precision not null default 0,
  lat double precision,
  lng double precision,
  facilities text[] not null default '{}',
  rooms jsonb not null default '[]', -- [{code,label,price,total,vacant}, ...]
  images text[] not null default '{}',
  description text,  -- รายละเอียดหอพัก (ห้ามใช้ชื่อ desc เพราะเป็นคำสงวนของ SQL)
  phone text,      -- เบอร์โทรหอพัก
  line_id text,    -- LINE ID หรือลิงก์ LINE
  facebook text,   -- ลิงก์เพจ Facebook
  verified boolean not null default false, -- true = เจ้าของหอยืนยันข้อมูลแล้ว (จองมัดจำได้) / false = ข้อมูลจากการรวบรวม รอยืนยัน
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- ตาราง bookings: การจอง
-- ----------------------------------------------------------------------------
create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  dorm_id uuid references dorms(id),
  dorm_name text,
  owner_id uuid,
  room_code text,
  room_label text,
  deposit double precision,
  slip_url text,               -- อาจว่างได้ (โหมดจองไว้ก่อนแล้วนัดทำสัญญา ไม่บังคับโอนมัดจำ)
  contact_phone text,          -- เบอร์ติดต่อกลับของนักศึกษา
  note text,                   -- ข้อความ/วันเวลาที่สะดวกนัดดูห้อง-ทำสัญญา
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  user_id uuid references auth.users(id),
  user_name text,
  user_email text,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- ฟังก์ชันช่วยตรวจสิทธิ์ (security definer เพื่อไม่ให้ policy วนเช็คตัวเองไม่รู้จบ)
-- ============================================================================
create or replace function is_admin() returns boolean
language sql stable security definer as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function is_approved_owner() returns boolean
language sql stable security definer as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'owner' and approved = true);
$$;

-- ป้องกันผู้ใช้แก้ role/approved ของตัวเอง (กันยกระดับสิทธิ์ตัวเอง) — แอดมินแก้ของคนอื่นได้ปกติ
create or replace function prevent_self_promote() returns trigger
language plpgsql security definer as $$
begin
  if auth.uid() = old.id then
    new.role := old.role;
    new.approved := old.approved;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_self_promote on profiles;
create trigger trg_prevent_self_promote
before update on profiles
for each row execute function prevent_self_promote();

-- ฟังก์ชันยืนยัน/ปฏิเสธการจอง — ถ้ายืนยัน (confirmed) จะตัดห้องว่างใน dorms.rooms ให้อัตโนมัติแบบอะตอมิก
create or replace function confirm_booking(p_booking_id uuid, p_new_status text)
returns void
language plpgsql security definer as $$
declare
  v_booking bookings%rowtype;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then
    raise exception 'ไม่พบรายการจองนี้';
  end if;

  if not (is_admin() or (is_approved_owner() and v_booking.owner_id = auth.uid())) then
    raise exception 'ไม่มีสิทธิ์ดำเนินการนี้';
  end if;

  update bookings set status = p_new_status where id = p_booking_id;

  if p_new_status = 'confirmed' then
    update dorms
    set rooms = (
      select coalesce(jsonb_agg(
        case when r->>'code' = v_booking.room_code and (r->>'vacant')::int > 0
             then jsonb_set(r, '{vacant}', to_jsonb(((r->>'vacant')::int - 1)))
             else r end
      ), '[]'::jsonb)
      from jsonb_array_elements(rooms) r
    )
    where id = v_booking.dorm_id;
  end if;
end;
$$;

-- ============================================================================
-- เปิดใช้งาน Row Level Security (RLS) — ถ้าไม่เปิด ใครก็อ่าน/เขียนข้อมูลได้หมดโดยไม่เช็คสิทธิ์
-- ============================================================================
alter table profiles enable row level security;
alter table dorms enable row level security;
alter table bookings enable row level security;

-- ---- profiles ----
drop policy if exists "profiles_select" on profiles;
create policy "profiles_select" on profiles for select
using (auth.uid() = id or is_admin());

drop policy if exists "profiles_insert" on profiles;
create policy "profiles_insert" on profiles for insert
with check (auth.uid() = id);

drop policy if exists "profiles_update" on profiles;
create policy "profiles_update" on profiles for update
using (auth.uid() = id or is_admin());

-- ---- dorms ----
drop policy if exists "dorms_select_public" on dorms;
create policy "dorms_select_public" on dorms for select
using (true);

drop policy if exists "dorms_insert" on dorms;
create policy "dorms_insert" on dorms for insert
with check (is_admin() or (is_approved_owner() and owner_id = auth.uid()));

drop policy if exists "dorms_update" on dorms;
create policy "dorms_update" on dorms for update
using (is_admin() or (is_approved_owner() and owner_id = auth.uid()));

drop policy if exists "dorms_delete" on dorms;
create policy "dorms_delete" on dorms for delete
using (is_admin() or (is_approved_owner() and owner_id = auth.uid()));

-- ---- bookings ----
drop policy if exists "bookings_insert" on bookings;
create policy "bookings_insert" on bookings for insert
with check (user_id = auth.uid());

drop policy if exists "bookings_select" on bookings;
create policy "bookings_select" on bookings for select
using (
  user_id = auth.uid() or is_admin() or (is_approved_owner() and owner_id = auth.uid())
);

drop policy if exists "bookings_update" on bookings;
create policy "bookings_update" on bookings for update
using (is_admin() or (is_approved_owner() and owner_id = auth.uid()));

-- ============================================================================
-- เปิด Realtime สำหรับตาราง dorms (ให้หน้าแรกเห็นห้องว่างอัปเดตสดโดยไม่ต้องรีเฟรช)
-- ห่อด้วย do-block เช็คก่อน เพื่อให้รันไฟล์นี้ซ้ำได้โดยไม่ชน error "already member"
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dorms'
  ) then
    alter publication supabase_realtime add table dorms;
  end if;
end $$;

-- ============================================================================
-- Storage bucket สำหรับสลิปโอนเงิน (ตั้งเป็น public เพื่อความง่าย — ดูหมายเหตุใน SETUP-SUPABASE.md)
-- ต้องสร้าง bucket ชื่อ "slips" ผ่านหน้า Storage ใน Dashboard ก่อน (ปุ่ม New bucket) แล้วค่อยรัน policy ด้านล่าง
-- ============================================================================
drop policy if exists "slips_upload_own" on storage.objects;
create policy "slips_upload_own" on storage.objects for insert
with check (
  bucket_id = 'slips' and auth.uid()::text = (storage.foldername(name))[1]
);

drop policy if exists "slips_read_public" on storage.objects;
create policy "slips_read_public" on storage.objects for select
using (bucket_id = 'slips');
