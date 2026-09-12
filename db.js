/* ==========================================================================
   DormCRU — db.js (Supabase data layer, ไฟล์เดียว ไม่มีโฟลเดอร์ assets)
   *** แก้ SUPABASE_URL และ SUPABASE_ANON_KEY ด้านล่างเป็นค่าจริงของคุณ ***
   หาได้จาก Supabase Dashboard -> Project Settings -> API
   ดูขั้นตอนเต็มใน SETUP-SUPABASE.md

   ออกแบบให้ "ไม่มีวันจอหน้าว่างเปล่า": ทุกฟังก์ชันที่คุยกับ Supabase มีการดัก
   error ไว้ที่นี่ชั้นหนึ่งแล้ว และหน้าเว็บแต่ละหน้าจะเช็ค checkConnection()
   ก่อนเสมอ ถ้ายังไม่ตั้งค่าจะโชว์แบนเนอร์เตือนแทนที่จะพังเงียบๆ
   ========================================================================== */

const SUPABASE_URL = "https://iekcsncnvpdtomhehxlw.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlla2NzbmNudnBkdG9taGVoeGx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTM2ODUyNDgsImV4cCI6MjA2OTI2MTI0OH0.YLhNpTHffj4mqnwcBJ-MqJ7Ist0JGv_mtQwHHwTDYAA";

// หมายเหตุเรื่องความปลอดภัย:
// คีย์ด้านบนคือ "anon public key" ซึ่งออกแบบมาให้เปิดเผยในหน้าเว็บได้อยู่แล้ว
// สิ่งที่กันคนอื่นแก้ข้อมูลคือ Row Level Security (RLS) ในฐานข้อมูล ไม่ใช่การซ่อนคีย์นี้
// *** ห้ามเอา service_role key มาใส่ในไฟล์นี้เด็ดขาด *** คีย์นั้นข้าม RLS ได้ทั้งหมด
// ถ้าต้องใช้ ให้ใส่ไว้ใน Environment Variables ของ Vercel เท่านั้น (ฝั่ง api/)

function isSupabaseConfigured(){
  return !SUPABASE_URL.includes('YOUR_PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR_ANON');
}

// ---------------------------------------------------------------------------
// ตรวจว่าคีย์ที่ใส่ไว้เป็นของโปรเจกต์เดียวกับ SUPABASE_URL จริงไหม
//
// คีย์ของ Supabase เป็น JWT ที่ข้างในมีชื่อโปรเจกต์ (ref) อยู่
// ถ้าคัดลอกมาผิดตัวหรือขาดหาย จะจับได้ตรงนี้ แล้วขึ้นข้อความบอกวิธีแก้
// ดีกว่าปล่อยให้หน้าเว็บเงียบ ๆ แล้วล็อกอินไม่ได้โดยไม่รู้สาเหตุ
// ---------------------------------------------------------------------------
function supabaseKeyProblem(){
  if(!isSupabaseConfigured()) return 'ยังไม่ได้ใส่ค่า SUPABASE_URL / SUPABASE_ANON_KEY ใน db.js';
  try{
    const parts = SUPABASE_ANON_KEY.split('.');
    if(parts.length !== 3) return 'รูปแบบคีย์ไม่ถูกต้อง — คัดลอกคีย์มาไม่ครบ';
    const payload = JSON.parse(atob(parts[1].replace(/-/g,'+').replace(/_/g,'/')));
    const urlRef  = (SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/) || [])[1];
    if(payload.role !== 'anon'){
      return 'คีย์นี้ไม่ใช่ anon public key (role = ' + payload.role + ') — ต้องใช้ anon key เท่านั้น';
    }
    if(urlRef && payload.ref && urlRef !== payload.ref){
      return 'คีย์เป็นของโปรเจกต์ "' + payload.ref + '" แต่ URL ชี้ไปโปรเจกต์ "' + urlRef + '" — คัดลอกมาคนละโปรเจกต์';
    }
    if(payload.exp && payload.exp * 1000 < Date.now()) return 'คีย์หมดอายุแล้ว — ไปคัดลอกคีย์ใหม่จาก Supabase';
    return null;   // ผ่านหมด
  }catch(err){
    return 'อ่านคีย์ไม่ออก — น่าจะคัดลอกมาไม่ครบหรือมีอักขระแปลกปน';
  }
}

