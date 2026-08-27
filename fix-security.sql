-- ============================================================================
-- DormCRU — fix-security.sql
-- ปิดช่องโหว่ความปลอดภัย 3 จุด + แก้การคืนห้องว่างเมื่อยกเลิกการจอง
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางไฟล์นี้ทั้งหมด -> Run
-- รันซ้ำได้ ไม่ error และไม่ลบข้อมูลเดิม
--
-- ⚠️ อ่านหัวข้อ "ตั้งบัญชีแอดมินคนแรก" ท้ายไฟล์ก่อนรัน ไม่งั้นอาจไม่มีใครอนุมัติ
--    เจ้าของหอได้เลยสักคน
-- ============================================================================


-- ============================================================================
-- ช่องโหว่ที่ 1: ใครสมัครเป็น "เจ้าของหอ" ก็ยึดหอไหนก็ได้ทันที
--
-- เดิม: claim_dorm() เช็คแค่ว่าเป็น approved owner แล้ว set owner_id = ตัวเองเลย
--       และคนสมัครใหม่ถูกตั้ง approved = true อัตโนมัติ
--       => ใครก็ได้สมัคร 30 วินาที แล้วยึดหอของคนอื่น แก้เบอร์/ราคาเป็นของตัวเอง
--          แล้วรับแชทและรับจองจากนักศึกษาแทนหอตัวจริง
--
-- ใหม่: การรับช่วงดูแลหอกลายเป็น "คำขอ" ที่ต้องรอแอดมินอนุมัติก่อน
-- ============================================================================

create table if not exists dorm_claims (
  id uuid primary key default gen_random_uuid(),
  dorm_id    uuid not null references dorms(id) on delete cascade,
  dorm_name  text,
  owner_id   uuid not null references auth.users(id) on delete cascade,
  owner_name text,
  owner_email text,
  owner_phone text,
  proof      text,                       -- ข้อความยืนยันตัวตนที่เจ้าของหอกรอกมา
  status     text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);

create index if not exists dorm_claims_status_idx on dorm_claims (status, created_at desc);
create unique index if not exists dorm_claims_one_pending
  on dorm_claims (dorm_id, owner_id) where status = 'pending';

alter table dorm_claims enable row level security;

drop policy if exists "dorm_claims_select" on dorm_claims;
create policy "dorm_claims_select" on dorm_claims for select
using (owner_id = auth.uid() or is_admin());

-- ไม่เปิด insert/update ตรง ๆ ให้ผู้ใช้ — ต้องผ่านฟังก์ชันด้านล่างเท่านั้น
drop policy if exists "dorm_claims_insert" on dorm_claims;
drop policy if exists "dorm_claims_update" on dorm_claims;


-- ---- เจ้าของหอ "ยื่นคำขอ" รับช่วงดูแล (ไม่ได้สิทธิ์ทันที) ----
create or replace function request_dorm_claim(p_dorm_id uuid, p_proof text default null)
returns uuid
language plpgsql security definer as $$
declare
  v_dorm  dorms%rowtype;
  v_prof  profiles%rowtype;
  v_id    uuid;
begin
  select * into v_dorm from dorms where id = p_dorm_id;
  if v_dorm.id is null then raise exception 'ไม่พบหอพักนี้'; end if;

  select * into v_prof from profiles where id = auth.uid();
  if v_prof.id is null or v_prof.role not in ('owner','admin') then
    raise exception 'ต้องเข้าสู่ระบบด้วยบัญชีเจ้าของหอพักก่อน';
  end if;

  if v_dorm.owner_id is not null and v_dorm.verified then
    raise exception 'หอพักนี้มีเจ้าของยืนยันดูแลอยู่แล้ว หากเป็นของคุณกรุณาติดต่อผู้ดูแลระบบ';
  end if;

  if exists (select 1 from dorm_claims
             where dorm_id = p_dorm_id and owner_id = auth.uid() and status = 'pending') then
    raise exception 'คุณยื่นคำขอดูแลหอนี้ไว้แล้ว กรุณารอผู้ดูแลระบบตรวจสอบ';
  end if;

  insert into dorm_claims (dorm_id, dorm_name, owner_id, owner_name, owner_email, owner_phone, proof)
  values (p_dorm_id, v_dorm.name, auth.uid(), v_prof.name, v_prof.email, v_prof.phone, p_proof)
  returning id into v_id;

  return v_id;
end $$;


