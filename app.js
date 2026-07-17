/* ==========================================================================
   DormCRU — app.js ฟังก์ชันส่วนกลาง (UI) ใช้ร่วมกับ db.js
   ทุกฟังก์ชันดักข้อผิดพลาดเอง เพื่อไม่ให้หน้าเว็บพังถ้า Supabase ยังไม่พร้อม
   ========================================================================== */

function toast(msg, type=''){
  let wrap = document.querySelector('.toast-wrap');
  if(!wrap){
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  wrap.appendChild(el);
  setTimeout(()=> el.remove(), 3200);
}

// เรียกครั้งเดียวตอนเปิดหน้า — คืนค่า profile (หรือ null ถ้ายังไม่ล็อคอิน/ยังไม่ได้ตั้งค่า Supabase)
// นำทางเสมอไม่ว่าจะสำเร็จหรือพลาด (ห่อ try/catch ไว้ในนี้ชั้นหนึ่งแล้ว)
async function renderNav(active){
  let profile = null;
  try{ profile = await currentProfile(); }catch(err){ console.error('renderNav:', err); }

  const links = [
    { href:'index.html', label:'ค้นหาหอพัก', key:'search' },
  ];
  const nav = document.getElementById('site-nav');
  if(!nav) return profile;
  let html = `<a href="index.html" class="brand"><span class="dot"></span>DormCRU เชียงราย</a>
  <button class="hamburger" id="hamburgerBtn" aria-label="เมนู">☰</button>
  <div class="nav-links" id="navLinks">`;
  links.forEach(l=>{
    html += `<a href="${l.href}" ${active===l.key?'style="background:rgba(255,255,255,.14)"':''}>${l.label}</a>`;
  });
  if(profile){
    if(profile.role === 'owner' || profile.role === 'admin'){
      html += `<a href="admin.html">หลังบ้านของฉัน</a>`;
    }
    html += `<a href="#" id="logoutBtn">ออกจากระบบ (${profile.name})</a>`;
  }else{
    html += `<a href="login.html">เข้าสู่ระบบ / สมัครสมาชิก</a>`;
  }
  nav.innerHTML = html;

  const logoutBtn = document.getElementById('logoutBtn');
  if(logoutBtn){
    logoutBtn.addEventListener('click', async (e)=>{
      e.preventDefault();
      try{ await logout(); }catch(err){ console.error(err); }
      toast('ออกจากระบบแล้ว','success');
      setTimeout(()=> location.href='index.html', 500);
    });
  }
  const hb = document.getElementById('hamburgerBtn');
  if(hb){
    hb.addEventListener('click', ()=>{
      const nl = document.getElementById('navLinks');
      nl.style.display = nl.style.display === 'flex' ? 'none' : 'flex';
      nl.style.cssText += 'position:absolute;top:68px;left:0;right:0;background:var(--forest);flex-direction:column;padding:10px 20px;';
    });
  }
  return profile;
}

// เรียกในหน้า/ฟีเจอร์ที่ต้องล็อคอินก่อนถึงใช้งานได้ — คืนค่า profile ถ้าผ่าน, null ถ้าไม่ผ่าน
async function requireLogin(redirectMsg){
  let profile = null;
  try{ profile = await currentProfile(); }catch(err){ console.error(err); }
  if(!profile){
    toast(redirectMsg || 'กรุณาเข้าสู่ระบบก่อนใช้งานส่วนนี้','error');
    setTimeout(()=> location.href = 'login.html', 900);
    return null;
  }
  return profile;
}
