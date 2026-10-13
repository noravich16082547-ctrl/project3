-- ============================================================================
-- DormCRU — fix-v51.sql
--
-- เก็บ "เวลาที่ห้องถูกนัดหมาย" ไว้ในผังห้อง
--
-- ที่มา:
--   หน้าต่างรายละเอียดห้องฝั่งนักศึกษาจะบอกว่า "ห้องนี้มีผู้นัดหมายไว้แล้ว
--   แต่ยังนัดหมายซ้ำได้" — ถ้าบอกด้วยว่า "นัดไว้เมื่อไหร่" นักศึกษาจะตัดสินใจง่ายขึ้น
--   ว่าควรนัดซ้ำหรือไปดูห้องอื่น (นัดเมื่อวานกับนัดไว้ตั้งแต่ 3 เดือนก่อน ต่างกันมาก)
--
--   แต่นักศึกษาอ่านใบนัดหมายของคนอื่นไม่ได้ (RLS กันไว้ และไม่ควรให้อ่านด้วย)
--   จึงต้องเก็บ "เฉพาะเวลา" ไว้ในผังห้องซึ่งเป็นข้อมูลสาธารณะของหออยู่แล้ว
--   ไม่มีชื่อ ไม่มีเบอร์ ไม่มีอีเมลของผู้ที่นัดไว้ติดไปด้วย
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error   (ต้องรัน fix-v35.sql, fix-v44.sql และ fix-v48.sql มาก่อน)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ส่วนที่ 1: ตั้งค่าช่องห้องพร้อมเวลาที่ถูกนัดหมาย
--
-- เหมือน plan_set_cell() เดิมทุกอย่าง แต่เขียนช่อง reservedAt เพิ่มให้ด้วย
-- (เก็บเป็นตัวเลข epoch มิลลิวินาที เพื่อให้ฝั่งเว็บอ่านด้วย new Date() ได้ตรง ๆ)
-- ---------------------------------------------------------------------------
create or replace function plan_set_cell_at(
  p_plan jsonb, p_cell_id text, p_status text,
  p_booking uuid default null, p_user uuid default null,
  p_at timestamptz default null
)
returns jsonb language sql immutable as $$
  select jsonb_set(p_plan, '{floors}', coalesce((
    select jsonb_agg(
      jsonb_set(f, '{rows}', coalesce((
        select jsonb_agg(
          jsonb_set(r, '{cells}', coalesce((
            select jsonb_agg(
              case
                when c->>'id' = p_cell_id and coalesce(c->>'k','room') = 'room'
                then c || jsonb_build_object(
                       'status',     p_status,
                       'bookingId',  case when p_booking is null then 'null'::jsonb else to_jsonb(p_booking::text) end,
                       'userId',     case when p_user    is null then 'null'::jsonb else to_jsonb(p_user::text)    end,
                       'reservedAt', case when p_at      is null then 'null'::jsonb
                                          else to_jsonb(round(extract(epoch from p_at) * 1000)) end)
                else c
              end
              order by idx)
            from jsonb_array_elements(coalesce(r->'cells','[]'::jsonb)) with ordinality as t(c, idx)
          ), '[]'::jsonb))
          order by idx)
        from jsonb_array_elements(coalesce(f->'rows','[]'::jsonb)) with ordinality as t(r, idx)
      ), '[]'::jsonb))
      order by idx)
    from jsonb_array_elements(coalesce(p_plan->'floors','[]'::jsonb)) with ordinality as t(f, idx)
  ), '[]'::jsonb));
$$;


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2: trigger เดิมของ fix-v48.sql แต่บันทึกเวลาที่นัดหมายไปด้วย
--
-- กติกาอื่นเหมือนเดิมทุกข้อ:
--   confirmed -> ห้องเป็น 'reserved' (มีผู้นัดหมายแล้ว แต่ยังนัดหมายซ้ำได้)
--   cancelled -> คืนห้องให้ว่าง เฉพาะเมื่อไม่เหลือนัดหมายของคนอื่นแล้ว
-- ---------------------------------------------------------------------------
create or replace function sync_room_cell_with_booking()
returns trigger language plpgsql security definer as $$
declare
  v_plan   jsonb;
  v_cell   text;
  v_others int;
  v_keep   bookings%rowtype;
