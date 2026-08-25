-- ============================================================================
-- DormCRU — chat.sql : ระบบแชทระหว่างนักศึกษากับเจ้าของหอพัก
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางไฟล์นี้ทั้งหมด -> Run
-- รันซ้ำได้ ไม่ error
-- ============================================================================

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  dorm_id uuid references dorms(id) on delete cascade,
  dorm_name text,                       -- เก็บชื่อไว้เผื่อหอถูกลบ จะยังอ่านประวัติแชทได้
  student_id uuid references auth.users(id) on delete cascade,
  student_name text,
  owner_id uuid references auth.users(id) on delete set null,
  sender_id uuid references auth.users(id) on delete set null,  -- ใครเป็นคนพิมพ์
  body text not null,
  read_at timestamptz,                  -- null = ยังไม่อ่าน
  created_at timestamptz not null default now()
);

-- ดัชนีช่วยให้ดึงห้องแชทเร็วขึ้น
create index if not exists idx_messages_thread on messages (dorm_id, student_id, created_at);
create index if not exists idx_messages_owner on messages (owner_id, created_at);
create index if not exists idx_messages_student on messages (student_id, created_at);

-- ============================================================================
-- Row Level Security: เห็นได้เฉพาะคู่สนทนาของตัวเอง (นักศึกษาเจ้าของข้อความ กับ เจ้าของหอ)
-- ============================================================================
alter table messages enable row level security;

drop policy if exists "messages_select" on messages;
create policy "messages_select" on messages for select
using (student_id = auth.uid() or owner_id = auth.uid() or is_admin());

-- ส่งข้อความได้เฉพาะในนามตัวเอง และต้องเป็นคู่สนทนาจริง (เป็นนักศึกษาเจ้าของห้องแชท หรือเป็นเจ้าของหอนั้น)
drop policy if exists "messages_insert" on messages;
create policy "messages_insert" on messages for insert
with check (
  sender_id = auth.uid()
  and (student_id = auth.uid() or owner_id = auth.uid())
);

-- อัปเดตได้เฉพาะการทำเครื่องหมายว่าอ่านแล้ว โดยคู่สนทนา
drop policy if exists "messages_update" on messages;
create policy "messages_update" on messages for update
using (student_id = auth.uid() or owner_id = auth.uid());

-- ============================================================================
-- เปิด Realtime ให้ข้อความเด้งทันทีโดยไม่ต้องรีเฟรช
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