let sb = null;
try{
  if(window.supabase && isSupabaseConfigured()){
    sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
}catch(err){
  console.error('สร้าง Supabase client ไม่สำเร็จ:', err);
  sb = null;
}

// ---------------------------------------------------------------------------
// ช่องทางติดต่อของเว็บไซต์ DormCRU (แสดงที่ footer และหน้าเข้าสู่ระบบ)
// *** แก้ค่าด้านล่างเป็นช่องทางจริงของคุณ — ช่องไหนยังไม่มีให้ปล่อย '' ว่างไว้ ปุ่มจะไม่แสดง ***
// ---------------------------------------------------------------------------
const SITE_CONTACT = {
  name:  'ทีมงาน DormCRU',                     // ชื่อผู้ดูแลเว็บ
  phone: '',                                  // เช่น '081-234-5678'
  email: 'darkwarior707@gmail.com',           // อีเมลผู้ดูแลเว็บ — แก้ตรงนี้ถ้าอยากใช้อีเมลอื่น
  line:  '',                                  // LINE ID เช่น '@dormcru' หรือลิงก์เต็ม https://line.me/...
  facebook: ''                                // ลิงก์เพจ เช่น 'https://facebook.com/dormcru'
};

// รายการช่องทางติดต่อเจ้าของเว็บ (คืนเป็น array ของ {icon, label, href})
function siteContactList(){
  const out = [];
  if(SITE_CONTACT.phone) out.push({ icon:'📞', label: SITE_CONTACT.phone, href:`tel:${SITE_CONTACT.phone}` });
  if(SITE_CONTACT.email) out.push({ icon:'✉️', label: SITE_CONTACT.email, href:`mailto:${SITE_CONTACT.email}` });
  if(SITE_CONTACT.line){
    const href = SITE_CONTACT.line.startsWith('http') ? SITE_CONTACT.line : `https://line.me/R/ti/p/~${encodeURIComponent(SITE_CONTACT.line)}`;
    out.push({ icon:'💬', label:`LINE: ${SITE_CONTACT.line}`, href });
  }
  if(SITE_CONTACT.facebook) out.push({ icon:'📘', label:'Facebook', href: SITE_CONTACT.facebook });
  return out;
}

// แบบบรรทัดเดียว (ใช้ในหน้าเข้าสู่ระบบ) — คืนค่าว่างถ้ายังไม่ได้กรอกช่องทางใดเลย
function siteContactHtml(){
  return siteContactList()
    .map(c=>`<a href="${c.href}" ${c.href.startsWith('http')?'target="_blank" rel="noopener"':''} style="color:inherit">${c.icon} ${c.label}</a>`)
    .join(' &nbsp;·&nbsp; ');
}

// แถบ "ติดต่อเจ้าของเว็บ" ท้ายเว็บ — แสดงเสมอ ถ้ายังไม่กรอกจะขึ้นข้อความบอกวิธีกรอก
function siteContactBarHtml(){
  const list = siteContactList();
  const who = SITE_CONTACT.name || 'ผู้ดูแลเว็บ DormCRU';
  const items = list.length
    ? list.map(c=>`<a class="site-contact-item" href="${c.href}" ${c.href.startsWith('http')?'target="_blank" rel="noopener"':''}>
         <span class="ic">${c.icon}</span><span>${c.label}</span></a>`).join('')
    : `<span class="site-contact-item muted-light">ยังไม่ได้กรอกช่องทางติดต่อ — เปิดไฟล์ <code>db.js</code> แล้วเติมค่าในตัวแปร <code>SITE_CONTACT</code></span>`;
  return `
    <div class="site-contact-inner">
      <div class="site-contact-head">
        <strong>ติดต่อเจ้าของเว็บ</strong>
        <span>${who} · แจ้งข้อมูลหอพักผิดพลาด เพิ่มหอใหม่ หรือสอบถามการใช้งาน</span>
      </div>
      <div class="site-contact-links">${items}</div>
    </div>`;
}

// เรียกจากทุกหน้าตอนเริ่มโหลด — คืนค่า true ถ้าพร้อมใช้งาน, false ถ้ายังไม่ได้ตั้งค่า/เชื่อมต่อไม่ได้
// ไม่ throw error เด็ดขาด เพื่อไม่ให้หน้าเว็บพัง
async function checkConnection(){
  if(!isSupabaseConfigured() || !sb) return false;
  try{
    const { error } = await sb.from('dorms').select('id', { count: 'exact', head: true });
    return !error;
  }catch(err){
    console.error('เชื่อมต่อ Supabase ไม่สำเร็จ:', err);
    return false;
  }
}

// แสดง/ซ่อนแบนเนอร์แจ้งเตือนตอนยังไม่ได้ตั้งค่า Supabase — ใช้ร่วมกับ <div class="setup-banner" id="setupBanner">
async function showSetupBannerIfNeeded(){
  const ok = await checkConnection();
  const banner = document.getElementById('setupBanner');
  if(banner){
    banner.classList.toggle('show', !ok);
    if(!ok){
      const keyIssue = supabaseKeyProblem();
      banner.innerHTML = keyIssue
        ? `⚠️ <strong>เชื่อมต่อฐานข้อมูลไม่สำเร็จ</strong> — ${keyIssue}<br>
           <small>วิธีแก้: เปิด Supabase → Project Settings → API → คัดลอก <strong>Project URL</strong> และ
           <strong>anon public</strong> มาวางในไฟล์ <code>db.js</code> บรรทัดบนสุด แล้วอัปโหลดใหม่</small>`
        : `⚠️ ต่อฐานข้อมูล Supabase ไม่ได้ — คีย์ดูถูกต้องแล้ว แต่เรียกข้อมูลไม่สำเร็จ<br>
           <small>เช็กว่าโปรเจกต์ Supabase ยังทำงานอยู่ (ไม่ถูก pause) และรันไฟล์ SQL ครบแล้ว</small>`;
    }
  }
  return ok;
}

// หมายเหตุ: เดิมตรงนี้มีพิกัด "ประตู 1/2/3" ของมอฮาร์ดโค้ดไว้
// แต่พิกัดทั้ง 3 จุดนั้นผิด (ชี้ไปกลางเมืองเชียงราย ไม่ใช่บ้านดู่) และไม่มีที่ไหนเรียกใช้แล้ว
// จึงลบทิ้ง ดีกว่าปล่อยตัวเลขผิดไว้ให้คนหยิบไปใช้ต่อโดยไม่รู้

const FACILITY_META = {
  wifi: { icon:'📶', label:'Wi-Fi ฟรี' },
  parking: { icon:'🛵', label:'ที่จอดรถ' },
  laundry: { icon:'🧺', label:'ซักผ้าหยอดเหรียญ' },
  keycard: { icon:'🔑', label:'คีย์การ์ด' },
  cctv: { icon:'📷', label:'กล้องวงจรปิด' },
  guard: { icon:'🛡️', label:'รปภ. 24 ชม.' }
};

// ---------------------------------------------------------------------------
// สิ่งอำนวยความสะดวก "อื่น ๆ" ที่เจ้าของหอพิมพ์เอง
//
// ค่าในคอลัมน์ facilities เก็บได้ 2 แบบ
//   - รหัสมาตรฐาน เช่น 'wifi' 'cctv'  -> ใช้ไอคอน/ชื่อจาก FACILITY_META
//   - ข้อความอิสระ เช่น 'ตู้กดน้ำดื่ม'   -> แสดงข้อความนั้นตรง ๆ พร้อมไอคอน ✅
// เก็บเป็นข้อความล้วน ไม่ต้องมีคำนำหน้า เพื่อให้ข้อมูลเก่ายังใช้ได้เหมือนเดิม
// ---------------------------------------------------------------------------
function isCustomFacility(code){
  return typeof code === 'string' && code.trim() !== '' && !FACILITY_META[code];
}
// คืน {icon, label} เสมอ — label เป็นข้อความดิบ ผู้เรียกต้อง escape ก่อนใส่ลง HTML
function facilityMeta(code){
  if(FACILITY_META[code]) return FACILITY_META[code];
  return { icon:'✅', label: String(code) };
}
function escapeAttr(s){
  return String(s==null?'':s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

// ---------------------------------------------------------------------------
// เอา "ข้อมูลหอพักตั้งต้น 61 หอ" ออกแล้ว (v16)
//
// เดิมระบบใส่รายชื่อหอพักเครือข่ายของมหาวิทยาลัยไว้ให้ก่อน พร้อมรูปสต็อกจาก Pexels
// แต่หอเหล่านั้นไม่มีราคา ไม่มีห้องว่าง ไม่มีเจ้าของ และรูปก็ไม่ใช่ห้องจริง
// ทำให้หน้าเว็บดูเหมือนมีข้อมูลเยอะแต่กดเข้าไปแล้วไม่มีอะไรให้ดู
//
// ตอนนี้หอพักในเว็บมาจาก "เจ้าของหอสมัครแล้วสร้างหน้าหอของตัวเอง" เท่านั้น
// ทุกหอที่นักศึกษาเห็นจึงเป็นหอจริงที่มีคนดูแลและติดต่อได้จริง
//
// ถ้าอยากได้รายชื่อ 61 หอกลับมา ให้รันไฟล์ insert-dorms.sql ใน Supabase
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// ตำแหน่งหอและระยะทางถึงมหาวิทยาลัย
//
// เดิมให้เจ้าของหอกรอก "ระยะจากประตู 1/2/3" เอง 3 ช่อง — แทบไม่มีใครกรอก
// เพราะต้องไปวัดเอง ทุกหอเลยขึ้นว่า "ยังไม่ระบุ" เหมือนกันหมด
//
// ของใหม่: เจ้าของหอปักหมุดหอครั้งเดียว (วางลิงก์ Google Maps ก็พอ)
// แล้วเว็บคำนวณระยะให้เอง
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// พิกัดมหาวิทยาลัยราชภัฏเชียงราย
//
// ⚠️ ของเดิมใส่ไว้ 19.9074, 99.8230 ซึ่ง "ผิด" — จุดนั้นคือ ต.เวียง ในเมืองเชียงราย
//    ห่างจากมอจริงประมาณ 8.6 กม. ทำให้:
//      - ตัวเลข "ห่างมอ ... ม." ที่โชว์ทุกที่ผิดหมด
//      - เส้นทางที่ให้นักศึกษากด ตั้งต้นจากกลางเมือง ไม่ใช่จากมอ
//    มอจริงอยู่เลขที่ 80 หมู่ 9 ต.บ้านดู่ อ.เมือง จ.เชียงราย 57100
//    ตรวจสอบจาก 2 แหล่ง: Longdo Map (19.98082, 99.85114) และ uniRank (19.98038, 99.85029)
// ---------------------------------------------------------------------------
const CRRU_CENTER = { lat: 19.9808, lng: 99.8511 };   // มหาวิทยาลัยราชภัฏเชียงราย (ต.บ้านดู่)

// ระยะเส้นตรงระหว่าง 2 จุดบนโลก (สูตร haversine) หน่วยกิโลเมตร
function haversineKm(a, b){
  const R = 6371;
  const toRad = (deg)=> deg * Math.PI / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat/2)**2 +
            Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function hasLocation(d){
  return !!(d && typeof d.lat === 'number' && typeof d.lng === 'number' &&
            !isNaN(d.lat) && !isNaN(d.lng));
}

// ระยะจากหอถึงมหาวิทยาลัย (กม.) — คืน null ถ้าหอยังไม่ได้ปักหมุด
function distanceToCrru(d){
  if(!hasLocation(d)) return null;
  return haversineKm({ lat:d.lat, lng:d.lng }, CRRU_CENTER);
}

// ข้อความระยะทางแบบอ่านง่าย เช่น "450 ม." / "1.2 กม."
function distanceLabel(km){
  if(km == null) return null;
  if(km < 1) return Math.round(km * 100) * 10 + ' ม.';
  return km.toFixed(1) + ' กม.';
}

// เวลาเดินโดยประมาณ (คนเดินเฉลี่ย 5 กม./ชม.) — ใช้บอกคร่าว ๆ เท่านั้น
function walkMinutes(km){
  if(km == null) return null;
  return Math.max(1, Math.round(km / 5 * 60));
}

// ข้อความสรุปตำแหน่งหอ เช่น "ห่างมอ 450 ม. · เดินราว 6 นาที"
function locationSummary(d){
  const km = distanceToCrru(d);
  if(km == null) return null;
  const m = walkMinutes(km);
  return `ห่างมหาวิทยาลัย ${distanceLabel(km)}` + (km <= 3 ? ` · เดินราว ${m} นาที` : '');
}

// ---------------------------------------------------------------------------
// ดึงพิกัดจากลิงก์ Google Maps ที่เจ้าของหอวางมา
//
// รองรับรูปแบบที่เจอบ่อย:
//   https://www.google.com/maps/@19.9074,99.8230,17z
//   https://www.google.com/maps/place/.../@19.9074,99.8230,17z/...
//   https://maps.google.com/?q=19.9074,99.8230
//   https://www.google.com/maps?ll=19.9074,99.8230
//   19.9074, 99.8230            (วางพิกัดตรง ๆ ก็ได้)
// ลิงก์ย่อ https://maps.app.goo.gl/xxxx ใช้ไม่ได้ เพราะต้องเปิดลิงก์ก่อนถึงจะรู้พิกัด
// ---------------------------------------------------------------------------
function parseLatLng(text){
  const s = String(text || '').trim();
  if(!s) return null;
  if(/maps\.app\.goo\.gl|goo\.gl\/maps/i.test(s)){
    return { error:'ลิงก์ย่อแบบนี้ยังอ่านพิกัดไม่ได้ — เปิดลิงก์ในเบราว์เซอร์ก่อน แล้วคัดลอกลิงก์เต็มจากช่อง URL มาวางแทน' };
  }
  const patterns = [
    /@(-?\d+\.\d+),\s*(-?\d+\.\d+)/,          // /maps/@lat,lng,17z
    /[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,     // ?q=lat,lng
    /[?&]ll=(-?\d+\.\d+),\s*(-?\d+\.\d+)/,    // ?ll=lat,lng
    /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,         // ...!3dlat!4dlng
    /^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/       // วางพิกัดตรง ๆ
  ];
  for(const re of patterns){
    const m = s.match(re);
    if(m){
      const lat = Number(m[1]), lng = Number(m[2]);
      if(isNaN(lat) || isNaN(lng)) continue;
      // เช็กว่าอยู่ในเขตเชียงรายโดยประมาณ กันวางลิงก์ผิดที่หรือสลับ lat/lng
      if(lat < 18.5 || lat > 20.5 || lng < 99.0 || lng > 100.6){
        return { error:`พิกัดที่ได้ (${lat}, ${lng}) อยู่นอกพื้นที่เชียงราย — ตรวจว่าคัดลอกลิงก์ของหอมาถูกไหม` };
      }
      return { lat, lng };
    }
  }
  return { error:'อ่านพิกัดจากลิงก์นี้ไม่ได้ — ลองคัดลอกลิงก์จากช่อง URL ของ Google Maps ตอนเปิดหน้าหอ' };
}

// ---------------------------------------------------------------------------
// รอบ ๆ หอมีอะไรบ้าง (เจ้าของหอกรอกเอง)
// ---------------------------------------------------------------------------
const NEARBY_CATS = {
  convenience: { icon:'🏪', label:'ร้านสะดวกซื้อ' },
  food:        { icon:'🍜', label:'ร้านอาหาร' },
  coffee:      { icon:'☕', label:'ร้านกาแฟ' },
  market:      { icon:'🧺', label:'ตลาด' },
  laundry:     { icon:'🧼', label:'ร้านซักผ้า' },
  salon:       { icon:'💅', label:'ร้านเสริมสวย/ทำเล็บ' },
  pharmacy:    { icon:'💊', label:'ร้านขายยา/คลินิก' },
  atm:         { icon:'🏧', label:'ตู้ ATM/ธนาคาร' },
  gas:         { icon:'⛽', label:'ปั๊มน้ำมัน' },
  gym:         { icon:'🏋️', label:'ฟิตเนส/สนามกีฬา' },
  transport:   { icon:'🚌', label:'รถโดยสาร/วินมอเตอร์ไซค์' },
  other:       { icon:'📍', label:'อื่น ๆ' }
};
const NEARBY_CAT_ORDER = Object.keys(NEARBY_CATS);

function nearbyCatMeta(cat){ return NEARBY_CATS[cat] || NEARBY_CATS.other; }

function normalizeNearby(list){
  if(!Array.isArray(list)) return [];
  return list
    .filter(p => p && String(p.name||'').trim())
    .slice(0, 30)
    .map(p => ({
      cat: NEARBY_CATS[p.cat] ? p.cat : 'other',
      name: String(p.name).trim().slice(0,60),
      dist: String(p.dist || '').trim().slice(0,30)
    }));
}

function hasNearby(d){ return !!(d && Array.isArray(d.nearby) && d.nearby.length); }

// วาดรายการร้านรอบหอ (ใช้ทั้งฝั่งนักศึกษาและหลังบ้าน)
function nearbyPlacesHtml(list, opts){
  const o = opts || {};
  const places = normalizeNearby(list);
  if(!places.length) return '';
  return `<div class="np-grid">${places.map((p,i)=>{
    const m = nearbyCatMeta(p.cat);
    return `<div class="np-item">
      <span class="np-ic" title="${escapeAttr(m.label)}">${m.icon}</span>
      <span class="np-name">${escapeAttr(p.name)}</span>
      ${p.dist ? `<span class="np-dist">${escapeAttr(p.dist)}</span>` : ''}
      ${o.edit ? `<button type="button" class="np-x" data-rmnear="${i}" title="ลบรายการนี้">✕</button>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function nearestGate(dorm){
  if(!dorm.gates) return null;
  let best = 'gate1';
  Object.keys(dorm.gates).forEach(g=>{ if(dorm.gates[g] < dorm.gates[best]) best = g; });
  return best;
}
// ---------------------------------------------------------------------------
// "ราคาเริ่มต้น" เก็บซ่อนไว้ใน rooms เป็นรายการเดียว code = 'base'
//
// ทำแบบนี้เพื่อไม่ต้องเพิ่มคอลัมน์ในฐานข้อมูล (ไม่ต้องรัน SQL)
// แต่มันไม่ใช่ "ประเภทห้อง" จริง ๆ — เป็นแค่ตัวเลขราคาที่เอาไปโชว์บนการ์ด
// เพราะงั้นทุกที่ที่เอา rooms ไปใช้ในฐานะ "ประเภทห้องให้เลือก/ให้จอง"
// ต้องกรองตัวนี้ออกก่อนด้วย roomTypes() ไม่งั้นนักศึกษาจะเห็นห้องชื่อ "ราคาเริ่มต้น"
// ---------------------------------------------------------------------------
const BASE_PRICE_CODE = 'base';
function isBasePriceRow(r){ return r && r.code === BASE_PRICE_CODE; }
// ประเภทห้องจริง ๆ ของหอ (ตัดรายการราคาเริ่มต้นออก)
function roomTypes(dorm){ return (dorm && dorm.rooms || []).filter(r => !isBasePriceRow(r)); }
// หอนี้มีประเภทห้องให้เลือกไหม (หอที่กรอกแค่ราคาเริ่มต้น = ไม่มี)
function hasRoomTypes(dorm){ return roomTypes(dorm).length > 0; }

// จำนวนห้องว่างรวมของหอ
// หอที่วาดผังห้องไว้แล้ว ให้นับจาก "ช่องห้องที่ยังว่าง" ในผัง เพราะเป็นข้อมูลที่จริงกว่า
// (ตัวเลขที่กรอกมือในหน้าแก้ไขหอ จะถูกใช้เฉพาะหอที่ยังไม่ได้วาดผัง)
function totalVacancy(dorm){
  if(hasFloorPlan(dorm)) return planSummary(dorm.floorPlan).vacant;
  return roomTypes(dorm).reduce((s,r)=>s+(r.vacant||0),0);
}
// จำนวนห้องทั้งหมดของหอ
function totalRooms(dorm){
  if(hasFloorPlan(dorm)) return planSummary(dorm.floorPlan).total;
  return roomTypes(dorm).reduce((s,r)=>s+(r.total||0),0);
}
// ห้องแต่ละประเภท ว่างกี่ห้อง/ทั้งหมดกี่ห้อง (คืน {vacant,total} หรือ null ถ้าไม่รู้)
function roomTypeCount(dorm, code){
  if(hasFloorPlan(dorm)){
    const m = planVacancyByType(dorm.floorPlan)[code];
    return m ? { vacant:m.vacant, total:m.total } : { vacant:0, total:0 };
  }
  const r = roomTypes(dorm).find(x=>x.code===code);
  return r ? { vacant:r.vacant, total:r.total } : null;
}
// ราคาเริ่มต้นของหอ — คืน null เมื่อยังไม่มีข้อมูลราคา อย่าคืนตัวเลขมั่ว
// (นับรวมรายการ 'base' ด้วย เพราะมันคือช่อง "ราคาเริ่มต้น" ที่เจ้าของหอกรอกมาตรง ๆ)
function minPrice(dorm){
  const prices = (dorm && dorm.rooms || []).map(r => Number(r.price)).filter(p => p > 0);
  if(!prices.length) return null;
  return Math.min(...prices);
}
function hasPrice(dorm){ return minPrice(dorm) !== null; }
function hasGates(dorm){ return !!dorm.gates && dorm.gates.gate1 !== null && dorm.gates.gate1 !== undefined; }
function priceLabel(dorm){ return hasPrice(dorm) ? fmtBaht(minPrice(dorm)) + ' <small>บาท/เดือน เริ่มต้น</small>' : '<small class="muted">สอบถามราคากับหอโดยตรง</small>'; }
function fmtBaht(n){ return Number(n).toLocaleString('th-TH'); }
function mapEmbedUrl(lat, lng){ return `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`; }

// ---------------------------------------------------------------------------
// แผนที่ + เส้นทาง (ใช้ Google Maps embed แบบไม่ต้องใช้ API key)
// หอที่ยังไม่มีพิกัด lat/lng จะค้นด้วย "ชื่อหอ + บ้านดู่ เชียงราย" แทน
// ---------------------------------------------------------------------------
// จุดตั้งต้นของเส้นทาง = มหาวิทยาลัย
//
// ตรงนี้ใช้ "ชื่อมอ" ไม่ใช่พิกัด เพื่อให้ช่องบนสุดใน Google Maps ขึ้นว่า
// "มหาวิทยาลัยราชภัฏเชียงราย" ให้คนอ่านรู้เรื่อง (ถ้าส่งพิกัดไป Google จะแปลงกลับ
// เป็นเลขที่บ้าน/ชื่อถนน ซึ่งอ่านแล้วไม่รู้ว่าคือมอ)
//
// ที่ปลอดภัยเพราะมอเป็นสถานที่ที่ Google รู้จักอยู่แล้ว —
// เว็บทางการของมอเอง (crru.ac.th/maps) ก็ฝังแผนที่ด้วยคำค้นคำนี้ตรง ๆ
// ต่างจาก "ชื่อหอพัก" ที่ Google ไม่รู้จัก ซึ่งเป็นต้นเหตุของบั๊ก Your location
const CRRU_ORIGIN = 'มหาวิทยาลัยราชภัฏเชียงราย';

// จุดหมาย = พิกัดหอเท่านั้น
//
// ⚠️ บั๊กเดิม: ถ้าหอยังไม่ได้ปักหมุด โค้ดเก่าจะส่งข้อความค้นหา
//    เช่น "goooo หอพัก บ้านดู่ เชียงราย" ไปให้ Google
//    ซึ่ง Google หาไม่เจอ → มันเลยเอา "Your location / ตำแหน่งของคุณ"
//    ไปใส่เป็นปลายทางแทน แล้ววาดเส้นทางมั่ว ๆ ออกมา
//    ตอนนี้เปลี่ยนเป็นคืน null ไปเลย แล้วให้หน้าเว็บขึ้นข้อความว่า "ยังไม่ได้ปักหมุด"
//    ดีกว่าโชว์เส้นทางผิด ๆ ให้นักศึกษาขับรถตามไป
function dormPlaceQuery(d){
  if(!hasLocation(d)) return null;
  return `${d.lat},${d.lng}`;
}
// แผนที่แสดงเส้นทางจากมหาวิทยาลัยไปหอพัก (ฝังในหน้าเว็บ) — null ถ้าหอยังไม่ปักหมุด
function mapRouteEmbedUrl(d){
  const q = dormPlaceQuery(d);
  if(!q) return null;
  return `https://maps.google.com/maps?saddr=${encodeURIComponent(CRRU_ORIGIN)}&daddr=${encodeURIComponent(q)}&hl=th&output=embed`;
}
// ลิงก์เปิดเส้นทางในแอป Google Maps (สำหรับกดนำทางจริงบนมือถือ) — null ถ้าหอยังไม่ปักหมุด
function mapDirectionsLink(d){
  const q = dormPlaceQuery(d);
  if(!q) return null;
  return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(CRRU_ORIGIN)}&destination=${encodeURIComponent(q)}&travelmode=walking`;
}
// ลิงก์เปิดหมุดหอบนแผนที่ (ไม่ใช่เส้นทาง) — null ถ้าหอยังไม่ปักหมุด
function mapPinLink(d){
  const q = dormPlaceQuery(d);
  if(!q) return null;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
// ข้อความมาตรฐานเวลาหอยังไม่ได้ปักหมุด (ใช้ให้เหมือนกันทุกที่)
const NO_PIN_TEXT = 'เจ้าของหอยังไม่ได้ปักหมุดตำแหน่งหอ';
// รูปสำรองเมื่อรูปต้นทางโหลดไม่ขึ้น
const FALLBACK_IMG = 'https://images.pexels.com/photos/1034584/pexels-photo-1034584.jpeg?auto=compress&cs=tinysrgb&w=900';
// รูปที่ระบบใส่ให้ตอนตั้งต้น (สต็อกจาก Pexels) ไม่ใช่รูปห้องจริงของหอ
// ใช้ตรวจเพื่อขึ้นป้าย "ภาพประกอบ" กันนักศึกษาเข้าใจผิดว่าเป็นห้องจริง
function isStockPhoto(url){
  return typeof url === 'string' && /images\.pexels\.com/.test(url);
}
function hasOnlyStockPhotos(d){
  const imgs = (d && d.images) || [];
  return imgs.length === 0 || imgs.every(isStockPhoto);
}
function imgFallbackAttr(){
  return `onerror="if(!this.dataset.fb){this.dataset.fb=1;this.src='${FALLBACK_IMG}';}"`;
}
function facilityIcons(codes){
  return (codes||[]).filter(Boolean).map(c=>{
    const m = facilityMeta(c);
    return `<span title="${escapeAttr(m.label)}">${m.icon}</span>`;
  }).join(' ');
}
function amenityGridHtml(codes){
  return (codes||[]).filter(Boolean).map(c=>{
    const m = facilityMeta(c);
    // label อาจเป็นข้อความที่เจ้าของหอพิมพ์เอง — ต้อง escape ก่อนเสมอ
    return `<div class="amenity"><span class="ic">${m.icon}</span><span>${escapeAttr(m.label)}</span></div>`;
  }).join('');
}
// ---------------------------------------------------------------------------
// ผังห้องพักแต่ละชั้น (floor plan)
//
// โครงข้อมูล:
//   { floors: [ { id, name, rows: [ { id, cells: [ cell, ... ] } ] } ] }
//
// ช่องในแถว (cell) มี 2 แบบ
//   ห้องพัก   { k:'room',  id, no:'101', type:'air', price:2800, status:'vacant', note }
//   ทางเดิน   { k:'stair', id, label:'บันได' }   ใช้แทนบันได ลิฟต์ หรือช่องว่าง
//
// สถานะห้อง (status) — ตรงกับสีที่แสดงในเว็บ
//   vacant   เทา      ว่าง
//   pending  แดง      มีคนกดจองแล้ว รอเจ้าของหอยืนยัน
//   occupied น้ำเงิน  มีผู้เช่าอยู่แล้ว
//   closed   เทาเข้ม  ปิดปรับปรุง ไม่ปล่อยเช่า
// ---------------------------------------------------------------------------
const ROOM_STATUS_META = {
  vacant: { label:'ว่าง',      short:'ว่าง',    cls:'st-vacant' },   // เขียว
  booked: { label:'จองแล้ว',   short:'จองแล้ว', cls:'st-booked' }    // แดง
};
const ROOM_STATUS_ORDER = ['vacant','booked'];
const MAX_ROOM_PHOTOS = 8;   // รูปต่อห้องสูงสุด

// สถานะเก่าจากเวอร์ชันก่อน (4 แบบ) ให้ยุบมาเหลือ 2 แบบ
// ห้องที่เคยเป็น "มีผู้เช่าอยู่" หรือ "ปิดปรับปรุง" = ห้องที่จองไม่ได้ -> จองแล้ว
// ทำไว้ที่ฝั่งเว็บด้วย เผื่อยังไม่ได้รันไฟล์ fix-v21.sql จะได้ไม่แสดงห้องที่มีคนอยู่ว่าว่าง
const LEGACY_ROOM_STATUS = { pending:'booked', occupied:'booked', closed:'booked' };

function normalizeRoomStatus(s){
  if(ROOM_STATUS_META[s]) return s;
  return LEGACY_ROOM_STATUS[s] || 'vacant';
}
function roomStatusMeta(s){ return ROOM_STATUS_META[normalizeRoomStatus(s)]; }

// ผังเปล่าที่ถูกต้องตามโครง (ใช้ตอนหอยังไม่เคยวาดผัง)
function emptyFloorPlan(){ return { floors: [] }; }

// รับผังจากฐานข้อมูลแล้วทำให้แน่ใจว่าโครงครบทุกชั้น (กันข้อมูลเก่า/ข้อมูลเพี้ยน)
function normalizeFloorPlan(plan){
  const p = (plan && typeof plan === 'object') ? plan : {};
  const floors = Array.isArray(p.floors) ? p.floors : [];
  return {
    floors: floors.map((f,fi)=>({
      id: f.id || 'f'+(fi+1),
      name: f.name || ('ชั้น ' + (fi+1)),
      rows: (Array.isArray(f.rows) ? f.rows : []).map((r,ri)=>({
        id: r.id || 'r'+(fi+1)+'-'+(ri+1),
        cells: (Array.isArray(r.cells) ? r.cells : []).map(c=>{
          if((c.k || 'room') !== 'room') return { k:'stair', id: c.id || newCellId(), label: c.label || 'บันได' };
          return {
            k:'room', id: c.id || newCellId(),
            no: c.no || '', type: c.type || '', price: (c.price === '' || c.price == null) ? null : Number(c.price),
            status: normalizeRoomStatus(c.status),
            note: c.note || '',
            amen: Array.isArray(c.amen)
              ? c.amen.filter(x=>String(x||'').trim()).map(x=>String(x).trim().slice(0,30)).slice(0,20)
              : [],
            // รูปภายในห้องนี้ (สูงสุด 8 รูปต่อห้อง) — รูปแรกคือรูปหลักที่โชว์บนช่องห้องในผัง
            // *** ถ้าลืมใส่ตรงนี้ รูปจะหายทุกครั้งที่เจ้าของหอกดบันทึกผัง ***
            photos: Array.isArray(c.photos)
              ? c.photos.filter(u=>typeof u === 'string' && u.trim()).slice(0, MAX_ROOM_PHOTOS)
              : [],
            bookingId: c.bookingId || null, userId: c.userId || null
          };
        })
      }))
    }))
  };
}

function newCellId(){ return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function hasFloorPlan(d){
  return !!(d && d.floorPlan && Array.isArray(d.floorPlan.floors) && d.floorPlan.floors.length > 0);
}

// ไล่ทุกช่องห้องในผัง (ไม่รวมบันได) — คืน array ของ {floor, row, cell}
function eachRoomCell(plan){
  const out = [];
  ((plan && plan.floors) || []).forEach(f=>{
    (f.rows||[]).forEach(r=>{
      (r.cells||[]).forEach(c=>{ if((c.k||'room') === 'room') out.push({ floor:f, row:r, cell:c }); });
    });
  });
  return out;
}

// สรุปจำนวนห้องตามสถานะ {total, vacant, pending, occupied, closed}
function planSummary(plan){
  const s = { total:0, vacant:0, booked:0 };
  eachRoomCell(plan).forEach(({cell})=>{
    s.total++;
    s[normalizeRoomStatus(cell.status)]++;
  });
  return s;
}

// จำนวนห้องว่างแยกตามประเภทห้อง (ใช้แทนตัวเลขที่กรอกมือ เมื่อหอวาดผังแล้ว)
function planVacancyByType(plan){
  const map = {};
  eachRoomCell(plan).forEach(({cell})=>{
    const t = cell.type || '_';
    if(!map[t]) map[t] = { total:0, vacant:0 };
    map[t].total++;
    if(cell.status === 'vacant') map[t].vacant++;
  });
  return map;
}

// รายการห้องว่างที่จองได้จริง (เรียงตามชั้น/เลขห้อง) — ใช้เติมตัวเลือกในฟอร์มจอง
function vacantRoomCells(plan){
  const out = [];
  ((plan && plan.floors) || []).forEach(f=>{
    (f.rows||[]).forEach(r=>{
      (r.cells||[]).forEach(c=>{
        if((c.k||'room') === 'room' && c.status === 'vacant') out.push({ ...c, floorName: f.name });
      });
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// วาดผังห้องพักเป็น HTML (ใช้ร่วมกันทั้งหน้าหลังบ้านและหน้าฝั่งนักศึกษา)
//
// opts.edit      true = โหมดแก้ไข (มีปุ่มเพิ่มห้อง/เพิ่มแถว/เพิ่มชั้น)
// opts.bookable  true = กดห้องว่างเพื่อจองได้ (ฝั่งนักศึกษา)
// opts.myUserId  ใช้ทำเครื่องหมายห้องที่ "คุณจองไว้เอง"
// ---------------------------------------------------------------------------
function floorPlanLegendHtml(){
  return `<div class="fp-legend">${ROOM_STATUS_ORDER.map(s=>{
    const m = ROOM_STATUS_META[s];
    return `<span class="fp-lg"><i class="fp-swatch ${m.cls}"></i>${m.label}</span>`;
  }).join('')}</div>`;
}

function planCellHtml(cell, opts){
  const o = opts || {};
  if((cell.k||'room') !== 'room'){
    return `<div class="fp-cell fp-stair" ${o.edit?`data-cell="${escapeAttr(cell.id)}"`:''}>
      <span class="fp-stair-ic">🪜</span><span>${escapeAttr(cell.label||'บันได')}</span>
      ${o.edit?'<button type="button" class="fp-x" data-rmcell="'+escapeAttr(cell.id)+'" title="เอาออก">✕</button>':''}
    </div>`;
  }
  const st   = normalizeRoomStatus(cell.status);
  const meta = ROOM_STATUS_META[st];
  const mine = o.myUserId && cell.userId === o.myUserId;
  const canBook = o.bookable && st === 'vacant';
  const amen = (cell.amen || []).filter(Boolean);
  // ฝั่งนักศึกษา: กดห้องไหนก็ดูรายละเอียดห้องนั้นได้ ไม่ใช่เฉพาะห้องว่าง
  const clickable = o.bookable || o.edit;
  const tag = clickable ? 'button' : 'div';
  const tip = (cell.no ? ('ห้อง ' + cell.no) : 'ห้อง') + ' · ' + meta.label +
              (amen.length ? ' · ' + amen.join(', ') : '');
  return `<${tag} type="button" class="fp-cell fp-room ${meta.cls} ${canBook?'is-bookable':''} ${mine?'is-mine':''}"
      ${o.edit ? `data-cell="${escapeAttr(cell.id)}"` : ''}
      ${o.bookable ? `data-roominfo="${escapeAttr(cell.id)}"` : ''}
      title="${escapeAttr(tip)}">
    <span class="fp-no">${escapeAttr(cell.no || 'ห้อง')}</span>
    <span class="fp-st">${mine ? 'คุณจองไว้' : meta.short}</span>
    ${cell.price ? `<span class="fp-price">${fmtBaht(cell.price)}฿</span>` : ''}
    ${amen.length ? `<span class="fp-amen">${amen.slice(0,3).map(a=>escapeAttr(a)).join(' · ')}${amen.length>3?' +'+(amen.length-3):''}</span>` : ''}
    ${(cell.photos && cell.photos.length) ? `<span class="fp-pic" title="มีรูปห้อง ${cell.photos.length} รูป">📷 ${cell.photos.length}</span>` : ''}
  </${tag}>`;
}

// แกลเลอรีรูปภายในห้อง (ใช้ในหน้าต่างรายละเอียดห้องฝั่งนักศึกษา)
function roomPhotosHtml(photos){
  const list = (photos || []).filter(Boolean);
  if(!list.length) return '';
  return `<div class="rp-gallery">${list.map((u,i)=>`
    <button type="button" class="rp-thumb" data-roomphoto="${escapeAttr(u)}" title="กดดูรูปขนาดเต็ม">
      <img src="${escapeAttr(u)}" alt="รูปในห้อง ${i+1}" loading="lazy" ${imgFallbackAttr()}>
    </button>`).join('')}</div>`;
}

// ป้ายสิ่งอำนวยความสะดวกในห้อง (ใช้ในหน้าต่างรายละเอียดห้องฝั่งนักศึกษา)
// หน้าตาเหมือนป้ายที่เจ้าของหอติ๊กไว้ในหลังบ้าน จะได้เห็นตรงกันทั้งสองฝั่ง
function roomAmenChipsHtml(list){
  const a = (list || []).filter(Boolean);
  if(!a.length){
    return `<p class="muted" style="font-size:.85rem;margin:0">
      เจ้าของหอยังไม่ได้ระบุของในห้องนี้ — กดปุ่ม "สอบถามห้องนี้" ด้านล่างเพื่อถามได้เลย</p>`;
  }
  return `<div class="ra-chips">${a.map(x=>`<span class="ra-chip on">✓ ${escapeAttr(x)}</span>`).join('')}</div>`;
}

function floorPlanHtml(plan, opts){
  const o = opts || {};
  const p = normalizeFloorPlan(plan);
  if(!p.floors.length){
    return o.edit
      ? `<div class="fp-empty">
           <strong>ยังไม่ได้ทำผังห้องพัก</strong>
           <p class="muted">วาดผังหอของคุณได้เลย — บอกว่าหอมีกี่ชั้น แต่ละชั้นมีห้องอะไรบ้าง
           นักศึกษาจะเห็นว่าห้องไหนว่าง ห้องไหนมีคนจองแล้ว และกดจองห้องที่ต้องการได้โดยตรง</p>
           <button type="button" class="btn btn-primary" data-addfloor="1">+ เพิ่มชั้นแรก</button>
         </div>`
      : '';
  }
  return `
  <div class="fp-wrap">
    ${floorPlanLegendHtml()}
    ${p.floors.map((f,fi)=>`
      <div class="fp-floor" data-floor="${escapeAttr(f.id)}">
        <div class="fp-floor-head">
          <h4>${escapeAttr(f.name)}</h4>
          ${o.edit ? `<div class="fp-floor-tools">
            <button type="button" class="btn btn-sm btn-ghost" data-renamefloor="${escapeAttr(f.id)}">เปลี่ยนชื่อชั้น</button>
            <button type="button" class="btn btn-sm btn-ghost" data-addrow="${escapeAttr(f.id)}">+ เพิ่มแถว</button>
            <button type="button" class="btn btn-sm btn-ghost fp-del" data-rmfloor="${escapeAttr(f.id)}">ลบชั้นนี้</button>
          </div>` : `<span class="fp-floor-count">${(()=>{
            const s = planSummary({floors:[f]});
            return `${s.total} ห้อง · ว่าง ${s.vacant}`;
          })()}</span>`}
        </div>
        ${f.rows.map(r=>`
          <div class="fp-row" data-row="${escapeAttr(r.id)}">
            ${r.cells.map(c=> planCellHtml(c, o)).join('')}
            ${o.edit ? `
              <button type="button" class="fp-cell fp-add" data-addroom="${escapeAttr(f.id)}|${escapeAttr(r.id)}" title="เพิ่มห้องในแถวนี้">
                <span class="fp-add-ic">✚</span><span class="fp-add-tx">เพิ่มห้อง</span></button>
              <button type="button" class="fp-cell fp-add fp-add-stair" data-addstair="${escapeAttr(f.id)}|${escapeAttr(r.id)}" title="เพิ่มบันได ลิฟต์ หรือทางเดิน">
                <span class="fp-add-ic">🪜</span><span class="fp-add-tx">เพิ่มบันได</span></button>
              <button type="button" class="fp-rowx" data-rmrow="${escapeAttr(f.id)}|${escapeAttr(r.id)}" title="ลบแถวนี้">ลบแถว</button>
            ` : ''}
          </div>`).join('')}
        ${(o.edit && f.rows.length === 0)
          ? `<p class="muted" style="font-size:.86rem">ชั้นนี้ยังไม่มีแถวห้อง — กด "+ เพิ่มแถว"</p>` : ''}
      </div>`).join('')}
    ${o.edit ? `<button type="button" class="btn btn-outline btn-sm" data-addfloor="1">+ เพิ่มชั้น</button>` : ''}
  </div>`;
}

function statusPill(status){
  const map = {
    pending: ['status-pending','รอหอติดต่อกลับ/ยืนยันนัด'],
    confirmed: ['status-confirmed','ยืนยันแล้ว รอทำสัญญา'],
    cancelled: ['status-cancelled','ยกเลิกการจอง']
  };
  const [cls,label] = map[status] || ['status-pending', status];
  return `<span class="status-pill ${cls}">${label}</span>`;
}

// ปุ่มติดต่อแบบเต็ม (ใช้ในการ์ดด้านข้างของหน้ารายละเอียด) — เรียงเป็นบล็อกกดง่ายบนมือถือ
function contactButtonsBlock(d){
  const btns = [];
  if(d.phone){
    btns.push(`<a class="btn btn-primary btn-block" href="tel:${d.phone}" style="text-align:center;text-decoration:none;display:block">📞 โทร ${d.phone}</a>`);
  }
  if(d.lineId){
    const href = d.lineId.startsWith('http') ? d.lineId : `https://line.me/R/ti/p/~${encodeURIComponent(d.lineId)}`;
    btns.push(`<a class="btn btn-outline btn-block" href="${href}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:block">💬 แชททาง LINE</a>`);
  }
  if(d.contactEmail){
    btns.push(`<a class="btn btn-outline btn-block" href="mailto:${d.contactEmail}" style="text-align:center;text-decoration:none;display:block">✉️ ${d.contactEmail}</a>`);
  }
  if(d.facebook){
    btns.push(`<a class="btn btn-outline btn-block" href="${d.facebook}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none;display:block">📘 เปิดเพจ Facebook</a>`);
  }
  if(btns.length === 0){
    btns.push(`<div class="muted" style="font-size:.86rem;background:var(--sage-bg);border:1px solid var(--line);border-radius:8px;padding:12px">
      ยังไม่มีช่องทางติดต่อในระบบสำหรับหอนี้<br><br>
      สอบถามได้ที่ <strong>สำนักงานบริการที่พักอาศัย มร.ชร.</strong><br>
      <a href="tel:053776273" style="color:var(--forest);font-weight:600">📞 0-5377-6273</a>
    </div>`);
  }
  return btns.join('');
}

// มีช่องทางติดต่อหรือยัง (ใช้แสดงป้ายบนการ์ด)
function hasContact(d){ return !!(d.phone || d.lineId || d.facebook || d.contactEmail); }

function contactButtonsHtml(d){
  const btns = [];
  if(d.phone) btns.push(`<a class="btn btn-outline btn-sm" href="tel:${d.phone}">📞 ${d.phone}</a>`);
  if(d.lineId){
    const lineHref = d.lineId.startsWith('http') ? d.lineId : `https://line.me/R/ti/p/~${encodeURIComponent(d.lineId)}`;
    btns.push(`<a class="btn btn-outline btn-sm" href="${lineHref}" target="_blank" rel="noopener">💬 LINE</a>`);
  }
  if(d.contactEmail) btns.push(`<a class="btn btn-outline btn-sm" href="mailto:${d.contactEmail}">✉️ ${d.contactEmail}</a>`);
  if(d.facebook) btns.push(`<a class="btn btn-outline btn-sm" href="${d.facebook}" target="_blank" rel="noopener">📘 Facebook</a>`);
  if(btns.length === 0) return `<span class="muted" style="font-size:.85rem">ยังไม่มีช่องทางติดต่อ — รอเจ้าของหอยืนยันข้อมูล</span>`;
  return btns.join(' ');
}

function toDormRow(d){
  const row = {
    name: d.name, hall_type: d.hallType,
    gate1: d.gates ? d.gates.gate1 : null, gate2: d.gates ? d.gates.gate2 : null, gate3: d.gates ? d.gates.gate3 : null,
    lat: d.lat, lng: d.lng, facilities: d.facilities, rooms: d.rooms,
    images: d.images, description: d.desc,
    phone: d.phone || null, line_id: d.lineId || null, facebook: d.facebook || null,
    contact_email: d.contactEmail || null
  };
  if(typeof d.verified === 'boolean') row.verified = d.verified;
  if(d.floorPlan) row.floor_plan = normalizeFloorPlan(d.floorPlan);
  if(d.nearby)    row.nearby_places = normalizeNearby(d.nearby);
  return row;
}
function mapDormRow(row){
  return {
    id: row.id, ownerId: row.owner_id, name: row.name, hallType: row.hall_type,
    gates: (row.gate1===null||row.gate1===undefined) ? null
           : { gate1: Number(row.gate1), gate2: Number(row.gate2), gate3: Number(row.gate3) },
    lat: row.lat===null?null:Number(row.lat), lng: row.lng===null?null:Number(row.lng),
    facilities: row.facilities || [], rooms: row.rooms || [],
    images: row.images || [], desc: row.description,
    phone: row.phone || '', lineId: row.line_id || '', facebook: row.facebook || '',
    contactEmail: row.contact_email || '',
    published: row.published !== false,
    reviewNote: row.review_note || '',
    floorPlan: normalizeFloorPlan(row.floor_plan),
    nearby: normalizeNearby(row.nearby_places),
    verified: !!row.verified
  };
}
function mapBookingRow(row){
  return {
    id: row.id, dormId: row.dorm_id, dormName: row.dorm_name, ownerId: row.owner_id,
    roomCode: row.room_code, roomLabel: row.room_label, deposit: Number(row.deposit),
    roomUid: row.room_uid || '', roomNo: row.room_no || '',
    slipUrl: row.slip_url, contactPhone: row.contact_phone || '', note: row.note || '',
    status: row.status,
    visitDate: row.visit_date || '', ownerEmail: row.owner_email || '',
    notifiedAt: row.notified_at ? new Date(row.notified_at).getTime() : null,
    ownerReadAt: row.owner_read_at ? new Date(row.owner_read_at).getTime() : null,
    userId: row.user_id, userName: row.user_name, userEmail: row.user_email,
    createdAt: new Date(row.created_at).getTime()
  };
}

// ---------------------------------------------------------------------------
// Auth / Profile — ทุกฟังก์ชันเช็ค sb ว่างก่อนเสมอ กันหน้าเว็บพังถ้ายังไม่ตั้งค่า
// ---------------------------------------------------------------------------
async function waitForSession(){
  if(!sb) return null;
  try{
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.user : null;
  }catch(err){ console.error(err); return null; }
}
async function getProfile(uid){
  if(!sb) return null;
  const { data, error } = await sb.from('profiles').select('*').eq('id', uid).single();
  if(error || !data) return null;
  return {
    uid: data.id, role: data.role, name: data.name, email: data.email, phone: data.phone,
    sid: data.sid, orgName: data.org_name, approved: data.approved, wishlist: data.wishlist || []
  };
}
async function currentProfile(){
  const user = await waitForSession();
  if(!user) return null;
  return await getProfile(user.id);
}
function requireSupabase(){
  if(!sb) throw new Error('ยังไม่ได้ตั้งค่า Supabase — แก้ SUPABASE_URL/SUPABASE_ANON_KEY ใน db.js ก่อน (ดู SETUP-SUPABASE.md)');
}
async function registerStudent({ name, sid, email, phone, password }){
  requireSupabase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if(error) throw error;
  if(!data.session){
    throw new Error('สมัครสำเร็จแต่ยังไม่ได้ล็อกอินอัตโนมัติ — ต้องปิด "Confirm email" ใน Supabase Auth Settings ก่อน (ดู SETUP-SUPABASE.md)');
  }
  const { error: e2 } = await sb.from('profiles').insert({ id: data.user.id, role:'student', name, sid, email, phone, wishlist: [] });
  if(e2) throw e2;
  return data.user;
}
async function registerOwner({ name, orgName, email, phone, password }){
  requireSupabase();
  const { data, error } = await sb.auth.signUp({ email, password });
  if(error) throw error;
  if(!data.session){
    throw new Error('สมัครสำเร็จแต่ยังไม่ได้ล็อกอินอัตโนมัติ — ต้องปิด "Confirm email" ใน Supabase Auth Settings ก่อน (ดู SETUP-SUPABASE.md)');
  }
  // เจ้าของหอต้องรอผู้ดูแลระบบตรวจสอบก่อนถึงจะแก้ข้อมูลหอได้
  // (เดิมตั้ง approved:true ทันที ทำให้ใครก็ได้สมัครแล้วยึดหอของคนอื่น)
  // หมายเหตุ: ฝั่งฐานข้อมูลมี trigger บังคับ approved = false อยู่แล้วอีกชั้น
  const { error: e2 } = await sb.from('profiles').insert({ id: data.user.id, role:'owner', name, org_name: orgName, email, phone, approved: false });
  if(e2) throw e2;
  return data.user;
}
async function login(email, password){
  requireSupabase();
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if(error) throw error;
  return await getProfile(data.user.id);
}
async function logout(){ if(sb) await sb.auth.signOut(); }

async function toggleWishlist(dormId){
  const user = await waitForSession();
  if(!user) return null;
  const profile = await getProfile(user.id);
  const wishlist = profile.wishlist || [];
  const has = wishlist.includes(dormId);
  const next = has ? wishlist.filter(id=>id!==dormId) : [...wishlist, dormId];
  const { error } = await sb.from('profiles').update({ wishlist: next }).eq('id', user.id);
  if(error) throw error;
  return !has;
}

// ---------------------------------------------------------------------------
// Dorms
// ---------------------------------------------------------------------------
async function getDorms(){
  if(!sb) return [];
  const { data, error } = await sb.from('dorms').select('*');
  if(error) throw error;
  return data.map(mapDormRow);
}
async function getDormById(id){
  if(!sb) return null;
  const { data, error } = await sb.from('dorms').select('*').eq('id', id).single();
  if(error || !data) return null;
  return mapDormRow(data);
}
function watchDorms(callback){
  if(!sb){ callback([]); return () => {}; }
  let active = true;
  const refresh = async ()=>{ if(active){ try{ callback(await getDorms()); }catch(err){ console.error(err); callback([]); } } };
  refresh();
  const channel = sb.channel('dorms-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dorms' }, refresh)
    .subscribe();
  return () => { active = false; sb.removeChannel(channel); };
}
// ---------------------------------------------------------------------------
// ตัวช่วยกันปัญหา "ไฟล์เว็บใหม่ แต่ยังไม่ได้รัน SQL ในฐานข้อมูล"
//
// ถ้าฐานข้อมูลยังไม่มีคอลัมน์ที่โค้ดใหม่ส่งไป Supabase จะตอบว่า
//   Could not find the 'xxx' column of 'dorms' in the schema cache
// แทนที่จะให้บันทึกไม่ผ่านทั้งหมด ให้ตัดเฉพาะคอลัมน์นั้นออกแล้วลองใหม่
// ข้อมูลส่วนที่เหลือจะถูกบันทึกตามปกติ พร้อมเตือนให้ไปรันไฟล์ SQL
// ---------------------------------------------------------------------------
const OPTIONAL_DORM_COLUMNS = {
  contact_email: 'add-contact-email.sql',
  floor_plan:    'fix-v17.sql',
  nearby_places: 'fix-v19.sql'
};

function missingColumnFrom(error){
  const msg = (error && (error.message || error.hint || '')) || '';
  const m = msg.match(/Could not find the '([^']+)' column/i);
  return m ? m[1] : null;
}

async function saveDormRow(row, runQuery){
  let attempt = { ...row };
  for(let i = 0; i < 5; i++){
    const res = await runQuery(attempt);
    if(!res.error) return res;

    const col = missingColumnFrom(res.error);
    if(col && col in attempt && OPTIONAL_DORM_COLUMNS[col]){
      delete attempt[col];
      console.warn(`ฐานข้อมูลยังไม่มีคอลัมน์ "${col}" — ข้ามไปก่อน (ไปรันไฟล์ ${OPTIONAL_DORM_COLUMNS[col]} ใน Supabase SQL Editor)`);
      if(typeof toast === 'function'){
        toast(`บันทึกแล้ว แต่ยังใช้ช่อง "${col}" ไม่ได้ — ต้องรันไฟล์ ${OPTIONAL_DORM_COLUMNS[col]} ใน Supabase ก่อน`, 'error');
      }
      continue;   // ลองใหม่โดยไม่มีคอลัมน์นั้น
    }
    throw res.error;
  }
  throw new Error('บันทึกไม่สำเร็จ');
}

async function addDorm(ownerId, dormData){
  requireSupabase();
  const row = toDormRow(dormData);
  row.owner_id = ownerId;
  const res = await saveDormRow(row, r => sb.from('dorms').insert(r).select().single());
  return res.data.id;
}
async function updateDorm(id, fields){
  requireSupabase();
  const row = toDormRow(fields);
  await saveDormRow(row, r => sb.from('dorms').update(r).eq('id', id));
}
async function deleteDorm(id){
  requireSupabase();
  const { error } = await sb.from('dorms').delete().eq('id', id);
  if(error) throw error;
}

// ---------------------------------------------------------------------------
// อัปโหลดรูปหอพักจากเครื่องของเจ้าของหอ
//
// เก็บไว้ใน Supabase Storage bucket ชื่อ "dorm-photos"
// โครงสร้างไฟล์: dorm-photos/<user-id>/<เวลา>_<สุ่ม>.jpg
// (โฟลเดอร์ชื่อ user-id เพราะ policy ฝั่งฐานข้อมูลใช้ตรวจว่าเป็นโฟลเดอร์ของตัวเอง)
//
// รูปจากมือถือมักใหญ่ 3-6 MB ต่อรูป จึงย่อขนาดในเบราว์เซอร์ก่อนอัปโหลด
// เพื่อให้อัปโหลดเร็วและหน้าเว็บโหลดไว ไม่กินโควตาฟรีของ Supabase
// ---------------------------------------------------------------------------
const DORM_PHOTO_BUCKET = 'dorm-photos';
const MAX_PHOTO_SIDE = 1600;      // ด้านยาวสุดหลังย่อ (พิกเซล)
const PHOTO_QUALITY  = 0.82;      // คุณภาพ JPEG หลังย่อ

// โหลดไฟล์รูปเข้ามาเป็นภาพ (ใช้ createImageBitmap ถ้ามี ไม่มีก็ถอยไปใช้ <img>)
async function loadImageForResize(file){
  if(typeof createImageBitmap === 'function'){
    try{ return await createImageBitmap(file); }catch(e){ /* ถอยไปวิธีสำรอง */ }
  }
  return await new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{ URL.revokeObjectURL(url); resolve(img); };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error('เปิดไฟล์รูปไม่ได้')); };
    img.src = url;
  });
}

