/* ============================================================================
   DormCRU — /api/notify-booking
   ส่งอีเมลแจ้งเจ้าของหอเมื่อมีนักศึกษากดจองห้อง

   ทำงานบน Vercel Serverless Function (ไฟล์ในโฟลเดอร์ api/ Vercel จะรันให้เอง)

   ต้องตั้งค่า Environment Variables ใน Vercel ก่อน (Settings -> Environment Variables):
     SUPABASE_URL               = https://xxxx.supabase.co         (เหมือนใน db.js)
     SUPABASE_SERVICE_ROLE_KEY  = service_role key จาก Supabase     *** ห้ามใส่ในไฟล์หน้าเว็บเด็ดขาด ***
     SITE_URL                   = https://ชื่อเว็บของคุณ.vercel.app  (ไม่ใส่ก็ได้)

   แล้วเลือกผู้ให้บริการส่งอีเมล 1 เจ้า:
     [ก] BREVO_API_KEY   = API key จาก brevo.com   <-- แนะนำถ้าไม่มีโดเมนเป็นของตัวเอง
         MAIL_FROM       = DormCRU <อีเมลที่ยืนยันกับ Brevo แล้ว>   เช่น DormCRU <dormcru@gmail.com>
     [ข] RESEND_API_KEY  = API key จาก resend.com  <-- ต้องยืนยันโดเมนของตัวเองก่อน
         MAIL_FROM       = DormCRU <noreply@โดเมนของคุณ>
         *** onboarding@resend.dev ส่งได้เฉพาะอีเมลเจ้าของบัญชี Resend เท่านั้น
             ใช้ส่งหาเจ้าของหอคนอื่นไม่ได้ ***
   ถ้าตั้งทั้งสองเจ้า ระบบจะใช้ Brevo ก่อน

   ถ้ายังไม่ตั้งค่า ฟังก์ชันนี้จะตอบ ok:false กลับไป การจองยังบันทึกลงฐานข้อมูลตามปกติ
   และเจ้าของหอยังเห็นคำขอจองในหน้าหลังบ้านอยู่ดี
   ============================================================================ */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;    // ทางเลือกที่ 1: Resend (ต้องมีโดเมนของตัวเอง)
const BREVO_KEY    = process.env.BREVO_API_KEY;     // ทางเลือกที่ 2: Brevo (ใช้อีเมล Gmail ธรรมดาได้ ไม่ต้องมีโดเมน)
const MAIL_FROM    = process.env.MAIL_FROM || 'DormCRU <onboarding@resend.dev>';
const SITE_URL     = process.env.SITE_URL || '';

// แยกชื่อผู้ส่งกับอีเมลผู้ส่งออกจากกัน  เช่น  'DormCRU <dormcru@gmail.com>'
function parseFrom(v){
  const m = String(v||'').match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if(m) return { name: m[1] || 'DormCRU', email: m[2] };
  return { name: 'DormCRU', email: String(v||'').trim() };
}

// ส่งอีเมลผ่านผู้ให้บริการที่ตั้งค่าไว้ (Brevo มาก่อนเพราะไม่ต้องมีโดเมน)
// คืน { ok, reason?, detail? } — ไม่ throw เพื่อให้การจองสำเร็จเสมอแม้เมลส่งไม่ออก
async function sendMail({ to, subject, html, replyTo }){
  const from = parseFrom(MAIL_FROM);

  if(BREVO_KEY){
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method:'POST',
      headers:{ 'api-key': BREVO_KEY, 'Content-Type':'application/json', accept:'application/json' },
      body: JSON.stringify({
        sender: { name: from.name, email: from.email },
        to: [{ email: to }],
        replyTo: replyTo ? { email: replyTo } : undefined,
        subject, htmlContent: html
      })
    });
    if(res.ok) return { ok:true, provider:'brevo' };
    const detail = await res.text();
    return { ok:false, reason:'brevo ส่งไม่สำเร็จ', detail: detail.slice(0,300) };
  }

  if(RESEND_KEY){
    const res = await fetch('https://api.resend.com/emails', {
      method:'POST',
      headers:{ Authorization:`Bearer ${RESEND_KEY}`, 'Content-Type':'application/json' },
      body: JSON.stringify({ from: MAIL_FROM, to:[to], reply_to: replyTo || undefined, subject, html })
    });
    if(res.ok) return { ok:true, provider:'resend' };
    const detail = await res.text();
    // ข้อผิดพลาดที่เจอบ่อยที่สุด: ใช้ onboarding@resend.dev ส่งหาคนอื่นที่ไม่ใช่เจ้าของบัญชี
    const hint = /resend\.dev|403|domain/i.test(detail)
      ? ' — onboarding@resend.dev ส่งได้เฉพาะอีเมลเจ้าของบัญชี Resend เท่านั้น ต้องยืนยันโดเมนของตัวเองก่อน หรือเปลี่ยนไปใช้ BREVO_API_KEY'
      : '';
    return { ok:false, reason:'resend ส่งไม่สำเร็จ' + hint, detail: detail.slice(0,300) };
  }

  return { ok:false, reason:'ยังไม่ได้ตั้งค่า BREVO_API_KEY หรือ RESEND_API_KEY ใน Vercel' };
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// เรียก Supabase REST ด้วย service role (ข้าม RLS ได้ ใช้ได้เฉพาะฝั่งเซิร์ฟเวอร์)
async function sbFetch(pathAndQuery, options = {}){
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  if(!res.ok) throw new Error(`supabase ${res.status}: ${await res.text()}`);
  return res.json();
}

