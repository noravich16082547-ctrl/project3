-- ============================================================================
-- DormCRU — fix-owner-selfservice.sql
-- แก้ทางตัน 2 อย่างที่เกิดจากระบบอนุมัติรอบก่อน:
--
--   ปัญหาที่ 1: เจ้าของหอที่หอยังไม่อยู่ในลิสต์ 61 หอ ทำอะไรไม่ได้เลย
--               (กด "นี่คือหอของฉัน" ไม่ได้เพราะไม่มีหอให้กด และเพิ่มหอใหม่ก็ไม่ได้
--                เพราะ RLS บังคับว่าต้องเป็นเจ้าของหอที่อนุมัติแล้ว)
--   ปัญหาที่ 2: ยังไม่มีบัญชีแอดมินในระบบ จึงไม่มีใครกดอนุมัติได้
--               กลายเป็นวงจรตัน: ไม่มีแอดมิน -> อนุมัติไม่ได้ -> ใช้งานไม่ได้เลย
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error
-- ============================================================================


-- ============================================================================
-- ส่วนที่ 1: หอพักมีสถานะ "เผยแพร่แล้ว / รอตรวจสอบ"
--
-- เจ้าของหอเพิ่มหอของตัวเองเข้ามาได้เลยตั้งแต่ยังไม่ผ่านการตรวจสอบ
-- แต่หอจะยังไม่โผล่ให้นักศึกษาเห็น จนกว่าผู้ดูแลระบบจะกดอนุมัติ
-- (กันไม่ให้ใครสร้างหอปลอมขึ้นมาหลอกนักศึกษา)
-- ============================================================================

alter table dorms add column if not exists published   boolean not null default true;
alter table dorms add column if not exists review_note text;      -- เหตุผลตอนไม่อนุมัติ
alter table dorms add column if not exists submitted_at timestamptz;

create index if not exists dorms_published_idx on dorms (published, created_at desc);

-- หอเดิมทั้ง 61 หอที่มีอยู่แล้ว ให้ยังเผยแพร่ตามปกติ
update dorms set published = true where published is null;

-- ---------------------------------------------------------------------------
-- trigger: ห้ามคนที่ไม่ใช่แอดมินตั้งสถานะเผยแพร่ให้ตัวเอง
-- ---------------------------------------------------------------------------
create or replace function force_dorm_publish_rules()
returns trigger language plpgsql security definer as $$
begin
  if TG_OP = 'INSERT' then
    if not is_admin() then
      new.published := false;                 -- หอที่เจ้าของหอเพิ่มเอง = รอตรวจสอบเสมอ
      new.verified  := false;                 -- ยังยืนยันข้อมูลไม่ได้จนกว่าจะผ่านการตรวจสอบ
      new.submitted_at := now();
    end if;
  else
    if not is_admin() then
      new.published := old.published;         -- แก้ข้อมูลหอได้ แต่เปลี่ยนสถานะเผยแพร่เองไม่ได้
      -- หอที่ยังไม่ผ่านการตรวจสอบ จะติ๊ก "ยืนยันข้อมูล" เองไม่ได้
      if not old.published then new.verified := false; end if;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_force_dorm_publish_rules on dorms;
create trigger trg_force_dorm_publish_rules
  before insert or update on dorms
  for each row execute function force_dorm_publish_rules();


-- ---------------------------------------------------------------------------
-- RLS ใหม่ของ dorms
-- ---------------------------------------------------------------------------

-- นักศึกษาเห็นเฉพาะหอที่เผยแพร่แล้ว / เจ้าของหอเห็นหอของตัวเองเสมอ / แอดมินเห็นทั้งหมด
drop policy if exists "dorms_select_public" on dorms;
create policy "dorms_select_public" on dorms for select
using (published or owner_id = auth.uid() or is_admin());

