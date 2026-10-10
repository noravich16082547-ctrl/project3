-- ============================================================================
-- DormCRU — fix-v44.sql
--
-- ไฟล์นี้ทำ 3 เรื่อง
--
--   1) เพิ่มคอลัมน์ visit_time  — เวลาที่นักศึกษาสะดวกเข้ามาดูห้อง
--      เดิมมีแต่ visit_date (วันที่) เจ้าของหอจึงรู้แค่ว่า "วันไหน" ไม่รู้ว่ากี่โมง
--      ต้องไปถามซ้ำในแชททุกครั้ง
--
--   2) เพิ่มคอลัมน์ owner_note — เหตุผลที่เจ้าของหอปฏิเสธคำขอนัดหมาย
--      เดิมกดปฏิเสธแล้วนักศึกษาเห็นแค่คำว่า "ถูกปฏิเสธ" ลอย ๆ ไม่รู้สาเหตุ
--      และไม่รู้ว่าควรทำอย่างไรต่อ
--
--   3) เปลี่ยนสถานะห้องตอนเจ้าของหอกด "ยืนยันรับนัด"
--      จาก 'booked' (ไม่ว่าง) เป็น 'reserved' (มีผู้นัดหมายแล้ว)
--      เพราะการยืนยันนัดคือการตกลงว่าจะมาดูห้อง ยังไม่ใช่การทำสัญญาเช่า
--      ห้องจะเป็น 'booked' ก็ต่อเมื่อเจ้าของหอตั้งเองหลังผู้เช่าเข้าอยู่จริง
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error   (ต้องรัน fix-v35.sql และ fix-v43.sql มาก่อน)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ส่วนที่ 1: คอลัมน์ใหม่ของตารางคำขอนัดหมาย
-- ---------------------------------------------------------------------------
alter table public.bookings add column if not exists visit_time text;
alter table public.bookings add column if not exists owner_note text;

comment on column public.bookings.visit_time is
  'เวลาที่นักศึกษาสะดวกเข้ามาดูห้อง รูปแบบ HH:MM (24 ชั่วโมง) — ว่างได้';
comment on column public.bookings.owner_note is
  'ข้อความจากเจ้าของหอถึงนักศึกษา ใช้บอกเหตุผลตอนปฏิเสธคำขอนัดหมาย — ว่างได้';


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2: สิทธิ์การเขียน
--
-- owner_note เขียนได้เฉพาะเจ้าของหอของคำขอนั้น (และผู้ดูแลระบบ)
-- visit_time เขียนได้เฉพาะนักศึกษาเจ้าของคำขอ ตอนส่งคำขอ
--
-- นโยบาย RLS เดิมของตาราง bookings คุมเรื่องนี้ไว้อยู่แล้วทั้งหมด
-- (เจ้าของหอแก้แถวของหอตัวเองได้ · นักศึกษาแก้แถวของตัวเองได้)
-- คอลัมน์ใหม่จึงได้สิทธิ์ตามนโยบายเดิมโดยอัตโนมัติ ไม่ต้องเพิ่มนโยบายใหม่
--
-- ตรวจให้แน่ใจว่า RLS ยังเปิดอยู่จริง
-- ---------------------------------------------------------------------------
alter table public.bookings enable row level security;


