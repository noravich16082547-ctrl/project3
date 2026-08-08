-- ============================================================================
-- DormCRU — setup-all.sql  ***ไฟล์เดียวจบ***
-- สร้างตาราง + ฟังก์ชัน + กฎความปลอดภัย + ใส่รายชื่อหอพัก 61 หอ ในคำสั่งเดียว
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางไฟล์นี้ทั้งหมด -> Run
-- รันซ้ำได้ ไม่ error และข้อมูลไม่ซ้ำ
-- ============================================================================

-- ส่วนที่ 1: โครงสร้างฐานข้อมูล
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
  approved boolean not null default true, -- เจ้าของหอใช้งานได้ทันทีหลังสมัคร (ไม่ต้องรออนุมัติ)
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
  gate1 double precision,  -- null = ยังไม่ระบุระยะทาง (รอเจ้าของหอกรอก)
  gate2 double precision,
  gate3 double precision,
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

-- ฟังก์ชัน "รับช่วงดูแลหอพัก" (claim) — ให้เจ้าของหอตัวจริงกดรับหอที่ยังไม่มีใครยืนยันดูแล
-- ได้เองโดยไม่ต้องรอแอดมิน (ทำได้เฉพาะหอที่ verified = false เท่านั้น
-- หอที่มีเจ้าของยืนยันดูแลแล้วจะแย่งไม่ได้)
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