function bookingEmailHtml(b){
  const link = SITE_URL ? `${SITE_URL.replace(/\/$/,'')}/admin` : '';
  const row = (label, value) => value
    ? `<tr>
         <td style="padding:8px 14px;color:#5B6355;font-size:14px;white-space:nowrap">${esc(label)}</td>
         <td style="padding:8px 14px;color:#23291E;font-size:14px;font-weight:600">${esc(value)}</td>
       </tr>` : '';

  return `<!doctype html>
<html lang="th"><body style="margin:0;background:#FBF9F3;font-family:'Segoe UI',Tahoma,sans-serif">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <div style="background:#1F3A2E;color:#fff;padding:20px 24px;border-radius:14px 14px 0 0">
      <div style="font-size:13px;color:#E8A33D;letter-spacing:.04em">DormCRU เชียงราย</div>
      <h1 style="margin:6px 0 0;font-size:20px;color:#fff">มีคำขอจองห้องใหม่</h1>
    </div>

    <div style="background:#fff;border:1px solid #DCE3D2;border-top:none;padding:22px 24px;border-radius:0 0 14px 14px">
      <p style="margin:0 0 16px;font-size:15px;color:#23291E">
        นักศึกษา <strong>${esc(b.user_name || 'ไม่ระบุชื่อ')}</strong>
        ส่งคำขอจองห้องที่ <strong>${esc(b.dorm_name || 'หอพักของคุณ')}</strong> เข้ามาครับ
      </p>

      <table style="width:100%;border-collapse:collapse;background:#F3F6EE;border-radius:10px;overflow:hidden">
        ${row('ห้องที่สนใจ', b.room_label)}
        ${row('ชื่อนักศึกษา', b.user_name)}
        ${row('เบอร์ติดต่อกลับ', b.contact_phone)}
        ${row('อีเมล', b.user_email)}
        ${row('วันที่สะดวกไปดูห้อง', b.visit_date)}
        ${row('ข้อความเพิ่มเติม', b.note)}
      </table>

      ${link ? `<div style="text-align:center;margin:22px 0 8px">
        <a href="${esc(link)}" style="display:inline-block;background:#E8A33D;color:#16281F;text-decoration:none;
           font-weight:700;padding:12px 26px;border-radius:8px;font-size:15px">เปิดหน้าหลังบ้านเพื่อตอบกลับ</a>
      </div>` : ''}

      <p style="margin:16px 0 0;font-size:12px;color:#5B6355;line-height:1.6">
        กรุณาติดต่อกลับนักศึกษาเพื่อยืนยันห้องและนัดดูห้องจริง<br>
        DormCRU เป็นเพียงช่องทางรวมข้อมูลหอพัก ไม่ได้รับจองหรือรับเงินแทนหอพัก
      </p>
    </div>
  </div>
</body></html>`;
}

