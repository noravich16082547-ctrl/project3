-- ============================================================================
-- DormCRU — fix-v48.sql
--
-- เปิดให้ "นัดหมายซ้ำ" ห้องที่มีผู้นัดหมายไว้แล้วได้
--
-- ที่มา:
--   v44 กำหนดว่าเมื่อเจ้าของหอกด "ยืนยันรับนัดหมาย" ห้องจะเปลี่ยนเป็น
--   'reserved' (มีผู้นัดหมายแล้ว) และนักศึกษาคนอื่นกดนัดห้องนั้นไม่ได้อีก
--
--   แต่การ "นัดหมาย" ในเว็บนี้คือการนัดเข้าชมห้อง ไม่ใช่การจองห้อง
--   ผู้ที่นัดไว้ก่อนอาจไม่มาตามนัด หรือมาดูแล้วไม่เช่าก็ได้
--   การปิดรับนัดตั้งแต่คนแรกจึงทำให้ห้องหายไปจากสายตานักศึกษาคนอื่น
--   ทั้งที่หอพักยังปล่อยห้องนั้นอยู่ — เป็นปัญหาเดียวกับที่ fix-v35.sql แก้ไป
--   ตอนที่ห้องเคยเปลี่ยนเป็นสีแดงทันทีที่มีคนกดนัด
--
-- ไฟล์นี้จึงแก้ให้ book_room_unit() รับได้ทั้งห้อง 'vacant' และ 'reserved'
--
--   vacant    ว่าง              -> นัดหมายได้
--   reserved  มีผู้นัดหมายแล้ว  -> นัดหมายได้ (นัดซ้ำ)      <-- เปลี่ยนตรงนี้
--   booked    ไม่ว่าง           -> นัดหมายไม่ได้ (มีผู้เช่าอยู่)
--   closed    ปิดปรับปรุง       -> นัดหมายไม่ได้ (ยังไม่พร้อมปล่อยเช่า)
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error   (ต้องรัน fix-v35.sql และ fix-v44.sql มาก่อน)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ส่วนที่ 1: กดนัดหมายได้ทั้งห้องว่างและห้องที่มีผู้นัดหมายไว้แล้ว
--
-- ยังเช็ก "ห้องต้องไม่มีผู้เช่าและไม่ปิดปรับปรุง" อยู่ และยังไม่แตะผังห้อง
-- เหมือน fix-v35.sql — ห้องจะเปลี่ยนสีก็ต่อเมื่อเจ้าของหอกดยืนยันรับนัดหมาย
-- ---------------------------------------------------------------------------
create or replace function book_room_unit(p_booking_id uuid, p_cell_id text)
returns void language plpgsql security definer as $$
declare
  v_b      bookings%rowtype;
  v_plan   jsonb;
  v_status text;
  v_no     text;
begin
  select * into v_b from bookings where id = p_booking_id;
  if v_b.id is null then raise exception 'ไม่พบคำขอนัดหมายนี้'; end if;
  if v_b.user_id <> auth.uid() then raise exception 'นัดหมายได้เฉพาะในนามของตัวเอง'; end if;

  select floor_plan into v_plan from dorms where id = v_b.dorm_id;
  if not dorm_has_plan(v_plan) then return; end if;

  v_status := plan_cell_status(v_plan, p_cell_id);
  if v_status is null then raise exception 'ไม่พบห้องนี้ในผังห้องพัก'; end if;

  -- ข้อมูลเก่าบางแถวอาจยังใช้ชื่อสถานะรุ่นก่อน จึงแปลงให้ตรงกันก่อนเทียบ
  v_status := case v_status
                when 'occupied' then 'booked'
                when 'pending'  then 'reserved'
                else v_status
              end;

  if v_status = 'booked' then
    raise exception 'ห้องนี้มีผู้เช่าอยู่แล้ว กรุณาเลือกห้องอื่น';
  end if;
  if v_status = 'closed' then
    raise exception 'ห้องนี้ปิดปรับปรุงอยู่ จึงยังนัดหมายไม่ได้ กรุณาเลือกห้องอื่น';
  end if;
  if v_status not in ('vacant', 'reserved') then
    raise exception 'ห้องนี้ยังนัดหมายไม่ได้ กรุณาเลือกห้องอื่น';
  end if;

  select c->>'no' into v_no
  from jsonb_array_elements(v_plan->'floors') f,
       jsonb_array_elements(coalesce(f->'rows','[]'::jsonb)) r,
       jsonb_array_elements(coalesce(r->'cells','[]'::jsonb)) c
  where c->>'id' = p_cell_id limit 1;

  -- ไม่แตะ dorms.floor_plan ตรงนี้ (เหมือน fix-v35.sql)
  -- ห้องจะเปลี่ยนสีก็ต่อเมื่อเจ้าของหอกดยืนยันรับนัดหมาย
  update bookings set room_uid = p_cell_id, room_no = v_no where id = p_booking_id;
