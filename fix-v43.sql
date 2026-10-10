-- ============================================================================
-- DormCRU — fix-v43.sql
--
-- เพิ่ม "อัปเดตหอพักล่าสุดเมื่อ" ให้ตารางหอพัก
--
-- ปัญหาเดิม:
--   ตาราง dorms ไม่มีคอลัมน์บอกเวลาที่แก้ไขครั้งล่าสุด
--   เจ้าของหอจึงไม่รู้ว่าตัวเองอัปเดตราคา/ห้องว่างไปเมื่อไหร่
--   และฝั่งนักศึกษาก็ไม่รู้ว่าข้อมูลหอนี้สด (เพิ่งแก้) หรือค้างมานานเป็นปี
--
-- ไฟล์นี้ทำ 2 อย่าง:
--   1) เพิ่มคอลัมน์ updated_at (และ created_at ถ้ายังไม่มี)
--   2) ติดตั้ง trigger ให้ updated_at เปลี่ยนเองทุกครั้งที่แถวหอถูกแก้
--      เจ้าของหอไม่ต้องกรอกเอง และโค้ดฝั่งเว็บไม่ต้องส่งค่านี้มา
--      (ส่งมาก็ถูกทับด้วยเวลาจริงของเซิร์ฟเวอร์ กันคนปลอมเวลาอัปเดตให้ดูสด)
--
-- แถวหอเก่าที่มีอยู่แล้ว จะตั้ง updated_at ให้เท่ากับ created_at ไปก่อน
-- (หรือเวลาปัจจุบันถ้าไม่มี created_at) แล้วค่อยขยับเองเมื่อเจ้าของหอกดบันทึกครั้งถัดไป
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ส่วนที่ 1: คอลัมน์เวลา
-- ---------------------------------------------------------------------------
alter table public.dorms add column if not exists created_at timestamptz default now();
alter table public.dorms add column if not exists updated_at timestamptz default now();

-- เติมค่าให้แถวเก่าที่ยังว่าง
update public.dorms set created_at = now() where created_at is null;
update public.dorms set updated_at = coalesce(created_at, now()) where updated_at is null;


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2: trigger ขยับ updated_at ให้เองทุกครั้งที่แถวถูกแก้
--
-- ใช้ now() ของฐานข้อมูลเสมอ ไม่ใช้ค่าที่ client ส่งมา
-- เพราะเวลาในเครื่องผู้ใช้ตั้งเองได้ จะปลอมให้หอดู "เพิ่งอัปเดต" ก็ได้
-- ---------------------------------------------------------------------------
create or replace function public.touch_dorm_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  -- กันเขียนทับเวลาที่สร้างหอ
  new.created_at := coalesce(old.created_at, new.created_at, now());
  return new;
end;
$$;

drop trigger if exists trg_dorms_updated_at on public.dorms;
create trigger trg_dorms_updated_at
  before update on public.dorms
  for each row execute function public.touch_dorm_updated_at();

-- ตอน insert ก็ตั้งเวลาให้ด้วย เผื่อ client ส่งค่ามาเอง
create or replace function public.stamp_dorm_created_at()
returns trigger language plpgsql as $$
begin
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_dorms_created_at on public.dorms;
create trigger trg_dorms_created_at
  before insert on public.dorms
  for each row execute function public.stamp_dorm_created_at();


-- ---------------------------------------------------------------------------
-- ส่วนที่ 3: ดัชนีสำหรับเรียงหอตามเวลาที่อัปเดตล่าสุด
-- (เผื่ออนาคตอยากทำหน้า "หอที่เพิ่งอัปเดต")
-- ---------------------------------------------------------------------------
create index if not exists dorms_updated_at_idx on public.dorms (updated_at desc);


-- ---------------------------------------------------------------------------
-- ตรวจผล — ควรเห็นคอลัมน์ created_at / updated_at และ trigger 2 ตัว
-- ---------------------------------------------------------------------------
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'dorms'
   and column_name in ('created_at','updated_at')
 order by column_name;

select tgname from pg_trigger
 where tgrelid = 'public.dorms'::regclass and not tgisinternal
 order by tgname;
