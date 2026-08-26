-- ============================================================================
-- DormCRU — fix-chat-booking.sql
-- แก้ระบบแชทที่ส่งข้อความไม่ได้ + เตรียมตารางสำหรับ "ปุ่มจอง"
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางไฟล์นี้ทั้งหมด -> Run
-- รันซ้ำได้ ไม่ error  (ปลอดภัยกับข้อมูลเดิม ไม่มีการลบข้อความหรือการจองที่มีอยู่)
--
-- ทำไมต้องรันไฟล์นี้:
--   ก่อนหน้านี้มีไฟล์ติดตั้งแชท 2 เวอร์ชัน (chat.sql กับ chat-setup.sql) ที่สร้าง
--   ตาราง messages ไม่เหมือนกัน เวอร์ชันหนึ่งมีคอลัมน์ sender_role อีกเวอร์ชันไม่มี
--   เว็บจึงขึ้น error "Could not find the 'sender_role' column of 'messages'"
--   ไฟล์นี้ทำให้ทั้งสองเวอร์ชันมาอยู่ในรูปแบบเดียวกัน และเติม sender_role ให้
--   อัตโนมัติด้วย trigger ฝั่งฐานข้อมูล เว็บจึงไม่ต้องส่งค่านี้มาเองอีกต่อไป
-- ============================================================================


-- ============================================================================
-- ส่วนที่ 1: ตาราง messages (ระบบแชท)
-- ============================================================================

-- เผื่อกรณียังไม่เคยรันไฟล์แชทมาก่อนเลย
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  dorm_id uuid references dorms(id) on delete cascade,
  dorm_name text,
  student_id uuid references auth.users(id) on delete cascade,
  student_name text,
  owner_id uuid references auth.users(id) on delete set null,
  sender_id uuid references auth.users(id) on delete set null,
  body text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- เติมคอลัมน์ที่อาจขาดไปในสคีมาเวอร์ชันเก่า
alter table messages add column if not exists dorm_name    text;
alter table messages add column if not exists student_name text;
alter table messages add column if not exists sender_role  text;
alter table messages add column if not exists read_at      timestamptz;

-- ปลด NOT NULL ของ sender_role (ถ้ามี) เพราะต่อไปให้ trigger เติมให้เอง
alter table messages alter column sender_role drop not null;

-- ลบ check constraint เดิมของ sender_role ทิ้งก่อน แล้วสร้างใหม่แบบยอมให้เป็น null ได้
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'messages'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%sender_role%'
  loop
    execute format('alter table messages drop constraint %I', c.conname);
  end loop;
end $$;

alter table messages add constraint messages_sender_role_chk
  check (sender_role is null or sender_role in ('student','owner'));

-- trigger เติม sender_role ให้อัตโนมัติ: ถ้าคนส่งคือเจ้าของหอ = 'owner' นอกนั้น = 'student'
create or replace function set_message_sender_role()
returns trigger language plpgsql as $$
begin
  if new.sender_role is null then
    new.sender_role := case
      when new.owner_id is not null and new.sender_id = new.owner_id then 'owner'
      else 'student'
    end;
  end if;
  return new;
end $$;

drop trigger if exists trg_set_message_sender_role on messages;
create trigger trg_set_message_sender_role
  before insert on messages
  for each row execute function set_message_sender_role();

-- เติม sender_role ให้ข้อความเก่าที่ยังว่างอยู่
update messages
set sender_role = case when sender_id = owner_id then 'owner' else 'student' end
where sender_role is null;

create index if not exists messages_thread_idx  on messages (dorm_id, student_id, created_at);
create index if not exists messages_owner_idx   on messages (owner_id, created_at);
create index if not exists messages_student_idx on messages (student_id, created_at);

alter table messages enable row level security;

drop policy if exists "messages_select" on messages;
create policy "messages_select" on messages for select
using (student_id = auth.uid() or owner_id = auth.uid() or is_admin());

drop policy if exists "messages_insert" on messages;
create policy "messages_insert" on messages for insert
with check (
  sender_id = auth.uid()
  and (student_id = auth.uid() or owner_id = auth.uid())
);

drop policy if exists "messages_update" on messages;
create policy "messages_update" on messages for update
using (student_id = auth.uid() or owner_id = auth.uid());


-- ============================================================================
-- ส่วนที่ 2: ตาราง bookings (ปุ่มจอง) — เติมคอลัมน์ที่ระบบจองใหม่ใช้
-- ============================================================================

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  dorm_id uuid references dorms(id),
  dorm_name text,
  owner_id uuid,
  room_code text,
  room_label text,
  deposit double precision,
  slip_url text,
  contact_phone text,
  note text,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  user_id uuid references auth.users(id),
  user_name text,
  user_email text,
  created_at timestamptz not null default now()
);

-- คอลัมน์ใหม่สำหรับระบบจองรอบนี้
alter table bookings add column if not exists visit_date   date;         -- วันที่นักศึกษาสะดวกไปดูห้อง
alter table bookings add column if not exists owner_email  text;         -- อีเมลเจ้าของหอ ณ ตอนจอง (เก็บไว้ส่งเมล)
alter table bookings add column if not exists notified_at  timestamptz;  -- ส่งอีเมลแจ้งเจ้าของหอสำเร็จเมื่อไร
alter table bookings add column if not exists owner_read_at timestamptz; -- เจ้าของหอเปิดอ่านคำขอนี้เมื่อไร

create index if not exists bookings_owner_idx on bookings (owner_id, created_at desc);
create index if not exists bookings_user_idx  on bookings (user_id, created_at desc);

alter table bookings enable row level security;

drop policy if exists "bookings_insert" on bookings;
create policy "bookings_insert" on bookings for insert
with check (user_id = auth.uid());

drop policy if exists "bookings_select" on bookings;
create policy "bookings_select" on bookings for select
using (user_id = auth.uid() or is_admin() or (is_approved_owner() and owner_id = auth.uid()));

drop policy if exists "bookings_update" on bookings;
create policy "bookings_update" on bookings for update
using (is_admin() or (is_approved_owner() and owner_id = auth.uid()));


-- ============================================================================
-- ส่วนที่ 3: ฟังก์ชันดึงอีเมลเจ้าของหอ (ให้หน้าเว็บใช้ตอนกดจอง)
-- อ่านจากตาราง profiles เท่านั้น และคืนค่าเฉพาะอีเมลของ "เจ้าของหอนั้นจริง ๆ"
-- ป้องกันไม่ให้ใครกวาดอีเมลผู้ใช้คนอื่นทั้งระบบ
-- ============================================================================
create or replace function dorm_owner_email(p_dorm_id uuid)
returns text
language sql stable security definer as $$
  select p.email
  from dorms d
  join profiles p on p.id = d.owner_id
  where d.id = p_dorm_id
$$;


-- ============================================================================
-- ส่วนที่ 4: เปิด Realtime ให้ข้อความและคำขอจองเด้งทันทีโดยไม่ต้องรีเฟรช
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='bookings'
  ) then
    alter publication supabase_realtime add table bookings;
  end if;
end $$;

-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 แล้วลองส่งข้อความและกดจองได้เลย