end $$;


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2: ยกเลิก/ปฏิเสธนัดหมาย — คืนห้องให้ว่างเฉพาะเมื่อไม่มีนัดอื่นค้างอยู่
--
-- พอนัดซ้ำได้แล้ว ห้องหนึ่งอาจมีนัดที่ยืนยันแล้วมากกว่าหนึ่งใบ
-- ถ้ายกเลิกใบหนึ่งแล้วคืนห้องเป็นว่างทันที ห้องจะกลายเป็นสีเขียว
-- ทั้งที่ยังมีนัดของคนอื่นค้างอยู่ จึงต้องเช็กก่อนว่าไม่มีใบอื่นเหลือแล้วจริง ๆ
-- ---------------------------------------------------------------------------
create or replace function sync_room_cell_with_booking()
returns trigger language plpgsql security definer as $$
declare
  v_plan   jsonb;
  v_cell   text;
  v_others int;
begin
  if new.status is not distinct from old.status then return new; end if;

  select floor_plan into v_plan from dorms where id = new.dorm_id;
  if not dorm_has_plan(v_plan) then return new; end if;

  v_cell := coalesce(new.room_uid, plan_cell_of_booking(v_plan, new.id));
  if v_cell is null then return new; end if;

  if new.status = 'confirmed' then
    -- เจ้าของหอยืนยันรับนัดหมายแล้ว = ห้องนี้มีผู้นัดหมายไว้ (แต่ยังนัดซ้ำได้)
    update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'reserved', new.id, new.user_id)
     where id = new.dorm_id;

  elsif new.status = 'cancelled' then
    -- ยังมีนัดที่ยืนยันแล้วใบอื่นผูกกับห้องนี้อยู่ไหม
    select count(*) into v_others
      from bookings b
     where b.dorm_id  = new.dorm_id
       and b.room_uid = v_cell
       and b.status   = 'confirmed'
       and b.id <> new.id;

    if v_others = 0 and plan_cell_of_booking(v_plan, new.id) = v_cell then
      -- ไม่เหลือนัดของใครแล้ว คืนห้องให้ว่าง
      update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'vacant', null, null)
       where id = new.dorm_id;
    elsif v_others > 0 and plan_cell_of_booking(v_plan, new.id) = v_cell then
      -- ยังมีคนอื่นนัดอยู่ — ห้องยังเป็น "มีผู้นัดหมายแล้ว" แต่ย้ายไปผูกกับใบที่เหลือ
      update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'reserved',
               (select b.id      from bookings b
                 where b.dorm_id = new.dorm_id and b.room_uid = v_cell
                   and b.status = 'confirmed' and b.id <> new.id
                 order by b.created_at limit 1),
               (select b.user_id from bookings b
                 where b.dorm_id = new.dorm_id and b.room_uid = v_cell
                   and b.status = 'confirmed' and b.id <> new.id
                 order by b.created_at limit 1))
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
-- ตรวจผล — ห้องที่ไม่ว่างควรผูกกับนัดที่ยืนยันแล้ว หรือเจ้าของหอตั้งเอง
-- ---------------------------------------------------------------------------
select coalesce(c->>'status','vacant') as "สถานะห้อง", count(*) as "จำนวนห้อง"
from dorms d,
     jsonb_array_elements(coalesce(d.floor_plan->'floors','[]'::jsonb)) f,
     jsonb_array_elements(coalesce(f->'rows','[]'::jsonb)) r,
     jsonb_array_elements(coalesce(r->'cells','[]'::jsonb)) c
where coalesce(c->>'k','room') = 'room'
group by 1 order by 2 desc;


-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 หนึ่งครั้ง