-- ---------------------------------------------------------------------------
-- ส่วนที่ 3: ยืนยันรับนัด -> ห้องเป็น "มีผู้นัดหมายแล้ว" (reserved)
--
-- ของเดิม (fix-v35.sql) ตั้งเป็น 'booked' ซึ่งแปลว่าไม่ว่าง/มีผู้เช่า
-- ทำให้แยกไม่ออกระหว่าง "ห้องที่มีคนนัดมาดู" กับ "ห้องที่มีคนอยู่แล้วจริง ๆ"
--
-- ผลต่อนักศึกษาเหมือนเดิมทุกอย่าง: ห้องที่ไม่ใช่ 'vacant' กดนัดหมายไม่ได้
-- เปลี่ยนแค่สีและคำที่แสดง จากสีแดง "ไม่ว่าง" เป็นสีเหลือง "มีผู้นัดหมายแล้ว"
--
-- ส่วนการยกเลิก/ปฏิเสธ ยังคืนห้องให้ว่างเหมือนเดิม และยังเช็กว่าห้องนั้น
-- "ผูกกับใบนัดใบนี้จริง" ก่อนคืน เพื่อไม่ให้ไปแย่งห้องที่คนอื่นได้ไปแล้ว
-- ---------------------------------------------------------------------------
create or replace function sync_room_cell_with_booking()
returns trigger language plpgsql security definer as $$
declare
  v_plan jsonb;
  v_cell text;
begin
  if new.status is not distinct from old.status then return new; end if;

  select floor_plan into v_plan from dorms where id = new.dorm_id;
  if not dorm_has_plan(v_plan) then return new; end if;

  v_cell := coalesce(new.room_uid, plan_cell_of_booking(v_plan, new.id));
  if v_cell is null then return new; end if;

  if new.status = 'confirmed' then
    -- เจ้าของหอยืนยันรับนัดแล้ว = ห้องนี้มีผู้นัดหมายไว้ ยังไม่เปิดรับนัดเพิ่ม
    update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'reserved', new.id, new.user_id)
     where id = new.dorm_id;

  elsif new.status = 'cancelled' then
    -- คืนห้องให้ว่าง เฉพาะห้องที่ยังผูกกับใบนัดใบนี้อยู่เท่านั้น
    if plan_cell_of_booking(v_plan, new.id) = v_cell then
      update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'vacant', null, null)
       where id = new.dorm_id;
    end if;

  -- new.status = 'pending' -> ไม่ทำอะไรกับผังเลย (ห้องยังเขียว)
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_room_cell on bookings;
create trigger trg_sync_room_cell
  after update of status on bookings
  for each row execute function sync_room_cell_with_booking();


-- ---------------------------------------------------------------------------
-- ส่วนที่ 4: ย้ายห้องเดิมที่ "แดงเพราะยืนยันนัด" ให้เป็นสีเหลืองตามกติกาใหม่
--
-- แตะเฉพาะห้องที่ผูกกับใบนัดที่ยืนยันแล้วเท่านั้น
-- ห้องที่เจ้าของหอตั้งเป็นไม่ว่างเอง (ไม่มี bookingId) จะไม่ถูกแตะ
-- ---------------------------------------------------------------------------
update dorms d
set floor_plan = plan_set_cell(d.floor_plan, b.room_uid, 'reserved', b.id, b.user_id)
from bookings b
where b.dorm_id = d.id
  and b.status = 'confirmed'
  and b.room_uid is not null
  and dorm_has_plan(d.floor_plan)
  and plan_cell_status(d.floor_plan, b.room_uid) = 'booked'
  and plan_cell_of_booking(d.floor_plan, b.id) = b.room_uid;


-- ---------------------------------------------------------------------------
-- ตรวจผล
-- ---------------------------------------------------------------------------
select column_name, data_type
  from information_schema.columns
 where table_schema = 'public' and table_name = 'bookings'
   and column_name in ('visit_time','owner_note')
 order by column_name;

-- จำนวนห้องแยกตามสถานะ — ควรเริ่มเห็นสถานะ reserved ถ้ามีนัดที่ยืนยันแล้ว
select coalesce(c->>'status','vacant') as "สถานะห้อง", count(*) as "จำนวนห้อง"
from dorms d,
     jsonb_array_elements(coalesce(d.floor_plan->'floors','[]'::jsonb)) f,
     jsonb_array_elements(coalesce(f->'rows','[]'::jsonb)) r,
     jsonb_array_elements(coalesce(r->'cells','[]'::jsonb)) c
where coalesce(c->>'k','room') = 'room'
group by 1 order by 2 desc;


-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 หนึ่งครั้ง
