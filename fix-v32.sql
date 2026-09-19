-- ============================================================================
-- fix-v32.sql — แก้ "ลบหอพักไม่ได้"
--
-- รันไฟล์นี้ใน Supabase -> SQL Editor -> New query -> วาง -> Run
-- รันซ้ำได้ ไม่พัง
--
-- อาการ: กดลบหอแล้วขึ้น
--   update or delete on table "dorms" violates foreign key constraint
--   "bookings_dorm_id_fkey" on table "bookings"
--
-- สาเหตุ: ตาราง bookings มีคอลัมน์ dorm_id ที่อ้างถึง dorms
--   แต่ตอนสร้างไม่ได้บอกว่า "ถ้าหอถูกลบ ให้ลบใบจองของหอนั้นตามไปด้วย"
--   ฐานข้อมูลเลยกันไม่ให้ลบหอ เพราะกลัวใบจองจะกลายเป็นใบจองของหอที่ไม่มีอยู่จริง
--
-- วิธีแก้: บอกฐานข้อมูลให้ลบตามกัน (on delete cascade)
--   เหมือนที่ตารางอื่น (messages, reviews, rentals) ทำไว้อยู่แล้ว
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ส่วนที่ 1: bookings — ตัวที่ทำให้ลบหอไม่ได้
-- ---------------------------------------------------------------------------
alter table bookings drop constraint if exists bookings_dorm_id_fkey;
alter table bookings
  add constraint bookings_dorm_id_fkey
  foreign key (dorm_id) references dorms(id) on delete cascade;


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2: ไล่เช็กตารางอื่นที่อ้างถึง dorms ให้ครบ
--
-- ตารางพวกนี้ส่วนใหญ่ตั้ง cascade ไว้แล้ว แต่ถ้าใครรัน SQL ไม่ครบทุกไฟล์
-- อาจมีบางตัวที่ยังไม่ได้ตั้ง ทำให้ลบหอไม่ผ่านอยู่ดี
-- บล็อกนี้จึงไล่แก้ให้อัตโนมัติทุกตัวที่ยังไม่ใช่ cascade
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select
      con.conname      as fk_name,
      src.relname      as src_table,
      att.attname      as src_column
    from pg_constraint con
    join pg_class  src on src.oid = con.conrelid
    join pg_class  tgt on tgt.oid = con.confrelid
    join pg_attribute att
      on att.attrelid = con.conrelid
     and att.attnum   = con.conkey[1]
    where con.contype = 'f'
      and tgt.relname = 'dorms'
      and con.confdeltype <> 'c'        -- 'c' = cascade (ตัวที่ยังไม่ใช่เท่านั้น)
      and src.relnamespace = 'public'::regnamespace
  loop
    raise notice 'แก้ % บนตาราง % (คอลัมน์ %) ให้ลบตามหอ',
      r.fk_name, r.src_table, r.src_column;

    execute format('alter table public.%I drop constraint %I', r.src_table, r.fk_name);
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) references dorms(id) on delete cascade',
      r.src_table, r.fk_name, r.src_column);
  end loop;
end $$;


-- ---------------------------------------------------------------------------
-- ส่วนที่ 3: ตรวจผล — ควรขึ้น cascade ทุกแถว
-- ---------------------------------------------------------------------------
select
  src.relname  as "ตาราง",
  con.conname  as "ชื่อ constraint",
  case con.confdeltype
    when 'c' then '✅ ลบตามหอ (cascade)'
    when 'a' then '❌ ห้ามลบ (no action) — ยังมีปัญหา'
    when 'r' then '❌ ห้ามลบ (restrict) — ยังมีปัญหา'
    when 'n' then '⚠️ ตั้งเป็น null'
    when 'd' then '⚠️ ตั้งเป็นค่า default'
  end          as "เมื่อหอถูกลบ"
from pg_constraint con
join pg_class src on src.oid = con.conrelid
join pg_class tgt on tgt.oid = con.confrelid
where con.contype = 'f'
  and tgt.relname = 'dorms'
  and src.relnamespace = 'public'::regnamespace
order by src.relname;

-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 แล้วลองลบหอใหม่
--
-- ⚠️ ระวัง: ลบหอแล้ว "ใบจอง ข้อความ รีวิว และรายการเช่า" ของหอนั้นจะหายไปด้วย
--    ถ้าแค่อยากซ่อนหอจากนักศึกษาชั่วคราว ให้ผู้ดูแลระบบกด "ซ่อน" แทนการลบ


-- ============================================================================
-- ส่วนที่ 4: เพิ่มช่อง "เลขที่สัญญา" ในตารางสรุปการเช่า
-- ============================================================================
alter table rentals add column if not exists contract_no text;

comment on column rentals.contract_no is
  'เลขที่สัญญาเช่าที่เจ้าของหอกรอกเอง เช่น CT-001 — ว่างได้';
