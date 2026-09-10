-- ============================================================================
-- DormCRU — fix-v17.sql
--
-- ผังห้องพักแต่ละชั้น (floor plan)
--   - เจ้าของหอวาดผังหอของตัวเองได้: กี่ชั้น แต่ละชั้นมีกี่แถว แถวละกี่ห้อง
--     แทรกบันได/ลิฟต์/ทางเดินไว้ตรงกลางแถวได้
--   - แต่ละห้องมีเลขห้อง ประเภท ราคา และ "สถานะ" เป็นสี
--
-- สีของห้อง
--   เทา      = ว่าง                  (vacant)
--   แดง      = มีคนกดจองแล้ว รอหอยืนยัน (pending)
--   น้ำเงิน  = มีผู้เช่าอยู่แล้ว        (occupied)
--   เทาเข้ม  = ปิดปรับปรุง / ไม่ปล่อยเช่า (closed)
--
-- สถานะเปลี่ยนเองอัตโนมัติตามการจอง
--   นักศึกษากดจองห้อง        -> แดง
--   เจ้าของหอกดยืนยันรับจอง   -> น้ำเงิน
--   นักศึกษายกเลิก / หอปฏิเสธ -> กลับเป็นเทา (ว่าง)
--   เจ้าของหอปรับสถานะเองได้ตลอดเวลา
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error
-- ============================================================================


-- ---------------------------------------------------------------------------
-- ส่วนที่ 1: คอลัมน์ใหม่
-- ---------------------------------------------------------------------------
alter table dorms    add column if not exists floor_plan jsonb not null default '{"floors":[]}'::jsonb;
alter table bookings add column if not exists room_uid text;   -- id ของช่องห้องในผัง
alter table bookings add column if not exists room_no  text;   -- เลขห้องที่จอง เช่น 101

comment on column dorms.floor_plan is
  'ผังห้องพัก: {"floors":[{"id","name","rows":[{"id","cells":[{"k":"room"|"stair","id","no","type","price","status"}]}]}]}';


-- ---------------------------------------------------------------------------
-- ส่วนที่ 2: ตัวช่วยอ่าน/เขียนช่องห้องในผัง
--
-- ผังเป็น jsonb ซ้อนกัน 3 ชั้น (floors -> rows -> cells)
-- การแก้ค่าในช่องเดียวจึงต้องประกอบใหม่ทั้งก้อน ฟังก์ชันพวกนี้ทำให้เรียกใช้ง่าย
-- ---------------------------------------------------------------------------

-- หอนี้วาดผังไว้หรือยัง
create or replace function dorm_has_plan(p_plan jsonb)
returns boolean language sql immutable as $$
  select coalesce(jsonb_array_length(p_plan->'floors'), 0) > 0;
$$;

-- อ่านสถานะปัจจุบันของช่องห้องหนึ่งช่อง
create or replace function plan_cell_status(p_plan jsonb, p_cell_id text)
returns text language sql stable as $$
  select c->>'status'
  from jsonb_array_elements(coalesce(p_plan->'floors','[]'::jsonb)) f,
       jsonb_array_elements(coalesce(f->'rows'  ,'[]'::jsonb)) r,
       jsonb_array_elements(coalesce(r->'cells' ,'[]'::jsonb)) c
  where c->>'id' = p_cell_id and coalesce(c->>'k','room') = 'room'
  limit 1;
$$;

-- เขียนสถานะใหม่ลงช่องห้องหนึ่งช่อง แล้วคืนผังทั้งก้อนที่แก้แล้ว
create or replace function plan_set_cell(
  p_plan jsonb, p_cell_id text, p_status text,
  p_booking uuid default null, p_user uuid default null
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
                       'status',    p_status,
                       'bookingId', case when p_booking is null then 'null'::jsonb else to_jsonb(p_booking::text) end,
                       'userId',    case when p_user    is null then 'null'::jsonb else to_jsonb(p_user::text)    end)
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

-- หาว่าการจองใบนี้ผูกอยู่กับช่องห้องไหน
create or replace function plan_cell_of_booking(p_plan jsonb, p_booking uuid)
returns text language sql stable as $$
  select c->>'id'
  from jsonb_array_elements(coalesce(p_plan->'floors','[]'::jsonb)) f,
       jsonb_array_elements(coalesce(f->'rows'  ,'[]'::jsonb)) r,
       jsonb_array_elements(coalesce(r->'cells' ,'[]'::jsonb)) c
  where c->>'bookingId' = p_booking::text
  limit 1;
$$;


-- ---------------------------------------------------------------------------
-- ส่วนที่ 3: นักศึกษาจอง "ห้องเจาะจง" จากผัง
--
-- ต้องทำผ่านฟังก์ชัน เพราะนักศึกษาแก้ตาราง dorms เองไม่ได้ (RLS ปิดไว้)
-- ฟังก์ชันนี้กันการจองซ้ำด้วย: ถ้ามีคนกดจองห้องเดียวกันไปก่อนแล้ว จะไม่ให้จองซ้ำ
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
  if not dorm_has_plan(v_plan) then return; end if;   -- หอนี้ไม่ได้ทำผังไว้ ข้ามไป

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
     set floor_plan = plan_set_cell(v_plan, p_cell_id, 'pending', p_booking_id, auth.uid())
   where id = v_b.dorm_id;

  update bookings set room_uid = p_cell_id, room_no = v_no where id = p_booking_id;
end $$;


