-- ============================================================================
-- DormCRU — add-line-notify.sql
-- ระบบแจ้งเตือนเข้า LINE ของเจ้าของหอ (ใช้ควบคู่กับอีเมล ไม่ได้แทนที่กัน)
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error
--
-- แนวคิด: LINE ไม่อนุญาตให้ยิงข้อความหาใครก็ได้จากเบอร์หรืออีเมล
--         ต้องรู้ "userId" ซึ่งได้มาต่อเมื่อเจ้าของหอทักบอทของเราก่อนเท่านั้น
--         จึงใช้วิธี: เว็บออกรหัส 6 หลัก -> เจ้าของหอพิมพ์รหัสส่งให้บอทใน LINE
--         -> webhook จับคู่รหัสกับ userId -> บันทึกไว้ใช้ส่งแจ้งเตือนครั้งต่อไป
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1) บัญชี LINE ที่เชื่อมแล้ว (เจ้าของหอ 1 คน = 1 บัญชี LINE)
-- ---------------------------------------------------------------------------
create table if not exists line_links (
  owner_id     uuid primary key references auth.users(id) on delete cascade,
  line_user_id text not null unique,
  display_name text,
  linked_at    timestamptz not null default now(),
  last_sent_at timestamptz,
  send_count   int not null default 0
);

alter table line_links enable row level security;

-- เจ้าของหอเห็นเฉพาะการเชื่อมต่อของตัวเอง / แอดมินเห็นทั้งหมด
drop policy if exists "line_links_select" on line_links;
create policy "line_links_select" on line_links for select
using (owner_id = auth.uid() or is_admin());

-- ยกเลิกการเชื่อมต่อของตัวเองได้
drop policy if exists "line_links_delete" on line_links;
create policy "line_links_delete" on line_links for delete
using (owner_id = auth.uid() or is_admin());

-- ไม่เปิด insert/update ให้ผู้ใช้โดยตรง — เขียนได้จาก webhook ที่ใช้ service role เท่านั้น


-- ---------------------------------------------------------------------------
-- 2) รหัสยืนยัน 6 หลัก (มีอายุ 15 นาที ใช้ได้ครั้งเดียว)
-- ---------------------------------------------------------------------------
create table if not exists line_link_codes (
  code       text primary key,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists line_link_codes_owner_idx on line_link_codes (owner_id, created_at desc);

alter table line_link_codes enable row level security;

drop policy if exists "line_link_codes_select" on line_link_codes;
create policy "line_link_codes_select" on line_link_codes for select
using (owner_id = auth.uid() or is_admin());


-- ---------------------------------------------------------------------------
-- 3) ฟังก์ชันขอรหัสใหม่ (เรียกจากปุ่ม "เชื่อมต่อ LINE" ในหลังบ้าน)
--    ยกเลิกรหัสเก่าที่ยังไม่ถูกใช้ทิ้งก่อนเสมอ กันสับสนว่ารหัสไหนคืออันล่าสุด
-- ---------------------------------------------------------------------------
create or replace function create_line_link_code()
returns text
language plpgsql security definer as $$
declare
  v_code text;
  v_prof profiles%rowtype;
  v_try  int := 0;
begin
  select * into v_prof from profiles where id = auth.uid();
  if v_prof.id is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อน';
  end if;
  if v_prof.role not in ('owner','admin') then
    raise exception 'ใช้ได้เฉพาะบัญชีเจ้าของหอพัก';
  end if;

  -- ปิดรหัสเก่าที่ยังค้างอยู่
  update line_link_codes
     set used_at = now()
   where owner_id = auth.uid() and used_at is null;

  -- สุ่มรหัส 6 หลักที่ยังไม่ซ้ำกับใคร
  loop
    v_try := v_try + 1;
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    exit when not exists (
      select 1 from line_link_codes
       where code = v_code and used_at is null and expires_at > now()
    );
    if v_try > 20 then
      raise exception 'สุ่มรหัสไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
    end if;
  end loop;

  insert into line_link_codes (code, owner_id, expires_at)
  values (v_code, auth.uid(), now() + interval '15 minutes');

  return v_code;
end $$;


-- ---------------------------------------------------------------------------
-- 4) ฟังก์ชันหา LINE userId ปลายทางของหอหนึ่ง ๆ
--    ใช้ฝั่งเซิร์ฟเวอร์ตอนจะส่งแจ้งเตือน (คืน null ถ้าเจ้าของหอยังไม่ได้เชื่อม LINE)
-- ---------------------------------------------------------------------------
create or replace function dorm_owner_line_id(p_dorm_id uuid)
returns text
language sql stable security definer as $$
  select l.line_user_id
  from dorms d
  join line_links l on l.owner_id = d.owner_id
  where d.id = p_dorm_id
$$;


-- ---------------------------------------------------------------------------
-- 5) เก็บผลการส่งไว้ที่คำขอจอง เพื่อให้ตรวจย้อนหลังได้ว่าแจ้งเตือนไปทางไหนบ้าง
-- ---------------------------------------------------------------------------
alter table bookings add column if not exists line_sent_at timestamptz;
alter table bookings add column if not exists line_error   text;


-- ---------------------------------------------------------------------------
-- 6) ล้างรหัสที่หมดอายุเกิน 1 วัน (เรียกเองเป็นครั้งคราวได้ ไม่บังคับ)
-- ---------------------------------------------------------------------------
create or replace function cleanup_line_codes()
returns void
language sql security definer as $$
  delete from line_link_codes where created_at < now() - interval '1 day'
$$;

-- เสร็จแล้ว — ขั้นตอนต่อไปคือสร้าง LINE Official Account และตั้งค่า Webhook
-- ดูคู่มือทีละขั้นในไฟล์ README.md หัวข้อ "ตั้งค่าแจ้งเตือนเข้า LINE"
