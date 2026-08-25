-- ============================================================================
-- DormCRU — chat-setup.sql : ระบบแชทระหว่างนักศึกษากับเจ้าของหอพัก
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> วางไฟล์นี้ทั้งหมด -> Run
-- รันซ้ำได้ ไม่ error
-- ============================================================================

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  dorm_id uuid references dorms(id) on delete cascade,
  dorm_name text,
  student_id uuid references auth.users(id) on delete cascade,
  student_name text,
  owner_id uuid references auth.users(id) on delete cascade,
  sender_id uuid references auth.users(id) on delete cascade,
  sender_role text not null check (sender_role in ('student','owner')),
  body text not null,
  read_at timestamptz,                       -- null = อีกฝ่ายยังไม่ได้อ่าน
  created_at timestamptz not null default now()
);

-- ดัชนีช่วยให้ดึงห้องแชท (หอ + นักศึกษา 1 คน) ได้เร็ว
create index if not exists messages_thread_idx  on messages (dorm_id, student_id, created_at);
create index if not exists messages_owner_idx   on messages (owner_id, created_at);
create index if not exists messages_student_idx on messages (student_id, created_at);

alter table messages enable row level security;

-- อ่านได้เฉพาะคู่สนทนาของตัวเอง (นักศึกษาเจ้าของข้อความ หรือเจ้าของหอนั้น)
drop policy if exists "messages_select" on messages;
create policy "messages_select" on messages for select
using (student_id = auth.uid() or owner_id = auth.uid() or is_admin());

-- ส่งได้เฉพาะในนามตัวเอง และต้องเป็นคู่สนทนาในห้องนั้นจริง
drop policy if exists "messages_insert" on messages;
create policy "messages_insert" on messages for insert
with check (
  sender_id = auth.uid()
  and (student_id = auth.uid() or owner_id = auth.uid())
);

-- อัปเดตได้เฉพาะเพื่อทำเครื่องหมาย "อ่านแล้ว" ในห้องของตัวเอง
drop policy if exists "messages_update" on messages;
create policy "messages_update" on messages for update
using (student_id = auth.uid() or owner_id = auth.uid());

-- เปิด Realtime ให้ข้อความเด้งขึ้นทันทีโดยไม่ต้องรีเฟรช
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table messages;
  end if;
end $$;
