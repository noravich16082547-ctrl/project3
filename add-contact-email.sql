-- ============================================================================
-- DormCRU — add-contact-email.sql
-- ให้เจ้าของหอกำหนด "อีเมลรับแจ้งเตือนการจอง" ของหอเองได้
-- (แยกจากอีเมลที่ใช้ล็อกอิน เช่น ล็อกอินด้วยอีเมลส่วนตัว แต่ให้แจ้งเตือนไปที่อีเมลของหอ)
--
-- วิธีใช้: Supabase Dashboard -> SQL Editor -> New query -> วางทั้งไฟล์ -> Run
-- รันซ้ำได้ ไม่ error
-- ============================================================================

alter table dorms add column if not exists contact_email text;

-- ปรับฟังก์ชันเดิมให้เลือกอีเมลตามลำดับความสำคัญ:
--   1) อีเมลรับแจ้งเตือนที่เจ้าของหอกรอกไว้ในข้อมูลหอ  (dorms.contact_email)
--   2) อีเมลที่เจ้าของหอใช้สมัครสมาชิก                  (profiles.email)
-- คืนค่าเฉพาะอีเมลของหอที่ระบุเท่านั้น กวาดอีเมลผู้ใช้คนอื่นทั้งระบบไม่ได้
create or replace function dorm_owner_email(p_dorm_id uuid)
returns text
language sql stable security definer as $$
  select coalesce(
           nullif(trim(d.contact_email), ''),
           nullif(trim(p.email), '')
         )
  from dorms d
  left join profiles p on p.id = d.owner_id
  where d.id = p_dorm_id
$$;

-- เก็บอีเมลผู้รับที่ใช้จริงไว้กับคำขอจอง เผื่อภายหลังเจ้าของหอเปลี่ยนอีเมล
-- จะยังตรวจสอบย้อนหลังได้ว่าตอนนั้นส่งไปที่ไหน  (คอลัมน์นี้มีอยู่แล้วจาก fix-chat-booking.sql)
alter table bookings add column if not exists owner_email text;
alter table bookings add column if not exists notify_error text;   -- เก็บสาเหตุถ้าส่งเมลไม่สำเร็จ

-- เสร็จแล้ว — ไปกรอกอีเมลได้ที่ หลังบ้าน -> จัดการห้องพัก -> แก้ไข -> "อีเมลรับแจ้งเตือนการจอง"