-- ============================================================================
-- ส่วนที่ 2: ใส่รายชื่อหอพักเครือข่ายทางการ 61 หอ
-- แหล่งข้อมูล: สำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มร.ชร.
--              https://aso.crru.ac.th/asoblog/dormnetwork
-- เว็บต้นทางมีเฉพาะชื่อหอ/ประเภท/Facebook — ราคา ห้องว่าง ระยะทาง เว้นเป็น null
-- ให้เจ้าของหอมากรอกเอง (ไม่เดาตัวเลขแทน)
-- ทุกคำสั่งใช้ where not exists = รันซ้ำได้ ข้อมูลไม่ซ้ำ
-- ============================================================================

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ทริปเปิลพี', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/7055757/pexels-photo-7055757.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100009134251032', false
where not exists (select 1 from dorms where name = 'ทริปเปิลพี');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ภูชมดาว', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/2416932/pexels-photo-2416932.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/15792555/pexels-photo-15792555.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100012000224471', false
where not exists (select 1 from dorms where name = 'ภูชมดาว');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'PPSP', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/2416933/pexels-photo-2416933.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/8251695/pexels-photo-8251695.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'PPSP');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ธนณัฐ', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/8251681/pexels-photo-8251681.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858236/pexels-photo-5858236.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100006856248956', false
where not exists (select 1 from dorms where name = 'ธนณัฐ');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'อภิสรา', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/1454806/pexels-photo-1454806.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/1455613048023448/', false
where not exists (select 1 from dorms where name = 'อภิสรา');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'เงินยวง', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/7055757/pexels-photo-7055757.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/6782344/pexels-photo-6782344.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100024388698688', false
where not exists (select 1 from dorms where name = 'เงินยวง');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ไทเสรีปาร์ค', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/15792555/pexels-photo-15792555.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858228/pexels-photo-5858228.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/pages/251804134878673', false
where not exists (select 1 from dorms where name = 'ไทเสรีปาร์ค');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'บ้านน้ำอุ่น', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/8251695/pexels-photo-8251695.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858234/pexels-photo-5858234.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'บ้านน้ำอุ่น');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ชยานีคอร์ท', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858236/pexels-photo-5858236.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/chayaneecourt', false
where not exists (select 1 from dorms where name = 'ชยานีคอร์ท');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'เทียมจันทร์', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/2416932/pexels-photo-2416932.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/599661180135782/', false
where not exists (select 1 from dorms where name = 'เทียมจันทร์');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'จ่าพันธ์ศักดิ์ 2', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/6782344/pexels-photo-6782344.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/2416933/pexels-photo-2416933.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'จ่าพันธ์ศักดิ์ 2');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'แอลเอ', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858228/pexels-photo-5858228.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/8251681/pexels-photo-8251681.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/ppech.la', false
where not exists (select 1 from dorms where name = 'แอลเอ');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'น้ำอินทร์', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858234/pexels-photo-5858234.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/1454806/pexels-photo-1454806.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/pages/420211831355174', false
where not exists (select 1 from dorms where name = 'น้ำอินทร์');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'อรวรรณ', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/7055757/pexels-photo-7055757.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/ratana.rakpanale', false
where not exists (select 1 from dorms where name = 'อรวรรณ');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'แฮปปี้โฮมคอร์ท', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/2416932/pexels-photo-2416932.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/15792555/pexels-photo-15792555.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100004807893321', false
where not exists (select 1 from dorms where name = 'แฮปปี้โฮมคอร์ท');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'รักษา', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/2416933/pexels-photo-2416933.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/8251695/pexels-photo-8251695.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100016663201133', false
where not exists (select 1 from dorms where name = 'รักษา');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ภัทรวดี', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/8251681/pexels-photo-8251681.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858236/pexels-photo-5858236.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100004715538790', false
where not exists (select 1 from dorms where name = 'ภัทรวดี');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ณิชชาพัชร์', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/1454806/pexels-photo-1454806.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'ณิชชาพัชร์');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ศุภาพร', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/7055757/pexels-photo-7055757.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/6782344/pexels-photo-6782344.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'ศุภาพร');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'สุดารัตน์', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/15792555/pexels-photo-15792555.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858228/pexels-photo-5858228.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100012848528545', false
where not exists (select 1 from dorms where name = 'สุดารัตน์');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'รัตนาวดี 1', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/8251695/pexels-photo-8251695.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858234/pexels-photo-5858234.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/rattanavadee2/', false
where not exists (select 1 from dorms where name = 'รัตนาวดี 1');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'รัตนาวดี 2', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858236/pexels-photo-5858236.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'รัตนาวดี 2');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'สองปั้น', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/2416932/pexels-photo-2416932.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/1481698028712243/', false
where not exists (select 1 from dorms where name = 'สองปั้น');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'วัฒนา', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/6782344/pexels-photo-6782344.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/2416933/pexels-photo-2416933.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'วัฒนา');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'วัฒนา 2', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858228/pexels-photo-5858228.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/8251681/pexels-photo-8251681.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'วัฒนา 2');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'บ้านฝ้าย', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858234/pexels-photo-5858234.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/1454806/pexels-photo-1454806.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100009741480531', false
where not exists (select 1 from dorms where name = 'บ้านฝ้าย');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'บ้านแสนสบาย', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/7055757/pexels-photo-7055757.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'บ้านแสนสบาย');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'พลอยชมภู', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/2416932/pexels-photo-2416932.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/15792555/pexels-photo-15792555.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/ploy.chompoo.313', false
where not exists (select 1 from dorms where name = 'พลอยชมภู');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'บุษราคัม', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/2416933/pexels-photo-2416933.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/8251695/pexels-photo-8251695.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'บุษราคัม');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'บุษราคัม 2', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/8251681/pexels-photo-8251681.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858236/pexels-photo-5858236.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'บุษราคัม 2');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'อภิญษยา 1', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/1454806/pexels-photo-1454806.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100092527032637', false
where not exists (select 1 from dorms where name = 'อภิญษยา 1');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'อภิญษยา 2', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/7055757/pexels-photo-7055757.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/6782344/pexels-photo-6782344.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100092527032637', false
where not exists (select 1 from dorms where name = 'อภิญษยา 2');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ศุภญา', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/15792555/pexels-photo-15792555.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858228/pexels-photo-5858228.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/supaya240/', false
where not exists (select 1 from dorms where name = 'ศุภญา');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'บ้าน 235', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/8251695/pexels-photo-8251695.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858234/pexels-photo-5858234.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'บ้าน 235');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'สตรีศรีวรรณ', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858236/pexels-photo-5858236.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'สตรีศรีวรรณ');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'สุขสถิตย์', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/2416932/pexels-photo-2416932.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'สุขสถิตย์');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'จตุพร', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/6782344/pexels-photo-6782344.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/2416933/pexels-photo-2416933.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'จตุพร');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ทิพากร', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858228/pexels-photo-5858228.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/8251681/pexels-photo-8251681.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'ทิพากร');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'พีเจเพลส', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858234/pexels-photo-5858234.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/1454806/pexels-photo-1454806.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'พีเจเพลส');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'แก้วตา', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/7055757/pexels-photo-7055757.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/profile.php?id=100006143896462', false
where not exists (select 1 from dorms where name = 'แก้วตา');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'เพชรพลอย', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/2416932/pexels-photo-2416932.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/15792555/pexels-photo-15792555.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, 'https://www.facebook.com/160190551305126/', false
where not exists (select 1 from dorms where name = 'เพชรพลอย');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'สตรีวันทนีย์', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/2416933/pexels-photo-2416933.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/8251695/pexels-photo-8251695.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'สตรีวันทนีย์');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'นิลักษณ์', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/8251681/pexels-photo-8251681.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858236/pexels-photo-5858236.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'นิลักษณ์');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'บ้านสวนนภา', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/1454806/pexels-photo-1454806.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'บ้านสวนนภา');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'อัจจุดา', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/7055757/pexels-photo-7055757.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/6782344/pexels-photo-6782344.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'อัจจุดา');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'สมพร', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/15792555/pexels-photo-15792555.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858228/pexels-photo-5858228.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'สมพร');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'วิจักขณาภรณ์ 2', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/8251695/pexels-photo-8251695.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858234/pexels-photo-5858234.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'วิจักขณาภรณ์ 2');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'พชรวรรณ', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858236/pexels-photo-5858236.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'พชรวรรณ');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'ยามาโตะ', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/2416932/pexels-photo-2416932.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'ยามาโตะ');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'เจริญรัตน์ 3', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/6782344/pexels-photo-6782344.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/2416933/pexels-photo-2416933.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'เจริญรัตน์ 3');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'พิศมัย', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858228/pexels-photo-5858228.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/8251681/pexels-photo-8251681.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'พิศมัย');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'มณีจันทร์สุข', 'หอชายล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858234/pexels-photo-5858234.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/1454806/pexels-photo-1454806.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'มณีจันทร์สุข');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'อารีรัตน์', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/7055757/pexels-photo-7055757.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล', null, null, false
where not exists (select 1 from dorms where name = 'อารีรัตน์');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'UniHouse-Single', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/2416932/pexels-photo-2416932.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/15792555/pexels-photo-15792555.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักบุคลากร มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ติดต่อสำนักงานบริการที่พักอาศัย โทร. 0-5377-6273', '053-776273', null, false
where not exists (select 1 from dorms where name = 'UniHouse-Single');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'UniHouse-Family', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/2416933/pexels-photo-2416933.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/8251695/pexels-photo-8251695.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักบุคลากร มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ติดต่อสำนักงานบริการที่พักอาศัย โทร. 0-5377-6273', '053-776273', null, false
where not exists (select 1 from dorms where name = 'UniHouse-Family');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'Uni-dorm 1', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/8251681/pexels-photo-8251681.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858236/pexels-photo-5858236.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273', '053-776273', null, false
where not exists (select 1 from dorms where name = 'Uni-dorm 1');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'Uni-dorm 2', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/1454806/pexels-photo-1454806.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/164595/pexels-photo-164595.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273', '053-776273', null, false
where not exists (select 1 from dorms where name = 'Uni-dorm 2');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'Uni-dorm 3', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/7055757/pexels-photo-7055757.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/6782344/pexels-photo-6782344.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/19390169/pexels-photo-19390169.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273', '053-776273', null, false
where not exists (select 1 from dorms where name = 'Uni-dorm 3');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'Uni-dorm 4', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/15792555/pexels-photo-15792555.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858228/pexels-photo-5858228.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/14121007/pexels-photo-14121007.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273', '053-776273', null, false
where not exists (select 1 from dorms where name = 'Uni-dorm 4');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'Uni-dorm 5', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/8251695/pexels-photo-8251695.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/5858234/pexels-photo-5858234.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619257/pexels-photo-33619257.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273', '053-776273', null, false
where not exists (select 1 from dorms where name = 'Uni-dorm 5');

insert into dorms (name, hall_type, gate1, gate2, gate3, lat, lng, facilities, rooms, images, description, phone, facebook, verified)
select 'Uni-dorm 6', 'หอหญิงล้วน', null, null, null, null, null, '{}', '[]'::jsonb, array['https://images.pexels.com/photos/5858236/pexels-photo-5858236.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900','https://images.pexels.com/photos/33619255/pexels-photo-33619255.jpeg?auto=compress&cs=tinysrgb&w=900'], 'หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273', '053-776273', null, false
where not exists (select 1 from dorms where name = 'Uni-dorm 6');
