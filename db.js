/* ==========================================================================
   DormCRU — db.js (Supabase data layer, ไฟล์เดียว ไม่มีโฟลเดอร์ assets)
   *** แก้ SUPABASE_URL และ SUPABASE_ANON_KEY ด้านล่างเป็นค่าจริงของคุณ ***
   หาได้จาก Supabase Dashboard -> Project Settings -> API
   ดูขั้นตอนเต็มใน SETUP-SUPABASE.md

   ออกแบบให้ "ไม่มีวันจอหน้าว่างเปล่า": ทุกฟังก์ชันที่คุยกับ Supabase มีการดัก
   error ไว้ที่นี่ชั้นหนึ่งแล้ว และหน้าเว็บแต่ละหน้าจะเช็ค checkConnection()
   ก่อนเสมอ ถ้ายังไม่ตั้งค่าจะโชว์แบนเนอร์เตือนแทนที่จะพังเงียบๆ
   ========================================================================== */

const SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_PUBLIC_KEY";

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
// ข้อมูลหอพักตั้งต้น: รวบรวมจากประกาศสาธารณะ (RentHub/Hongpak ฯลฯ) เป็น "หอพักที่มีอยู่จริง"
// รอบมหาวิทยาลัยราชภัฏเชียงราย ต.บ้านดู่ — แต่ราคา/ห้องว่าง/พิกัดเป็นข้อมูลโดยประมาณ ณ วันที่รวบรวม
// จึงตั้งค่า verified:false ทั้งหมด = ระบบจะแสดงป้าย "รอเจ้าของหอยืนยันข้อมูล" และเปิดเฉพาะ
// การขอนัดดูห้อง/จองคิวไว้ก่อน (ไม่เปิดรับโอนมัดจำ) จนกว่าเจ้าของหอตัวจริงจะเข้ามารับช่วง
// ดูแลข้อมูล (claim) แล้วแอดมินติ๊ก verified ให้ — ป้องกันการจอง/โอนเงินจากข้อมูลที่ยังไม่ยืนยัน
// ---------------------------------------------------------------------------
const SEED_DORMS_RAW = [
  { name:'เวสธิมา คอร์ท', hallType:'หอรวม', gates:{gate1:0.1,gate2:1.0,gate3:1.4}, lat:19.9074,lng:99.8232,
    facilities:['wifi','parking','cctv','guard'],
    rooms:[{code:'fan',label:'พัดลม',price:2500,total:0,vacant:0},{code:'air',label:'แอร์',price:3500,total:0,vacant:0}],
    desc:'อพาร์ตเมนต์ 4 ชั้น ~67 ห้อง อยู่หน้ามอราชภัฏเชียงราย ห่างจากมอประมาณ 50 เมตร เดินเข้าเรียนได้ทันที (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'หอพักหญิง ฮักล้านนา (ประตู 2)', hallType:'หอหญิงล้วน', gates:{gate1:1.4,gate2:0.3,gate3:1.6}, lat:19.9100,lng:99.8200,
    facilities:['wifi','parking','cctv'],
    rooms:[{code:'air',label:'แอร์',price:3000,total:0,vacant:0}],
    desc:'หอพักหญิง ซ.บ้านป่าแฝก ใกล้ประตู 2 ราชภัฏเชียงราย ใกล้บิ๊กซี 2 และโรงพยาบาลกรุงเทพ (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'ฮักล้านนา เรสซิเดนซ์', hallType:'หอรวม', gates:{gate1:1.5,gate2:0.8,gate3:2.0}, lat:19.9090,lng:99.8180,
    facilities:['wifi','parking','cctv','guard'],
    rooms:[{code:'air',label:'แอร์',price:3800,total:0,vacant:0}],
    desc:'ถ.พหลโยธิน บ้านดู่ ใกล้ราชภัฏเชียงราย ~1.5 กม. ใกล้สนามบิน บิ๊กซี แม็คโคร ตลาดสด ราคาประกาศ ~3,800-4,500 บาท/เดือน (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'หอพักบัณฑิตา', hallType:'หอรวม', gates:{gate1:0.3,gate2:1.2,gate3:1.5}, lat:19.9076,lng:99.8228,
    facilities:['wifi','parking'],
    rooms:[{code:'fan',label:'พัดลม',price:2200,total:0,vacant:0}],
    desc:'ถนนหน้า ม.ราชภัฏเชียงราย บ้านดู่ เดินเข้าประตูหลักได้สะดวก (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'หอพักสุนทรี (ประตู 2)', hallType:'หอรวม', gates:{gate1:1.3,gate2:0.4,gate3:1.7}, lat:19.9098,lng:99.8196,
    facilities:['wifi','parking','cctv'],
    rooms:[{code:'fan',label:'พัดลม',price:2300,total:0,vacant:0},{code:'air',label:'แอร์',price:3200,total:0,vacant:0}],
    desc:'บ้านดู่ ใกล้ ม.ราชภัฏเชียงราย ฝั่งประตู 2 (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'หอพักจงไพศาล 2', hallType:'หอรวม', gates:{gate1:1.2,gate2:1.0,gate3:1.4}, lat:19.9050,lng:99.8260,
    facilities:['wifi','parking','cctv'],
    rooms:[{code:'fan',label:'พัดลม',price:2300,total:0,vacant:0}],
    desc:'อพาร์ตเมนต์ 3 ชั้น ~30 ห้อง ใกล้ตลาดสดบ้านดู่ บิ๊กซี 2 แม็คโคร ห่างมอ ~1.2 กม. ราคาประกาศ ~2,300 บาท/เดือน (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'เอ็ม เรสซิเดนซ์ @เชียงราย', hallType:'หอรวม', gates:{gate1:0.4,gate2:1.3,gate3:1.6}, lat:19.9072,lng:99.8226,
    facilities:['wifi','parking','cctv','keycard'],
    rooms:[{code:'air',label:'แอร์',price:3500,total:0,vacant:0}],
    desc:'ถนนหน้า ม.ราชภัฏ บ้านดู่ (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'กันต์ดนัย เพลส', hallType:'หอรวม', gates:{gate1:1.0,gate2:1.5,gate3:1.2}, lat:19.9040,lng:99.8240,
    facilities:['wifi','parking'],
    rooms:[{code:'fan',label:'พัดลม',price:2200,total:0,vacant:0},{code:'air',label:'แอร์',price:3000,total:0,vacant:0}],
    desc:'ถ.พหลโยธิน บ้านดู่ เมืองเชียงราย (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'P&P Apartment', hallType:'หอรวม', gates:{gate1:0.8,gate2:1.6,gate3:1.0}, lat:19.9058,lng:99.8244,
    facilities:['wifi','parking'],
    rooms:[{code:'fan',label:'พัดลม',price:2000,total:0,vacant:0}],
    desc:'ซ.4/7 ถ.บ้านดู่ เมืองเชียงราย (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'บุญมณี อพาร์ทเม้นท์', hallType:'หอรวม', gates:{gate1:1.1,gate2:1.8,gate3:0.7}, lat:19.9045,lng:99.8218,
    facilities:['wifi','parking'],
    rooms:[{code:'fan',label:'พัดลม',price:2000,total:0,vacant:0}],
    desc:'ซ.11/1 บ้านดู่ เมืองเชียงราย ฝั่งใกล้ประตู 3 (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'หอแนน', hallType:'หอรวม', gates:{gate1:0.9,gate2:1.4,gate3:0.9}, lat:19.9052,lng:99.8236,
    facilities:['wifi'],
    rooms:[{code:'fan',label:'พัดลม',price:1800,total:0,vacant:0}],
    desc:'ซ.2 บ้านดู่ เมืองเชียงราย (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'เดอะ แจ๊ส วิลเลจ', hallType:'หอรวม', gates:{gate1:0.6,gate2:1.4,gate3:1.1}, lat:19.9066,lng:99.8240,
    facilities:['wifi','parking','cctv'],
    rooms:[{code:'air',label:'แอร์',price:3200,total:0,vacant:0}],
    desc:'ซ.ราชภัฏ ถ.ราชภัฏ บ้านดู่ (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'โกลเด้นเวลล์ อพาร์ตเมนต์', hallType:'หอรวม', gates:{gate1:1.0,gate2:1.7,gate3:0.8}, lat:19.9048,lng:99.8230,
    facilities:['wifi','parking'],
    rooms:[{code:'fan',label:'พัดลม',price:2100,total:0,vacant:0},{code:'air',label:'แอร์',price:2900,total:0,vacant:0}],
    desc:'บ้านดู่ เมืองเชียงราย ฝั่งใกล้ประตู 3 (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'สุขพระพร อพาร์ทเมนท์', hallType:'หอรวม', gates:{gate1:1.2,gate2:1.9,gate3:0.6}, lat:19.9042,lng:99.8214,
    facilities:['wifi','parking'],
    rooms:[{code:'fan',label:'พัดลม',price:1900,total:0,vacant:0}],
    desc:'บ้านดู่ เมืองเชียงราย ฝั่งใกล้ประตู 3 (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' },
  { name:'หอพักประหยัด อพาร์ทเม้นท์', hallType:'หอรวม', gates:{gate1:0.7,gate2:1.2,gate3:1.3}, lat:19.9062,lng:99.8234,
    facilities:['wifi'],
    rooms:[{code:'fan',label:'พัดลม',price:1700,total:0,vacant:0}],
    desc:'บ้านดู่ เมืองเชียงราย ราคาประหยัดเหมาะน้องปี 1 (ข้อมูลรวบรวมจากประกาศสาธารณะ รอเจ้าของหอยืนยัน)' }
];

function nearestGate(dorm){
  let best = 'gate1';
  Object.keys(dorm.gates).forEach(g=>{ if(dorm.gates[g] < dorm.gates[best]) best = g; });
  return best;
}
function totalVacancy(dorm){ return dorm.rooms.reduce((s,r)=>s+r.vacant,0); }
function minPrice(dorm){ return Math.min(...dorm.rooms.map(r=>r.price)); }
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
    gate1: d.gates.gate1, gate2: d.gates.gate2, gate3: d.gates.gate3,
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
    gates: { gate1: Number(row.gate1), gate2: Number(row.gate2), gate3: Number(row.gate3) },
    lat: Number(row.lat), lng: Number(row.lng),
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
async function seedSampleDormsIfEmpty(ownerId){
  requireSupabase();
  const { count, error: ce } = await sb.from('dorms').select('*', { count: 'exact', head: true });
  if(ce) throw ce;
  if(count && count > 0) return 0;
  const rows = SEED_DORMS_RAW.map((d,i)=>{
    const row = toDormRow({ ...d, images: roomImgSet(i) });
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
