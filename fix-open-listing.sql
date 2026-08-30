-- ============================================================================
-- DormCRU — fix-open-listing.sql
--
-- 1) เจ้าของหอเพิ่มหอได้อย่างอิสระ ไม่ต้องรอผู้ดูแลระบบกดอนุมัติ
-- 2) นักศึกษายกเลิกการจองได้เอง แม้หอจะยืนยันรับจองไปแล้ว (คืนห้องว่างให้อัตโนมัติ)
-- 3) ถอดระบบแจ้งเตือนเข้า LINE ออกทั้งหมด
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error
-- ============================================================================


-- ============================================================================
-- ส่วนที่ 1: เพิ่มหอได้เลย ไม่ต้องรออนุมัติ
-- ============================================================================

-- หอทุกหอที่ค้างรอตรวจสอบอยู่ ให้เผยแพร่ทั้งหมด
update dorms set published = true where published = false;

-- trigger เดิมบังคับให้หอที่เจ้าของหอเพิ่มเอง published = false เสมอ — เอาออก
drop trigger if exists trg_force_dorm_publish_rules on dorms;
drop function if exists force_dorm_publish_rules();

-- ให้คอลัมน์ published ยังอยู่ (ผู้ดูแลระบบใช้ "ซ่อน" หอที่มีปัญหาได้)
-- แต่ค่าเริ่มต้นคือเผยแพร่ทันที
alter table dorms alter column published set default true;

-- เจ้าของหอลบหอของตัวเองได้ทุกหอ (เดิมลบได้เฉพาะหอที่ยังไม่เผยแพร่)
drop policy if exists "dorms_delete" on dorms;
create policy "dorms_delete" on dorms for delete
using (is_admin() or owner_id = auth.uid());


-- ---------------------------------------------------------------------------
-- บัญชีเจ้าของหอใช้งานได้ทันทีหลังสมัคร ไม่ต้องรอผู้ดูแลระบบ
--
-- คอลัมน์ approved เปลี่ยนความหมายเป็น "บัญชียังไม่ถูกระงับ"
-- ผู้ดูแลระบบยังตั้งเป็น false เพื่อระงับบัญชีที่มีปัญหาได้อยู่
-- ---------------------------------------------------------------------------
create or replace function force_safe_profile_insert()
returns trigger language plpgsql security definer as $$
begin
  -- ผู้ใช้สมัครเองได้แค่ 2 บทบาทนี้ ใครส่ง role อื่นมาให้กลายเป็น student
  -- (ยังกันการตั้งตัวเองเป็น admin เหมือนเดิม)
  if new.role is null or new.role not in ('student','owner') then
    new.role := 'student';
  end if;
  -- เจ้าของหอใช้งานได้ทันที
  new.approved := true;
  return new;
end $$;

drop trigger if exists trg_force_safe_profile_insert on profiles;
create trigger trg_force_safe_profile_insert
  before insert on profiles
  for each row execute function force_safe_profile_insert();

drop policy if exists "profiles_insert" on profiles;
create policy "profiles_insert" on profiles for insert
with check (auth.uid() = id and role in ('student','owner'));

-- ปลดล็อกบัญชีเจ้าของหอที่ค้างรออนุมัติอยู่ทั้งหมด
update profiles set approved = true where role = 'owner' and approved = false;


-- ============================================================================
-- ส่วนที่ 2: นักศึกษายกเลิกการจองเองได้ แม้หอจะยืนยันรับจองไปแล้ว
--
-- ต้องทำผ่านฟังก์ชัน ไม่ใช่ UPDATE ตรง ๆ เพราะถ้าการจองถูกยืนยันไปแล้ว
-- ระบบต้องคืนจำนวนห้องว่างให้หอด้วย ไม่งั้นตัวเลขห้องว่างจะหายไปเฉย ๆ
-- ============================================================================
create or replace function cancel_my_booking(p_booking_id uuid)
returns void
language plpgsql security definer as $$
declare v_b bookings%rowtype;
begin
  select * into v_b from bookings where id = p_booking_id;
  if v_b.id is null then raise exception 'ไม่พบรายการจองนี้'; end if;
  if v_b.user_id <> auth.uid() then raise exception 'ยกเลิกได้เฉพาะการจองของตัวเอง'; end if;
  if v_b.status = 'cancelled' then return; end if;   -- ยกเลิกไปแล้ว ไม่ต้องทำซ้ำ

  update bookings set status = 'cancelled' where id = p_booking_id;

  -- ถ้าหอเคยยืนยันรับจองไปแล้ว ต้องคืนห้องว่างกลับเข้าระบบ
  if v_b.status = 'confirmed' and v_b.room_code is not null then
    update dorms
    set rooms = (
      select coalesce(jsonb_agg(
        case when r->>'code' = v_b.room_code then
          jsonb_set(r, '{vacant}', to_jsonb(
            least(
              coalesce((r->>'total')::int, coalesce((r->>'vacant')::int,0) + 1),
              coalesce((r->>'vacant')::int, 0) + 1
            )
          ))
        else r end
      ), '[]'::jsonb)
      from jsonb_array_elements(rooms) r
    )
    where id = v_b.dorm_id;
  end if;
end $$;

-- ปิดช่องแก้ตารางตรง ๆ ของนักศึกษา ให้เหลือทางเดียวคือผ่านฟังก์ชันด้านบน
drop policy if exists "bookings_update" on bookings;
create policy "bookings_update" on bookings for update
using (is_admin() or (is_approved_owner() and owner_id = auth.uid()))
with check (is_admin() or (is_approved_owner() and owner_id = auth.uid()));


-- ============================================================================
-- ส่วนที่ 3: ถอดระบบแจ้งเตือนเข้า LINE ออก
-- ============================================================================
drop function if exists dorm_owner_line_id(uuid);
drop function if exists create_line_link_code();
drop function if exists cleanup_line_codes();
drop table if exists line_link_codes;
drop table if exists line_links;

alter table bookings drop column if exists line_sent_at;
alter table bookings drop column if exists line_error;

-- เสร็จแล้ว — กลับไปที่เว็บ กด Ctrl+F5
-- เจ้าของหอเพิ่มหอได้ทันที และนักศึกษายกเลิกการจองได้เองแล้ว