-- เพิ่มหอใหม่ได้ตั้งแต่ยังไม่ผ่านการตรวจสอบ ขอแค่เป็นบัญชีเจ้าของหอและใส่ชื่อตัวเองเป็นเจ้าของ
drop policy if exists "dorms_insert" on dorms;
create policy "dorms_insert" on dorms for insert
with check (
  owner_id = auth.uid()
  and exists (select 1 from profiles where id = auth.uid() and role in ('owner','admin'))
);

-- แก้ไขได้เฉพาะหอของตัวเอง (ไม่ต้องรออนุมัติ จะได้กรอกข้อมูลรอไว้ก่อนได้)
drop policy if exists "dorms_update" on dorms;
create policy "dorms_update" on dorms for update
using (is_admin() or owner_id = auth.uid())
with check (is_admin() or owner_id = auth.uid());

-- ลบได้เฉพาะหอของตัวเองที่ยังไม่ถูกเผยแพร่ (กันลบหอที่นักศึกษากำลังใช้อยู่)
drop policy if exists "dorms_delete" on dorms;
create policy "dorms_delete" on dorms for delete
using (is_admin() or (owner_id = auth.uid() and published = false));


-- ---------------------------------------------------------------------------
-- ฟังก์ชันให้แอดมินอนุมัติ / ไม่อนุมัติหอที่เจ้าของหอส่งเข้ามา
-- ---------------------------------------------------------------------------
create or replace function approve_dorm(p_dorm_id uuid)
returns void language plpgsql security definer as $$
declare v_owner uuid;
begin
  if not is_admin() then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น'; end if;

  update dorms set published = true, review_note = null
   where id = p_dorm_id
  returning owner_id into v_owner;

  if v_owner is null then raise exception 'ไม่พบหอพักนี้'; end if;

  -- อนุมัติหอ = อนุมัติบัญชีเจ้าของหอไปในตัว จะได้ไม่ต้องกดสองรอบ
  update profiles set approved = true where id = v_owner;
end $$;

create or replace function reject_dorm(p_dorm_id uuid, p_reason text default null)
returns void language plpgsql security definer as $$
begin
  if not is_admin() then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น'; end if;
  update dorms set published = false, review_note = p_reason where id = p_dorm_id;
end $$;


-- ============================================================================
-- ส่วนที่ 2: ตั้งผู้ดูแลระบบคนแรกจากหน้าเว็บได้ (ไม่ต้องเขียน SQL)
--
-- เงื่อนไขความปลอดภัย 2 ชั้น — ต้องผ่านทั้งคู่:
--   1) ระบบต้องยังไม่มีผู้ดูแลระบบเลยสักคน
--   2) ผู้ที่กดต้องเป็น "บัญชีแรกสุดที่สมัครในระบบ" เท่านั้น
-- เมื่อมีแอดมินคนแรกแล้ว ปุ่มนี้จะใช้ไม่ได้อีกตลอดไป
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ก่อนอื่นต้องแก้ trigger กันยกระดับสิทธิ์ตัวเองก่อน
--
-- ของเดิมเขียนว่า "ถ้าคนที่แก้คือเจ้าของแถวเอง ให้คืนค่า role/approved กลับ"
-- ซึ่งดักแม้กระทั่งตอนที่ระบบเองเป็นคนสั่งแก้ผ่านฟังก์ชันที่เชื่อถือได้
-- ทำให้ bootstrap_first_admin() ทำงานแล้วค่าไม่เปลี่ยน (อัปเดตผ่านแต่โดน trigger คืนค่า)
--
-- ตัวแยกแยะ: เวลาผู้ใช้ยิงคำสั่งแก้ตารางตรง ๆ ผ่าน API
--            current_user จะเท่ากับ session_user (เช่น authenticated ทั้งคู่)
--            แต่ถ้าคำสั่งมาจากฟังก์ชัน security definer ที่เราเขียนไว้
--            current_user จะเป็นเจ้าของฟังก์ชัน ซึ่งต่างจาก session_user
-- จึงบังคับเฉพาะกรณีแรกเท่านั้น
-- ---------------------------------------------------------------------------
-- *** ต้องเป็น security invoker (ค่าเริ่มต้น) ห้ามใส่ security definer ***
-- ถ้าใส่ definer ตัว current_user ข้างในจะกลายเป็นเจ้าของฟังก์ชันเสมอ
-- ทำให้เงื่อนไข current_user = session_user เป็นเท็จตลอด = ไม่ป้องกันอะไรเลย
create or replace function prevent_self_promote()
returns trigger language plpgsql as $$
begin
  if auth.uid() = old.id and current_user = session_user then
    new.role     := old.role;
    new.approved := old.approved;
  end if;
  return new;