// ย่อรูปให้ด้านยาวสุดไม่เกิน MAX_PHOTO_SIDE แล้วคืนเป็น Blob (jpeg)
// ถ้าย่อไม่สำเร็จด้วยเหตุใดก็ตาม จะคืนไฟล์ต้นฉบับไปเลย ดีกว่าอัปโหลดไม่ได้
async function compressImage(file){
  try{
    const img = await loadImageForResize(file);
    const iw = img.width || img.naturalWidth;
    const ih = img.height || img.naturalHeight;
    if(!iw || !ih) return file;
    const scale = Math.min(1, MAX_PHOTO_SIDE / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * scale));
    const h = Math.max(1, Math.round(ih * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(img, 0, 0, w, h);
    if(img.close) img.close();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', PHOTO_QUALITY));
    // ถ้าย่อแล้วดันใหญ่กว่าเดิม (รูปเล็กอยู่แล้ว) ใช้ไฟล์เดิมดีกว่า
    if(!blob) return file;
    return (blob.size < file.size) ? blob : file;
  }catch(err){
    console.warn('ย่อรูปไม่สำเร็จ ใช้ไฟล์ต้นฉบับแทน:', err.message);
    return file;
  }
}

// แปลง error จาก Storage ให้เป็นข้อความที่บอกวิธีแก้ได้จริง
function storageErrorMessage(error){
  const msg = (error && (error.message || error.error || '')) || '';
  if(/bucket not found/i.test(msg) || /404/.test(String(error && error.statusCode))){
    return 'ยังไม่มีที่เก็บรูปในฐานข้อมูล — เปิด Supabase → SQL Editor แล้วรันไฟล์ fix-v15.sql ก่อน แล้วลองใหม่';
  }
  if(/row-level security|not authorized|403/i.test(msg)){
    return 'ไม่มีสิทธิ์อัปโหลดรูป — ตรวจว่าเข้าสู่ระบบด้วยบัญชีเจ้าของหอ และรันไฟล์ fix-v15.sql ใน Supabase แล้ว';
  }
  if(/payload too large|exceeded the maximum|413/i.test(msg)){
    return 'ไฟล์รูปใหญ่เกินไป — ลองใช้รูปที่เล็กลง หรือถ่ายใหม่ด้วยความละเอียดต่ำลง';
  }
  return 'อัปโหลดรูปไม่สำเร็จ: ' + (msg || 'ไม่ทราบสาเหตุ');
}

// อัปโหลดรูปหลายรูปพร้อมกัน คืน array ของลิงก์รูปที่ใช้งานได้
// onProgress(ทำไปแล้วกี่รูป, ทั้งหมดกี่รูป, ชื่อไฟล์ปัจจุบัน)
async function uploadDormImages(files, onProgress){
  requireSupabase();
  const user = await waitForSession();
  if(!user) throw new Error('กรุณาเข้าสู่ระบบก่อนอัปโหลดรูป');

  const list = Array.from(files || []).filter(f => f && /^image\//.test(f.type || ''));
  if(list.length === 0) throw new Error('กรุณาเลือกไฟล์รูปภาพ (jpg, png, webp)');

  const urls = [];
  for(let i = 0; i < list.length; i++){
    const file = list[i];
    if(typeof onProgress === 'function') onProgress(i, list.length, file.name);

    const blob = await compressImage(file);
    const ext  = (blob.type === 'image/jpeg') ? 'jpg'
               : ((file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,4) || 'jpg');
    const path = `${user.id}/${Date.now()}_${i}_${Math.random().toString(36).slice(2,8)}.${ext}`;

    const { error } = await sb.storage.from(DORM_PHOTO_BUCKET)
      .upload(path, blob, { contentType: blob.type || 'image/jpeg', cacheControl:'31536000', upsert:false });
    if(error) throw new Error(storageErrorMessage(error));

    const { data } = sb.storage.from(DORM_PHOTO_BUCKET).getPublicUrl(path);
    urls.push(data.publicUrl);
  }
  if(typeof onProgress === 'function') onProgress(list.length, list.length, '');
  return urls;
}

// รูปนี้เป็นไฟล์ที่เราอัปโหลดเองหรือเป็นลิงก์จากเว็บอื่น
function isUploadedPhoto(url){
  return typeof url === 'string' && url.includes(`/${DORM_PHOTO_BUCKET}/`);
}
// ลบไฟล์รูปออกจากที่เก็บ (เรียกหลังจากเอารูปออกจากหอแล้ว)
// ลบไม่สำเร็จก็ไม่ throw — รูปหลุดค้างในที่เก็บไม่ทำให้หน้าเว็บพัง
async function deleteDormPhoto(url){
  if(!sb || !isUploadedPhoto(url)) return;
  try{
    const path = url.split(`/${DORM_PHOTO_BUCKET}/`).pop().split('?')[0];
    await sb.storage.from(DORM_PHOTO_BUCKET).remove([decodeURIComponent(path)]);
  }catch(err){ console.warn('ลบไฟล์รูปไม่สำเร็จ:', err.message); }
}
// ---------------------------------------------------------------------------
// ผู้ดูแลระบบ: ตั้งแอดมินคนแรกจากหน้าเว็บ (ไม่ต้องเขียน SQL)
// ---------------------------------------------------------------------------
async function adminExists(){
  if(!sb) return true;
  const { data, error } = await sb.rpc('admin_exists');
  if(error){ console.error(error); return true; }
  return !!data;
}
async function canBootstrapAdmin(){
  if(!sb) return false;
  const { data, error } = await sb.rpc('can_bootstrap_admin');
  if(error){ console.error(error); return false; }
  return !!data;
}
async function bootstrapFirstAdmin(){
  requireSupabase();
  const { error } = await sb.rpc('bootstrap_first_admin');
  if(error) throw error;
}
async function grantAdmin(email){
  requireSupabase();
  const { error } = await sb.rpc('grant_admin', { p_email: email });
  if(error) throw error;
}

// ---------------------------------------------------------------------------
// หอพักที่เจ้าของหอส่งเข้ามาใหม่ และยังรอผู้ดูแลระบบตรวจสอบ
// ---------------------------------------------------------------------------
async function getPendingDorms(){
  if(!sb) return [];
  const { data, error } = await sb.from('dorms').select('*')
    .eq('published', false).order('submitted_at', { ascending:true, nullsFirst:false });
  if(error) throw error;
  return data.map(mapDormRow);
}
async function approveDorm(dormId){
  requireSupabase();
  const { error } = await sb.rpc('approve_dorm', { p_dorm_id: dormId });
  if(error) throw error;
}
async function rejectDorm(dormId, reason){
  requireSupabase();
  const { error } = await sb.rpc('reject_dorm', { p_dorm_id: dormId, p_reason: reason || null });
  if(error) throw error;
}

// หมายเหตุ: ระบบ "รับช่วงดูแลหอ" (dorm_claims) ถูกถอดออกจากเว็บแล้ว
// เพราะตอนนี้เจ้าของหอสร้างหอของตัวเองได้เลย ไม่ต้องไปขอรับช่วงหอที่ระบบใส่ไว้ก่อน
// ตารางเดิมในฐานข้อมูลยังอยู่ (ไม่ลบข้อมูลเก่าทิ้ง) แต่ไม่มีหน้าไหนเรียกใช้แล้ว


// ---------------------------------------------------------------------------
// รีวิวจากผู้ใช้
//
// 1 คน รีวิวได้ 1 ครั้งต่อ 1 หอ — เขียนซ้ำ = แก้ไขรีวิวเดิมของตัวเอง
// เจ้าของหอรีวิวหอของตัวเองไม่ได้ (ฝั่งฐานข้อมูลกันไว้อีกชั้น)
// ต้องรันไฟล์ fix-v15.sql ใน Supabase ก่อน ถึงจะมีตาราง reviews
// ---------------------------------------------------------------------------
function mapReviewRow(r){
  return {
    id: r.id, dormId: r.dorm_id, userId: r.user_id,
    userName: r.user_name || 'ผู้ใช้ DormCRU',
    rating: Number(r.rating) || 0, body: r.body || '',
    createdAt: new Date(r.created_at).getTime(),
    updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : null
  };
}

// ตรวจว่า error คือ "ยังไม่มีตารางนี้ในฐานข้อมูล" (ยังไม่ได้รันไฟล์ SQL)
function isMissingTable(error){
  if(!error) return false;
  const msg = error.message || '';
  return error.code === '42P01' || error.code === 'PGRST205' ||
         /relation .* does not exist|Could not find the table/i.test(msg);
}

// รีวิวทั้งหมดของหอหนึ่งหอ (ใหม่สุดขึ้นก่อน)
// ถ้ายังไม่ได้รัน SQL จะคืน [] เฉย ๆ ไม่ทำให้หน้ารายละเอียดหอพัง
async function getReviews(dormId){
  if(!sb || !dormId) return [];
  const { data, error } = await sb.from('reviews').select('*')
    .eq('dorm_id', dormId).order('created_at', { ascending:false });
  if(error){
    if(isMissingTable(error)){
      console.warn('ยังไม่มีตาราง reviews — ไปรันไฟล์ fix-v15.sql ใน Supabase SQL Editor');
      return [];
    }
    throw error;
  }
  return data.map(mapReviewRow);
}

// สรุปคะแนน: {count, avg, dist:{5:n,4:n,...}}
function ratingSummary(reviews){
  const list = reviews || [];
  const dist = {1:0,2:0,3:0,4:0,5:0};
  let sum = 0;
  list.forEach(r=>{ if(dist[r.rating] !== undefined) dist[r.rating]++; sum += r.rating; });
  return {
    count: list.length,
    avg: list.length ? Math.round((sum / list.length) * 10) / 10 : 0,
    dist
  };
}

// เขียนหรือแก้ไขรีวิวของตัวเอง (upsert ตามคู่ dorm_id + user_id)
async function saveReview({ dormId, rating, body }){
  requireSupabase();
  const user = await waitForSession();
  if(!user) throw new Error('กรุณาเข้าสู่ระบบก่อนเขียนรีวิว');
  const stars = Math.round(Number(rating));
  if(!(stars >= 1 && stars <= 5)) throw new Error('กรุณาให้คะแนน 1-5 ดาว');

  const { error } = await sb.from('reviews')
    .upsert({ dorm_id: dormId, user_id: user.id, rating: stars, body: (body||'').trim() },
            { onConflict: 'dorm_id,user_id' });

  if(error){
    if(isMissingTable(error)){
      throw new Error('ยังไม่มีระบบรีวิวในฐานข้อมูล — เปิด Supabase → SQL Editor แล้วรันไฟล์ fix-v15.sql ก่อน');
    }
    if(/row-level security/i.test(error.message||'')){
      throw new Error('เขียนรีวิวไม่ได้ — เจ้าของหอรีวิวหอของตัวเองไม่ได้');
    }
    throw error;
  }
}

// ลบรีวิว (ของตัวเอง หรือผู้ดูแลระบบลบรีวิวไม่เหมาะสม)
async function deleteReview(reviewId){
  requireSupabase();
  const { error } = await sb.from('reviews').delete().eq('id', reviewId);
  if(error) throw error;
}

// รีวิวของหอหลายหอพร้อมกัน — ใช้ตอนแสดงดาวบนการ์ดรายการหอ
// คืน Map: dormId -> {count, avg}
async function getRatingsForDorms(dormIds){
  const out = {};
  if(!sb || !dormIds || !dormIds.length) return out;
  const { data, error } = await sb.from('reviews').select('dorm_id, rating').in('dorm_id', dormIds);
  if(error){
    if(isMissingTable(error)) return out;
    console.error(error);
    return out;
  }
  data.forEach(r=>{
    const k = r.dorm_id;
    if(!out[k]) out[k] = { count:0, sum:0, avg:0 };
    out[k].count++; out[k].sum += Number(r.rating) || 0;
  });
  Object.keys(out).forEach(k=>{
    out[k].avg = Math.round((out[k].sum / out[k].count) * 10) / 10;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------
async function uploadSlip(uid, file){
  requireSupabase();
  const path = `${uid}/${Date.now()}_${file.name}`;
  const { error } = await sb.storage.from('slips').upload(path, file);
  if(error) throw error;
  const { data } = sb.storage.from('slips').getPublicUrl(path);
  return data.publicUrl;
}
// สร้างคำขอจอง แล้วคืนแถวที่เพิ่งสร้าง (ต้องได้ id กลับมาเพื่อส่งต่อให้ระบบอีเมล)
async function createBooking({ dorm, roomCode, roomLabel, deposit, slipUrl, contactPhone, note, visitDate, roomUid, user, profile }){
  requireSupabase();
  if(!dorm.ownerId) throw new Error('หอพักนี้ยังไม่มีเจ้าของหอในระบบ จึงยังจองผ่านเว็บไม่ได้');

  // ขออีเมลเจ้าของหอจากฐานข้อมูล (ฟังก์ชันนี้คืนเฉพาะอีเมลของเจ้าของหอนั้นเท่านั้น)
  let ownerEmail = null;
  try{
    const { data } = await sb.rpc('dorm_owner_email', { p_dorm_id: dorm.id });
    ownerEmail = data || null;
  }catch(err){ console.error('ดึงอีเมลเจ้าของหอไม่สำเร็จ:', err); }

  const { data, error } = await sb.from('bookings').insert({
    dorm_id: dorm.id, dorm_name: dorm.name, owner_id: dorm.ownerId,
    room_code: roomCode || null, room_label: roomLabel || null, deposit: deposit || 0,
    slip_url: slipUrl || null, contact_phone: contactPhone || null, note: note || null,
    visit_date: visitDate || null, owner_email: ownerEmail,
    status: 'pending', user_id: user.id, user_name: profile.name, user_email: profile.email
  }).select().single();
  if(error) throw error;

  // ถ้าเลือกห้องเจาะจงจากผังห้องพัก ให้จองช่องห้องนั้นไว้ด้วย (ห้องจะเปลี่ยนเป็นสีแดง)
  // ทำหลังจากสร้างใบจองแล้ว เพราะฟังก์ชันฝั่งฐานข้อมูลต้องอ้างอิงเลขที่ใบจอง
  if(roomUid){
    try{
      await reserveRoomUnit(data.id, roomUid);
    }catch(err){
      // จองช่องห้องไม่สำเร็จ (เช่น มีคนตัดหน้าไปแล้ว) — ยกเลิกใบจองที่เพิ่งสร้าง
      // ไม่งั้นนักศึกษาจะได้ใบจองที่ไม่ผูกกับห้องไหนเลย
      try{ await sb.from('bookings').update({ status:'cancelled' }).eq('id', data.id); }catch(e){ console.error(e); }
      throw err;
    }
  }
  return mapBookingRow(data);
}

// จองช่องห้องเจาะจงในผัง — ฝั่งฐานข้อมูลจะกันไม่ให้จองห้องที่ไม่ว่าง
async function reserveRoomUnit(bookingId, cellId){
  const { error } = await sb.rpc('book_room_unit', { p_booking_id: bookingId, p_cell_id: cellId });
  if(!error) return;
  if(isMissingFunction(error)){
    console.warn('ยังไม่มีฟังก์ชัน book_room_unit — ไปรันไฟล์ fix-v17.sql ใน Supabase');
    return;   // ยังจองได้ตามปกติ แค่ผังห้องไม่เปลี่ยนสี
  }
  throw error;
}

// ---------------------------------------------------------------------------
// แจ้งเตือนเจ้าของหอทางอีเมล — ยิงไปที่ Vercel Serverless Function /api/notify-booking
// ถ้ายังไม่ได้ตั้งค่าอีเมล (หรือรันแบบเปิดไฟล์ตรง ๆ) จะคืน {ok:false} เฉย ๆ
// ไม่ throw error เพราะการจองต้องสำเร็จอยู่ดี แม้เมลจะส่งไม่ออก
// ---------------------------------------------------------------------------
async function notifyOwnerByEmail(bookingId){
  try{
    const { data } = await sb.auth.getSession();
    const token = data.session ? data.session.access_token : null;
    if(!token) return { ok:false, reason:'no-session' };

    const res = await fetch('/api/notify-booking', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
      body: JSON.stringify({ bookingId })
    });
    if(!res.ok){
      const txt = await res.text();
      console.warn('ส่งอีเมลแจ้งเจ้าของหอไม่สำเร็จ:', res.status, txt);
      return { ok:false, reason:'http-'+res.status };
    }
    return await res.json();
  }catch(err){
    console.warn('เรียก /api/notify-booking ไม่สำเร็จ (ยังไม่ได้ตั้งค่าอีเมลหรือรันนอก Vercel):', err.message);
    return { ok:false, reason:'network' };
  }
}

// ส่งอีเมลทดสอบไปยังอีเมลรับแจ้งเตือนของหอ (ใช้จากหลังบ้าน)
async function sendTestNotifyEmail(dormId, channel){
  const { data } = await sb.auth.getSession();
  const token = data.session ? data.session.access_token : null;
  if(!token) throw new Error('กรุณาเข้าสู่ระบบใหม่');
  const res = await fetch('/api/notify-booking', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'Authorization':'Bearer ' + token },
    body: JSON.stringify({ testDormId: dormId, channel: channel || 'email' })
  });
  const text = await res.text();
  try{ return JSON.parse(text); }
  catch(e){
    // ตอบกลับมาไม่ใช่ JSON = ไปไม่ถึงฟังก์ชัน บอกสาเหตุตามรหัสสถานะจริง
    let reason;
    if(res.status === 404){
      reason = 'หาไฟล์ /api/notify-booking ไม่เจอ (404) — ตรวจว่าโฟลเดอร์ api/ อยู่ที่ระดับบนสุดของโปรเจกต์ใน Vercel แล้ว Redeploy';
    }else if(res.status === 405){
      reason = 'เส้นทาง /api ทำงานแล้ว แต่ถูกเสิร์ฟเป็นไฟล์สถิต ไม่ใช่ฟังก์ชัน (405) — ตรวจการตั้งค่า Output Directory ใน Vercel';
    }else if(res.status >= 500){
      reason = `ฟังก์ชันฝั่งเซิร์ฟเวอร์ error (${res.status}) — เปิด Vercel -> โปรเจกต์ -> Logs เพื่อดูรายละเอียด`;
    }else if(location.protocol === 'file:'){
      reason = 'กำลังเปิดไฟล์จากเครื่องโดยตรง ไม่ได้ผ่านเซิร์ฟเวอร์ — ระบบอีเมลทดสอบได้เฉพาะบนเว็บที่ deploy บน Vercel แล้ว';
    }else{
      reason = `เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ (HTTP ${res.status})`;
    }
    console.warn('notify-booking ตอบกลับ:', res.status, text.slice(0, 200));
    return { ok:false, reason, httpStatus: res.status, raw: text.slice(0, 200) };
  }
}

// คำขอจองที่เจ้าของหอยังไม่ได้เปิดอ่าน (ใช้แสดงจุดแดงบนเมนูหลังบ้าน)
async function getUnreadBookingCount(ownerId){
  if(!sb || !ownerId) return 0;
  const { count, error } = await sb.from('bookings')
    .select('id', { count:'exact', head:true })
    .eq('owner_id', ownerId).eq('status','pending').is('owner_read_at', null);
  if(error){ console.error(error); return 0; }
  return count || 0;
}

// ทำเครื่องหมายว่าเจ้าของหอเปิดอ่านคำขอจองแล้ว
async function markBookingsRead(ownerId){
  if(!sb || !ownerId) return;
  await sb.from('bookings').update({ owner_read_at: new Date().toISOString() })
    .eq('owner_id', ownerId).is('owner_read_at', null);
}

// ติดตามคำขอจองใหม่แบบเรียลไทม์ (ฝั่งเจ้าของหอ)
function watchBookings(ownerId, callback){
  if(!sb || !ownerId){ callback([]); return ()=>{}; }
  let active = true;
  const refresh = async ()=>{
    if(!active) return;
    try{ callback(await getBookingsForOwner(ownerId)); }catch(err){ console.error(err); }
  };
  refresh();
  const ch = sb.channel('bookings-' + ownerId)
    .on('postgres_changes', { event:'*', schema:'public', table:'bookings',
        filter:`owner_id=eq.${ownerId}` }, refresh)
    .subscribe();
  return ()=>{ active = false; sb.removeChannel(ch); };
}
async function getMyBookings(uid){
  if(!sb) return [];
  const { data, error } = await sb.from('bookings').select('*').eq('user_id', uid).order('created_at', { ascending:false });
  if(error) throw error;
  return data.map(mapBookingRow);
}
async function getAllBookings(){
  if(!sb) return [];
  const { data, error } = await sb.from('bookings').select('*').order('created_at', { ascending:false });
  if(error) throw error;
  return data.map(mapBookingRow);
}
async function getBookingsForOwner(ownerId){
  if(!sb) return [];
  const { data, error } = await sb.from('bookings').select('*').eq('owner_id', ownerId).order('created_at', { ascending:false });
  if(error) throw error;
  return data.map(mapBookingRow);
}
// ตรวจว่า error ที่ได้คือ "ยังไม่มีฟังก์ชันนี้ในฐานข้อมูล" (ยังไม่ได้รันไฟล์ SQL)
function isMissingFunction(error){
  if(!error) return false;
  return error.code === 'PGRST202' || /Could not find the function/i.test(error.message || '');
}

// นักศึกษายกเลิกการจองของตัวเอง — ยกเลิกได้ทั้งที่ยังรอหอตอบ และที่หอยืนยันไปแล้ว
// (ถ้าหอยืนยันไปแล้ว ฝั่งฐานข้อมูลจะคืนจำนวนห้องว่างให้หออัตโนมัติ)
async function cancelMyBooking(bookingId){
  requireSupabase();

  const { error } = await sb.rpc('cancel_my_booking', { p_booking_id: bookingId });
  if(!error) return;
  if(!isMissingFunction(error)) throw error;

  // ---- วิธีสำรอง: ฐานข้อมูลยังไม่ได้รันไฟล์ fix-open-listing.sql ----
  // การจองที่ "ยังรอหอตอบ" ยกเลิกด้วยวิธีนี้ได้ผลถูกต้อง เพราะยังไม่เคยหักห้องว่าง
  // ส่วนการจองที่ "หอยืนยันแล้ว" ต้องใช้ฟังก์ชันเท่านั้น ไม่งั้นห้องว่างจะไม่ถูกคืน
  console.warn('ยังไม่มีฟังก์ชัน cancel_my_booking ในฐานข้อมูล — ใช้วิธีสำรอง (ควรไปรันไฟล์ fix-open-listing.sql ใน Supabase)');

  const user = await waitForSession();
  if(!user) throw new Error('กรุณาเข้าสู่ระบบก่อน');

  const { data, error: e2 } = await sb.from('bookings')
    .update({ status: 'cancelled' })
    .eq('id', bookingId).eq('user_id', user.id)
    .select('id');

  if(e2 || !data || data.length === 0){
    throw new Error(
      'ยกเลิกไม่สำเร็จ — ฐานข้อมูลยังไม่ได้อัปเดต\n' +
      'กรุณาเปิด Supabase → SQL Editor แล้วรันไฟล์ fix-open-listing.sql ก่อน ' +
      '(การจองที่หอยืนยันแล้วต้องใช้ไฟล์นี้เพื่อคืนห้องว่างให้หอ)'
    );
  }
}

async function updateBookingStatus(bookingId, status){
  requireSupabase();
  if(status === 'confirmed'){
    const { error } = await sb.rpc('confirm_booking', { p_booking_id: bookingId, p_new_status: status });
    if(error) throw error;
  }else{
    const { error } = await sb.from('bookings').update({ status }).eq('id', bookingId);
    if(error) throw error;
  }
}

// ---------------------------------------------------------------------------
// ระบบแชท นักศึกษา <-> เจ้าของหอพัก
// ห้องแชทหนึ่งห้อง = คู่ของ (หอพัก, นักศึกษา) — นักศึกษาคุยกับแต่ละหอแยกห้องกัน
// ---------------------------------------------------------------------------

// หมายเหตุ: ฟังก์ชันแชทหลัก (canChat, sendMessage, getThread, watchThread,
// markThreadRead) อยู่ในหมวด "ระบบแชท" ด้านล่างของไฟล์นี้เพียงชุดเดียว
// เพื่อไม่ให้นิยามซ้ำกันแล้วทับกันเองจนพฤติกรรมเพี้ยน

// รายการห้องแชททั้งหมดของฉัน (ใช้ได้ทั้งฝั่งนักศึกษาและฝั่งเจ้าของหอ — RLS กรองให้เองแล้ว)
async function getMyThreads(){
  if(!sb) return [];
  const user = await waitForSession();
  if(!user) return [];
  const { data, error } = await sb.from('messages').select('*')
    .order('created_at', { ascending: false });
  if(error) throw error;

  const map = new Map();
  data.forEach(m=>{
    const key = m.dorm_id + '|' + m.student_id;
    if(!map.has(key)){
      map.set(key, {
        key, dormId: m.dorm_id, dormName: m.dorm_name,
        studentId: m.student_id, studentName: m.student_name,
        ownerId: m.owner_id,
        lastBody: m.body, lastAt: new Date(m.created_at).getTime(),
        lastSenderId: m.sender_id, unread: 0
      });
    }
    // นับข้อความที่ "คนอื่นส่งมา" และยังไม่ได้อ่าน
    if(!m.read_at && m.sender_id !== user.id) map.get(key).unread++;
  });
  return Array.from(map.values()).sort((a,b)=> b.lastAt - a.lastAt);
}

// จำนวนข้อความที่ยังไม่ได้อ่านทั้งหมด (ใช้แสดงจุดแดงบนเมนู)
async function getUnreadCount(){
  if(!sb) return 0;
  const user = await waitForSession();
  if(!user) return 0;
  const { count, error } = await sb.from('messages')
    .select('id', { count:'exact', head:true })
    .is('read_at', null).neq('sender_id', user.id);
  if(error){ console.error(error); return 0; }
  return count || 0;
}

// ---------------------------------------------------------------------------
// Owners (สำหรับแอดมินอนุมัติ)
// ---------------------------------------------------------------------------
async function getPendingOwners(){
  if(!sb) return [];
  const { data, error } = await sb.from('profiles').select('*').eq('role','owner').eq('approved', false);
  if(error) throw error;
  return data.map(p=>({ uid: p.id, name:p.name, orgName:p.org_name, email:p.email, phone:p.phone, approved:p.approved }));
}
async function getAllOwners(){
  if(!sb) return [];
  const { data, error } = await sb.from('profiles').select('*').eq('role','owner');
  if(error) throw error;
  return data.map(p=>({ uid: p.id, name:p.name, orgName:p.org_name, email:p.email, phone:p.phone, approved:p.approved }));
}
async function approveOwner(uid){
  requireSupabase();
  const { error } = await sb.from('profiles').update({ approved: true }).eq('id', uid);
  if(error) throw error;
}

// ---------------------------------------------------------------------------
// ระบบแชท นักศึกษา <-> เจ้าของหอพัก
// "ห้องแชท" 1 ห้อง = คู่ (หอพัก 1 แห่ง + นักศึกษา 1 คน)
// ---------------------------------------------------------------------------

// หอนี้แชทได้ไหม — ต้องมีเจ้าของหอในระบบก่อน (หอที่ยังไม่มีใครรับช่วงดูแลจะแชทไม่ได้)
function canChat(dorm){ return !!(dorm && dorm.ownerId); }

function mapMessageRow(r){
  // senderRole: ถ้าฐานข้อมูลไม่มีคอลัมน์นี้ (สคีมาเวอร์ชันเก่า) ให้เดาจาก id แทน
  // จะได้ไม่ต้องพึ่งคอลัมน์ sender_role เลย เว็บทำงานได้กับสคีมาทั้งสองแบบ
  const role = r.sender_role || ((r.owner_id && r.sender_id === r.owner_id) ? 'owner' : 'student');
  return {
    id: r.id, dormId: r.dorm_id, dormName: r.dorm_name,
    studentId: r.student_id, studentName: r.student_name, ownerId: r.owner_id,
    senderId: r.sender_id, senderRole: role, body: r.body,
    readAt: r.read_at, createdAt: new Date(r.created_at).getTime()
  };
}

// ดึงข้อความทั้งหมดในห้องแชทหนึ่งห้อง
async function getThread(dormId, studentId){
  if(!sb) return [];
  const { data, error } = await sb.from('messages').select('*')
    .eq('dorm_id', dormId).eq('student_id', studentId)
    .order('created_at', { ascending: true });
  if(error) throw error;
  return data.map(mapMessageRow);
}

// ส่งข้อความ
// *** ไม่ส่งคอลัมน์ sender_role ไปด้วยแล้ว *** — เพราะฐานข้อมูลบางเวอร์ชันไม่มีคอลัมน์นี้
// (เป็นที่มาของ error "Could not find the 'sender_role' column of 'messages'")
// ฝั่งฐานข้อมูลมี trigger เติมค่าให้เองแล้วหลังรันไฟล์ fix-chat-booking.sql
async function sendMessage({ dorm, studentId, studentName, body, profile }){
  requireSupabase();
  const text = (body||'').trim();
  if(!text) return;
  if(!dorm.ownerId) throw new Error('หอพักนี้ยังไม่มีเจ้าของในระบบ จึงยังแชทไม่ได้');

  const user = await waitForSession();
  if(!user) throw new Error('กรุณาเข้าสู่ระบบก่อนส่งข้อความ');

  const { error } = await sb.from('messages').insert({
    dorm_id: dorm.id, dorm_name: dorm.name,
    student_id: studentId, student_name: studentName || (profile && profile.name) || '',
    owner_id: dorm.ownerId,
    sender_id: user.id,          // ต้องตรงกับ auth.uid() ไม่งั้น RLS จะปฏิเสธ
    body: text
  });
  if(error) throw error;
}

// ฟังข้อความใหม่แบบเรียลไทม์ในห้องแชท คืนฟังก์ชันสำหรับยกเลิกการฟัง
function watchThread(dormId, studentId, callback){
  if(!sb){ callback([]); return ()=>{}; }
  let active = true;
  const refresh = async ()=>{
    if(!active) return;
    try{ callback(await getThread(dormId, studentId)); }
    catch(err){ console.error(err); }
  };
  refresh();
  const ch = sb.channel('thread-' + dormId + '-' + studentId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages',
        filter: `dorm_id=eq.${dormId}` }, refresh)
    .subscribe();
  return ()=>{ active = false; sb.removeChannel(ch); };
}

// ทำเครื่องหมายว่าอ่านข้อความของอีกฝ่ายแล้ว
// (myRole ไม่ได้ใช้แล้ว แต่คงพารามิเตอร์ไว้เพื่อไม่ให้โค้ดเดิมที่เรียกอยู่พัง)
async function markThreadRead(dormId, studentId, myRole){
  if(!sb) return;
  const user = await waitForSession();
  if(!user) return;
  // อ่านแล้ว = ข้อความในห้องนี้ที่ "คนอื่นเป็นคนส่ง" และยังไม่ถูกทำเครื่องหมาย
  await sb.from('messages').update({ read_at: new Date().toISOString() })
    .eq('dorm_id', dormId).eq('student_id', studentId)
    .neq('sender_id', user.id).is('read_at', null);
}

// รายการห้องแชทของฉัน (รวมข้อความล่าสุด + จำนวนที่ยังไม่ได้อ่าน)
async function getMyConversations(profile){
  if(!sb || !profile) return [];
  const col = (profile.role === 'student') ? 'student_id' : 'owner_id';
  const { data, error } = await sb.from('messages').select('*')
    .eq(col, profile.uid).order('created_at', { ascending: false });
  if(error) throw error;

  const threads = new Map();
  data.map(mapMessageRow).forEach(m=>{
    const key = m.dormId + '|' + m.studentId;
    if(!threads.has(key)){
      threads.set(key, {
        key, dormId: m.dormId, dormName: m.dormName,
        studentId: m.studentId, studentName: m.studentName, ownerId: m.ownerId,
        lastBody: m.body, lastAt: m.createdAt, unread: 0
      });
    }
    // นับข้อความที่อีกฝ่ายส่งมาและเรายังไม่ได้อ่าน (เทียบจาก id คนส่ง ไม่พึ่ง sender_role)
    if(m.senderId !== profile.uid && !m.readAt) threads.get(key).unread++;
  });
  return Array.from(threads.values()).sort((a,b)=> b.lastAt - a.lastAt);
}

// จำนวนข้อความที่ยังไม่ได้อ่านทั้งหมด (ใช้แสดงจุดแดงบนเมนู)
async function getUnreadTotal(profile){
  if(!sb || !profile) return 0;
  const col = (profile.role === 'student') ? 'student_id' : 'owner_id';
  const { count, error } = await sb.from('messages')
    .select('id', { count: 'exact', head: true })
    .eq(col, profile.uid).neq('sender_id', profile.uid).is('read_at', null);
  if(error){ console.error(error); return 0; }
  return count || 0;
}

function fmtChatTime(ts){
  const d = new Date(ts), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const t = d.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
  return sameDay ? t : d.toLocaleDateString('th-TH', { day:'numeric', month:'short' }) + ' ' + t;
}
