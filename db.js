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
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlla2NzbmNudnBkdG9taGVoeGx3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQwMTEwNTksImV4cCI6MjA5OTU4NzA1OX0.YLhNpTHffj4mqnwcBJ-MqJ7Ist0JGv_mtQwHHwTDYAA";

function isSupabaseConfigured(){
  return !SUPABASE_URL.includes('YOUR_PROJECT') && !SUPABASE_ANON_KEY.includes('YOUR_ANON');
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
  phone: '',                                  // เช่น '081-234-5678'
  line: '',                                   // LINE ID เช่น '@dormcru' หรือลิงก์เต็ม https://line.me/...
  facebook: ''                                // ลิงก์เพจ เช่น 'https://facebook.com/dormcru'
};
function siteContactHtml(){
  const btns = [];
  if(SITE_CONTACT.phone) btns.push(`<a href="tel:${SITE_CONTACT.phone}" style="color:inherit">📞 ${SITE_CONTACT.phone}</a>`);
  if(SITE_CONTACT.line){
    const href = SITE_CONTACT.line.startsWith('http') ? SITE_CONTACT.line : `https://line.me/R/ti/p/~${encodeURIComponent(SITE_CONTACT.line)}`;
    btns.push(`<a href="${href}" target="_blank" rel="noopener" style="color:inherit">💬 LINE: ${SITE_CONTACT.line}</a>`);
  }
  if(SITE_CONTACT.facebook) btns.push(`<a href="${SITE_CONTACT.facebook}" target="_blank" rel="noopener" style="color:inherit">📘 Facebook</a>`);
  return btns.join(' &nbsp;·&nbsp; ');
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
      banner.innerHTML = '⚠️ ยังไม่ได้เชื่อมต่อฐานข้อมูล Supabase (หรือเชื่อมต่อไม่สำเร็จ) — ฟีเจอร์ล็อคอิน/จอง/แก้ไขข้อมูลจะยังใช้ไม่ได้ ดูวิธีตั้งค่าในไฟล์ <strong>SETUP-SUPABASE.md</strong>';
    }
  }
  return ok;
}

const CRRU_GATE = {
  gate1: { lat: 19.9074, lng: 99.8230, label: 'ประตู 1 (ทางเข้าหลัก)' },
  gate2: { lat: 19.9101, lng: 99.8199, label: 'ประตู 2' },
  gate3: { lat: 19.9057, lng: 99.8213, label: 'ประตู 3' }
};

const FACILITY_META = {
  wifi: { icon:'📶', label:'Wi-Fi ฟรี' },
  parking: { icon:'🛵', label:'ที่จอดรถ' },
  laundry: { icon:'🧺', label:'ซักผ้าหยอดเหรียญ' },
  keycard: { icon:'🔑', label:'คีย์การ์ด' },
  cctv: { icon:'📷', label:'กล้องวงจรปิด' },
  guard: { icon:'🛡️', label:'รปภ. 24 ชม.' }
};

