/* ============================================================================
   DormCRU — /api/health
   หน้าตรวจสุขภาพระบบฝั่งเซิร์ฟเวอร์ ใช้ไล่หาสาเหตุเวลาอีเมลไม่ทำงาน

   วิธีใช้: เปิดเบราว์เซอร์ไปที่  https://ชื่อเว็บของคุณ.vercel.app/api/health

   - ถ้าเห็น JSON (ข้อความแบบ {"ok":true,...})  = โฟลเดอร์ api/ ถูก deploy แล้ว
   - ถ้าเห็นหน้า 404 Not Found                  = Vercel หาโฟลเดอร์ api/ ไม่เจอ
                                                  (มักเกิดจาก api/ ไม่ได้อยู่ระดับบนสุดของโปรเจกต์)

   ตัวแปรลับ (API key ต่าง ๆ) จะไม่ถูกแสดงค่าออกมา บอกแค่ว่า "ตั้งค่าแล้ว" หรือ "ยัง"
   ============================================================================ */

module.exports = async function handler(req, res){
  const has = (v) => (v && String(v).trim().length > 0) ? 'ตั้งค่าแล้ว' : 'ยังไม่ได้ตั้งค่า';

  const provider =
    (process.env.BREVO_API_KEY && 'brevo') ||
    (process.env.RESEND_API_KEY && 'resend') ||
    'ยังไม่ได้เลือกผู้ให้บริการส่งอีเมล';

  res.status(200).json({
    ok: true,
    message: 'โฟลเดอร์ api/ ถูก deploy บน Vercel เรียบร้อยแล้ว',
    เวลาเซิร์ฟเวอร์: new Date().toISOString(),
    ตัวแปรที่ตั้งไว้: {
      SUPABASE_URL: has(process.env.SUPABASE_URL),
      SUPABASE_SERVICE_ROLE_KEY: has(process.env.SUPABASE_SERVICE_ROLE_KEY),
      BREVO_API_KEY: has(process.env.BREVO_API_KEY),
      RESEND_API_KEY: has(process.env.RESEND_API_KEY),
      MAIL_FROM: process.env.MAIL_FROM || 'ยังไม่ได้ตั้งค่า',
      SITE_URL: process.env.SITE_URL || 'ยังไม่ได้ตั้งค่า'
    },
    ผู้ให้บริการที่จะใช้ส่ง: provider,
    พร้อมส่งอีเมลหรือยัง:
      (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY &&
       (process.env.BREVO_API_KEY || process.env.RESEND_API_KEY))
        ? 'พร้อม'
        : 'ยังไม่พร้อม — ดูรายการตัวแปรด้านบนว่าขาดตัวไหน'
  });
};