begin
  if new.status is not distinct from old.status then return new; end if;

  select floor_plan into v_plan from dorms where id = new.dorm_id;
  if not dorm_has_plan(v_plan) then return new; end if;

  v_cell := coalesce(new.room_uid, plan_cell_of_booking(v_plan, new.id));
  if v_cell is null then return new; end if;

  if new.status = 'confirmed' then
    update dorms
       set floor_plan = plan_set_cell_at(v_plan, v_cell, 'reserved', new.id, new.user_id, now())
     where id = new.dorm_id;

  elsif new.status = 'cancelled' then
    select count(*) into v_others
      from bookings b
     where b.dorm_id  = new.dorm_id
       and b.room_uid = v_cell
       and b.status   = 'confirmed'
       and b.id <> new.id;

    if plan_cell_of_booking(v_plan, new.id) = v_cell then
      if v_others = 0 then
        -- ไม่เหลือนัดหมายของใครแล้ว คืนห้องให้ว่างและล้างเวลาที่นัดไว้
        update dorms
           set floor_plan = plan_set_cell_at(v_plan, v_cell, 'vacant', null, null, null)
         where id = new.dorm_id;
      else
        -- ยังมีคนอื่นนัดอยู่ — ย้ายไปผูกกับใบที่เหลือและใช้เวลาของใบนั้น
        select * into v_keep
          from bookings b
         where b.dorm_id = new.dorm_id and b.room_uid = v_cell
           and b.status = 'confirmed' and b.id <> new.id
         order by b.created_at limit 1;

        update dorms
           set floor_plan = plan_set_cell_at(v_plan, v_cell, 'reserved',
                              v_keep.id, v_keep.user_id, v_keep.created_at)
         where id = new.dorm_id;
      end if;
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
-- ส่วนที่ 3: เติมเวลาให้ห้องที่เป็น "มีผู้นัดหมายแล้ว" อยู่ก่อนแล้ว
--
-- ใช้เวลาที่นักศึกษากดส่งคำขอของใบนัดหมายที่ผูกกับห้องนั้น
-- ห้องที่เจ้าของหอตั้งเป็น reserved เองโดยไม่มีใบนัดหมาย จะไม่มีเวลากำกับ
-- (ฝั่งเว็บจะไม่แสดงบรรทัดเวลาให้ห้องพวกนั้น ไม่พัง)
-- ---------------------------------------------------------------------------
update dorms d
set floor_plan = plan_set_cell_at(d.floor_plan, b.room_uid, 'reserved',
                                  b.id, b.user_id, b.created_at)
from bookings b
where b.dorm_id = d.id
  and b.status  = 'confirmed'
  and b.room_uid is not null
  and dorm_has_plan(d.floor_plan)
  and plan_cell_status(d.floor_plan, b.room_uid) = 'reserved'
  and plan_cell_of_booking(d.floor_plan, b.id) = b.room_uid;


-- ---------------------------------------------------------------------------
-- ตรวจผล — ห้องที่มีผู้นัดหมายแล้ว ควรมีเวลากำกับไว้ด้วย
-- ---------------------------------------------------------------------------
select coalesce(c->>'status','vacant') as "สถานะห้อง",
       count(*) as "จำนวนห้อง",
       count(*) filter (where c->>'reservedAt' is not null) as "มีเวลานัดหมายกำกับ"
from dorms d,
     jsonb_array_elements(coalesce(d.floor_plan->'floors','[]'::jsonb)) f,
     jsonb_array_elements(coalesce(f->'rows','[]'::jsonb)) r,
     jsonb_array_elements(coalesce(r->'cells','[]'::jsonb)) c
where coalesce(c->>'k','room') = 'room'
group by 1 order by 2 desc;


-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 หนึ่งครั้ง