const ROOM_PHOTOS = [1034584,2416932,2416933,8251681,1454806,7055757,15792555,8251695,5858236,164595,6782344,5858228,5858234];
const EXTERIOR_PHOTOS = [33619255, 19390169, 14121007, 33619257];
function pexelsUrl(id){ return `https://images.pexels.com/photos/${id}/pexels-photo-${id}.jpeg?auto=compress&cs=tinysrgb&w=900`; }
function roomImgSet(i){
  const a = ROOM_PHOTOS[i % ROOM_PHOTOS.length];
  const b = ROOM_PHOTOS[(i + 5) % ROOM_PHOTOS.length];
  const c = EXTERIOR_PHOTOS[i % EXTERIOR_PHOTOS.length];
  return [pexelsUrl(a), pexelsUrl(b), pexelsUrl(c)];
}
// ---------------------------------------------------------------------------
// ข้อมูลหอพักตั้งต้น: รายชื่อ "หอพักเครือข่าย" ทางการทั้งหมด 61 หอ จากเว็บไซต์
// สำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย
// แหล่งข้อมูล: https://aso.crru.ac.th/asoblog/dormnetwork
//
// เว็บต้นทางให้เฉพาะ ชื่อหอ / ประเภทหอ (ชาย-หญิง) / ลิงก์ Facebook (บางหอ) เท่านั้น
// ***ไม่มี ราคา จำนวนห้องว่าง ระยะทางจากประตู เบอร์โทร*** — ระบบจึงเว้นไว้เป็น "ยังไม่ระบุ"
// ให้เจ้าของหอเข้ามากรอกเอง (เมนู "รับช่วงดูแลหอของฉัน" ในหลังบ้าน) แทนการเดาตัวเลข
// ---------------------------------------------------------------------------
const SEED_DORMS_RAW = [
  { name:"ทริปเปิลพี", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100009134251032", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"ภูชมดาว", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100012000224471", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"PPSP", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"ธนณัฐ", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100006856248956", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"อภิสรา", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/1455613048023448/", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"เงินยวง", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100024388698688", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"ไทเสรีปาร์ค", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/pages/251804134878673", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"บ้านน้ำอุ่น", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"ชยานีคอร์ท", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/chayaneecourt", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"เทียมจันทร์", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/599661180135782/", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"จ่าพันธ์ศักดิ์ 2", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"แอลเอ", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/ppech.la", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"น้ำอินทร์", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/pages/420211831355174", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"อรวรรณ", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/ratana.rakpanale", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"แฮปปี้โฮมคอร์ท", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100004807893321", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"รักษา", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100016663201133", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"ภัทรวดี", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100004715538790", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"ณิชชาพัชร์", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"ศุภาพร", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"สุดารัตน์", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100012848528545", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"รัตนาวดี 1", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/rattanavadee2/", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"รัตนาวดี 2", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"สองปั้น", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/1481698028712243/", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"วัฒนา", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"วัฒนา 2", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"บ้านฝ้าย", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100009741480531", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"บ้านแสนสบาย", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"พลอยชมภู", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/ploy.chompoo.313", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"บุษราคัม", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"บุษราคัม 2", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"อภิญษยา 1", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100092527032637", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"อภิญษยา 2", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100092527032637", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"ศุภญา", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/supaya240/", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"บ้าน 235", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"สตรีศรีวรรณ", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"สุขสถิตย์", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"จตุพร", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"ทิพากร", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"พีเจเพลส", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"แก้วตา", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/profile.php?id=100006143896462", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"เพชรพลอย", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"https://www.facebook.com/160190551305126/", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"สตรีวันทนีย์", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"นิลักษณ์", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"บ้านสวนนภา", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"อัจจุดา", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"สมพร", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"วิจักขณาภรณ์ 2", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"พชรวรรณ", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"ยามาโตะ", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"เจริญรัตน์ 3", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"พิศมัย", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"มณีจันทร์สุข", hallType:"หอชายล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"อารีรัตน์", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"", category:"เครือข่าย", desc:"หอพักเครือข่ายที่ขึ้นทะเบียนกับสำนักงานบริการที่พักอาศัย กองพัฒนานักศึกษา มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ราคา ห้องว่าง ระยะทาง และเบอร์ติดต่อ รอเจ้าของหอเข้ามากรอกข้อมูล" },
  { name:"UniHouse-Single", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"053-776273", category:"บุคลากร", desc:"หอพักบุคลากร มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ติดต่อสำนักงานบริการที่พักอาศัย โทร. 0-5377-6273" },
  { name:"UniHouse-Family", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"053-776273", category:"บุคลากร", desc:"หอพักบุคลากร มหาวิทยาลัยราชภัฏเชียงราย (สถานะ: ให้บริการ) — ติดต่อสำนักงานบริการที่พักอาศัย โทร. 0-5377-6273" },
  { name:"Uni-dorm 1", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"053-776273", category:"หอใน", desc:"หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273" },
  { name:"Uni-dorm 2", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"053-776273", category:"หอใน", desc:"หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273" },
  { name:"Uni-dorm 3", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"053-776273", category:"หอใน", desc:"หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273" },
  { name:"Uni-dorm 4", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"053-776273", category:"หอใน", desc:"หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273" },
  { name:"Uni-dorm 5", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"053-776273", category:"หอใน", desc:"หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273" },
  { name:"Uni-dorm 6", hallType:"หอหญิงล้วน", gates:null, lat:null, lng:null, facilities:[], rooms:[], facebook:"", phone:"053-776273", category:"หอใน", desc:"หอพักในมหาวิทยาลัยราชภัฏเชียงราย (Uni-dorm) — จองผ่านระบบหอพักนักศึกษาที่ https://otim.crru.ac.th/unidorm หรือติดต่อ โทร. 0-5377-6273" }
];

function nearestGate(dorm){
  if(!dorm.gates) return null;
  let best = 'gate1';
  Object.keys(dorm.gates).forEach(g=>{ if(dorm.gates[g] < dorm.gates[best]) best = g; });
  return best;
}
function totalVacancy(dorm){ return (dorm.rooms||[]).reduce((s,r)=>s+r.vacant,0); }
// คืน null เมื่อยังไม่มีข้อมูลราคา (หอที่เจ้าของยังไม่เข้ามากรอก) — อย่าคืนตัวเลขมั่ว
function minPrice(dorm){
  if(!dorm.rooms || dorm.rooms.length===0) return null;
  return Math.min(...dorm.rooms.map(r=>r.price));
}
function hasPrice(dorm){ return minPrice(dorm) !== null; }
function hasGates(dorm){ return !!dorm.gates && dorm.gates.gate1 !== null && dorm.gates.gate1 !== undefined; }
function priceLabel(dorm){ return hasPrice(dorm) ? fmtBaht(minPrice(dorm)) + ' <small>บาท/เดือน เริ่มต้น</small>' : '<small class="muted">สอบถามราคากับหอโดยตรง</small>'; }
function fmtBaht(n){ return Number(n).toLocaleString('th-TH'); }
function mapEmbedUrl(lat, lng){ return `https://maps.google.com/maps?q=${lat},${lng}&z=16&output=embed`; }
function facilityIcons(codes){
  return (codes||[]).map(c => FACILITY_META[c] ? `<span title="${FACILITY_META[c].label}">${FACILITY_META[c].icon}</span>` : '').join(' ');
}
function amenityGridHtml(codes){
  return (codes||[]).map(c=>{
    const m = FACILITY_META[c];
    if(!m) return '';
    return `<div class="amenity"><span class="ic">${m.icon}</span><span>${m.label}</span></div>`;
  }).join('');
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
function hasContact(d){ return !!(d.phone || d.lineId || d.facebook); }

function contactButtonsHtml(d){
  const btns = [];
  if(d.phone) btns.push(`<a class="btn btn-outline btn-sm" href="tel:${d.phone}">📞 ${d.phone}</a>`);
  if(d.lineId){
    const lineHref = d.lineId.startsWith('http') ? d.lineId : `https://line.me/R/ti/p/~${encodeURIComponent(d.lineId)}`;
    btns.push(`<a class="btn btn-outline btn-sm" href="${lineHref}" target="_blank" rel="noopener">💬 LINE</a>`);
  }
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
    phone: d.phone || null, line_id: d.lineId || null, facebook: d.facebook || null
  };
  if(typeof d.verified === 'boolean') row.verified = d.verified;
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
    verified: !!row.verified
  };
}
function mapBookingRow(row){
  return {
    id: row.id, dormId: row.dorm_id, dormName: row.dorm_name, ownerId: row.owner_id,
    roomCode: row.room_code, roomLabel: row.room_label, deposit: Number(row.deposit),
    slipUrl: row.slip_url, contactPhone: row.contact_phone || '', note: row.note || '',
    status: row.status,
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
  // เจ้าของหอใช้งานได้ทันทีหลังสมัคร ไม่ต้องรอแอดมินอนุมัติ (approved: true)
  const { error: e2 } = await sb.from('profiles').insert({ id: data.user.id, role:'owner', name, org_name: orgName, email, phone, approved: true });
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
async function addDorm(ownerId, dormData){
  requireSupabase();
  const row = toDormRow(dormData);
  row.owner_id = ownerId;
  const { data, error } = await sb.from('dorms').insert(row).select().single();
  if(error) throw error;
  return data.id;
}
async function updateDorm(id, fields){
  requireSupabase();
  const row = toDormRow(fields);
  const { error } = await sb.from('dorms').update(row).eq('id', id);
  if(error) throw error;
}
async function deleteDorm(id){
  requireSupabase();
  const { error } = await sb.from('dorms').delete().eq('id', id);
  if(error) throw error;
}
// หอพักที่ยังไม่มีเจ้าของยืนยันดูแล (verified = false) — เปิดให้เจ้าของหอตัวจริงกดรับช่วงดูแลได้
async function getUnclaimedDorms(){
  if(!sb) return [];
  const { data, error } = await sb.from('dorms').select('*').eq('verified', false);
  if(error) throw error;
  return data.map(mapDormRow);
}
async function claimDorm(dormId){
  requireSupabase();
  const { error } = await sb.rpc('claim_dorm', { p_dorm_id: dormId });
  if(error) throw error;
}
async function seedSampleDormsIfEmpty(ownerId){
  requireSupabase();
  const { count, error: ce } = await sb.from('dorms').select('*', { count: 'exact', head: true });
  if(ce) throw ce;
  if(count && count > 0) return 0;
  const rows = SEED_DORMS_RAW.map((d,i)=>{
    const row = toDormRow({ ...d, images: roomImgSet(i), lineId: '' });
    row.owner_id = ownerId;
    return row;
  });
  const { error } = await sb.from('dorms').insert(rows);
  if(error) throw error;
  return rows.length;
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
async function createBooking({ dorm, roomCode, roomLabel, deposit, slipUrl, contactPhone, note, user, profile }){
  requireSupabase();
  const { error } = await sb.from('bookings').insert({
    dorm_id: dorm.id, dorm_name: dorm.name, owner_id: dorm.ownerId,
    room_code: roomCode, room_label: roomLabel, deposit: deposit || 0,
    slip_url: slipUrl || null, contact_phone: contactPhone || null, note: note || null,
    status: 'pending', user_id: user.id, user_name: profile.name, user_email: profile.email
  });
  if(error) throw error;
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