end $$;

drop trigger if exists trg_prevent_self_promote on profiles;
create trigger trg_prevent_self_promote
  before update on profiles
  for each row execute function prevent_self_promote();


-- ให้หน้าเว็บถามได้ว่า "ระบบมีแอดมินแล้วหรือยัง" โดยไม่ต้องเห็นข้อมูลคนอื่น
create or replace function admin_exists()
returns boolean language sql stable security definer as $$
  select exists (select 1 from profiles where role = 'admin')
$$;

-- ให้หน้าเว็บถามได้ว่า "ฉันมีสิทธิ์กดตั้งแอดมินคนแรกไหม"
create or replace function can_bootstrap_admin()
returns boolean language sql stable security definer as $$
  select
    not exists (select 1 from profiles where role = 'admin')
    and auth.uid() is not null
    and auth.uid() = (select id from profiles order by created_at asc, id asc limit 1)
$$;

create or replace function bootstrap_first_admin()
returns void language plpgsql security definer as $$
declare v_first uuid;
begin
  if auth.uid() is null then
    raise exception 'กรุณาเข้าสู่ระบบก่อน';
  end if;
  if exists (select 1 from profiles where role = 'admin') then
    raise exception 'ระบบนี้มีผู้ดูแลระบบอยู่แล้ว — ให้ผู้ดูแลระบบคนเดิมเป็นคนเพิ่มคนใหม่';
  end if;

  select id into v_first from profiles order by created_at asc, id asc limit 1;
  if v_first is null or v_first <> auth.uid() then
    raise exception 'ตั้งได้เฉพาะบัญชีแรกที่สมัครในระบบนี้เท่านั้น';
  end if;

  update profiles set role = 'admin', approved = true where id = auth.uid();
end $$;


-- ============================================================================
-- ส่วนที่ 3: ให้แอดมินตั้งแอดมินคนอื่นเพิ่มได้จากหน้าเว็บ
-- (เผื่อมีทีมงานหลายคน หรือบัญชีแรกหาย)
-- ============================================================================
create or replace function grant_admin(p_email text)
returns void language plpgsql security definer as $$
declare v_id uuid;
begin
  if not is_admin() then raise exception 'เฉพาะผู้ดูแลระบบเท่านั้น'; end if;

  select id into v_id from profiles where lower(email) = lower(trim(p_email));
  if v_id is null then
    raise exception 'ไม่พบบัญชีที่ใช้อีเมลนี้ — ให้เขาสมัครสมาชิกในเว็บก่อน';
  end if;

  update profiles set role = 'admin', approved = true where id = v_id;
end $$;


-- ============================================================================
-- ตรวจผลหลังรัน
-- ============================================================================
-- ดูว่าใครเป็นบัญชีแรกของระบบ (คนนี้เท่านั้นที่กดปุ่มตั้งแอดมินคนแรกได้):
--   select email, role, created_at from profiles order by created_at asc limit 1;
--
-- ถ้าอยากตั้งแอดมินด้วย SQL เหมือนเดิมก็ยังทำได้:
--   update profiles set role='admin', approved=true where email='อีเมลของคุณ';