-- ---- แอดมินอนุมัติคำขอ -> ค่อยโอนสิทธิ์ดูแลหอจริง ----
create or replace function approve_dorm_claim(p_claim_id uuid)
returns void
language plpgsql security definer as $$
declare v_claim dorm_claims%rowtype;
begin
  if not is_admin() then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น'; end if;

  select * into v_claim from dorm_claims where id = p_claim_id;
  if v_claim.id is null then raise exception 'ไม่พบคำขอนี้'; end if;
  if v_claim.status <> 'pending' then raise exception 'คำขอนี้ถูกตรวจสอบไปแล้ว'; end if;

  update dorms set owner_id = v_claim.owner_id where id = v_claim.dorm_id;

  -- เจ้าของหอที่ได้รับอนุมัติดูแลหอ ถือว่าผ่านการตรวจสอบตัวตนแล้ว
  update profiles set approved = true where id = v_claim.owner_id;

  update dorm_claims
     set status='approved', reviewed_by=auth.uid(), reviewed_at=now()
   where id = p_claim_id;

  -- คำขออื่นของหอเดียวกันที่ยังค้างอยู่ ให้ปิดไปด้วย
  update dorm_claims
     set status='rejected', reviewed_by=auth.uid(), reviewed_at=now(),
         reject_reason='มีเจ้าของหอรายอื่นได้รับอนุมัติดูแลหอนี้แล้ว'
   where dorm_id = v_claim.dorm_id and status='pending' and id <> p_claim_id;
end $$;


create or replace function reject_dorm_claim(p_claim_id uuid, p_reason text default null)
returns void
language plpgsql security definer as $$
begin
  if not is_admin() then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น'; end if;
  update dorm_claims
     set status='rejected', reviewed_by=auth.uid(), reviewed_at=now(), reject_reason=p_reason
   where id = p_claim_id and status='pending';
end $$;


-- ---- ปิดฟังก์ชันเดิมที่ให้สิทธิ์ทันที ----
-- เผื่อมีโค้ดเก่าค้างอยู่ที่ไหน จะได้ไม่แอบโอนสิทธิ์ให้ใครได้อีก
create or replace function claim_dorm(p_dorm_id uuid)
returns void
language plpgsql security definer as $$
begin
  perform request_dorm_claim(p_dorm_id, 'ส่งจากปุ่มเวอร์ชันเก่า');
end $$;


-- ============================================================================
-- ช่องโหว่ที่ 2: สมัครสมาชิกแล้วตั้ง role ตัวเองเป็น 'admin' ได้
--
-- เดิม: policy insert เช็คแค่ auth.uid() = id ส่วน trigger กันยกระดับสิทธิ์
--       ทำงานเฉพาะตอน UPDATE => ยิง insert ตรงด้วย anon key พร้อม role='admin' ได้เลย
-- ใหม่: บังคับทั้งที่ policy และ trigger ว่า สมัครเองได้แค่ student/owner
--       และ approved ต้องเป็น false เสมอ
-- ============================================================================

create or replace function force_safe_profile_insert() returns trigger
language plpgsql security definer as $$
begin
  -- ผู้ใช้สมัครเองได้แค่ 2 บทบาทนี้ ใครส่ง role อื่นมาให้กลายเป็น student
  if new.role is null or new.role not in ('student','owner') then
    new.role := 'student';
  end if;
  -- ห้ามตั้ง approved = true ให้ตัวเองตั้งแต่แรก (แอดมินเป็นคนอนุมัติทีหลัง)
  new.approved := false;
  return new;
end $$;

drop trigger if exists trg_force_safe_profile_insert on profiles;
create trigger trg_force_safe_profile_insert
  before insert on profiles
  for each row execute function force_safe_profile_insert();

drop policy if exists "profiles_insert" on profiles;
create policy "profiles_insert" on profiles for insert
with check (
  auth.uid() = id
  and role in ('student','owner')
  and coalesce(approved, false) = false
);

-- ปิดช่องเดิมของบัญชีเจ้าของหอที่เคยถูกตั้ง approved = true อัตโนมัติ
-- ให้เฉพาะรายที่ "ดูแลหออยู่จริง" เท่านั้นที่ยังผ่าน ที่เหลือกลับไปรอตรวจสอบ
update profiles p
   set approved = false
 where p.role = 'owner'
   and coalesce(p.approved, false) = true
   and not exists (select 1 from dorms d where d.owner_id = p.id);


-- ============================================================================
-- ช่องโหว่ที่ 3 (ต่อเนื่อง): กันบัญชีแอดมินถูกสร้างจากหน้าเว็บ
-- เปลี่ยนบทบาทเป็น admin ทำได้จาก SQL Editor เท่านั้น (ดูท้ายไฟล์)
-- ============================================================================

-- trigger เดิมกันแก้ role/approved ของตัวเองตอน UPDATE — สร้างซ้ำให้แน่ใจว่ามีอยู่
create or replace function prevent_self_promote() returns trigger
language plpgsql security definer as $$
begin
  if auth.uid() = old.id then
    new.role := old.role;
    new.approved := old.approved;
  end if;
  return new;
end $$;

drop trigger if exists trg_prevent_self_promote on profiles;
create trigger trg_prevent_self_promote
  before update on profiles
  for each row execute function prevent_self_promote();


