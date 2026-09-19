-- ============================================================================
-- DormCRU — fix-v35.sql
--
-- เปลี่ยน "จังหวะ" ที่ห้องในผังเปลี่ยนเป็นสีแดง
--
--   เดิม   นักศึกษากดนัดพบ      -> ห้องแดงทันที (ทั้งที่เจ้าของหอยังไม่ได้ตอบเลย)
--          เจ้าของหอกดยืนยัน    -> ห้องแดงเหมือนเดิม
--
--   ใหม่   นักศึกษากดนัดพบ      -> ห้อง "ยังว่าง" (เขียว)  <-- เปลี่ยนตรงนี้
--          เจ้าของหอกดยืนยันนัด -> ห้อง "ไม่ว่าง" (แดง)
--          ยกเลิก / ปฏิเสธ      -> ห้องกลับมาว่าง (เขียว)
--
-- ทำไมถึงควรเป็นแบบนี้:
--   "นัดพบ" คือการนัดไปดูห้อง ไม่ใช่การจองห้อง การกดนัดจึงไม่ควรล็อกห้อง
--   ของเดิมใครกดก่อนก็ล็อกห้องไว้ได้เลย ถึงจะไม่มาดูจริงก็ตาม
--   ห้องนั้นจะหายไปจากสายตานักศึกษาคนอื่นทันที ทั้งที่หอยังปล่อยห้องนั้นอยู่
--
-- ผลข้างเคียงที่ตั้งใจ: นักศึกษาหลายคนขอนัดดูห้องเดียวกันได้ (เหมือนนัดดูห้องจริง ๆ)
-- เจ้าของหอเลือกยืนยันคนไหน ห้องถึงจะกลายเป็นไม่ว่าง
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error   (ต้องรัน fix-v21.sql มาก่อน)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ส่วนที่ 1: กดนัดพบ = แค่ผูกเลขห้องไว้กับใบนัด ไม่เปลี่ยนสีห้อง
--
-- ยังเช็ก "ห้องต้องว่าง" อยู่ เพราะห้องที่ไม่ว่างแล้ว (เจ้าของหอยืนยันให้คนอื่นไป
-- หรือมีคนอยู่จริง) ไม่ควรให้กดนัดได้ตั้งแต่แรก
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
  if v_b.id is null then raise exception 'ไม่พบคำขอนัดพบนี้'; end if;
  if v_b.user_id <> auth.uid() then raise exception 'นัดพบได้เฉพาะในนามของตัวเอง'; end if;

  select floor_plan into v_plan from dorms where id = v_b.dorm_id;
  if not dorm_has_plan(v_plan) then return; end if;

  v_status := plan_cell_status(v_plan, p_cell_id);
  if v_status is null then raise exception 'ไม่พบห้องนี้ในผังห้องพัก'; end if;
  if v_status <> 'vacant' then
    raise exception 'ห้องนี้ไม่ว่างแล้ว กรุณาเลือกห้องอื่น';
  end if;

  select c->>'no' into v_no
  from jsonb_array_elements(v_plan->'floors') f,
       jsonb_array_elements(coalesce(f->'rows','[]'::jsonb)) r,
       jsonb_array_elements(coalesce(r->'cells','[]'::jsonb)) c
  where c->>'id' = p_cell_id limit 1;

  -- *** v35: ไม่มีการ update dorms.floor_plan ตรงนี้อีกแล้ว ***
  -- ห้องยังเป็น 'vacant' (เขียว) จนกว่าเจ้าของหอจะกดยืนยันรับนัด
  update bookings set room_uid = p_cell_id, room_no = v_no where id = p_booking_id;
end $$;


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2: ห้องเปลี่ยนสีตอนเจ้าของหอกดยืนยันเท่านั้น
--
--   pending   (รอเจ้าของหอตอบ) -> ไม่แตะผังเลย ห้องยังเขียว
--   confirmed (ยืนยันรับนัด)   -> ห้องเป็น booked (แดง)
--   cancelled (ยกเลิก/ปฏิเสธ)  -> คืนห้องให้ว่าง เฉพาะห้องที่ผูกกับใบนี้จริง ๆ
--
-- ⚠️ จุดที่ต้องระวัง: ตอนยกเลิก ต้องเช็กว่าห้องนั้น "ผูกกับใบนัดใบนี้" อยู่จริง
--    ไม่งั้นกรณีนี้จะพัง: นาย ก ขอนัดห้อง 101 (ห้องยังเขียว) -> นาย ข ขอนัดห้อง 101
--    -> เจ้าของหอยืนยันของนาย ข (ห้องแดง) -> นาย ก กดยกเลิกของตัวเอง
--    ถ้าเช็กแค่ "ห้องเป็น booked ไหม" ห้องจะถูกปล่อยเป็นว่าง
--    ทั้งที่นาย ข เพิ่งได้ห้องนั้นไป
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
    -- เจ้าของหอยืนยันรับนัดแล้ว = ห้องนี้ไม่ว่างแล้ว
    update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'booked', new.id, new.user_id)
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
-- ส่วนที่ 3: คืนห้องที่ "ติดแดงค้างไว้" จากคำขอนัดพบที่ยังไม่ได้ยืนยัน
--
-- ห้องที่เป็นสีแดงอยู่ตอนนี้เพราะกติกาเก่า (มีคนกดนัด แต่เจ้าของหอยังไม่ยืนยัน)
-- ให้กลับมาเป็นว่างตามกติกาใหม่ — ส่วนห้องที่เจ้าของหอยืนยันไปแล้ว หรือห้องที่
-- เจ้าของหอตั้งเป็นไม่ว่างเอง (ไม่มี bookingId) จะไม่ถูกแตะ
-- ---------------------------------------------------------------------------
update dorms d
set floor_plan = plan_set_cell(d.floor_plan, b.room_uid, 'vacant')
from bookings b
where b.dorm_id = d.id
  and b.status = 'pending'
  and b.room_uid is not null
  and dorm_has_plan(d.floor_plan)
  and plan_cell_status(d.floor_plan, b.room_uid) = 'booked'
  and plan_cell_of_booking(d.floor_plan, b.id) = b.room_uid;


-- ---------------------------------------------------------------------------
-- ตรวจผล: ห้องที่ยังไม่ว่าง ควรผูกกับใบนัดที่ "ยืนยันแล้ว" หรือไม่มีใบนัดเลย
--          (ไม่ควรมีแถวไหนขึ้นว่า pending)
-- ---------------------------------------------------------------------------
select coalesce(b.status, 'เจ้าของหอตั้งเอง') as "ห้องไม่ว่างเพราะ",
       count(*) as "จำนวนห้อง"
from dorms d,
     jsonb_array_elements(coalesce(d.floor_plan->'floors','[]'::jsonb)) f,
     jsonb_array_elements(coalesce(f->'rows','[]'::jsonb)) r,
     jsonb_array_elements(coalesce(r->'cells','[]'::jsonb)) c
left join bookings b on b.id::text = c->>'bookingId'
where coalesce(c->>'k','room') = 'room'
  and coalesce(c->>'status','vacant') = 'booked'
group by 1 order by 1;


-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 หนึ่งครั้ง