-- ---------------------------------------------------------------------------
-- ส่วนที่ 4: สีห้องเปลี่ยนตามสถานะการจองอัตโนมัติ
--
-- ใช้ trigger ตัวเดียวคุมทุกทาง ไม่ว่าสถานะจะถูกเปลี่ยนจากตรงไหน
--   เจ้าของหอกดยืนยัน / เจ้าของหอกดปฏิเสธ / นักศึกษากดยกเลิก / ผู้ดูแลระบบแก้
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

  -- หาช่องห้องที่ผูกกับการจองใบนี้ (ถ้าไม่ได้บันทึกไว้ ให้ไล่หาจาก bookingId ในผัง)
  v_cell := coalesce(new.room_uid, plan_cell_of_booking(v_plan, new.id));
  if v_cell is null then return new; end if;

  if new.status = 'confirmed' then
    -- หอยืนยันรับจองแล้ว = มีผู้เช่าอยู่ (น้ำเงิน)
    update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'occupied', new.id, new.user_id)
     where id = new.dorm_id;

  elsif new.status = 'cancelled' then
    -- ยกเลิก/ปฏิเสธ = คืนห้องให้ว่าง (เทา) เฉพาะห้องที่ยังผูกกับการจองใบนี้อยู่
    if plan_cell_status(v_plan, v_cell) in ('pending','occupied') then
      update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'vacant', null, null)
       where id = new.dorm_id;
    end if;

  elsif new.status = 'pending' then
    update dorms set floor_plan = plan_set_cell(v_plan, v_cell, 'pending', new.id, new.user_id)
     where id = new.dorm_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_sync_room_cell on bookings;
create trigger trg_sync_room_cell
  after update of status on bookings
  for each row execute function sync_room_cell_with_booking();


-- ---------------------------------------------------------------------------
-- ส่วนที่ 5: หอที่มีผัง ให้นับห้องว่างจากผังแทนตัวเลขที่กรอกมือ
--
-- ไม่งั้นตัวเลข "ห้องว่าง" จะถูกหัก 2 ที (ทั้งจากผังและจากตัวนับเดิม)
-- confirm_booking เดิมจะหักตัวเลขในคอลัมน์ rooms — ต้องข้ามเมื่อหอมีผังแล้ว
-- ---------------------------------------------------------------------------
create or replace function confirm_booking(p_booking_id uuid, p_new_status text)
returns void
language plpgsql security definer as $$
declare
  v_booking bookings%rowtype;
  v_delta   int := 0;
  v_plan    jsonb;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'ไม่พบรายการจองนี้'; end if;

  if not (is_admin() or (is_approved_owner() and v_booking.owner_id = auth.uid())) then
    raise exception 'ไม่มีสิทธิ์ดำเนินการนี้';
  end if;

  if p_new_status not in ('pending','confirmed','cancelled') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;

  if p_new_status = 'confirmed' and v_booking.status <> 'confirmed' then
    v_delta := -1;
  elsif p_new_status <> 'confirmed' and v_booking.status = 'confirmed' then
    v_delta := 1;
  end if;

  update bookings set status = p_new_status where id = p_booking_id;
  -- (trigger trg_sync_room_cell จะเปลี่ยนสีห้องในผังให้เอง)

  select floor_plan into v_plan from dorms where id = v_booking.dorm_id;

  -- หอที่มีผังห้องแล้ว ห้องว่างมาจากการนับช่องในผัง ไม่ต้องขยับตัวเลขซ้ำ
  if dorm_has_plan(v_plan) then return; end if;

  if v_delta <> 0 and v_booking.room_code is not null then
    update dorms
    set rooms = (
      select coalesce(jsonb_agg(
        case
          when r->>'code' = v_booking.room_code then
            jsonb_set(r, '{vacant}', to_jsonb(
              greatest(0, least(
                coalesce((r->>'total')::int, (r->>'vacant')::int + 1),
                coalesce((r->>'vacant')::int, 0) + v_delta))))
          else r
        end
      ), '[]'::jsonb)
      from jsonb_array_elements(rooms) r
    )
    where id = v_booking.dorm_id;
  end if;
end $$;


-- เช่นเดียวกัน: นักศึกษายกเลิกเอง ก็ไม่ต้องคืนตัวเลขซ้ำถ้าหอมีผังแล้ว
create or replace function cancel_my_booking(p_booking_id uuid)
returns void
language plpgsql security definer as $$
declare
  v_b    bookings%rowtype;
  v_plan jsonb;
begin
  select * into v_b from bookings where id = p_booking_id;
  if v_b.id is null then raise exception 'ไม่พบรายการจองนี้'; end if;
  if v_b.user_id <> auth.uid() then raise exception 'ยกเลิกได้เฉพาะการจองของตัวเอง'; end if;
  if v_b.status = 'cancelled' then return; end if;

  update bookings set status = 'cancelled' where id = p_booking_id;
  -- (trigger trg_sync_room_cell คืนห้องในผังให้เป็นสีเทาแล้ว)

  select floor_plan into v_plan from dorms where id = v_b.dorm_id;
  if dorm_has_plan(v_plan) then return; end if;

  if v_b.status = 'confirmed' and v_b.room_code is not null then
    update dorms
    set rooms = (
      select coalesce(jsonb_agg(
        case when r->>'code' = v_b.room_code then
          jsonb_set(r, '{vacant}', to_jsonb(
            least(
              coalesce((r->>'total')::int, coalesce((r->>'vacant')::int,0) + 1),
              coalesce((r->>'vacant')::int, 0) + 1)))
        else r end
      ), '[]'::jsonb)
      from jsonb_array_elements(rooms) r
    )
    where id = v_b.dorm_id;
  end if;
end $$;


-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5 หนึ่งครั้ง
-- เข้าหลังบ้าน -> หน้าหอพักของฉัน จะเห็นการ์ด "ผังห้องพัก" ให้กดเพิ่มชั้นและเพิ่มห้องได้เลย