-- ============================================================================
-- แก้เรื่องห้องว่าง: ยกเลิกการจองที่ยืนยันไปแล้ว ต้องคืนห้องว่างกลับ
--
-- เดิม: confirm_booking ลดห้องว่างตอนยืนยัน แต่ตอนเปลี่ยนเป็น cancelled
--       ไม่บวกกลับ ทำให้จำนวนห้องว่างเพี้ยนสะสมไปเรื่อย ๆ
-- ใหม่: ดูสถานะเดิมก่อนเสมอ แล้วปรับห้องว่างตาม "การเปลี่ยนสถานะ" จริง
--       (ยืนยันซ้ำไม่หักซ้ำ / ยกเลิกของที่ยังไม่เคยยืนยันไม่บวกเกิน)
-- ============================================================================
create or replace function confirm_booking(p_booking_id uuid, p_new_status text)
returns void
language plpgsql security definer as $$
declare
  v_booking bookings%rowtype;
  v_delta   int := 0;
begin
  select * into v_booking from bookings where id = p_booking_id;
  if v_booking.id is null then raise exception 'ไม่พบรายการจองนี้'; end if;

  if not (is_admin() or (is_approved_owner() and v_booking.owner_id = auth.uid())) then
    raise exception 'ไม่มีสิทธิ์ดำเนินการนี้';
  end if;

  if p_new_status not in ('pending','confirmed','cancelled') then
    raise exception 'สถานะไม่ถูกต้อง';
  end if;

  -- ยืนยันครั้งแรก = ตัดห้องว่าง 1 ห้อง
  if p_new_status = 'confirmed' and v_booking.status <> 'confirmed' then
    v_delta := -1;
  -- ยกเลิก/ย้อนกลับ ของที่เคยยืนยันแล้ว = คืนห้องว่าง 1 ห้อง
  elsif p_new_status <> 'confirmed' and v_booking.status = 'confirmed' then
    v_delta := 1;
  end if;

  update bookings set status = p_new_status where id = p_booking_id;

  if v_delta <> 0 and v_booking.room_code is not null then
    update dorms
    set rooms = (
      select coalesce(jsonb_agg(
        case
          when r->>'code' = v_booking.room_code then
            jsonb_set(r, '{vacant}', to_jsonb(
              greatest(
                0,
                least(
                  coalesce((r->>'total')::int, (r->>'vacant')::int + 1),
                  coalesce((r->>'vacant')::int, 0) + v_delta
                )
              )
            ))
          else r
        end
      ), '[]'::jsonb)
      from jsonb_array_elements(rooms) r
    )
    where id = v_booking.dorm_id;
  end if;
end $$;


-- ============================================================================
-- ให้นักศึกษายกเลิกคำขอจองของตัวเองได้ (เฉพาะรายการที่ยังรอหอตอบ)
-- ============================================================================
-- หมายเหตุ: ต้องมีทั้ง using (ตรวจแถวเดิม) และ with check (ตรวจแถวใหม่)
-- ถ้าใส่แค่ using อย่างเดียว Postgres จะเอาเงื่อนไขเดียวกันไปตรวจแถวใหม่ด้วย
-- แถวใหม่มี status='cancelled' ซึ่งไม่ผ่านเงื่อนไข status='pending' -> นักศึกษาจะกดยกเลิกไม่ได้เลย
drop policy if exists "bookings_update" on bookings;
create policy "bookings_update" on bookings for update
using (
  is_admin()
  or (is_approved_owner() and owner_id = auth.uid())
  or (user_id = auth.uid() and status = 'pending')
)
with check (
  is_admin()
  or (is_approved_owner() and owner_id = auth.uid())
  -- นักศึกษาแก้ของตัวเองได้อย่างเดียวคือ "ยกเลิก" เท่านั้น (ตั้งเป็น confirmed เองไม่ได้)
  or (user_id = auth.uid() and status = 'cancelled')
);


-- ============================================================================
-- ตั้งบัญชีแอดมินคนแรก  ***สำคัญ อ่านก่อน***
--
-- หลังรันไฟล์นี้ จะไม่มีใครตั้งตัวเองเป็นแอดมินจากหน้าเว็บได้อีก
-- ให้ตั้งแอดมินคนแรก (บัญชีของคุณเอง) ด้วยคำสั่งข้างล่างนี้ใน SQL Editor
-- โดยแก้อีเมลเป็นอีเมลที่คุณใช้สมัครในเว็บ แล้วเอาเครื่องหมาย -- ออก:
--
-- update profiles set role = 'admin', approved = true
--  where email = 'อีเมลของคุณ@example.com';
--
-- ตรวจว่าสำเร็จไหม:
-- select email, role, approved from profiles where role = 'admin';
-- ============================================================================