module.exports = async function handler(req, res){
  if(req.method !== 'POST'){
    return res.status(405).json({ ok:false, error:'ใช้ได้เฉพาะ POST' });
  }
  if(!SUPABASE_URL || !SERVICE_KEY){
    return res.status(200).json({ ok:false, reason:'ยังไม่ได้ตั้งค่า SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ใน Vercel' });
  }

  try{
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const bookingId = body.bookingId;
    const testDormId = body.testDormId;
    if(!bookingId && !testDormId){
      return res.status(400).json({ ok:false, error:'ไม่ได้ส่ง bookingId มา' });
    }

    // ---- ตรวจว่าคนเรียกล็อกอินจริง ----
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if(!token) return res.status(401).json({ ok:false, error:'ไม่พบ token ผู้ใช้' });

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` }
    });
    if(!userRes.ok) return res.status(401).json({ ok:false, error:'token ไม่ถูกต้องหรือหมดอายุ' });
    const user = await userRes.json();

    // ---- โหมดทดสอบ: เจ้าของหอกดปุ่ม "ส่งอีเมลทดสอบ" จากหลังบ้าน ----
    if(testDormId){
      const dorms = await sbFetch(`dorms?id=eq.${encodeURIComponent(testDormId)}&select=id,name,owner_id,contact_email`);
      const dorm = dorms[0];
      if(!dorm) return res.status(404).json({ ok:false, error:'ไม่พบหอพักนี้' });
      if(dorm.owner_id !== user.id){
        return res.status(403).json({ ok:false, error:'หอนี้ไม่ใช่ของคุณ' });
      }
      let target = (dorm.contact_email || '').trim();
      if(!target){
        const prof = await sbFetch(`profiles?id=eq.${encodeURIComponent(user.id)}&select=email`);
        target = prof[0] && prof[0].email;
      }
      if(!target) return res.status(200).json({ ok:false, reason:'ยังไม่มีอีเมลปลายทาง' });

      const testRes = await sendMail({
        to: target,
        subject: `[DormCRU] ทดสอบระบบแจ้งเตือน — ${dorm.name || 'หอพักของคุณ'}`,
        html: `<div style="font-family:'Segoe UI',Tahoma,sans-serif;max-width:520px;margin:0 auto;padding:22px">
          <h2 style="color:#1F3A2E">✅ ระบบแจ้งเตือนทำงานปกติ</h2>
          <p>ถ้าคุณเห็นอีเมลฉบับนี้ แปลว่าเมื่อมีนักศึกษากดจองห้องที่
             <strong>${esc(dorm.name||'')}</strong> ระบบจะส่งแจ้งเตือนมาที่
             <strong>${esc(target)}</strong> ได้แน่นอน</p>
          <p style="color:#5B6355;font-size:13px">
             ถ้าอีเมลนี้ตกอยู่ในโฟลเดอร์สแปม กรุณากด "ไม่ใช่สแปม" หรือย้ายเข้ากล่องขาเข้า
             เพื่อให้แจ้งเตือนครั้งต่อไปเข้ากล่องหลัก</p>
        </div>`
      });
      return res.status(200).json({ ...testRes, sentTo: target });
    }

    const rows = await sbFetch(`bookings?id=eq.${encodeURIComponent(bookingId)}&select=*`);
    const booking = rows[0];
    if(!booking) return res.status(404).json({ ok:false, error:'ไม่พบคำขอจองนี้' });
    if(booking.user_id !== user.id){
      return res.status(403).json({ ok:false, error:'คำขอจองนี้ไม่ใช่ของคุณ' });
    }
    if(booking.notified_at){
      return res.status(200).json({ ok:true, already:true });   // กันส่งเมลซ้ำ
    }

    // ---- หาอีเมลเจ้าของหอ ----
    let ownerEmail = booking.owner_email;
    if(!ownerEmail && booking.owner_id){
      const owner = await sbFetch(`profiles?id=eq.${encodeURIComponent(booking.owner_id)}&select=email`);
      ownerEmail = owner[0] && owner[0].email;
    }
    if(!ownerEmail){
      return res.status(200).json({ ok:false, reason:'เจ้าของหอยังไม่มีอีเมลในระบบ' });
    }
    // ---- ส่งอีเมล ----
    const mailRes = await sendMail({
      to: ownerEmail,
      replyTo: booking.user_email || undefined,
      subject: `[DormCRU] คำขอจองใหม่จาก ${booking.user_name || 'นักศึกษา'} — ${booking.dorm_name || 'หอพักของคุณ'}`,
      html: bookingEmailHtml(booking)
    });

    if(!mailRes.ok){
      console.error('ส่งอีเมลไม่สำเร็จ:', mailRes);
      // บันทึกสาเหตุไว้ที่คำขอจอง เจ้าของหอ/แอดมินจะได้เห็นว่าทำไมเมลไม่ถึง
      await sbFetch(`bookings?id=eq.${encodeURIComponent(bookingId)}`, {
        method:'PATCH', headers:{ Prefer:'return=minimal' },
        body: JSON.stringify({ notify_error: (mailRes.reason||'') + ' ' + (mailRes.detail||'') })
      }).catch(()=>{});
      return res.status(200).json(mailRes);
    }

    // ---- บันทึกว่าส่งเมลแล้ว กันส่งซ้ำ ----
    await sbFetch(`bookings?id=eq.${encodeURIComponent(bookingId)}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ notified_at: new Date().toISOString() })
    });

    return res.status(200).json({ ok:true, sentTo: ownerEmail, provider: mailRes.provider });
  }catch(err){
    console.error('notify-booking error:', err);
    return res.status(200).json({ ok:false, reason:'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์', detail: String(err.message||err) });
  }
};
