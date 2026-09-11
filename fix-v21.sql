-- ============================================================================
-- DormCRU — fix-v21.sql
--
-- ลดสถานะห้องในผังให้เหลือ 2 แบบเท่านั้น
--
--   ว่าง      (vacant) = เขียว   ห้องพร้อมให้เช่า นักศึกษากดจองได้
--   จองแล้ว   (booked) = แดง     ห้องไม่ว่าง (มีคนจอง / มีคนอยู่ / ปิดซ่อม)
--
-- ของเดิมมี 4 สถานะ (ว่าง / มีคนจองแล้ว / มีผู้เช่าอยู่ / ปิดปรับปรุง)
-- ซึ่งเยอะเกินจำเป็น เพราะสำหรับนักศึกษาแล้วมีแค่ 2 อย่างที่ต้องรู้: จองได้ หรือ จองไม่ได้
--
-- *** สำคัญ ***
-- trigger เดิมตั้งห้องเป็น "occupied" ตอนเจ้าของหอกดยืนยันรับจอง
-- ถ้าไม่แก้ตรงนี้ด้วย ห้องที่ยืนยันไปแล้วจะกลายเป็นสถานะที่เว็บไม่รู้จัก
-- แล้วจะถูกแสดงเป็น "ว่าง" ทั้งที่มีคนอยู่ — นักศึกษาจะกดจองห้องซ้ำได้
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ส่วนที่ 1: ย้ายข้อมูลเก่าให้เข้ากับ 2 สถานะใหม่
--
--   pending  (มีคนจองแล้ว)  -> booked
--   occupied (มีผู้เช่าอยู่)  -> booked
--   closed   (ปิดปรับปรุง)   -> booked   <-- ห้องที่ปิดซ่อมก็คือห้องที่จองไม่ได้
--   vacant                  -> vacant   (คงเดิม)
--
-- ที่เลือกให้ closed กลายเป็น booked ไม่ใช่ vacant เพราะถ้าเผลอทำให้ว่าง
-- นักศึกษาจะกดจองห้องที่ซ่อมอยู่ได้ ซึ่งแย่กว่ามาก
-- เจ้าของหอเปิดห้องพวกนี้กลับเป็นว่างเองได้ทีหลังจากหน้าผัง
-- ---------------------------------------------------------------------------
update dorms
set floor_plan = jsonb_set(floor_plan, '{floors}', coalesce((
  select jsonb_agg(
    jsonb_set(f, '{rows}', coalesce((
      select jsonb_agg(
        jsonb_set(r, '{cells}', coalesce((
          select jsonb_agg(
            case
              when coalesce(c->>'k','room') = 'room' and coalesce(c->>'status','vacant') <> 'vacant'
                then jsonb_set(c, '{status}', '"booked"'::jsonb)
              else c
            end
            order by ci)
          from jsonb_array_elements(coalesce(r->'cells','[]'::jsonb)) with ordinality as tc(c, ci)
        ), '[]'::jsonb))
        order by ri)
      from jsonb_array_elements(coalesce(f->'rows','[]'::jsonb)) with ordinality as tr(r, ri)
    ), '[]'::jsonb))
    order by fi)
  from jsonb_array_elements(coalesce(floor_plan->'floors','[]'::jsonb)) with ordinality as tf(f, fi)
), '[]'::jsonb))
where dorm_has_plan(floor_plan);


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2: trigger ใหม่ — ยืนยันรับจองแล้วห้องยังเป็นสีแดงเหมือนเดิม
--
--   นักศึกษากดจองห้อง        -> booked (แดง)
--   เจ้าของหอกดยืนยันรับจอง   -> booked (แดง เหมือนเดิม ไม่เปลี่ยนสี)
--   ยกเลิก / ปฏิเสธ          -> vacant (เขียว)
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

  if new.status in ('pending','confirmed') then
    -- ทั้งรอยืนยันและยืนยันแล้ว = ห้องไม่ว่าง (แดง)
    update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'booked', new.id, new.user_id)
     where id = new.dorm_id;

  elsif new.status = 'cancelled' then
    -- คืนห้องให้ว่าง เฉพาะห้องที่ยังผูกกับการจองใบนี้อยู่
    if plan_cell_status(v_plan, v_cell) = 'booked' then
      update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'vacant', null, null)
       where id = new.dorm_id;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_room_cell on bookings;
create trigger trg_sync_room_cell
  after update of status on bookings
  for each row execute function sync_room_cell_with_booking();


-- ---------------------------------------------------------------------------
-- ส่วนที่ 3: จองห้องได้เฉพาะห้องที่ว่างจริง (อัปเดตข้อความให้ตรงกับสถานะใหม่)
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
  if v_b.id is null then raise exception 'ไม่พบรายการจองนี้'; end if;
  if v_b.user_id <> auth.uid() then raise exception 'จองได้เฉพาะในนามของตัวเอง'; end if;

  select floor_plan into v_plan from dorms where id = v_b.dorm_id for update;
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

  update dorms
     set floor_plan = plan_set_cell(v_plan, p_cell_id, 'booked', p_booking_id, auth.uid())
   where id = v_b.dorm_id;

  update bookings set room_uid = p_cell_id, room_no = v_no where id = p_booking_id;
end $$;


-- ---------------------------------------------------------------------------
-- ตรวจผล: ควรเหลือแค่ vacant กับ booked เท่านั้น
-- ---------------------------------------------------------------------------
select coalesce(c->>'status','vacant') as "สถานะ", count(*) as "จำนวนห้อง"
from dorms,
     jsonb_array_elements(coalesce(floor_plan->'floors','[]'::jsonb)) f,
     jsonb_array_elements(coalesce(f->'rows','[]'::jsonb)) r,
     jsonb_array_elements(coalesce(r->'cells','[]'::jsonb)) c
where coalesce(c->>'k','room') = 'room'
group by 1 order by 1;


-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 หนึ่งครั้ง
