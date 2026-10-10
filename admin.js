/* ==========================================================================
   DormCRU — admin.js ตรรกะหลังบ้านสำหรับเจ้าของหอพัก/แอดมิน (ใช้กับ admin.html)
   ========================================================================== */

let ME = null;
let editingId = null;
let myDorms = [];
let activeOwnerDormId = null;   // หอที่กำลังเปิดอยู่ในหน้า "หน้าหอพักของฉัน"

document.getElementById('logoutBtn').addEventListener('click', async (e)=>{
  e.preventDefault();
  try{ await logout(); }catch(err){ console.error(err); }
  location.href = 'login.html';
});

const DASH_SECTIONS = ['overview','dashboard','listings','bookings','messages','report','rental','dormreview','owners'];

// ---------------------------------------------------------------------------
// ช่องตัวเลขแบบพิมพ์เอง (v43)
//
// ของเดิมเป็น <input type="number"> ซึ่งมีลูกศรขึ้น-ลงอยู่มุมขวา กดโดนง่าย
// และเลื่อนเมาส์ทับช่องก็เปลี่ยนเลขได้เอง เจ้าของหอเลยบันทึกราคาผิดบ่อย
// v43 เปลี่ยนเป็นช่องพิมพ์ธรรมดา แล้วกรองให้พิมพ์ได้แต่ตัวเลขด้วยตัวดักนี้
// ใช้ event delegation ที่ document เพราะช่องพวกนี้ถูกสร้างใหม่ทุกครั้งที่ render
// ---------------------------------------------------------------------------
document.addEventListener('input', (e)=>{
  const el = e.target;
  if(!el || !el.classList || !el.classList.contains('num-plain')) return;
  const clean = plainNumber(el.value);
  if(el.value !== clean) el.value = clean;
}, true);
// กันพิมพ์ตัวอักษรตั้งแต่แรก (เบราว์เซอร์บางตัวไม่ยิง input ถ้าค่าไม่เปลี่ยน)
document.addEventListener('keypress', (e)=>{
  const el = e.target;
  if(!el || !el.classList || !el.classList.contains('num-plain')) return;
  if(e.key && e.key.length === 1 && !/[0-9๐-๙]/.test(e.key)) e.preventDefault();
}, true);

// อ่านช่อง "เข้าพักได้ _ – _ คน" ของทั้งห้องพัดลมและห้องแอร์
// prefix คือคำนำหน้า id เช่น 'opfCap' -> opfCapMinFan / opfCapMaxFan / opfCapMinAir ...
// คืน { fan:{min,max}|null, air:{min,max}|null } หรือ null ถ้าเจ้าของหอกรอกเลขเพี้ยน
function readCapInputs(prefix){
  const out = {};
  for(const [code, C, th] of [['fan','Fan','ห้องพัดลม'], ['air','Air','ห้องแอร์']]){
    const lo = document.getElementById(`${prefix}Min${C}`);
    const hi = document.getElementById(`${prefix}Max${C}`);
    const rawLo = lo ? plainNumber(lo.value) : '';
    const rawHi = hi ? plainNumber(hi.value) : '';
    if(rawLo === '' && rawHi === ''){ out[code] = null; continue; }
    const cap = roomCapacity({ capMin: rawLo === '' ? null : +rawLo,
                               capMax: rawHi === '' ? null : +rawHi });
    if(!cap){
      toast(`จำนวนผู้เข้าพัก${th}ต้องเป็นตัวเลข 1-${CAP_MAX} คน`, 'error');
      return null;
    }
    out[code] = cap;
  }
  return out;
}

// เมนูที่ "บัญชีผู้ดูแลระบบ" ไม่ต้องเห็น — เป็นงานของเจ้าของหอทั้งหมด (v34)
const ADMIN_HIDDEN_SECTIONS = ['overview','bookings','messages','report','rental','dormreview'];
function isAdminAccount(){ return !!(ME && ME.role === 'admin'); }

document.querySelectorAll('.side-link').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.side-link').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    // เดิมลืมใส่ 'messages' ไว้ในรายการนี้ แท็บข้อความจึงกดแล้วไม่ขึ้นอะไรเลย
    DASH_SECTIONS.forEach(s=>{
      const el = document.getElementById('sec-'+s);
      if(el) el.style.display = (s===btn.dataset.sec) ? 'block':'none';
    });
    if(btn.dataset.sec === 'dashboard'){ renderDashboard(); }
    if(btn.dataset.sec === 'dormreview'){ renderPendingDorms(); }
    if(btn.dataset.sec === 'report'){ renderReport(); }
    if(btn.dataset.sec === 'rental'){ renderRental(); }
    if(btn.dataset.sec === 'overview'){ renderOwnerPage(); }
    // เปิดแท็บคำขอนัดหมาย = ถือว่าเจ้าของหออ่านแล้ว (ลบจุดแดง)
    if(btn.dataset.sec === 'bookings'){
      markBookingsRead(ME && ME.uid).then(refreshBookingBadge).catch(console.error);
    }
  });
});

// โหลดหอพักที่บัญชีนี้เห็นได้ — เจ้าของหอเห็นเฉพาะหอตัวเอง ผู้ดูแลระบบเห็นทั้งหมด
async function loadVisibleDorms(){
  const allDorms = await getDorms();
  const mine = allDorms.filter(d => d.ownerId === ME.uid);
  myDorms = (ME.role === 'admin') ? allDorms : mine;
  return { allDorms, mine };
}

async function renderStats(){
  await loadVisibleDorms();
  const dorms = myDorms;
  const set = (id, val)=>{ const el = document.getElementById(id); if(el) el.textContent = val; };
  set('statDorms', dorms.length);
  set('statVacant', dorms.reduce((s,d)=>s+totalVacancy(d),0));
  set('statContact', dorms.filter(d=>d.phone||d.lineId||d.facebook||d.contactEmail).length);
  set('statVerified', dorms.filter(d=>d.verified).length);
}

// ===========================================================================
// แดชบอร์ด (v45)
//
// รวมตัวเลขที่เจ้าของหอต้องดูทุกวันไว้ในหน้าเดียว แทนที่จะต้องไล่เปิดทีละแท็บ
// ผู้ดูแลระบบเปิดหน้านี้ได้เหมือนกัน แต่จะเห็นภาพรวมของทั้งระบบแทนของหอเดียว
//
// กราฟทั้งหมดวาดด้วย SVG ที่เขียนเอง ไม่ได้ดึงไลบรารีจากภายนอก
// เพราะเว็บนี้เป็นไฟล์แบนราบ ไม่มีขั้นตอน build และต้องเปิดได้แม้เน็ตช้า
//
// หลักการที่ใช้กับกราฟทุกตัวในหน้านี้
//   - สีของสถานะห้องใช้ชุดเดียวกับผังห้องพัก เพื่อไม่ให้ต้องจำสองชุด
//   - ทุกกราฟมีทั้งป้ายกำกับบนตัวกราฟและตารางข้อมูลให้กางดู
//     ผู้ที่แยกสีไม่ออกจึงยังอ่านได้ครบ ไม่ได้สื่อความหมายด้วยสีอย่างเดียว
//   - เอาเมาส์ชี้ที่แท่งแล้วมีคำอธิบายขึ้น
// ===========================================================================

// สีแท่งกราฟรายเดือน — ฟ้าเข้มของเว็บ ผ่านเกณฑ์ความต่างจากพื้นขาว
const DB_BAR = '#16709F';

// ปีที่กำลังแสดงอยู่ในกราฟคำขอนัดหมายรายเดือน (ค.ศ.) — เปลี่ยนได้จากช่องเลือกปี
let dbChartYear = new Date().getFullYear();

const DB_BOOKING_STATUS = {
  pending:   { label:'รอดำเนินการ', color:'#E8A317' },
  confirmed: { label:'ยืนยันแล้ว',  color:'#2E9E5B' },
  cancelled: { label:'ปฏิเสธ/ยกเลิก', color:'#8C96A0' }
};

// ตัวเลขที่อ่านง่าย — คั่นหลักพันแบบไทย
function dbNum(n){ return Number(n || 0).toLocaleString('th-TH'); }
function dbPct(part, whole){ return whole > 0 ? Math.round(part / whole * 100) : 0; }

// ---------------------------------------------------------------------------
// การ์ดตัวเลขสรุป (stat tile)
// ตัวเลขเดี่ยว ๆ ไม่ควรทำเป็นกราฟแท่งแท่งเดียว — ใช้ตัวเลขใหญ่ ๆ อ่านตรง ๆ ดีกว่า
// ---------------------------------------------------------------------------
function dbTileHtml({ icon, label, value, unit, note, tone }){
  return `
  <div class="db-tile${tone ? ' tone-' + tone : ''}">
    <div class="db-tile-label">${icon ? icon + ' ' : ''}${escapeHtml(label)}</div>
    <div class="db-tile-value">${escapeHtml(String(value))}${unit ? `<span class="db-tile-unit">${escapeHtml(unit)}</span>` : ''}</div>
    ${note ? `<div class="db-tile-note">${note}</div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// แถบส่วนประกอบแนวนอน (stacked bar) — ใช้กับ "ส่วนไหนเป็นส่วนไหนของทั้งหมด"
// rows = [{ label, value, color }]
// เว้นช่องว่างสีพื้น 2px ระหว่างแต่ละช่วง เพื่อให้ขอบของแต่ละช่วงชัดโดยไม่ต้องใช้เส้นขอบ
// ---------------------------------------------------------------------------
function dbStackHtml(rows, opts){
  const o = opts || {};
  const list = rows.filter(r => r.value > 0);
  const total = rows.reduce((a, r)=> a + r.value, 0);
  if(!total){
    return `<p class="muted" style="font-size:.88rem;margin:10px 0 0">${escapeHtml(o.empty || 'ยังไม่มีข้อมูล')}</p>`;
  }
  const bar = list.map(r=>{
    const pct = r.value / total * 100;
    return `<span class="db-seg" style="flex:0 0 ${pct}%;background:${r.color}"
                  title="${escapeAttr(r.label + ' ' + dbNum(r.value) + ' ' + (o.unit||'') + ' (' + dbPct(r.value,total) + '%)')}"></span>`;
  }).join('');

  // ป้ายกำกับใต้แถบ: บอกทั้งชื่อ จำนวน และเปอร์เซ็นต์ จึงไม่ได้ใช้สีสื่อความหมายอย่างเดียว
  const legend = rows.map(r=>`
    <span class="db-lg">
      <i class="db-swatch" style="background:${r.color}"></i>
      <span class="db-lg-label">${escapeHtml(r.label)}</span>
      <strong>${dbNum(r.value)}</strong>
      <span class="muted">(${dbPct(r.value, total)}%)</span>
    </span>`).join('');

  return `<div class="db-stack" role="img" aria-label="${escapeAttr(
      rows.map(r=> `${r.label} ${r.value}`).join(', '))}">${bar}</div>
    <div class="db-legend">${legend}</div>`;
}

// ---------------------------------------------------------------------------
// กราฟแท่งรายเดือน (SVG) — ชุดข้อมูลชุดเดียว จึงใช้สีเดียวทั้งกราฟ ไม่ต้องมีคำอธิบายสี
// points = [{ label, value, full }]
// ---------------------------------------------------------------------------
function dbColumnsHtml(points, opts){
  const o = opts || {};
  const max = Math.max(1, ...points.map(p=> p.value));
  const dense = points.length > 8;

  // แท่งสูงไม่เกิน 82% ของพื้นที่ เพื่อเว้นที่ให้ตัวเลขกำกับด้านบนเสมอ
  const cols = points.map(p=>{
    const h = p.value > 0 ? Math.max(4, p.value / max * 82) : 0;
    const tip = p.full + ' — ' + (p.value ? dbNum(p.value) + ' ' + (o.unit || 'รายการ') : 'ไม่มีรายการ');
    return `<div class="db-col" title="${escapeAttr(tip)}">
      ${p.value ? `<span class="db-colnum">${dbNum(p.value)}</span>` : ''}
      <span class="db-colbar${p.value ? '' : ' is-zero'}" style="height:${h}%"></span>
    </div>`;
  }).join('');

  return `
  <div class="db-cols" role="img"
       aria-label="${escapeAttr(points.map(p=> `${p.full} ${p.value}`).join(', '))}">
    <div class="db-colrow${dense ? ' is-dense' : ''}">${cols}</div>
    <div class="db-colbase"></div>
    <div class="db-colx${dense ? ' is-dense' : ''}">${points.map(p=>
      `<span>${escapeHtml(p.label)}</span>`).join('')}</div>
  </div>`;
}

// ---------------------------------------------------------------------------
// มาตรวัดความครบถ้วน (meter) — อัตราส่วนเดียวเทียบกับเต็ม 100%
// ---------------------------------------------------------------------------
function dbMeterHtml(done, total){
  const pct = dbPct(done, total);
  return `
  <div class="db-meter" role="img" aria-label="ความครบถ้วน ${pct} เปอร์เซ็นต์">
    <div class="db-meter-track"><span style="width:${pct}%"></span></div>
    <div class="db-meter-txt"><strong>${pct}%</strong> <span class="muted">(${done} จาก ${total} ข้อ)</span></div>
  </div>`;
}

// ตารางข้อมูลของกราฟ — กางดูได้ เผื่อผู้ที่อ่านกราฟไม่สะดวก
function dbTableHtml(head, rows){
  return `
  <details class="db-table">
    <summary>ดูเป็นตาราง</summary>
    <table><thead><tr>${head.map(h=> `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=> `<tr>${r.map((c, i)=>
      `<td${i ? ' class="num"' : ''}>${escapeHtml(String(c))}</td>`).join('')}</tr>`).join('')}</tbody></table>
  </details>`;
}

// ---------------------------------------------------------------------------
// นับคำขอนัดหมายรายเดือนของปีหนึ่ง ๆ (มกราคม -> ธันวาคม)
//
// v48: เปลี่ยนจาก "ย้อนหลัง 12 เดือนนับจากเดือนนี้" มาเป็น "ทั้งปีปฏิทิน"
// เพราะแบบเดิมคร่อม 2 ปี ต้องมีป้ายปีกำกับ และเทียบปีต่อปีไม่ได้
// แบบนี้เรียง ม.ค. ถึง ธ.ค. เสมอ อ่านง่ายและเทียบข้ามปีได้ตรง ๆ
// ---------------------------------------------------------------------------
function dbMonthlyBookings(list, year){
  const out = [];
  for(let m = 0; m < 12; m++){
    const d = new Date(year, m, 1);
    out.push({
      key:   `${year}-${m}`,
      label: d.toLocaleDateString('th-TH', { month:'short' }),
      full:  d.toLocaleDateString('th-TH', { month:'long', year:'numeric' }),
      value: 0
    });
  }
  const idx = Object.fromEntries(out.map((m, i)=> [m.key, i]));
  list.forEach(b=>{
    const d = new Date(b.createdAt);
    const k = `${d.getFullYear()}-${d.getMonth()}`;
    if(k in idx) out[idx[k]].value++;
  });
  return out;
}

// ปีทั้งหมดที่มีคำขอนัดหมาย (รวมปีปัจจุบันเสมอ) เรียงจากใหม่ไปเก่า
function dbBookingYears(list){
  const years = new Set([new Date().getFullYear()]);
  (list || []).forEach(b=>{
    const y = new Date(b.createdAt).getFullYear();
    if(y > 2000 && y < 2200) years.add(y);
  });
  return [...years].sort((a, b)=> b - a);
}

// ปีพุทธศักราชสำหรับแสดงผล
function dbThaiYear(y){ return y + 543; }

// ---------------------------------------------------------------------------
// ความครบถ้วนของข้อมูลหอพัก — เช็กทีละข้อว่ากรอกอะไรไปแล้วบ้าง
// ---------------------------------------------------------------------------
function dbChecklist(d){
  if(!d) return [];
  return [
    { ok: (d.images || []).length > 0,        label:'มีรูปหอพักอย่างน้อย 1 รูป', sec:'overview' },
    { ok: hasPrice(d),                        label:'ใส่ราคาห้องพักแล้ว',        sec:'overview' },
    { ok: !!(d.desc || '').trim(),            label:'เขียนคำอธิบายหอพักแล้ว',     sec:'overview' },
    { ok: d.lat != null && d.lng != null,     label:'ปักหมุดตำแหน่งหอพักแล้ว',    sec:'overview' },
    { ok: (d.facilities || []).length > 0,    label:'ระบุสิ่งอำนวยความสะดวกแล้ว', sec:'overview' },
    { ok: hasFloorPlan(d),                    label:'ทำผังห้องพักแล้ว',           sec:'overview' },
    { ok: !!(d.phone || d.lineId || d.facebook || d.contactEmail), label:'มีช่องทางติดต่อ', sec:'overview' },
    { ok: !!d.verified,                       label:'ยืนยันว่าข้อมูลเป็นปัจจุบัน', sec:'overview' }
  ];
}

// ---------------------------------------------------------------------------
// วาดแดชบอร์ด
// ---------------------------------------------------------------------------
async function renderDashboard(){
  const box = document.getElementById('dbBody');
  if(!box || !ME) return;
  const isAdmin = ME.role === 'admin';
  document.getElementById('dbTitle').textContent = isAdmin ? 'แดชบอร์ดภาพรวมระบบ' : 'แดชบอร์ดหอพักของฉัน';

  let dorms = [], bookings = [], ratings = {}, unread = 0;
  try{
    const vis = await loadVisibleDorms();
    dorms = isAdmin ? vis.allDorms : vis.mine;
    bookings = isAdmin ? await getAllBookings() : await getBookingsForOwner(ME.uid);
    if(dorms.length) ratings = await getRatingsForDorms(dorms.map(x=> x.id));
    if(!isAdmin) unread = await getUnreadCount();
  }catch(err){
    console.error(err);
    box.innerHTML = `<div class="chat-empty">โหลดข้อมูลแดชบอร์ดไม่สำเร็จ: ${escapeHtml(err.message || '')}</div>`;
    return;
  }

  document.getElementById('dbUpdated').textContent =
    'ข้อมูล ณ ' + new Date().toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' }) + ' น.';

  if(!dorms.length){
    box.innerHTML = `<div class="empty-state" style="padding:40px 10px">
      <div class="emoji">📈</div>
      <p>ยังไม่มีข้อมูลให้สรุป<br>
      <small class="muted">${isAdmin ? 'ยังไม่มีหอพักในระบบ' : 'สร้างหน้าหอพักของคุณก่อน แล้วตัวเลขทั้งหมดจะขึ้นที่นี่'}</small></p>
    </div>`;
    return;
  }

  // ---------- รวมสถานะห้องจากผังของทุกหอ ----------
  const st = { total:0 };
  ROOM_STATUS_ORDER.forEach(k=> st[k] = 0);
  let unsetRooms = 0;
  dorms.forEach(d=>{
    eachRoomCell(normalizeFloorPlan(d.floorPlan)).forEach(({ cell })=>{
      st.total++;
      st[normalizeRoomStatus(cell.status)]++;
      if(!cell.editedAt) unsetRooms++;
    });
  });

  const pending   = bookings.filter(b=> b.status === 'pending').length;
  const confirmed = bookings.filter(b=> b.status === 'confirmed').length;
  const cancelled = bookings.filter(b=> b.status === 'cancelled').length;

  // คะแนนรีวิวเฉลี่ยถ่วงน้ำหนักตามจำนวนรีวิว
  let rSum = 0, rCount = 0;
  Object.values(ratings).forEach(r=>{ rSum += (r.avg || 0) * (r.count || 0); rCount += (r.count || 0); });
  const avgRating = rCount ? Math.round(rSum / rCount * 10) / 10 : null;

  // รายได้โดยประมาณต่อเดือน = ห้องที่มีผู้เช่าอยู่ × ราคาของประเภทห้องนั้น
  let income = 0;
  dorms.forEach(d=>{
    eachRoomCell(normalizeFloorPlan(d.floorPlan)).forEach(({ cell })=>{
      if(normalizeRoomStatus(cell.status) !== 'booked') return;
      const t = roomTypes(d).find(r=> r.code === cell.type);
      income += (t && t.price) || minPrice(d) || 0;
    });
  });

  // ห้องแยกตามประเภท (แอร์/พัดลม) — รวมทุกหอถ้าเป็นผู้ดูแลระบบ
  const byType = {};
  dorms.forEach(d=>{
    eachRoomCell(normalizeFloorPlan(d.floorPlan)).forEach(({ cell })=>{
      const code = cell.type || '_';
      if(!byType[code]) byType[code] = { total:0, vacant:0, price:null };
      byType[code].total++;
      if(normalizeRoomStatus(cell.status) === 'vacant') byType[code].vacant++;
      if(byType[code].price == null){
        const t = roomTypes(d).find(r=> r.code === code);
        if(t && t.price) byType[code].price = t.price;
      }
    });
  });
  // เรียงตามลำดับประเภทมาตรฐานก่อน แล้วค่อยประเภทอื่น ๆ
  const typeRows = Object.keys(byType)
    .sort((a, b)=> ROOM_TYPE_ORDER.indexOf(a) - ROOM_TYPE_ORDER.indexOf(b))
    .map(code=> Object.assign({ code }, byType[code],
      { label: ROOM_TYPE_META[code] ? ROOM_TYPE_META[code].label : 'ไม่ระบุประเภท',
        icon:  ROOM_TYPE_META[code] ? ROOM_TYPE_META[code].icon  : '🚪' }));

  const occupied = st.booked + st.reserved;
  const years    = dbBookingYears(bookings);
  if(!years.includes(dbChartYear)) dbChartYear = years[0];
  const months   = dbMonthlyBookings(bookings, dbChartYear);
  const focus    = isAdmin ? null : (dorms.find(d=> d.id === activeOwnerDormId) || dorms[0]);
  const checks   = dbChecklist(focus);
  const checkOk  = checks.filter(c=> c.ok).length;

  // ---------- สิ่งที่ต้องจัดการ ----------
  const todo = [];
  if(pending)      todo.push({ icon:'📌', text:`มีคำขอนัดหมาย <strong>${dbNum(pending)}</strong> รายการที่ยังไม่ได้ตอบ`, sec:'bookings', tone:'warn' });
  if(unread)       todo.push({ icon:'💬', text:`มีข้อความจากนักศึกษา <strong>${dbNum(unread)}</strong> ข้อความที่ยังไม่ได้อ่าน`, sec:'messages', tone:'warn' });
  if(unsetRooms)   todo.push({ icon:'🧩', text:`มีห้องในผัง <strong>${dbNum(unsetRooms)}</strong> ห้องที่ยังไม่ได้ตั้งค่า`, sec:'overview', tone:'warn' });
  if(st.closed)    todo.push({ icon:'🛠', text:`มีห้องปิดปรับปรุงอยู่ <strong>${dbNum(st.closed)}</strong> ห้อง`, sec:'overview', tone:'info' });
  if(focus && checkOk < checks.length){
    todo.push({ icon:'📝', text:`ข้อมูลหอพักยังกรอกไม่ครบ อีก <strong>${checks.length - checkOk}</strong> ข้อ`, sec:'overview', tone:'info' });
  }
  if(!todo.length) todo.push({ icon:'✅', text:'ไม่มีรายการค้างอยู่ ข้อมูลหอพักเรียบร้อยดีแล้ว', sec:'', tone:'ok' });

  const statusRows = ROOM_STATUS_ORDER.map(k=>({
    label: ROOM_STATUS_META[k].label, value: st[k], color: ROOM_STATUS_META[k].color
  }));
  const bkRows = ['pending','confirmed','cancelled'].map(k=>({
    label: DB_BOOKING_STATUS[k].label, color: DB_BOOKING_STATUS[k].color,
    value: k === 'pending' ? pending : (k === 'confirmed' ? confirmed : cancelled)
  }));

  box.innerHTML = `
  <div class="db-tiles">
    ${dbTileHtml({ icon:'🏠', label: isAdmin ? 'หอพักในระบบ' : 'หอพักของฉัน', value: dbNum(dorms.length), unit:'แห่ง' })}
    ${dbTileHtml({ icon:'🚪', label:'ห้องพักทั้งหมด', value: dbNum(st.total), unit:'ห้อง',
                   note: st.total ? `ว่าง ${dbNum(st.vacant)} ห้อง` : 'ยังไม่ได้ทำผังห้องพัก' })}
    ${dbTileHtml({ icon:'📊', label:'อัตราการเข้าพัก', value: dbPct(occupied, st.total), unit:'%',
                   note: st.total ? `มีผู้เช่าหรือผู้นัดหมาย ${dbNum(occupied)} จาก ${dbNum(st.total)} ห้อง` : '—' })}
    ${dbTileHtml({ icon:'📌', label:'คำขอรอดำเนินการ', value: dbNum(pending), unit:'รายการ',
                   tone: pending ? 'warn' : '', note:`คำขอทั้งหมด ${dbNum(bookings.length)} รายการ` })}
    ${isAdmin ? '' : dbTileHtml({ icon:'💬', label:'ข้อความที่ยังไม่ได้อ่าน', value: dbNum(unread), unit:'ข้อความ',
                   tone: unread ? 'warn' : '' })}
    ${dbTileHtml({ icon:'⭐', label:'คะแนนรีวิวเฉลี่ย', value: avgRating == null ? '—' : avgRating,
                   unit: avgRating == null ? '' : 'เต็ม 5',
                   note: rCount ? `จาก ${dbNum(rCount)} รีวิว` : 'ยังไม่มีรีวิว' })}
    ${dbTileHtml({ icon:'💰', label:'รายได้โดยประมาณ', value: dbNum(income), unit:'บาท/เดือน',
                   note:'คิดจากห้องที่มีผู้เช่าอยู่ × ราคาห้อง' })}
  </div>

  <div class="db-grid">
    <section class="db-card">
      <h3>สถานะห้องพัก</h3>
      <p class="muted">แบ่งตามสถานะที่ตั้งไว้ในผังห้องพัก — สีเดียวกับในผัง</p>
      ${dbStackHtml(statusRows, { unit:'ห้อง', empty:'ยังไม่ได้ทำผังห้องพัก จึงยังไม่มีข้อมูลสถานะห้อง' })}
      ${st.total ? dbTableHtml(['สถานะ','จำนวน (ห้อง)','สัดส่วน'],
          statusRows.map(r=> [r.label, dbNum(r.value), dbPct(r.value, st.total) + '%'])) : ''}
    </section>

    <!-- v48: เติมช่องว่างในแถวบน — ข้อมูลที่เจ้าของหอใช้ตอบคำถามนักศึกษาบ่อยที่สุด
         คือ "ห้องแบบไหนยังว่างอยู่บ้าง" -->
    <section class="db-card">
      <h3>ห้องว่างแยกตามประเภทห้อง</h3>
      <p class="muted">ข้อมูลที่นักศึกษาถามบ่อยที่สุดเวลาติดต่อเข้ามา</p>
      ${typeRows.length ? `
        <ul class="db-types">${typeRows.map(t=>`
          <li>
            <div class="db-type-head">
              <span class="db-type-name">${t.icon} ห้อง${escapeHtml(t.label)}</span>
              <span class="db-type-num"><strong>${dbNum(t.vacant)}</strong> / ${dbNum(t.total)} ห้อง</span>
            </div>
            <div class="db-meter-track"><span style="width:${dbPct(t.vacant, t.total)}%"></span></div>
            <div class="db-type-foot">
              <span>ว่าง ${dbPct(t.vacant, t.total)}%</span>
              ${t.price ? `<span>${dbNum(t.price)} บาท/เดือน</span>` : '<span class="muted">ยังไม่ได้ใส่ราคา</span>'}
            </div>
          </li>`).join('')}</ul>
        ${dbTableHtml(['ประเภทห้อง','ว่าง (ห้อง)','ทั้งหมด (ห้อง)'],
            typeRows.map(t=> ['ห้อง' + t.label, dbNum(t.vacant), dbNum(t.total)]))}`
        : `<p class="muted" style="font-size:.88rem;margin:10px 0 0">
             ยังไม่ได้ทำผังห้องพัก จึงยังไม่มีข้อมูลห้องแยกตามประเภท</p>`}
    </section>

    <section class="db-card">
      <h3>ผลการตอบคำขอนัดหมาย</h3>
      <p class="muted">คำขอทั้งหมดที่เคยเข้ามา แบ่งตามผลลัพธ์</p>
      ${dbStackHtml(bkRows, { unit:'รายการ', empty:'ยังไม่มีคำขอนัดหมายเข้ามา' })}
      ${bookings.length ? dbTableHtml(['ผลลัพธ์','จำนวน (รายการ)','สัดส่วน'],
          bkRows.map(r=> [r.label, dbNum(r.value), dbPct(r.value, bookings.length) + '%'])) : ''}
    </section>

    <!-- v47: กราฟรายเดือนกินเต็มแถว เพราะ 12 แท่งต้องการความกว้าง
         ถ้าบีบอยู่ในคอลัมน์เดียวกับการ์ดอื่น ชื่อเดือนจะชนกันจนอ่านไม่ออก -->
    <section class="db-card db-span">
      <div class="db-card-head">
        <div>
          <h3>คำขอนัดหมายรายเดือน พ.ศ. ${dbThaiYear(dbChartYear)}</h3>
          <p class="muted">นับจากวันที่นักศึกษากดส่งคำขอ — เรียงตั้งแต่มกราคมถึงธันวาคม</p>
        </div>
        ${years.length > 1 ? `
          <label class="db-year">ปี
            <select id="dbYear">${years.map(y=>
              `<option value="${y}" ${y === dbChartYear ? 'selected' : ''}>พ.ศ. ${dbThaiYear(y)}</option>`).join('')}</select>
          </label>` : ''}
      </div>
      ${dbColumnsHtml(months, { unit:'รายการ' })}
      ${dbTableHtml(['เดือน','จำนวนคำขอ'], months.map(m=> [m.full, dbNum(m.value)]))}
    </section>

    <!-- การ์ดใบสุดท้ายกินความกว้างเต็มแถว ไม่งั้นจะเหลือที่ว่างข้าง ๆ เป็นแถบใหญ่ -->
    <section class="db-card db-span">
      <div class="db-split">
        ${isAdmin ? '' : `
        <div>
          <h3>ความครบถ้วนของข้อมูลหอพัก</h3>
          <p class="muted">${escapeHtml(focus ? focus.name : '')} — ข้อมูลที่ครบช่วยให้นักศึกษาตัดสินใจได้เร็วขึ้น</p>
          ${dbMeterHtml(checkOk, checks.length)}
          <ul class="db-check">${checks.map(c=>
            `<li class="${c.ok ? 'ok' : 'no'}"><span class="db-check-ic">${c.ok ? '✓' : '○'}</span>${escapeHtml(c.label)}</li>`).join('')}</ul>
        </div>`}
        <div>
          <h3>สิ่งที่ต้องจัดการ</h3>
          <p class="muted">รายการที่ควรจัดการก่อน เรียงจากเรื่องที่นักศึกษารออยู่</p>
          <ul class="db-todo">${todo.map(t=>
            `<li class="tone-${t.tone}">
              <span class="db-todo-ic">${t.icon}</span>
              <span>${t.text}</span>
              ${t.sec ? `<button type="button" class="btn btn-sm btn-outline" data-dbgo="${t.sec}">ไปจัดการ</button>` : ''}
            </li>`).join('')}</ul>
        </div>
      </div>
    </section>
  </div>`;

  // เปลี่ยนปีแล้ววาดกราฟใหม่
  document.getElementById('dbYear')?.addEventListener('change', (e)=>{
    dbChartYear = +e.target.value;
    renderDashboard();
  });

  // ปุ่ม "ไปจัดการ" — พาไปแท็บที่เกี่ยวข้องเลย ไม่ต้องไปหาเมนูเอง
  box.querySelectorAll('[data-dbgo]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const target = document.querySelector(`.side-link[data-sec="${btn.dataset.dbgo}"]`);
      if(target){ target.click(); window.scrollTo({ top:0, behavior:'smooth' }); }
    });
  });
}

// ===========================================================================
// หน้าหลักของเจ้าของหอ — "หน้าหอพักของฉัน"
// จัดหน้าคล้ายหน้าโปรไฟล์ที่พักในเว็บหาที่พัก (รูปปก + แกลเลอรี + ข้อมูลหอ)
// แต่ทุกส่วนแก้ไขได้จากหน้านี้เลย ไม่ต้องเข้าฟอร์มยาว ๆ
// ===========================================================================

// ดาวคะแนน (เต็ม/ครึ่ง/ว่าง) จากคะแนนเฉลี่ย
function starsHtml(avg){
  const n = Math.round((Number(avg)||0) * 2) / 2;
  let out = '';
  for(let i=1;i<=5;i++){
    if(n >= i) out += '<span class="st on">★</span>';
    else if(n >= i - 0.5) out += '<span class="st half">★</span>';
    else out += '<span class="st">★</span>';
  }
  return `<span class="stars">${out}</span>`;
}

function ownerPhotoTileHtml(url, i, isCover){
  return `
  <div class="op-photo ${isCover?'is-cover':''}">
    <img src="${escapeHtml(url)}" alt="รูปหอพัก ${i+1}" ${imgFallbackAttr()}>
    ${isCover ? '<span class="op-cover-tag">รูปปก</span>' : ''}
    <div class="op-photo-tools">
      ${isCover ? '' : `<button type="button" class="op-mini" data-cover="${i}" title="ตั้งเป็นรูปปก">⭐</button>`}
      <button type="button" class="op-mini danger" data-rmphoto="${i}" title="ลบรูปนี้">✕</button>
    </div>
  </div>`;
}

async function renderOwnerPage(){
  const box = document.getElementById('ownerPage');
  if(!box) return;
  const isAdmin = ME.role === 'admin';
  const adminBox = document.getElementById('adminOverview');
  if(adminBox) adminBox.style.display = isAdmin ? 'block' : 'none';

  let mine = [];
  try{ mine = (await loadVisibleDorms()).mine; }
  catch(err){
    console.error(err);
    box.innerHTML = `<div class="chat-empty">โหลดข้อมูลหอพักไม่สำเร็จ: ${escapeHtml(err.message||'')}</div>`;
    return;
  }

  if(mine.length === 0){
    box.innerHTML = `
      <div class="op-empty">
        <div class="emoji">🏡</div>
        <h2>ยังไม่มีหน้าหอพักของคุณ</h2>
        <p class="muted">
          สร้างหน้าหอพักของคุณเองได้ทันที ไม่ต้องรอผู้ดูแลระบบอนุมัติ —
          ใส่ชื่อหอ ราคา รูปห้อง แล้วหอของคุณจะขึ้นให้นักศึกษาเห็นทันที
        </p>
        <button class="btn btn-primary" id="opCreate">+ สร้างหน้าหอพักของฉัน</button>
      </div>`;
    const btn = document.getElementById('opCreate');
    if(btn) btn.addEventListener('click', ()=> openEdit(null));
    return;
  }

  // เลือกหอที่จะแสดง (เจ้าของหอบางคนมีหลายหอ)
  if(!activeOwnerDormId || !mine.some(d=>d.id===activeOwnerDormId)) activeOwnerDormId = mine[0].id;
  const d = mine.find(x=>x.id===activeOwnerDormId);

  const imgs = d.images || [];
  const cover = imgs[0] || '';
  const facs = (d.facilities||[]).filter(Boolean);

  let reviews = [];
  try{ reviews = await getReviews(d.id); }catch(err){ console.error(err); }
  const sum = ratingSummary(reviews);

  box.innerHTML = `
  <div class="op-page">

    <div class="op-switch">
      ${mine.length > 1
        ? mine.map(x=>`<button type="button" class="op-tab ${x.id===d.id?'on':''}" data-dorm="${x.id}">${escapeHtml(x.name)}</button>`).join('')
        : ''}
      <button type="button" class="op-tab add" id="opAddDorm">+ เพิ่มหอใหม่</button>
    </div>

    <!-- ---------- รูปปก ---------- -->
    <div class="op-cover">
      ${cover
        ? `<img src="${escapeHtml(cover)}" alt="รูปปกของ ${escapeHtml(d.name)}" ${imgFallbackAttr()}>`
        : `<div class="op-cover-empty">
             <div class="emoji">📷</div>
             <strong>ยังไม่มีรูปหอพัก</strong>
             <span class="muted">หอที่มีรูปจริงมีโอกาสถูกกดดูมากกว่าหอที่ไม่มีรูป</span>
           </div>`}
      <div class="op-cover-bar">
        <input type="file" id="opPhotoInput" accept="image/*" multiple hidden>
        <a class="btn btn-outline btn-sm" href="index.html#dorm=${encodeURIComponent(d.id)}" target="_blank" rel="noopener">👁 ดูหน้าที่นักศึกษาเห็น</a>
      </div>
      <div class="op-upstate" id="opUpState" style="display:none"></div>
    </div>

    <!-- ---------- แกลเลอรีรูปทั้งหมด ---------- -->
    <div class="op-photos" id="opPhotos">
      ${imgs.map((u,i)=> ownerPhotoTileHtml(u, i, i===0)).join('')}
      <button type="button" class="op-photo add" id="opAddPhoto2">＋<span>เพิ่มรูป</span></button>
    </div>
    ${imgs.length ? `<p class="form-hint">กด ⭐ เพื่อตั้งเป็นรูปปก · กด ✕ เพื่อลบรูป — รูปแรกคือรูปที่นักศึกษาเห็นในหน้าค้นหา</p>` : ''}

    <!-- ---------- ชื่อหอและสรุป ---------- -->
    <div class="op-head">
      <div>
        <h1>${escapeHtml(d.name)}
          <span class="td-tag ${d.verified?'ok':''}">${d.verified?'✓ ยืนยันข้อมูลแล้ว':'⚠ ยังไม่ได้ยืนยันข้อมูล'}</span>
          ${d.published === false ? '<span class="td-tag" style="background:#FBE7E3;color:#B23A24;border-color:#F0C8C0">🚫 ถูกซ่อนอยู่</span>' : ''}
        </h1>
        <div class="op-sub">
          📍 ต.บ้านดู่ อ.เมือง จ.เชียงราย · ${escapeHtml(d.hallType)}
          ${sum.count
            ? ` · ${starsHtml(sum.avg)} <strong>${sum.avg}</strong> <span class="muted">(${sum.count} รีวิว)</span>`
            : ' · <span class="muted">ยังไม่มีรีวิว</span>'}
        </div>
        <!-- v43: บอกเจ้าของหอว่าตัวเองอัปเดตหอนี้ครั้งล่าสุดเมื่อไหร่ -->
        ${d.updatedAt
          ? `<div class="op-updated" title="${escapeAttr(fmtUpdatedTitle(d.updatedAt))}">
               🕒 อัปเดตหอพักล่าสุดเมื่อ <strong>${escapeHtml(fmtSince(d.updatedAt))}</strong>
               <span class="muted">(${escapeHtml(fmtUpdatedTitle(d.updatedAt))})</span>
             </div>`
          : ''}
      </div>
      <div class="op-head-actions">
        <button class="btn btn-primary btn-sm" id="opEdit">✏️ เพิ่มหรือแก้ไข</button>
        <button class="btn btn-sm btn-reject" id="opDelete">🗑 ลบหอนี้</button>
      </div>
    </div>

    <!-- ---------- ชื่อหอ / ประเภท / ราคาเริ่มต้น (แก้ในการ์ดนี้เลย) ---------- -->
    <section class="op-card op-inline-card" id="opBasicEdit" style="display:none">
      <div class="opc-head">
        <h3>ข้อมูลพื้นฐานของหอ</h3>
        <button type="button" class="btn btn-ghost btn-sm" data-closeinline="opBasicEdit">✕ ปิด</button>
      </div>
      <div class="form-field"><label>ชื่อหอพัก</label><input type="text" id="opfName" value="${escapeAttr(d.name||'')}"></div>
      <div class="form-field"><label>ประเภทหอพัก</label>
        <select id="opfHallType">
          ${['หอหญิงล้วน','หอชายล้วน','หอรวม'].map(t=>
            `<option value="${t}" ${d.hallType===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
      <div class="form-field">
        <label>ราคาและจำนวนผู้เข้าพักของแต่ละประเภทห้อง</label>
        <div class="price-two">
          ${['fan','air'].map(code=>{
            const cap   = dormCapacity(d, code) || {};
            const price = code === 'fan' ? fanPriceValue(d) : airPriceValue(d);
            const ph    = code === 'fan' ? 'เช่น 2600' : 'เช่น 4000';
            const C     = code === 'fan' ? 'Fan' : 'Air';
            return `
          <div class="pt-box">
            <span>${ROOM_TYPE_META[code].icon} ห้อง${escapeHtml(ROOM_TYPE_META[code].label)}</span>
            <!-- v43: พิมพ์ราคาเองได้ทันที ไม่มีลูกศรขึ้น-ลงให้กดพลาด -->
            <input type="text" inputmode="numeric" id="opfPrice${C}" class="num-plain"
                   placeholder="${ph}" value="${price || ''}">
            <div class="pt-cap">
              <span class="pt-cap-lb">เข้าพักได้</span>
              <input type="text" inputmode="numeric" class="num-plain cap-in"
                     id="opfCapMin${C}" placeholder="1" value="${cap.min || ''}">
              <span class="pt-cap-dash">–</span>
              <input type="text" inputmode="numeric" class="num-plain cap-in"
                     id="opfCapMax${C}" placeholder="2" value="${cap.max || ''}">
              <span class="pt-cap-lb">คน</span>
            </div>
          </div>`;
          }).join('')}
        </div>
        <div class="form-hint">
          กรอกเฉพาะแบบที่หอมี — หอที่มีทั้งสองแบบ การ์ดฝั่งนักศึกษาจะขึ้นเป็นช่วงราคา
          เช่น <strong>2,600 - 4,000 บาท/เดือน</strong><br>
          ช่อง "เข้าพักได้" คือจำนวนคนที่อยู่ห้องแบบนั้นได้ เช่น <strong>1 – 2</strong> จะขึ้นให้นักศึกษาเห็นว่า "เข้าพักได้ 1-2 คน"
          — อยู่ได้คนเดียวก็กรอกช่องแรกช่องเดียว หรือเว้นว่างทั้งคู่ถ้ายังไม่อยากระบุ<br>
          เว้นราคาว่างทั้งคู่ได้ หน้าหอจะขึ้นว่า "สอบถามกับหอโดยตรง"
        </div>
      </div>
      <!-- v39: ของในห้องแต่ละประเภท — ติ๊กครั้งเดียว ห้องในผังที่เลือกประเภทนี้ดึงไปใช้เอง -->
      <div class="form-field">
        <label>ของในห้องแต่ละประเภท</label>
        <div class="form-hint" style="margin-top:0">ติ๊กครั้งเดียว — ห้องในผังที่เลือกประเภทเป็นแอร์หรือพัดลม
          จะได้ของในห้องชุดนี้อัตโนมัติ ไม่ต้องกรอกทีละห้อง</div>
        ${typeAmenEditorHtml()}
      </div>
      <div class="form-field">
        <label class="tick"><input type="checkbox" id="opfVerified" ${d.verified?'checked':''}>
          <span>ยืนยันว่าข้อมูลนี้เป็นปัจจุบัน</span></label>
        <div class="form-hint">ติ๊กเมื่อตรวจสอบราคา ห้องว่าง และช่องทางติดต่อแล้ว (ต้องมีรูปและราคาก่อน)</div>
      </div>
      <div class="op-actions">
        <button class="btn btn-primary btn-sm" id="opBasicSave">บันทึก</button>
        <button class="btn btn-ghost btn-sm" data-closeinline="opBasicEdit">ยกเลิก</button>
      </div>
    </section>

    <div class="op-grid">
      <!-- ---------- คำอธิบายหอพัก (แก้ในหน้านี้ได้เลย) ---------- -->
      <section class="op-card">
        <h3>เกี่ยวกับหอพักนี้</h3>
        <p class="muted" style="font-size:.85rem;margin-top:-6px">
          อธิบายให้นักศึกษาทราบว่าหอพักเป็นอย่างไร ตั้งอยู่บริเวณใด มีอะไรอยู่ใกล้เคียงบ้าง เขียนเสร็จแล้วกดบันทึก
        </p>
        <textarea id="opDesc" rows="6" placeholder="เช่น หอพักหญิงล้วน 3 ชั้น ห่างจากประตู 1 โดยการเดินประมาณ 5 นาที มีร้านสะดวกซื้ออยู่หน้าหอพัก ภายในห้องมีเตียง ตู้เสื้อผ้า และโต๊ะเขียนหนังสือ...">${escapeHtml(d.desc||'')}</textarea>
        <div class="op-actions">
          <button class="btn btn-primary btn-sm" id="opSaveDesc">บันทึกคำอธิบาย</button>
          <span class="op-saved" id="opDescSaved"></span>
        </div>
      </section>

      <!-- ---------- สิ่งอำนวยความสะดวกส่วนกลาง (ของทั้งหอ) ----------
           v37: เปลี่ยนชื่อการ์ดให้ไม่ซ้ำกับ "สิ่งอำนวยความสะดวกในห้อง" ที่ตั้งรายห้องในผัง -->
      <section class="op-card">
        <div class="opc-head">
          <h3>สิ่งอำนวยความสะดวกส่วนกลาง</h3>
          <button type="button" class="btn btn-outline btn-sm" id="opFacToggle" title="เพิ่มหรือแก้ไข">＋ เพิ่มหรือแก้ไข</button>
        </div>
        <div id="opFacView">
          ${facs.length
            ? `<div class="amenity-grid">${amenityGridHtml(facs)}</div>`
            : `<p class="muted" style="font-size:.88rem">ยังไม่ได้ระบุ — กด "＋ เพิ่มหรือแก้ไข" เพื่อเลือก หรือพิมพ์เพิ่มเองในช่อง "อื่น ๆ"</p>`}
          <p class="form-hint">ของส่วนกลางที่ทั้งหอใช้ร่วมกัน — ส่วน "ของในห้อง" (แอร์ ตู้เย็น เตียง) ติ๊กครั้งเดียวตามประเภทห้องได้ที่ปุ่ม "✏️ เพิ่มหรือแก้ไข" ด้านบนสุด</p>
        </div>
        <div class="op-inline" id="opFacEdit" style="display:none">
          <div class="tick-pick">
            ${Object.keys(FACILITY_META).map(code=>`
              <label class="tick">
                <input type="checkbox" class="opFac" value="${code}" ${facs.includes(code)?'checked':''}>
                <span>${FACILITY_META[code].icon} ${escapeHtml(FACILITY_META[code].label)}</span>
              </label>`).join('')}
          </div>
          <div class="ef-row" style="margin-top:10px">
            <input type="text" id="opFacOther" placeholder="อื่น ๆ เช่น ตู้กดน้ำดื่ม, ลิฟต์, เครื่องทำน้ำอุ่น">
            <button type="button" class="btn btn-outline btn-sm" id="opFacAdd">+ เพิ่ม</button>
          </div>
          <div class="ef-chips" id="opFacChips"></div>
          <div class="op-actions">
            <button class="btn btn-primary btn-sm" id="opFacSave">บันทึก</button>
            <button class="btn btn-ghost btn-sm" id="opFacCancel">ยกเลิก</button>
          </div>
        </div>
      </section>

      <!-- ---------- ห้องพักและราคา ----------
           v36: แสดงตลอด ไม่ว่าจะวาดผังห้องแล้วหรือยัง
           ของเดิมซ่อนการ์ดนี้ทันทีที่เพิ่มชั้นหอพัก เจ้าของหอเลยงงว่าราคาที่กรอกไว้หายไปไหน
           (ราคาห้องพัดลม/ห้องแอร์คือราคาที่โชว์บนการ์ดฝั่งนักศึกษา คนละอันกับราคารายห้องในผัง) -->
      <section class="op-card">
        <h3>ห้องพักและราคา</h3>
        ${hasRoomTypes(d)
          ? `<div class="op-rooms">${roomTypes(d).map(r=>`
              <div class="op-room">
                <div>
                  <strong>${ROOM_TYPE_META[r.code] ? ROOM_TYPE_META[r.code].icon + ' ' : ''}${escapeHtml(r.label)}</strong>
                  <div class="muted" style="font-size:.82rem">${r.total > 0
                    ? `ทั้งหมด ${r.total} ห้อง`
                    : 'จำนวนห้องดูจากผังห้องพักด้านล่าง'}</div>
                  ${capacityLabel(r) ? `<div class="muted" style="font-size:.82rem">👥 เข้าพักได้ ${capacityLabel(r)}</div>` : ''}
                </div>
                <div class="op-room-price">${fmtBaht(r.price)} <span>บาท/เดือน</span></div>
                ${r.total > 0 ? `
                <div class="op-room-vac">
                  <button class="btn btn-sm btn-ghost" data-vac2="${d.id}|${escapeHtml(r.code)}|-1" title="ลดห้องว่าง">−</button>
                  <span class="op-vac-num">${r.vacant}</span>
                  <button class="btn btn-sm btn-ghost" data-vac2="${d.id}|${escapeHtml(r.code)}|1" title="เพิ่มห้องว่าง">+</button>
                  <small class="muted">ห้องว่าง</small>
                </div>` : ''}
              </div>`).join('')}</div>
             <p class="form-hint">แก้ราคาได้ที่ปุ่ม "✏️ เพิ่มหรือแก้ไข" ด้านบนสุดของหน้า</p>`
          : `<p class="muted" style="font-size:.88rem">ยังไม่ได้ใส่ราคาห้อง — นักศึกษาจะเห็นว่า "สอบถามราคากับหอโดยตรง"
               · ใส่ได้ที่ปุ่ม "✏️ เพิ่มหรือแก้ไข" ด้านบนสุดของหน้า</p>`}
      </section>

      <!-- ---------- รอบ ๆ หอมีอะไรบ้าง ---------- -->
      <section class="op-card op-nearby">
        <h3>รอบ ๆ หอมีอะไรบ้าง</h3>
        <p class="muted" style="font-size:.85rem;margin-top:-6px">
          ระบุสถานที่ใกล้หอพัก เช่น ร้านสะดวกซื้อ ร้านอาหาร ตลาด ตู้ ATM —
          เรื่องนี้เป็นสิ่งที่นักศึกษาถามบ่อยที่สุดตอนเลือกหอ
        </p>
        ${hasLocation(d) ? '' : `<p class="form-hint" style="color:#946A0E">
          ⚠️ หอนี้ยังไม่ได้ปักหมุด — ระบบจึงคิดระยะทางให้ไม่ได้
          ปักหมุดหอในการ์ด "ช่องทางติดต่อ" ก่อน แล้วค่อยมาเพิ่มร้านรอบ ๆ</p>`}
        <div class="ef-row">
          <select id="opNearCat">
            ${NEARBY_CAT_ORDER.map(c=>`<option value="${c}">${NEARBY_CATS[c].icon} ${escapeHtml(NEARBY_CATS[c].label)}</option>`).join('')}
          </select>
          <input type="text" id="opNearName" placeholder="ชื่อร้าน เช่น 7-Eleven หน้าหอ">
          <button type="button" class="btn btn-outline btn-sm" id="opNearPick">🗺️ เลือกตำแหน่งบนแผนที่</button>
          <button type="button" class="btn btn-outline btn-sm" id="opNearAdd">+ เพิ่มเอง</button>
        </div>
        <div class="form-hint">
          พิมพ์ชื่อร้าน แล้วกด <strong>"เลือกตำแหน่งบนแผนที่"</strong>
          แตะตรงตัวร้านบนแผนที่เหมือนตอนปักหมุดหอ —
          ระบบจะคิดระยะจากหอให้เองเป็นกิโลเมตร (เหมือนระยะหอ–มหาวิทยาลัย)<br>
          ไม่อยากปักหมุดก็กด "+ เพิ่มเอง" เพื่อบันทึกแค่ชื่อร้านไว้ก่อนได้
        </div>

        <!-- แผนที่เลือกร้าน — ทำงานเหมือนแผนที่ปักหมุดหอ -->
        <div class="near-pick" id="opNearPickBox" style="display:none">
          <div class="loc-map-wrap" style="margin-top:10px">
            <div id="opNearMap" class="loc-map"></div>
            <div class="loc-map-tools">
              <button type="button" class="btn btn-sm btn-ghost" id="opNearHome">🏠 กลับไปที่หอ</button>
            </div>
          </div>
          <div class="loc-state" id="opNearState"></div>
          <div class="op-actions">
            <button type="button" class="btn btn-primary btn-sm" id="opNearSave" disabled>+ เพิ่มร้านนี้</button>
            <button type="button" class="btn btn-ghost btn-sm" id="opNearCancel">ยกเลิก</button>
          </div>
        </div>
        <div id="opNearList" style="margin-top:12px">
          ${hasNearby(d)
            ? nearbyPlacesHtml(d.nearby, { edit:true, dorm:d })
            : '<p class="muted" style="font-size:.86rem">ยังไม่ได้กรอก — เพิ่มสัก 3-5 ที่ที่ใกล้หอที่สุดก็พอ</p>'}
        </div>
      </section>

      <!-- ---------- ช่องทางติดต่อ ---------- -->
      <section class="op-card">
        <div class="opc-head">
          <h3>ช่องทางติดต่อที่นักศึกษาเห็น</h3>
          <button type="button" class="btn btn-outline btn-sm" id="opConToggle">✏️ เพิ่มหรือแก้ไข</button>
        </div>
        <div class="op-loc" id="opLoc">
          ${hasLocation(d)
            ? `<span class="ok">📍 ปักหมุดแล้ว · ${escapeHtml(locationSummary(d))}</span>
               <a href="${mapDirectionsLink(d)}" target="_blank" rel="noopener">ดูเส้นทางจากมหาวิทยาลัย</a>`
            : `<span class="warn">📍 ยังไม่ได้ปักหมุดหอ — กด "เพิ่มหรือแก้ไข" แล้วแตะตำแหน่งหอบนแผนที่
               นักศึกษาจะได้กดนำทางมาหอได้ และเว็บจะบอกได้ว่าหอห่างมหาวิทยาลัยเท่าไหร่</span>`}
        </div>
        <div id="opConView">
          <div class="op-contact">
            <div><span class="k">เบอร์โทร</span> ${d.phone ? escapeHtml(d.phone) : '<span class="muted">ยังไม่ได้ใส่</span>'}</div>
            <div><span class="k">LINE</span> ${d.lineId ? escapeHtml(d.lineId) : '<span class="muted">ยังไม่ได้ใส่</span>'}</div>
            <div><span class="k">Facebook</span> ${d.facebook ? escapeHtml(d.facebook) : '<span class="muted">ยังไม่ได้ใส่</span>'}</div>
            <div><span class="k">อีเมล</span> ${d.contactEmail ? escapeHtml(d.contactEmail) : '<span class="muted">ใช้อีเมลที่สมัครสมาชิก</span>'}</div>
          </div>
        </div>

        <div class="op-inline" id="opConEdit" style="display:none">
          <div class="form-field"><label>เบอร์โทรหอพัก</label>
            <input type="tel" id="opfPhone" placeholder="08x-xxx-xxxx" value="${escapeAttr(d.phone||'')}"></div>
          <div class="form-field"><label>LINE ID หรือลิงก์ LINE</label>
            <input type="text" id="opfLine" placeholder="@dormcru หรือ https://line.me/..." value="${escapeAttr(d.lineId||'')}"></div>
          <div class="form-field"><label>ลิงก์เพจ Facebook</label>
            <input type="text" id="opfFacebook" placeholder="https://facebook.com/..." value="${escapeAttr(d.facebook||'')}"></div>
          <div class="form-field"><label>📧 อีเมล</label>
            <input type="email" id="opfEmail" placeholder="เช่น dorm.banfai@gmail.com" value="${escapeAttr(d.contactEmail||'')}">
            <div class="form-hint">เว้นว่างได้ ระบบจะใช้อีเมลที่คุณใช้สมัครสมาชิกแทน</div>
          </div>

          <!-- ตำแหน่งหอบนแผนที่ — ใช้แผนที่เดียวกับตอนเลือกร้านรอบหอ -->
          <div class="form-field">
            <label>📍 ตำแหน่งหอพักบนแผนที่</label>
            <p class="form-hint" style="margin-top:0">
              <strong>แตะบนแผนที่ตรงหอของคุณ</strong> หรือลากหมุดไปวาง —
              หมุดนี้คือจุดที่นักศึกษาจะกดนำทางมา
            </p>
            <div class="loc-map-wrap">
              <div id="opLocMap" class="loc-map"></div>
              <div class="loc-map-tools">
                <button type="button" class="btn btn-sm btn-primary" id="opLocHere">📱 ใช้ตำแหน่งที่ฉันยืนอยู่ตอนนี้</button>
                <button type="button" class="btn btn-sm btn-ghost" id="opLocCrru">🎓 ไปที่มหาวิทยาลัย</button>
                <button type="button" class="btn btn-sm btn-ghost" id="opLocClear">ล้างหมุด</button>
              </div>
            </div>
            <div class="loc-state" id="opLocState"></div>
            <details class="loc-adv">
              <summary>วิธีอื่น: วางลิงก์ Google Maps</summary>
              <div class="ef-row" style="margin-top:8px">
                <input type="text" id="opfMapLink" placeholder="วางลิงก์ Google Maps ของหอที่นี่">
                <button type="button" class="btn btn-outline btn-sm" id="opLocLink">ใช้ลิงก์นี้</button>
              </div>
            </details>
          </div>

          <div class="op-actions">
            <button class="btn btn-primary btn-sm" id="opConSave">บันทึก</button>
            <button class="btn btn-ghost btn-sm" id="opConCancel">ยกเลิก</button>
          </div>
        </div>
      </section>
    </div>

    <!-- ---------- ผังห้องพักแต่ละชั้น ---------- -->
    <section class="op-card op-plan">
      <div class="op-plan-head">
        <div>
          <h3>ผังห้องพัก</h3>
          <p class="muted" style="font-size:.85rem;margin:0">
            ระบุว่าหอพักมีกี่ชั้น แต่ละชั้นมีห้องใดบ้าง — นักศึกษาจะเห็นผังนี้ในหน้าหอพักของคุณ
            และกดนัดหมายห้องที่ต้องการได้โดยตรง กดที่ช่องห้องเพื่อแก้ไขเลขห้อง ประเภทห้อง และสถานะ
          </p>
        </div>
        ${(()=>{ const s = planSummary(d.floorPlan); return s.total ? `
          <div class="op-plan-sum">
            <span><strong>${s.total}</strong> ห้อง</span>
            ${ROOM_STATUS_ORDER.map(k=>
              `<span class="${ROOM_STATUS_META[k].cls}-txt">${ROOM_STATUS_META[k].label} <strong>${s[k]}</strong></span>`).join('')}
          </div>` : ''; })()}
      </div>
      <div id="opPlan">${floorPlanHtml(d.floorPlan, { edit:true })}</div>
    </section>

    <!-- ---------- รีวิวจากผู้ใช้ ---------- -->
    <section class="op-card op-reviews">
      <h3>⭐ รีวิวจากผู้ใช้</h3>
      ${sum.count ? `
        <div class="rev-summary">
          <div class="rev-score">${sum.avg}<small>/5</small></div>
          <div class="rev-bars">
            ${[5,4,3,2,1].map(s=>`
              <div class="rev-bar">
                <span>${s}★</span>
                <div class="rb-track"><div class="rb-fill" style="width:${sum.count?Math.round(sum.dist[s]/sum.count*100):0}%"></div></div>
                <em>${sum.dist[s]}</em>
              </div>`).join('')}
          </div>
        </div>
        <div class="rev-list">
          ${reviews.map(r=>`
            <div class="rev-item">
              <div class="rev-top">
                <strong>${escapeHtml(r.userName)}</strong>
                ${starsHtml(r.rating)}
                <span class="muted">${fmtChatTime(r.createdAt)}</span>
              </div>
              ${r.body ? `<p>${escapeHtml(r.body)}</p>` : '<p class="muted">(ให้ดาวอย่างเดียว ไม่ได้เขียนข้อความ)</p>'}
              ${ME.role==='admin' ? `<button class="btn btn-sm btn-reject" data-delrev="${r.id}">ลบรีวิวนี้</button>` : ''}
            </div>`).join('')}
        </div>`
        : `<p class="muted" style="font-size:.9rem">
             ยังไม่มีใครรีวิวหอนี้ — เมื่อมีนักศึกษาเข้าไปรีวิวในหน้าหอของคุณ คะแนนจะมาแสดงที่นี่
           </p>`}
    </section>
  </div>`;

  // ---- ผูกปุ่มทั้งหมดในหน้านี้ ----
  box.querySelectorAll('[data-dorm]').forEach(b=>{
    b.addEventListener('click', ()=>{ activeOwnerDormId = b.dataset.dorm; renderOwnerPage(); });
  });
  const addDormBtn = document.getElementById('opAddDorm');
  if(addDormBtn) addDormBtn.addEventListener('click', ()=> openEdit(null));

  // ---- แก้ไขข้อมูลพื้นฐาน (ชื่อ / ประเภท / ราคาเริ่มต้น) ในหน้านี้เลย ----
  // เดิมปุ่มนี้กางฟอร์มใหญ่ #editPanel ออกมาทั้งแผง ซึ่งเจ้าของหอบอกว่าเหมือน
  // "เพิ่มหน้าใหม่ขึ้นมาอีกหน้า" — ตอนนี้แก้ทีละการ์ดในหน้าหอของตัวเองได้เลย
  // (#editPanel เหลือไว้ใช้ตอน "เพิ่มหอใหม่" และตอนผู้ดูแลระบบแก้หอของคนอื่นเท่านั้น)
  const editBtn = document.getElementById('opEdit');
  const basicBox = document.getElementById('opBasicEdit');
  const toggleInline = (box, on)=>{
    if(!box) return;
    const show = (on == null) ? (box.style.display === 'none') : !!on;
    box.style.display = show ? 'block' : 'none';
    if(show) setTimeout(()=> box.scrollIntoView({ behavior:'smooth', block:'center' }), 20);
    return show;
  };
  if(editBtn) editBtn.addEventListener('click', ()=> toggleInline(basicBox));
  box.querySelectorAll('[data-closeinline]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const t = document.getElementById(b.dataset.closeinline);
      if(t) t.style.display = 'none';
    });
  });

  const basicSave = document.getElementById('opBasicSave');
  if(basicSave) basicSave.addEventListener('click', async ()=>{
    const name = document.getElementById('opfName').value.trim();
    if(!name){ toast('กรุณาใส่ชื่อหอพัก','error'); return; }
    // v43: ช่องราคาเป็นช่องพิมพ์ธรรมดา เลยต้องกรองให้เหลือแต่ตัวเลขก่อนคิด
    const readPrice = (id, name)=>{
      const raw = plainNumber(document.getElementById(id).value);
      if(raw === '') return 0;
      const n = +raw;
      if(isNaN(n) || n < 0){ toast(`ราคา${name}ต้องเป็นตัวเลขที่ไม่ติดลบ`,'error'); return null; }
      return n;
    };
    const fanPrice = readPrice('opfPriceFan', 'ห้องพัดลม');
    const airPrice = readPrice('opfPriceAir', 'ห้องแอร์');
    if(fanPrice === null || airPrice === null) return;
    // จำนวนผู้เข้าพักต่อห้อง (v43) — เจ้าของหอกำหนดเองทีละประเภทห้อง
    const caps = readCapInputs('opfCap');
    if(caps === null) return;
    if(!(fanPrice > 0) && caps.fan){ toast('กรอกจำนวนผู้เข้าพักห้องพัดลมไว้ แต่ยังไม่ได้ใส่ราคา — กรุณาใส่ราคาห้องพัดลมด้วย','error'); return; }
    if(!(airPrice > 0) && caps.air){ toast('กรอกจำนวนผู้เข้าพักห้องแอร์ไว้ แต่ยังไม่ได้ใส่ราคา — กรุณาใส่ราคาห้องแอร์ด้วย','error'); return; }
    // เก็บเป็นรายการห้องพัดลม/ห้องแอร์ คงจำนวนห้อง-ห้องว่างเดิมไว้ให้
    const rooms = buildPriceRooms(d, fanPrice, airPrice, caps);
    const verified = document.getElementById('opfVerified').checked;
    if(verified && !(d.images||[]).length){ toast('ถ้าจะยืนยันข้อมูล กรุณาเพิ่มรูปหอพักอย่างน้อย 1 รูปก่อน','error'); return; }
    if(verified && !rooms.length){ toast('ถ้าจะยืนยันข้อมูล กรุณาใส่ราคาห้องพัดลมหรือห้องแอร์ก่อน','error'); return; }
    basicSave.disabled = true;
    try{
      // ของในห้องแต่ละประเภท เก็บรวมไว้ในผังห้อง (floor_plan.typeAmen)
      const plan = normalizeFloorPlan(d.floorPlan);
      const ta = Object.assign({}, plan.typeAmen);
      Object.assign(ta, taBasic.values());
      plan.typeAmen = normalizeTypeAmen(ta);
      await updateDorm(d.id, { ...d, name, hallType: document.getElementById('opfHallType').value, rooms, verified, floorPlan: plan });
      toast('บันทึกข้อมูลหอแล้ว','success');
      await renderOwnerPage(); renderStats(); renderListings();
    }catch(err){ console.error(err); toast('บันทึกไม่สำเร็จ: '+(err.message||''),'error'); }
    finally{ basicSave.disabled = false; }
  });

  // ---- สิ่งอำนวยความสะดวก: กด "＋ เพิ่มหรือแก้ไข" แล้วติ๊กในการ์ดนี้เลย ----
  let facCustom = (d.facilities||[]).filter(isCustomFacility);
  const facChips = ()=>{
    const cbox = document.getElementById('opFacChips');
    if(!cbox) return;
    cbox.innerHTML = facCustom.map(c=>`
      <span class="ef-chip">${escapeHtml(c)}
        <button type="button" data-rmfac2="${escapeAttr(c)}" title="ลบ">✕</button>
      </span>`).join('');
    cbox.querySelectorAll('[data-rmfac2]').forEach(b=>{
      b.addEventListener('click', ()=>{
        facCustom = facCustom.filter(x => x !== b.dataset.rmfac2);
        facChips();
      });
    });
  };
  facChips();
  const facEditBox = document.getElementById('opFacEdit');
  document.getElementById('opFacToggle')?.addEventListener('click', ()=>{
    const on = toggleInline(facEditBox);
    const view = document.getElementById('opFacView');
    if(view) view.style.display = on ? 'none' : 'block';
  });
  const closeFacEdit = ()=>{
    if(facEditBox) facEditBox.style.display = 'none';
    const view = document.getElementById('opFacView');
    if(view) view.style.display = 'block';
  };
  document.getElementById('opFacCancel')?.addEventListener('click', closeFacEdit);
  const addFacCustom = ()=>{
    const input = document.getElementById('opFacOther');
    const text = (input.value||'').trim().slice(0,40);
    if(!text) return;
    if(FACILITY_META[text]){ toast('รายการนี้มีในช่องติ๊กด้านบนแล้ว','error'); input.value=''; return; }
    if(facCustom.some(x => x.toLowerCase() === text.toLowerCase())){
      toast('เพิ่มรายการนี้ไปแล้ว','error'); input.value=''; return;
    }
    facCustom.push(text); input.value = ''; facChips();
  };
  document.getElementById('opFacAdd')?.addEventListener('click', addFacCustom);
  document.getElementById('opFacOther')?.addEventListener('keydown', (e)=>{
    if(e.key === 'Enter'){ e.preventDefault(); addFacCustom(); }
  });
  // ---- ของในห้องแต่ละประเภท (v38) — อยู่ในฟอร์มข้อมูลพื้นฐานของหอ ----
  const taBasic = mountTypeAmenEditor(document.getElementById('opBasicEdit'), code=> typeAmenFor(d, code));

  const facSave = document.getElementById('opFacSave');
  if(facSave) facSave.addEventListener('click', async ()=>{
    const checked = Array.from(document.querySelectorAll('.opFac:checked')).map(cb=>cb.value);
    facSave.disabled = true;
    try{
      await updateDorm(d.id, { ...d, facilities: checked.concat(facCustom) });
      toast('บันทึกสิ่งอำนวยความสะดวกแล้ว','success');
      await renderOwnerPage(); renderStats(); renderListings();
    }catch(err){ console.error(err); toast('บันทึกไม่สำเร็จ: '+(err.message||''),'error'); }
    finally{ facSave.disabled = false; }
  });

  // ลบหอของตัวเอง (ย้ายมาจากหน้า "จัดการห้องพัก" ที่ถูกเอาออกแล้ว)
  const delBtn = document.getElementById('opDelete');
  if(delBtn) delBtn.addEventListener('click', async ()=>{
    if(!confirm(`ลบหอ "${d.name}" ออกจากระบบ?\n\n` +
                'ผังห้อง รูปภาพ รีวิว และประวัติการนัดหมายของหอนี้จะหายไปทั้งหมด\nลบแล้วกู้คืนไม่ได้')) return;
    if(!confirm('ยืนยันอีกครั้ง — ลบหอนี้ถาวรใช่ไหม')) return;
    try{
      await deleteDorm(d.id);
      activeOwnerDormId = null;
      toast('ลบหอพักแล้ว','success');
      await renderOwnerPage(); renderStats(); renderListings();
    }catch(err){ console.error(err); toast('ลบไม่สำเร็จ: '+(err.message||''),'error'); }
  });

  // อัปโหลดรูปจากเครื่อง — ใช้ช่อง "＋ เพิ่มรูป" ท้ายแถวรูปย่อ
  const fileInput = document.getElementById('opPhotoInput');
  const addBtn = document.getElementById('opAddPhoto2');
  if(addBtn) addBtn.addEventListener('click', ()=> fileInput.click());
  if(fileInput){
    fileInput.addEventListener('change', async ()=>{
      const files = fileInput.files;
      if(!files || !files.length) return;
      await addPhotosToDorm(d, files);
      fileInput.value = '';
    });
  }

  // กดที่รูป (ทั้งรูปปกและรูปย่อ) = เปิดดูขนาดเต็มตามสัดส่วนจริงของรูป
  box.querySelectorAll('.op-cover > img, .op-photo:not(.add) img').forEach(img=>{
    img.addEventListener('click', (e)=>{
      e.stopPropagation();
      openPhotoViewer(d.images || [], img.src);
    });
  });

  // ตั้งรูปปก / ลบรูป
  box.querySelectorAll('[data-cover]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const i = +b.dataset.cover;
      const next = d.images.slice();
      const [pick] = next.splice(i,1);
      next.unshift(pick);
      await saveDormImages(d, next, 'ตั้งเป็นรูปปกแล้ว');
    });
  });
  box.querySelectorAll('[data-rmphoto]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const i = +b.dataset.rmphoto;
      if(!confirm('ลบรูปนี้ออกจากหน้าหอพัก?')) return;
      const removed = d.images[i];
      const next = d.images.filter((_,idx)=> idx !== i);
      await saveDormImages(d, next, 'ลบรูปแล้ว');
      deleteDormPhoto(removed);   // ลบไฟล์จริงในที่เก็บ (ล้มเหลวก็ไม่เป็นไร)
    });
  });

  // บันทึกคำอธิบายจากหน้านี้เลย
  const saveDesc = document.getElementById('opSaveDesc');
  if(saveDesc) saveDesc.addEventListener('click', async ()=>{
    const text = document.getElementById('opDesc').value.trim();
    saveDesc.disabled = true;
    try{
      await updateDorm(d.id, { ...d, desc: text });
      d.desc = text;
      const tag = document.getElementById('opDescSaved');
      if(tag){ tag.textContent = '✓ บันทึกแล้ว'; setTimeout(()=>{ tag.textContent=''; }, 2500); }
      toast('บันทึกคำอธิบายหอพักแล้ว','success');
    }catch(err){ console.error(err); toast('บันทึกไม่สำเร็จ: '+(err.message||''),'error'); }
    finally{ saveDesc.disabled = false; }
  });

  // ปรับห้องว่างเร็ว ๆ จากหน้านี้
  box.querySelectorAll('[data-vac2]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const [dormId, code, deltaStr] = b.dataset.vac2.split('|');
      const delta = parseInt(deltaStr, 10);
      const rooms = (d.rooms||[]).map(r => r.code !== code ? r
        : { ...r, vacant: Math.max(0, Math.min(r.total, r.vacant + delta)) });
      try{
        await updateDorm(dormId, { ...d, rooms });
        await renderOwnerPage(); renderStats(); renderListings();
      }catch(err){ console.error(err); toast('ปรับห้องว่างไม่สำเร็จ: '+err.message,'error'); }
    });
  });

  // ผังห้องพัก — ปุ่มเพิ่มชั้น/แถว/ห้อง/บันได และกดห้องเพื่อแก้รายละเอียด
  bindPlanEditor(box, d);

  // รอบ ๆ หอมีอะไรบ้าง — เพิ่ม/ลบรายการ
  // pin = {lat,lng} ถ้าเลือกตำแหน่งบนแผนที่ไว้ (ระบบคิดระยะให้เอง)
  const addNear = async (pin)=>{
    const name = document.getElementById('opNearName').value.trim();
    if(!name){ toast('กรุณาใส่ชื่อร้านหรือสถานที่','error'); return; }
    const list = (d.nearby || []).slice();
    if(list.length >= 30){ toast('เพิ่มได้สูงสุด 30 รายการ','error'); return; }
    list.push({
      cat:  document.getElementById('opNearCat').value,
      name: name.slice(0,60),
      dist: '',
      lat: pin ? pin.lat : null,
      lng: pin ? pin.lng : null
    });
    document.getElementById('opNearName').value = '';
    await saveNearby(d, list, pin ? 'เพิ่มแล้ว — ระบบคิดระยะทางให้เรียบร้อย' : 'เพิ่มแล้ว');
  };
  document.getElementById('opNearAdd')?.addEventListener('click', ()=> addNear(null));

  // ---- เลือกตำแหน่งร้านบนแผนที่ ----
  //
  // ของเดิมเป็นช่อง "หาบนแผนที่" ที่ส่งชื่อร้านไปค้นทั้งประเทศ
  // พิมพ์ "7-Eleven" ทีนึงได้สาขาเพชรบูรณ์ห่าง 406 กม. ขึ้นมาให้เลือกด้วย ซึ่งไม่ช่วยอะไร
  // ตอนนี้เปลี่ยนเป็น "แตะเลือกจุดบนแผนที่" แบบเดียวกับตอนปักหมุดหอ
  // เพราะเจ้าของหอรู้อยู่แล้วว่าร้านอยู่ตรงไหน และเห็นกับตาว่าหมุดลงถูกที่
  const nearPickBox = document.getElementById('opNearPickBox');
  const nearSaveBtn = document.getElementById('opNearSave');
  const dormPoint = hasLocation(d) ? { lat:d.lat, lng:d.lng } : null;
  let nearPin = null;

  const setNearState = (msg, kind)=>{
    const el = document.getElementById('opNearState');
    if(!el) return;
    el.className = 'loc-state' + (kind ? ' ' + kind : '');
    el.innerHTML = msg || '';
    el.style.display = msg ? 'block' : 'none';
  };

  const onNearPick = (lat, lng)=>{
    nearPin = { lat, lng };
    if(nearSaveBtn) nearSaveBtn.disabled = false;
    if(dormPoint){
      const km = haversineKm(nearPin, dormPoint);
      setNearState(`✓ เลือกจุดแล้ว — ห่างจากหอ <strong>${distanceLabel(km)}</strong>
        · ลากหมุดปรับได้ แล้วกด "+ เพิ่มร้านนี้"`, km <= 2 ? 'ok' : 'warn');
    }else{
      setNearState('✓ เลือกจุดแล้ว — แต่หอยังไม่ได้ปักหมุด ระบบจึงยังคิดระยะให้ไม่ได้','warn');
    }
  };

  const openNearPick = ()=>{
    if(!nearPickBox) return;
    nearPickBox.style.display = 'block';
    nearPin = null;
    if(nearSaveBtn) nearSaveBtn.disabled = true;
    const ok = pickMap('opNearMap', {
      center: dormPoint || CRRU_CENTER,
      zoom: 17,
      pinKind: 'shop',
      ref: dormPoint,
      onPick: onNearPick
    });
    if(!ok){
      setNearState('⚠️ แผนที่โหลดไม่ขึ้น — กด "+ เพิ่มเอง" เพื่อบันทึกแค่ชื่อร้านไว้ก่อนได้','warn');
      return;
    }
    setNearState(dormPoint
      ? 'ซูมเข้าไปแล้ว<strong>แตะตรงตัวร้าน</strong> — บนแผนที่จะเห็นชื่อร้านอยู่แล้ว หมุด 🏠 คือหอของคุณ'
      : 'แตะตรงตัวร้านบนแผนที่ (หอนี้ยังไม่ได้ปักหมุด ระบบจึงยังคิดระยะให้ไม่ได้)');
    setTimeout(()=> nearPickBox.scrollIntoView({ behavior:'smooth', block:'center' }), 40);
  };
  const closeNearPick = ()=>{
    if(nearPickBox) nearPickBox.style.display = 'none';
    nearPin = null;
  };
  document.getElementById('opNearPick')?.addEventListener('click', ()=>{
    if(nearPickBox && nearPickBox.style.display === 'block') closeNearPick();
    else openNearPick();
  });
  document.getElementById('opNearCancel')?.addEventListener('click', closeNearPick);
  document.getElementById('opNearHome')?.addEventListener('click', ()=>{
    const S = PICK_MAPS['opNearMap'];
    if(S && S.map) S.map.setView([(dormPoint||CRRU_CENTER).lat, (dormPoint||CRRU_CENTER).lng], 17);
  });
  if(nearSaveBtn) nearSaveBtn.addEventListener('click', async ()=>{
    if(!nearPin){ toast('แตะบนแผนที่เพื่อเลือกตำแหน่งร้านก่อน','error'); return; }
    if(!document.getElementById('opNearName').value.trim()){
      toast('กรุณาใส่ชื่อร้านในช่องด้านบนก่อน','error'); return;
    }
    await addNear(nearPin);
  });
  document.getElementById('opNearName')?.addEventListener('keydown', (e)=>{
    // Enter = เปิดแผนที่ให้เลือกจุด (วิธีที่แนะนำ) ไม่ใช่เพิ่มเองทันที
    if(e.key === 'Enter'){ e.preventDefault(); openNearPick(); }
  });
  box.querySelectorAll('[data-rmnear]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const i = +b.dataset.rmnear;
      const list = (d.nearby || []).filter((_,idx)=> idx !== i);
      await saveNearby(d, list, 'ลบแล้ว');
    });
  });

  // ---- ช่องทางติดต่อ + ตำแหน่งหอ: แก้ในการ์ดนี้เลย ----
  const conEditBox = document.getElementById('opConEdit');
  let conPin = dormPoint ? { ...dormPoint } : null;

  const setConState = (msg, kind)=>{
    const el = document.getElementById('opLocState');
    if(!el) return;
    el.className = 'loc-state' + (kind ? ' ' + kind : '');
    el.innerHTML = msg || (conPin
      ? `📍 ปักหมุดแล้ว — <strong>${locationSummary(conPin)}</strong>
         <a href="https://www.google.com/maps?q=${conPin.lat},${conPin.lng}" target="_blank" rel="noopener">เปิดหมุดนี้ใน Google Maps เพื่อตรวจสอบ</a>`
      : 'ยังไม่ได้ปักหมุด — แตะบนแผนที่ตรงหอของคุณ');
    el.style.display = 'block';
  };
  const setConPin = (lat, lng, opts)=>{
    conPin = (lat == null) ? null : { lat:+(+lat).toFixed(6), lng:+(+lng).toFixed(6) };
    setPick('opLocMap', conPin ? conPin.lat : null, conPin ? conPin.lng : null);
    if(conPin && opts && opts.pan){
      const S = PICK_MAPS['opLocMap'];
      if(S && S.map) S.map.setView([conPin.lat, conPin.lng], Math.max(S.map.getZoom(), 17));
    }
    setConState((opts && opts.msg) || '', (opts && opts.kind) || '');
  };

  const openConEdit = ()=>{
    const on = toggleInline(conEditBox);
    const view = document.getElementById('opConView');
    if(view) view.style.display = on ? 'none' : 'block';
    if(!on) return;
    const ok = pickMap('opLocMap', {
      center: conPin || CRRU_CENTER,
      zoom: conPin ? 17 : 15,
      pinKind: 'dorm',
      ref: CRRU_CENTER,
      refKind: 'crru',
      refLabel: 'มหาวิทยาลัยราชภัฏเชียงราย',
      pin: conPin,
      onPick: (lat,lng)=>{ conPin = {lat,lng}; setConState('', 'ok'); }
    });
    if(!ok) setConState('⚠️ แผนที่โหลดไม่ขึ้น — ใช้ช่อง "วางลิงก์ Google Maps" ด้านล่างแทนได้','warn');
    else setConState('');
  };
  document.getElementById('opConToggle')?.addEventListener('click', openConEdit);
  const closeConEdit = ()=>{
    if(conEditBox) conEditBox.style.display = 'none';
    const view = document.getElementById('opConView');
    if(view) view.style.display = 'block';
    stopOwnerGps();
  };
  document.getElementById('opConCancel')?.addEventListener('click', closeConEdit);

  document.getElementById('opLocCrru')?.addEventListener('click', ()=>{
    const S = PICK_MAPS['opLocMap'];
    if(S && S.map) S.map.setView([CRRU_CENTER.lat, CRRU_CENTER.lng], 16);
  });
  document.getElementById('opLocClear')?.addEventListener('click', ()=>{
    setConPin(null, null, { msg:'ล้างหมุดแล้ว — แตะบนแผนที่เพื่อปักใหม่' });
  });
  document.getElementById('opLocLink')?.addEventListener('click', ()=>{
    const text = document.getElementById('opfMapLink').value.trim();
    const p = parseLatLng(text);
    if(!p){ setConState('กรุณาวางลิงก์ Google Maps ของหอก่อน','warn'); return; }
    if(p.error){ setConState('⚠️ ' + p.error,'warn'); return; }
    setConPin(p.lat, p.lng, { pan:true, msg:'✓ ใช้ตำแหน่งจากลิงก์แล้ว — ตรวจดูว่าหมุดตรงหอไหม ถ้าไม่ตรงลากปรับได้', kind:'ok' });
  });
  document.getElementById('opLocHere')?.addEventListener('click', ()=>{
    ownerGpsPick((lat,lng,acc,msg,kind)=> setConPin(lat, lng, { pan:true, msg, kind }),
                 (msg,kind)=> setConState(msg, kind));
  });

  const conSave = document.getElementById('opConSave');
  if(conSave) conSave.addEventListener('click', async ()=>{
    conSave.disabled = true;
    try{
      await updateDorm(d.id, {
        ...d,
        phone:        document.getElementById('opfPhone').value.trim(),
        lineId:       document.getElementById('opfLine').value.trim(),
        facebook:     document.getElementById('opfFacebook').value.trim(),
        contactEmail: document.getElementById('opfEmail').value.trim(),
        lat: conPin ? conPin.lat : null,
        lng: conPin ? conPin.lng : null
      });
      stopOwnerGps();
      toast('บันทึกช่องทางติดต่อแล้ว','success');
      await renderOwnerPage(); renderStats(); renderListings();
    }catch(err){ console.error(err); toast('บันทึกไม่สำเร็จ: '+(err.message||''),'error'); }
    finally{ conSave.disabled = false; }
  });

  // ผู้ดูแลระบบลบรีวิวที่ไม่เหมาะสม
  box.querySelectorAll('[data-delrev]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      if(!confirm('ลบรีวิวนี้?')) return;
      try{ await deleteReview(b.dataset.delrev); toast('ลบรีวิวแล้ว','success'); renderOwnerPage(); }
      catch(err){ console.error(err); toast('ลบไม่สำเร็จ: '+(err.message||''),'error'); }
    });
  });
}

// ===========================================================================
// ตัวแก้ไขผังห้องพัก (ฝั่งเจ้าของหอ)
//
// ทุกการแก้ไขทำกับสำเนาผังในหน่วยความจำก่อน แล้วค่อยบันทึกลงฐานข้อมูลทีเดียว
// ผ่าน updateDorm() — เจ้าของหอแก้หอของตัวเองได้อยู่แล้วตาม RLS
// ===========================================================================
let planRoomCtx = null;   // ห้องที่กำลังเปิด pop up แก้อยู่ {dorm, cellId}

function nextRoomNumber(dorm, floorIndex){
  // เดาเลขห้องถัดไปให้อัตโนมัติ เช่น ชั้น 1 -> 101, 102 ... ชั้น 2 -> 201
  const used = eachRoomCell(dorm.floorPlan).map(x=>x.cell.no).filter(Boolean);
  const base = (floorIndex + 1) * 100;
  for(let i = 1; i <= 99; i++){
    const cand = String(base + i);
    if(!used.includes(cand)) return cand;
  }
  return '';
}

// บันทึกผังที่แก้แล้วลงฐานข้อมูล แล้ววาดหน้าใหม่
async function savePlan(dorm, plan, okMsg){
  try{
    await updateDorm(dorm.id, { ...dorm, floorPlan: plan });
    dorm.floorPlan = plan;
    if(okMsg) toast(okMsg, 'success');
    await renderOwnerPage(); renderStats(); renderListings();
  }catch(err){
    console.error(err);
    toast('บันทึกผังห้องไม่สำเร็จ: ' + (err.message || ''), 'error');
  }
}

function bindPlanEditor(box, d){
  const plan = () => normalizeFloorPlan(d.floorPlan);

  // ---- เพิ่มชั้น ----
  box.querySelectorAll('[data-addfloor]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const p = plan();
      const n = p.floors.length + 1;
      const name = prompt('ชื่อชั้นใหม่', 'ชั้น ' + n);
      if(name === null) return;
      p.floors.push({ id:'f'+Date.now().toString(36), name: (name||'ชั้น '+n).trim().slice(0,20), rows: [{ id:'r'+Date.now().toString(36), cells: [] }] });
      await savePlan(d, p, 'เพิ่มชั้นแล้ว');
    });
  });

  // ---- เปลี่ยนชื่อชั้น / ลบชั้น ----
  box.querySelectorAll('[data-renamefloor]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const p = plan();
      const f = p.floors.find(x=>x.id === b.dataset.renamefloor);
      if(!f) return;
      const name = prompt('ชื่อชั้น', f.name);
      if(name === null || !name.trim()) return;
      f.name = name.trim().slice(0,20);
      await savePlan(d, p, 'เปลี่ยนชื่อชั้นแล้ว');
    });
  });
  box.querySelectorAll('[data-rmfloor]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const p = plan();
      const f = p.floors.find(x=>x.id === b.dataset.rmfloor);
      if(!f) return;
      const n = planSummary({ floors:[f] }).total;
      if(!confirm(`ลบ "${f.name}" ทั้งชั้น?\n\nห้องในชั้นนี้ ${n} ห้องจะหายไปจากผังด้วย`)) return;
      p.floors = p.floors.filter(x=>x.id !== b.dataset.rmfloor);
      await savePlan(d, p, 'ลบชั้นแล้ว');
    });
  });

  // ---- เพิ่มแถว / ลบแถว ----
  box.querySelectorAll('[data-addrow]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const p = plan();
      const f = p.floors.find(x=>x.id === b.dataset.addrow);
      if(!f) return;
      f.rows.push({ id:'r'+Date.now().toString(36), cells: [] });
      await savePlan(d, p, 'เพิ่มแถวแล้ว');
    });
  });
  box.querySelectorAll('[data-rmrow]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const [fid, rid] = b.dataset.rmrow.split('|');
      const p = plan();
      const f = p.floors.find(x=>x.id === fid);
      if(!f) return;
      const row = f.rows.find(x=>x.id === rid);
      const n = (row ? row.cells : []).filter(c=>(c.k||'room')==='room').length;
      if(n > 0 && !confirm(`ลบแถวนี้? ห้อง ${n} ห้องในแถวจะหายไปด้วย`)) return;
      f.rows = f.rows.filter(x=>x.id !== rid);
      await savePlan(d, p, 'ลบแถวแล้ว');
    });
  });

  // ---- เพิ่มห้อง / เพิ่มบันได ----
  box.querySelectorAll('[data-addroom]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const [fid, rid] = b.dataset.addroom.split('|');
      const p = plan();
      const fi = p.floors.findIndex(x=>x.id === fid);
      if(fi < 0) return;
      const row = p.floors[fi].rows.find(x=>x.id === rid);
      if(!row) return;
      const firstType = (roomTypes(d)[0] || {}).code || '';
      row.cells.push({ k:'room', id:newCellId(), no: nextRoomNumber(d, fi),
        type: firstType, price: null, status:'vacant', note:'' });
      await savePlan(d, p, '');
    });
  });
  box.querySelectorAll('[data-addstair]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const [fid, rid] = b.dataset.addstair.split('|');
      const label = prompt('ช่องนี้คืออะไร (ไม่ใช่ห้องพัก)', 'บันได');
      if(label === null) return;
      const p = plan();
      const f = p.floors.find(x=>x.id === fid);
      const row = f && f.rows.find(x=>x.id === rid);
      if(!row) return;
      row.cells.push({ k:'stair', id:newCellId(), label: (label||'บันได').trim().slice(0,16) });
      await savePlan(d, p, '');
    });
  });

  // ---- เอาช่องบันไดออก ----
  box.querySelectorAll('[data-rmcell]').forEach(b=>{
    b.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const p = plan();
      p.floors.forEach(f=> f.rows.forEach(r=>{ r.cells = r.cells.filter(c=>c.id !== b.dataset.rmcell); }));
      await savePlan(d, p, '');
    });
  });

  // ---- กดที่ช่องห้อง -> เปิด pop up แก้รายละเอียด ----
  box.querySelectorAll('.fp-room[data-cell]').forEach(el=>{
    el.addEventListener('click', ()=> openRoomEditor(d, el.dataset.cell));
  });
}

// ---------------------------------------------------------------------------
// สิ่งอำนวยความสะดวกในห้อง (ของที่มีในห้องนั้น ๆ)
// ต่างจาก "สิ่งอำนวยความสะดวกของหอ" ตรงที่อันนี้เป็นของในห้อง แต่ละห้องไม่เหมือนกันได้
// ---------------------------------------------------------------------------
// v44: ตัดตัวเลือกที่รวมทุกอย่างไว้เป็นคำเดียวออก เพราะซ้ำซ้อนกับรายการอื่นในชุดนี้
// (เตียง ตู้เสื้อผ้า โต๊ะเขียนหนังสือ ก็คือเฟอร์นิเจอร์อยู่แล้ว) และคำว่า "ครบ"
// ก็ไม่ได้บอกว่าครบแค่ไหน นักศึกษาตีความไม่ตรงกัน
const ROOM_AMEN_PRESETS = ['แอร์','พัดลม','เครื่องทำน้ำอุ่น','ตู้เย็น','ทีวี','ระเบียง',
                           'เตียง','ตู้เสื้อผ้า','โต๊ะเขียนหนังสือ','ห้องน้ำในตัว','อินเทอร์เน็ต'];

// ---------------------------------------------------------------------------
// v48: ชุดของในห้องของแต่ละประเภท ไม่ต้องมีตัวเลือกที่ซ้ำกับชื่อประเภทห้องเอง
//
// "ห้องแอร์" ย่อมมีแอร์อยู่แล้ว การมีปุ่ม "แอร์" ให้ติ๊กอีกจึงซ้ำซ้อน
// และถ้าเจ้าของหอเผลอไม่ติ๊ก นักศึกษาจะเห็นห้องแอร์ที่ไม่มีแอร์ในรายการของในห้อง
// (ห้องพัดลมก็เช่นกัน)
//
// ตัวเลือกของอีกฝั่งยังอยู่ เพราะห้องแอร์บางห้องมีพัดลมเพิ่มให้ด้วยจริง ๆ
// ---------------------------------------------------------------------------
function amenPresetsFor(code){
  const own = (ROOM_TYPE_META[code] && ROOM_TYPE_META[code].label) || '';
  return ROOM_AMEN_PRESETS.filter(a => a !== own);
}
// ตัดของที่ซ้ำกับชื่อประเภทห้องออกจากรายการที่บันทึกไว้ (ข้อมูลเก่าที่เคยติ๊กไว้)
function stripOwnTypeAmen(code, list){
  const own = (ROOM_TYPE_META[code] && ROOM_TYPE_META[code].label) || '';
  return (list || []).filter(a => String(a).trim() !== own);
}
// ---------------------------------------------------------------------------
// ตัวเลือก "ของในห้องแต่ละประเภท" (แอร์/พัดลม) — ใช้ทั้งในฟอร์มข้อมูลพื้นฐานของหอ
// และฟอร์ม "เพิ่มหอพักใหม่" (v41) ทำงานในกล่อง root ของตัวเองเท่านั้น จะได้ไม่ชนกัน
// ---------------------------------------------------------------------------
function typeAmenEditorHtml(){
  return ROOM_TYPE_ORDER.map(code=>`
    <div class="op-ta-edit">
      <div class="op-ta-type">${ROOM_TYPE_META[code].icon} ห้อง${escapeHtml(ROOM_TYPE_META[code].label)}</div>
      <div class="ra-quick" data-taquick="${code}"></div>
      <div class="ef-row" style="margin-top:8px">
        <input type="text" data-taother="${code}" placeholder="อื่น ๆ เช่น ตู้เสื้อผ้าบิลท์อิน">
        <button type="button" class="btn btn-outline btn-sm" data-taadd="${code}">+ เพิ่ม</button>
      </div>
      <div class="ef-chips" data-tachips="${code}"></div>
    </div>`).join('');
}
function mountTypeAmenEditor(root, initialFor){
  const state = {};
  if(!root) return { values: ()=> ({}) };
  ROOM_TYPE_ORDER.forEach(code=>{
    state[code] = stripOwnTypeAmen(code, cleanAmenList(initialFor ? initialFor(code) : []));
  });
  const render = (code)=>{
    const quick = root.querySelector(`[data-taquick="${code}"]`);
    if(quick){
      quick.innerHTML = amenPresetsFor(code).map(a=>{
        const on = state[code].some(x=>x.toLowerCase() === a.toLowerCase());
        return `<button type="button" class="ra-q ${on?'on':''}" data-taq="${escapeHtml(a)}">${on?'✓ ':'+ '}${escapeHtml(a)}</button>`;
      }).join('');
      quick.querySelectorAll('[data-taq]').forEach(b=>{
        b.addEventListener('click', ()=>{
          const v = b.dataset.taq;
          const i = state[code].findIndex(x=>x.toLowerCase() === v.toLowerCase());
          if(i >= 0) state[code].splice(i,1); else state[code].push(v);
          render(code);
        });
      });
    }
    // ป้ายของที่พิมพ์เอง (ของที่มีปุ่มลัดอยู่แล้วไม่ต้องโชว์ซ้ำ)
    const chips = root.querySelector(`[data-tachips="${code}"]`);
    if(chips){
      const extra = state[code].filter(x=>!amenPresetsFor(code).some(a=>a.toLowerCase() === x.toLowerCase()));
      chips.innerHTML = extra.map(a=>`
        <span class="ef-chip">${escapeHtml(a)}
          <button type="button" data-tarm="${escapeHtml(a)}" title="ลบ">✕</button>
        </span>`).join('');
      chips.querySelectorAll('[data-tarm]').forEach(b=>{
        b.addEventListener('click', ()=>{
          state[code] = state[code].filter(x=>x !== b.dataset.tarm);
          render(code);
        });
      });
    }
  };
  const add = (code)=>{
    const input = root.querySelector(`[data-taother="${code}"]`);
    if(!input) return;
    const v = (input.value||'').trim().slice(0,30);
    if(!v) return;
    const own = (ROOM_TYPE_META[code] && ROOM_TYPE_META[code].label) || '';
    if(v === own){
      toast(`ห้อง${own}มี${own}อยู่แล้ว ไม่ต้องเพิ่มซ้ำ`,'error'); input.value=''; return;
    }
    if(state[code].some(x=>x.toLowerCase() === v.toLowerCase())){ toast('เพิ่มรายการนี้ไปแล้ว','error'); input.value=''; return; }
    if(state[code].length >= 20){ toast('เพิ่มได้สูงสุด 20 รายการต่อประเภทห้อง','error'); return; }
    state[code].push(v); input.value=''; render(code);
  };
  ROOM_TYPE_ORDER.forEach(code=>{
    render(code);
    root.querySelector(`[data-taadd="${code}"]`)?.addEventListener('click', ()=> add(code));
    root.querySelector(`[data-taother="${code}"]`)?.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){ e.preventDefault(); add(code); }
    });
  });
  return {
    values(){ const out = {}; ROOM_TYPE_ORDER.forEach(c=>{ out[c] = cleanAmenList(state[c]); }); return out; }
  };
}

let editRoomAmen = [];     // ของในห้องที่กำลังแก้อยู่ใน pop up
let editRoomPhotos = [];   // รูปในห้องที่กำลังแก้อยู่ใน pop up
let editRoomPrevType = ''; // ประเภทห้องก่อนเปลี่ยน (ใช้ตัดสินว่าควรสลับชุดของในห้องให้ไหม)

// บอกเจ้าของหอว่าของในห้องตอนนี้ดึงมาจากประเภทห้อง หรือกรอกเองเฉพาะห้องนี้
function updateRoomAmenHint(){
  const el = document.getElementById('rmAmenFromType');
  if(!el || !planRoomCtx) return;
  const type = document.getElementById('rmType')?.value || '';
  const def = typeAmenFor(planRoomCtx.dorm, type);
  const label = ROOM_TYPE_META[type] ? ROOM_TYPE_META[type].label : '';
  if(!type){
    el.innerHTML = 'เลือกประเภทห้องด้านบน ระบบจะดึงของในห้องที่ติ๊กไว้ในข้อมูลพื้นฐานของหอมาใส่ให้';
  }else if(!def.length){
    el.innerHTML = `ยังไม่ได้ติ๊กของในห้องของห้อง${escapeHtml(label)} — ติ๊กครั้งเดียวได้ที่ปุ่ม "✏️ เพิ่มหรือแก้ไข" ด้านบนสุดของหน้า ห้องอื่นจะได้ไม่ต้องกรอกซ้ำ`;
  }else if(sameAmenList(editRoomAmen, def)){
    el.innerHTML = `✓ ใช้ของในห้องตามประเภท <strong>ห้อง${escapeHtml(label)}</strong> — แก้ที่ "✏️ เพิ่มหรือแก้ไข" ด้านบนสุดของหน้า แล้วทุกห้องประเภทนี้เปลี่ยนตาม`;
  }else{
    el.innerHTML = `ห้องนี้ตั้งของในห้องเอง (ต่างจากชุดของห้อง${escapeHtml(label)}) · <a href="#" id="rmAmenReset">ใช้ชุดของห้อง${escapeHtml(label)}</a>`;
    document.getElementById('rmAmenReset')?.addEventListener('click', (e)=>{
      e.preventDefault();
      editRoomAmen = def.slice(); renderRoomAmen(); updateRoomAmenHint();
    });
  }
}

// เปลี่ยนประเภทห้อง → ถ้าของในห้องยังเป็นชุดของประเภทเดิม (หรือยังว่าง) สลับเป็นชุดของประเภทใหม่ให้
document.getElementById('rmType')?.addEventListener('change', (e)=>{
  if(!planRoomCtx) return;
  const dorm = planRoomCtx.dorm;
  const newType = e.target.value;
  const prevDef = typeAmenFor(dorm, editRoomPrevType);
  if(!editRoomAmen.length || sameAmenList(editRoomAmen, prevDef)){
    editRoomAmen = typeAmenFor(dorm, newType);
  }
  // v48: ของที่ซ้ำกับชื่อประเภทห้องใหม่ต้องหลุดออก และต้องวาดปุ่มใหม่เสมอ
  // เพราะรายการปุ่มลัดเปลี่ยนไปตามประเภทห้องที่เลือก
  editRoomAmen = stripOwnTypeAmen(newType, editRoomAmen);
  renderRoomAmen();
  editRoomPrevType = newType;
  updateRoomAmenHint();
});

// ---------------------------------------------------------------------------
// รูปภายในห้อง — อัปโหลดจากเครื่องเหมือนรูปหอ แต่ผูกกับห้องนั้น ๆ
// เก็บไว้ใน bucket เดียวกัน (dorm-photos) จึงไม่ต้องรัน SQL เพิ่ม
// ---------------------------------------------------------------------------
function renderRoomPhotos(){
  const grid = document.getElementById('rmPhotoGrid');
  if(!grid) return;
  grid.innerHTML = editRoomPhotos.map((u,i)=>`
    <div class="op-photo ${i===0?'is-cover':''}">
      <img src="${escapeHtml(u)}" alt="รูปในห้อง ${i+1}" ${imgFallbackAttr()}>
      ${i===0 ? '<span class="op-cover-tag">รูปหลัก</span>' : ''}
      <div class="op-photo-tools">
        ${i===0?'':`<button type="button" class="op-mini" data-rpcover="${i}" title="ตั้งเป็นรูปหลักของห้อง">⭐</button>`}
        <button type="button" class="op-mini danger" data-rprm="${i}" title="เอารูปนี้ออก">✕</button>
      </div>
    </div>`).join('');

  grid.querySelectorAll('[data-rpcover]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const i = +b.dataset.rpcover;
      const [pick] = editRoomPhotos.splice(i,1);
      editRoomPhotos.unshift(pick);
      renderRoomPhotos();
    });
  });
  grid.querySelectorAll('[data-rprm]').forEach(b=>{
    b.addEventListener('click', ()=>{
      editRoomPhotos.splice(+b.dataset.rprm, 1);
      renderRoomPhotos();
    });
  });
}

async function handleRoomPhotoFiles(files){
  const prog = document.getElementById('rmPhotoProgress');
  const show = (m)=>{ if(prog){ prog.style.display='block'; prog.textContent = m; } };
  const room = MAX_ROOM_PHOTOS - editRoomPhotos.length;
  if(room <= 0){ toast(`ห้องหนึ่งใส่รูปได้สูงสุด ${MAX_ROOM_PHOTOS} รูป`,'error'); return; }
  const list = Array.from(files).slice(0, room);
  if(list.length < files.length){
    toast(`ใส่ได้อีก ${room} รูป (สูงสุด ${MAX_ROOM_PHOTOS} รูปต่อห้อง) — อัปโหลดให้เท่าที่ใส่ได้`,'error');
  }
  try{
    show('กำลังเตรียมรูป...');
    const urls = await uploadDormImages(list, (done,total,name)=> show(`กำลังอัปโหลด ${done+1}/${total} — ${name||''}`));
    editRoomPhotos = editRoomPhotos.concat(urls);
    renderRoomPhotos();
    show(`✓ เพิ่มรูปแล้ว ${urls.length} รูป — กด "บันทึกห้องนี้" ด้านล่างเพื่อบันทึก`);
    setTimeout(()=>{ if(prog) prog.style.display='none'; }, 4000);
  }catch(err){
    console.error(err);
    if(prog) prog.style.display = 'none';
    toast(err.message || 'อัปโหลดรูปไม่สำเร็จ','error');
  }
}

document.getElementById('btnRmPickPhotos')?.addEventListener('click',
  ()=> document.getElementById('rmPhotoInput').click());
document.getElementById('rmPhotoInput')?.addEventListener('change', async (e)=>{
  const files = e.target.files;
  if(files && files.length) await handleRoomPhotoFiles(files);
  e.target.value = '';
});
const rmDrop = document.getElementById('rmPhotoDrop');
if(rmDrop){
  ['dragenter','dragover'].forEach(ev=> rmDrop.addEventListener(ev, (e)=>{
    e.preventDefault(); rmDrop.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(ev=> rmDrop.addEventListener(ev, (e)=>{
    e.preventDefault(); rmDrop.classList.remove('drag');
  }));
  rmDrop.addEventListener('drop', async (e)=>{
    const files = e.dataTransfer && e.dataTransfer.files;
    if(files && files.length) await handleRoomPhotoFiles(files);
  });
}

function renderRoomAmen(){
  // ปุ่มเลือกเร็ว
  const quick = document.getElementById('rmAmenQuick');
  if(quick){
    // v48: ห้องที่เลือกประเภทไว้แล้ว ไม่ต้องมีปุ่มที่ซ้ำกับชื่อประเภทห้องนั้น
    const sel = document.getElementById('rmType');
    const presets = (sel && sel.value) ? amenPresetsFor(sel.value) : ROOM_AMEN_PRESETS;
    quick.innerHTML = presets.map(a=>{
      const on = editRoomAmen.some(x=>x.toLowerCase() === a.toLowerCase());
      return `<button type="button" class="ra-q ${on?'on':''}" data-amen="${escapeHtml(a)}">${on?'✓ ':'+ '}${escapeHtml(a)}</button>`;
    }).join('');
    quick.querySelectorAll('[data-amen]').forEach(b=>{
      b.addEventListener('click', ()=>{
        const v = b.dataset.amen;
        const i = editRoomAmen.findIndex(x=>x.toLowerCase() === v.toLowerCase());
        if(i >= 0) editRoomAmen.splice(i,1); else editRoomAmen.push(v);
        renderRoomAmen(); updateRoomAmenHint();
      });
    });
  }
  // ป้ายรายการที่เลือกไว้ (รวมของที่พิมพ์เอง)
  const chips = document.getElementById('rmAmenChips');
  if(chips){
    chips.innerHTML = editRoomAmen.map(a=>`
      <span class="ef-chip">${escapeHtml(a)}
        <button type="button" data-rmamen="${escapeHtml(a)}" title="ลบ">✕</button>
      </span>`).join('');
    chips.querySelectorAll('[data-rmamen]').forEach(b=>{
      b.addEventListener('click', ()=>{
        editRoomAmen = editRoomAmen.filter(x=>x !== b.dataset.rmamen);
        renderRoomAmen(); updateRoomAmenHint();
      });
    });
  }
}

function addRoomAmen(){
  const input = document.getElementById('rmAmenOther');
  const v = (input.value||'').trim().slice(0,30);
  if(!v) return;
  if(editRoomAmen.some(x=>x.toLowerCase() === v.toLowerCase())){
    toast('เพิ่มรายการนี้ไปแล้ว','error'); input.value=''; return;
  }
  if(editRoomAmen.length >= 20){ toast('เพิ่มได้สูงสุด 20 รายการต่อห้อง','error'); return; }
  editRoomAmen.push(v);
  input.value = '';
  renderRoomAmen(); updateRoomAmenHint();
}

document.getElementById('btnAddAmen')?.addEventListener('click', addRoomAmen);
document.getElementById('rmAmenOther')?.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); addRoomAmen(); }
});

// เปิด pop up แก้รายละเอียดห้องหนึ่งห้อง
function openRoomEditor(dorm, cellId){
  const found = eachRoomCell(dorm.floorPlan).find(x=>x.cell.id === cellId);
  if(!found) return;
  const cell = found.cell;
  planRoomCtx = { dorm, cellId };

  document.getElementById('roomModalTitle').textContent = cell.no ? ('ห้อง ' + cell.no) : 'ห้องใหม่';
  document.getElementById('roomModalSub').textContent = found.floor.name + ' · ' + dorm.name;
  document.getElementById('rmNo').value    = cell.no || '';
  document.getElementById('rmNote').value  = cell.note || '';
  // ห้องที่ยังไม่ได้กรอกของในห้องเอง = ดึงชุดของประเภทห้องมาใส่ให้เลย
  editRoomAmen = (cell.amen && cell.amen.length) ? cell.amen.slice() : typeAmenFor(dorm, cell.type);
  editRoomPrevType = cell.type || '';
  renderRoomAmen();
  editRoomPhotos = (cell.photos || []).slice();
  renderRoomPhotos();
  const rmProg = document.getElementById('rmPhotoProgress');
  if(rmProg){ rmProg.style.display='none'; rmProg.textContent=''; }

  // ตัวเลือกประเภทห้อง = แอร์ / พัดลม (มีให้เลือกตลอด ไม่ต้องไปตั้งราคาก่อน)
  // + ประเภทเก่าที่หอเคยตั้งไว้เอง ถ้ามี จะได้ไม่หายไปจากห้องที่เลือกไว้แล้ว
  const sel = document.getElementById('rmType');
  const legacy = roomTypes(dorm).filter(r => !ROOM_TYPE_META[r.code]);
  sel.innerHTML = `<option value="">— ไม่ระบุประเภท —</option>`
    + ROOM_TYPE_ORDER.map(code=>
        `<option value="${code}">${ROOM_TYPE_META[code].icon} ${escapeHtml(ROOM_TYPE_META[code].label)}</option>`).join('')
    + legacy.map(r=>
        `<option value="${escapeHtml(r.code)}">${escapeHtml(r.label)} · ${fmtBaht(r.price)} บาท/เดือน</option>`).join('');
  sel.value = cell.type || '';
  updateRoomAmenHint();

  // ปุ่มเลือกสถานะ
  const wrap = document.getElementById('rmStatus');
  wrap.innerHTML = ROOM_STATUS_ORDER.map(s=>{
    const m = ROOM_STATUS_META[s];
    return `<button type="button" class="rm-st ${m.cls} ${cell.status===s?'on':''}" data-setst="${s}">
      <i class="fp-swatch ${m.cls}"></i>${m.label}</button>`;
  }).join('');
  wrap.querySelectorAll('[data-setst]').forEach(b=>{
    b.addEventListener('click', ()=>{
      wrap.querySelectorAll('.rm-st').forEach(x=>x.classList.remove('on'));
      b.classList.add('on');
      updateRoomStatusHint(b.dataset.setst, cell);
    });
  });
  updateRoomStatusHint(cell.status, cell);

  document.getElementById('roomModal').classList.add('open');
}

// คำอธิบายใต้ปุ่มเลือกสถานะห้อง — v44 มี 4 สถานะ จึงแยกข้อความของแต่ละสถานะไว้ที่เดียว
const ROOM_STATUS_HINT = {
  vacant:
    'ห้องว่างพร้อมให้เช่า นักศึกษาสามารถกดนัดหมายห้องนี้ได้จากผังในหน้าหอพักของคุณ<br>' +
    '<strong>ห้องจะยังคงเป็นสีเขียวแม้มีผู้กดนัดหมายแล้ว</strong> — จะเปลี่ยนเป็น ' +
    '"มีผู้นัดหมายแล้ว" ก็ต่อเมื่อคุณกด "ยืนยันรับนัดหมาย" ในเมนูคำขอนัดหมาย',
  reserved:
    'มีนักศึกษานัดหมายเข้ามาดูห้องนี้แล้ว แต่ยังไม่ได้ทำสัญญาเช่า<br>' +
    '<strong>นักศึกษาคนอื่นยังกดนัดหมายห้องนี้ซ้ำได้</strong> — เพราะการนัดหมายคือการนัดหมายเข้าชมห้อง ' +
    'ไม่ใช่การจอง ผู้ที่นัดหมายไว้ก่อนอาจไม่มาหรือไม่เช่าก็ได้<br>' +
    'เมื่อมีผู้เช่าเข้าอยู่จริงแล้ว ให้เปลี่ยนเป็น "ไม่ว่าง" เพื่อปิดรับนัดหมาย',
  booked:
    'ห้องนี้มีผู้เช่าอยู่แล้ว นักศึกษาจะเห็นเป็นสีแดงและกดนัดหมายไม่ได้',
  closed:
    'ห้องยังไม่พร้อมปล่อยเช่า เช่น กำลังซ่อมแซมหรือปรับปรุง<br>' +
    'นักศึกษาจะเห็นว่าห้องนี้ปิดปรับปรุงอยู่ และกดนัดหมายไม่ได้ — ' +
    'เมื่อซ่อมเสร็จแล้วเปลี่ยนกลับเป็น "ว่าง" ได้ทันที'
};
function updateRoomStatusHint(status, cell){
  const el = document.getElementById('rmStatusHint');
  if(!el) return;
  const st = normalizeRoomStatus(status);
  // ห้องที่ไม่ว่างเพราะระบบตั้งให้เองจากการยืนยันนัดหมาย ต้องบอกที่มาให้ชัด
  if((st === 'reserved' || st === 'booked') && cell && cell.bookingId){
    el.innerHTML = 'ห้องนี้ถูกตั้งเป็น <strong>"' + escapeHtml(ROOM_STATUS_META[st].label) + '"</strong> ' +
      'เนื่องจากคุณกด <strong>"ยืนยันรับนัดหมาย"</strong> ในเมนู "คำขอนัดหมาย" ไปแล้ว<br>' +
      'หากเปลี่ยนสถานะเองที่นี่ ห้องจะถูกตัดออกจากคำขอนัดหมายนั้น';
    return;
  }
  el.innerHTML = ROOM_STATUS_HINT[st] || ROOM_STATUS_HINT.vacant;
}

document.getElementById('closeRoomModal')?.addEventListener('click',
  ()=> document.getElementById('roomModal').classList.remove('open'));
document.getElementById('roomModal')?.addEventListener('click', (e)=>{
  if(e.target.id === 'roomModal') e.currentTarget.classList.remove('open');
});

document.getElementById('rmSave')?.addEventListener('click', async ()=>{
  if(!planRoomCtx) return;
  const { dorm, cellId } = planRoomCtx;
  const p = normalizeFloorPlan(dorm.floorPlan);
  const target = eachRoomCell(p).find(x=>x.cell.id === cellId);
  if(!target){ toast('ไม่พบห้องนี้ในผัง','error'); return; }

  const newStatus = (document.querySelector('#rmStatus .rm-st.on') || {}).dataset?.setst || 'vacant';

  target.cell.no    = document.getElementById('rmNo').value.trim().slice(0,12);
  target.cell.type  = document.getElementById('rmType').value;
  // v39: ไม่มีช่องราคารายห้องแล้ว — ทุกห้องใช้ราคาตามประเภทห้อง (ตั้งที่ข้อมูลพื้นฐานของหอ)
  target.cell.price = null;
  target.cell.note  = document.getElementById('rmNote').value.trim().slice(0,120);
  // ของในห้องเหมือนชุดของประเภทห้องทุกอย่าง = เก็บเป็น "ใช้ตามประเภท" (ว่างไว้)
  // วันหลังเจ้าของหอแก้ชุดของประเภทห้อง ห้องนี้จะเปลี่ยนตามเอง
  const typeDef = typeAmenFor(p, target.cell.type);
  target.cell.amen  = (typeDef.length && sameAmenList(editRoomAmen, typeDef)) ? [] : cleanAmenList(editRoomAmen);
  target.cell.photos = editRoomPhotos.slice(0, MAX_ROOM_PHOTOS);

  // เปลี่ยนสถานะด้วยมือจากห้องที่ผูกกับใบนัดหมายหมายอยู่ = ตัดห้องออกจากใบนัดหมายหมายนั้น
  if(newStatus !== target.cell.status){
    if(target.cell.bookingId && (target.cell.status === 'booked' || target.cell.status === 'reserved')){
      if(!confirm('ห้องนี้ผูกอยู่กับนัดหมายที่คุณยืนยันไปแล้ว\n\n' +
                  'การเปลี่ยนสถานะด้วยตนเองที่นี่ จะเป็นการตัดห้องออกจากคำขอนัดหมายนั้น\n' +
                  '(คำขอนัดหมายยังคงอยู่ในเมนู "คำขอนัดหมาย" เพื่อให้คุณตอบกลับนักศึกษา)\n\n' +
                  'ยืนยันการเปลี่ยนแปลงหรือไม่')) return;
    }
    target.cell.status = newStatus;
    if(newStatus !== 'booked' && newStatus !== 'reserved'){
      target.cell.bookingId = null; target.cell.userId = null;
    }
  }

  // v44: ประทับเวลาที่ตั้งค่าห้องนี้ ผังจะได้แยกห้องที่ตั้งค่าแล้วออกจากห้องเปล่า
  target.cell.editedAt = Date.now();

  document.getElementById('roomModal').classList.remove('open');
  await savePlan(dorm, p, 'บันทึกห้องแล้ว');
});

document.getElementById('rmDelete')?.addEventListener('click', async ()=>{
  if(!planRoomCtx) return;
  const { dorm, cellId } = planRoomCtx;
  const found = eachRoomCell(dorm.floorPlan).find(x=>x.cell.id === cellId);
  if(found && found.cell.status === 'booked' && found.cell.bookingId){
    if(!confirm('ห้องนี้มีคนกดนัดหมายไว้อยู่ ยืนยันลบห้องนี้ออกจากผัง?')) return;
  }else if(!confirm('ลบห้องนี้ออกจากผัง?')) return;

  const p = normalizeFloorPlan(dorm.floorPlan);
  const gonePhotos = (found && found.cell.photos) ? found.cell.photos.slice() : [];
  p.floors.forEach(f=> f.rows.forEach(r=>{ r.cells = r.cells.filter(c=>c.id !== cellId); }));
  document.getElementById('roomModal').classList.remove('open');
  await savePlan(dorm, p, 'ลบห้องแล้ว');
  // ลบไฟล์รูปของห้องที่ถูกลบออกจากที่เก็บด้วย มิฉะนั้นรูปจะค้างกินพื้นที่ไปเรื่อย ๆ
  gonePhotos.forEach(u=> deleteDormPhoto(u));
});

// ---------------------------------------------------------------------------
// ดูรูปขนาดเต็ม — แสดงรูปตามสัดส่วนจริง ไม่ครอบ ไม่ยืด
// เลื่อนดูรูปถัดไป/ก่อนหน้าได้ด้วยลูกศรหรือปุ่มซ้ายขวา
// ---------------------------------------------------------------------------
let viewerList = [];
let viewerIndex = 0;

function openPhotoViewer(images, currentSrc){
  viewerList = (images || []).filter(Boolean);
  if(!viewerList.length) return;
  const i = viewerList.findIndex(u => u === currentSrc);
  viewerIndex = i >= 0 ? i : 0;
  renderPhotoViewer();
  document.getElementById('photoViewer').classList.add('open');
}

function renderPhotoViewer(){
  const img = document.getElementById('pvImg');
  const cnt = document.getElementById('pvCount');
  if(!img) return;
  img.src = viewerList[viewerIndex];
  if(cnt) cnt.textContent = `${viewerIndex + 1} / ${viewerList.length}`;
  const many = viewerList.length > 1;
  ['pvPrev','pvNext'].forEach(id=>{
    const b = document.getElementById(id);
    if(b) b.style.display = many ? 'flex' : 'none';
  });
}

function stepPhotoViewer(delta){
  if(viewerList.length < 2) return;
  viewerIndex = (viewerIndex + delta + viewerList.length) % viewerList.length;
  renderPhotoViewer();
}

document.getElementById('pvPrev')?.addEventListener('click', (e)=>{ e.stopPropagation(); stepPhotoViewer(-1); });
document.getElementById('pvNext')?.addEventListener('click', (e)=>{ e.stopPropagation(); stepPhotoViewer(1); });
document.getElementById('closePhotoViewer')?.addEventListener('click',
  ()=> document.getElementById('photoViewer').classList.remove('open'));
document.getElementById('photoViewer')?.addEventListener('click', (e)=>{
  // กดพื้นที่ว่างรอบรูปเพื่อปิด (กดที่ตัวรูปไม่ปิด จะได้ซูมดูได้)
  if(e.target.id === 'photoViewer' || e.target.id === 'pvStage'){
    document.getElementById('photoViewer').classList.remove('open');
  }
});
document.addEventListener('keydown', (e)=>{
  const v = document.getElementById('photoViewer');
  if(!v || !v.classList.contains('open')) return;
  if(e.key === 'Escape') v.classList.remove('open');
  if(e.key === 'ArrowLeft')  stepPhotoViewer(-1);
  if(e.key === 'ArrowRight') stepPhotoViewer(1);
});

// บันทึกรายการร้านรอบหอ
async function saveNearby(dorm, list, okMsg){
  try{
    await updateDorm(dorm.id, { ...dorm, nearby: list });
    dorm.nearby = normalizeNearby(list);
    if(okMsg) toast(okMsg, 'success');
    await renderOwnerPage();
  }catch(err){
    console.error(err);
    toast('บันทึกไม่สำเร็จ: ' + (err.message || ''), 'error');
  }
}

// บันทึกรายการรูปชุดใหม่ลงหอ แล้ววาดหน้าใหม่
async function saveDormImages(dorm, images, okMsg){
  try{
    await updateDorm(dorm.id, { ...dorm, images });
    dorm.images = images;
    toast(okMsg || 'บันทึกรูปแล้ว','success');
    await renderOwnerPage();
  }catch(err){ console.error(err); toast('บันทึกรูปไม่สำเร็จ: '+(err.message||''),'error'); }
}

// อัปโหลดรูปจากเครื่องเข้าหอที่กำลังเปิดอยู่
async function addPhotosToDorm(dorm, files){
  const state = document.getElementById('opUpState');
  const show = (msg)=>{ if(state){ state.style.display='block'; state.textContent = msg; } };
  try{
    show('กำลังเตรียมรูป...');
    const urls = await uploadDormImages(files, (done, total, name)=>{
      show(`กำลังอัปโหลด ${done+1}/${total} — ${name||''}`);
    });
    show('กำลังบันทึก...');
    await saveDormImages(dorm, [...(dorm.images||[]), ...urls], `เพิ่มรูปแล้ว ${urls.length} รูป`);
  }catch(err){
    console.error(err);
    if(state) state.style.display = 'none';
    toast(err.message || 'อัปโหลดรูปไม่สำเร็จ','error');
  }
}

async function renderListings(){
  // หน้ารวมหอมีให้เฉพาะผู้ดูแลระบบแล้ว เจ้าของหอไม่ต้องโหลดตารางนี้เลย
  if(!ME || ME.role !== 'admin') return;
  const hint = document.getElementById('listingHint');
  if(hint) hint.innerHTML = '';
  await loadVisibleDorms();
  const dorms = myDorms;
  document.getElementById('listingTable').innerHTML = dorms.map(d=>{
    // ผู้ดูแลระบบ "ดู" และ "ลบ" หอของคนอื่นได้ แต่แก้ไขข้อมูลไม่ได้
    // (ฝั่งฐานข้อมูลก็ปิดไว้อีกชั้นในไฟล์ fix-v15.sql — ปุ่มนี้แค่ไม่หลอกให้กด)
    // v34: บัญชีผู้ดูแลระบบแก้ข้อมูลหอไม่ได้ทันที แม้แต่หอที่ผูกกับบัญชีตัวเอง
    const isMine = d.ownerId === ME.uid;
    const canEdit = isMine && !isAdminAccount();
    return `
    <tr>
      <td><strong>${escapeHtml(d.name)}</strong>
        ${isMine ? '' : '<br><small class="muted">หอของเจ้าของหอรายอื่น</small>'}</td>
      <td>${escapeHtml(d.hallType)}</td>
      <td>${hasPrice(d)
        ? (hasRoomTypes(d)
            ? roomTypes(d).map(r=>`${escapeHtml(r.label)}: ${fmtBaht(r.price)}฿`).join('<br>')
            : `เริ่มต้น ${fmtBaht(minPrice(d))}฿`)
        : '<span class="muted">ยังไม่ระบุ</span>'}</td>
      <td>${!hasRoomTypes(d) ? '<span class="muted">ดูจากผังห้อง</span>' : ''}${roomTypes(d).map(r=>`
        <div style="white-space:nowrap;margin:2px 0">
          ${escapeHtml(r.label)}: ${r.total > 0
            ? `<strong>${r.vacant}</strong>/${r.total}`
            : '<span class="muted">ดูจากผังห้อง</span>'}
          ${canEdit && r.total > 0 ? `
          <button class="btn btn-sm btn-ghost" data-vac="${d.id}|${escapeHtml(r.code)}|-1" title="ลดห้องว่าง (ปิดห้อง)" style="padding:2px 8px">−</button>
          <button class="btn btn-sm btn-ghost" data-vac="${d.id}|${escapeHtml(r.code)}|1" title="เพิ่มห้องว่าง (เปิดห้อง)" style="padding:2px 8px">+</button>` : ''}
        </div>`).join('')}</td>
      <td>
        ${d.published === false
          ? `<span class="status-pill status-cancelled">🚫 ถูกซ่อนโดยผู้ดูแลระบบ</span>
             ${d.reviewNote ? `<br><small class="muted">เหตุผล: ${escapeHtml(d.reviewNote)}</small>` : ''}`
          : (d.verified ? '<span class="status-pill status-confirmed">ยืนยันแล้ว</span>'
                        : '<span class="status-pill status-pending">รอยืนยัน</span>')}<br>
        ${canEdit
          ? `<button class="btn btn-outline btn-sm" data-edit="${d.id}" style="margin-top:6px">แก้ไข</button>`
          : `<button class="btn btn-outline btn-sm" data-view="${d.id}" style="margin-top:6px">👁 ดูข้อมูล</button>
             ${d.published === false
               ? `<button class="btn btn-sm btn-approve" data-dormok2="${d.id}" style="margin-top:6px">เผยแพร่</button>`
               : `<button class="btn btn-sm btn-ghost" data-dormno2="${d.id}" style="margin-top:6px">ซ่อน</button>`}`}
        <button class="btn btn-sm btn-reject" data-del="${d.id}" style="margin-top:6px">ลบ</button>
      </td>
    </tr>`;
  }).join('') || `<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">ยังไม่มีหอพักในระบบ</td></tr>`;

  document.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openEdit(dorms.find(d=>d.id===btn.dataset.edit)));
  });
  // ผู้ดูแลระบบเปิดดูข้อมูลหอของคนอื่นแบบอ่านอย่างเดียว
  document.querySelectorAll('[data-view]').forEach(btn=>{
    btn.addEventListener('click', ()=> openViewDorm(dorms.find(d=>d.id===btn.dataset.view)));
  });
  // ซ่อน/เผยแพร่หอของคนอื่น (ทำผ่านฟังก์ชันฝั่งฐานข้อมูล ไม่ใช่การแก้ข้อมูลหอ)
  document.querySelectorAll('[data-dormno2]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const reason = prompt('เหตุผลที่ซ่อนหอนี้จากนักศึกษา (เจ้าของหอจะเห็นข้อความนี้):');
      if(reason === null) return;
      try{ await rejectDorm(btn.dataset.dormno2, reason); toast('ซ่อนหอนี้แล้ว','success'); renderListings(); renderPendingDorms(); }
      catch(err){ console.error(err); toast('ทำรายการไม่สำเร็จ: '+(err.message||''),'error'); }
    });
  });
  document.querySelectorAll('[data-dormok2]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      try{ await approveDorm(btn.dataset.dormok2); toast('เผยแพร่หอนี้แล้ว','success'); renderListings(); renderPendingDorms(); }
      catch(err){ console.error(err); toast('ทำรายการไม่สำเร็จ: '+(err.message||''),'error'); }
    });
  });
  document.querySelectorAll('[data-del]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      if(!confirm('ยืนยันลบหอพักนี้?')) return;
      try{ await deleteDorm(btn.dataset.del); toast('ลบหอพักแล้ว','success'); renderListings(); renderStats(); }
      catch(err){ console.error(err); toast('ลบไม่สำเร็จ: '+err.message,'error'); }
    });
  });
  // ปุ่ม +/- ปรับห้องว่างเร็ว (เปิดห้อง/ปิดห้อง) โดยไม่ต้องเปิดฟอร์มแก้ไข
  document.querySelectorAll('[data-vac]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const [dormId, code, deltaStr] = btn.dataset.vac.split('|');
      const delta = parseInt(deltaStr, 10);
      const dorm = dorms.find(x=>x.id===dormId);
      if(!dorm) return;
      const rooms = (dorm.rooms||[]).map(r=>{
        if(r.code !== code) return r;
        const next = Math.max(0, Math.min(r.total, r.vacant + delta));
        return { ...r, vacant: next };
      });
      try{
        await updateDorm(dormId, { ...dorm, rooms });
        renderListings(); renderStats();
      }catch(err){ console.error(err); toast('ปรับห้องว่างไม่สำเร็จ: '+err.message,'error'); }
    });
  });
}

// ---------------------------------------------------------------------------
// หน้าต่างดูข้อมูลหอแบบอ่านอย่างเดียว (ผู้ดูแลระบบใช้ตรวจหอของเจ้าของหอรายอื่น)
// ---------------------------------------------------------------------------
function openViewDorm(d){
  if(!d) return;
  const box = document.getElementById('viewContent');
  box.innerHTML = `
    <h3 style="margin-top:0">${escapeHtml(d.name)}
      <span class="td-tag ${d.verified?'ok':''}">${d.verified?'✓ ยืนยันแล้ว':'⚠ ยังไม่ยืนยัน'}</span></h3>
    <p class="muted" style="font-size:.86rem;margin-top:-6px">
      โหมดอ่านอย่างเดียว — ผู้ดูแลระบบแก้ข้อมูลหอของเจ้าของหอรายอื่นไม่ได้
      ทำได้แค่ดู ซ่อนหอ หรือลบหอ (ถ้าพบข้อมูลเท็จ ให้ติดต่อเจ้าของหอให้แก้เอง)
    </p>
    ${(d.images||[]).length ? `<div class="op-photos view">${d.images.map(u=>`
      <div class="op-photo"><img src="${escapeHtml(u)}" alt="รูปหอพัก" ${imgFallbackAttr()}></div>`).join('')}</div>` : ''}
    <div class="bk-grid" style="grid-template-columns:1fr 1fr">
      <div><span class="k">ประเภท:</span> <strong>${escapeHtml(d.hallType)}</strong></div>
      <div><span class="k">สถานะ:</span> <strong>${d.published===false?'ถูกซ่อนอยู่':'เผยแพร่อยู่'}</strong></div>
      <div><span class="k">เบอร์โทร:</span> <strong>${escapeHtml(d.phone||'-')}</strong></div>
      <div><span class="k">LINE:</span> <strong>${escapeHtml(d.lineId||'-')}</strong></div>
      <div><span class="k">อีเมล:</span> <strong>${escapeHtml(d.contactEmail||'-')}</strong></div>
      <div><span class="k">Facebook:</span> <strong>${escapeHtml(d.facebook||'-')}</strong></div>
    </div>
    <h4 style="margin:14px 0 6px">ห้องพักและราคา</h4>
    ${hasRoomTypes(d)
      ? `<ul style="margin:0;padding-left:18px;font-size:.9rem">${roomTypes(d).map(r=>
          `<li>${escapeHtml(r.label)} — ${fmtBaht(r.price)} บาท/เดือน · ว่าง ${r.vacant}/${r.total}${
            capacityLabel(r) ? ` · เข้าพักได้ ${capacityLabel(r)}` : ''}</li>`).join('')}</ul>`
      : (hasPrice(d)
          ? `<p style="font-size:.9rem">ราคาเริ่มต้น ${fmtBaht(minPrice(d))} บาท/เดือน${hasFloorPlan(d)?' · จำนวนห้องดูได้จากผังห้อง':''}</p>`
          : '<p class="muted" style="font-size:.88rem">ยังไม่ระบุ</p>')}
    <h4 style="margin:14px 0 6px">สิ่งอำนวยความสะดวก</h4>
    ${(d.facilities||[]).length
      ? `<div class="amenity-grid">${amenityGridHtml(d.facilities)}</div>`
      : '<p class="muted" style="font-size:.88rem">ยังไม่ระบุ</p>'}
    <h4 style="margin:14px 0 6px">รายละเอียด</h4>
    <p style="font-size:.9rem;white-space:pre-wrap">${escapeHtml(d.desc||'-')}</p>
    <a class="btn btn-outline btn-block" href="index.html#dorm=${encodeURIComponent(d.id)}" target="_blank" rel="noopener" style="text-align:center;text-decoration:none">👁 เปิดหน้าที่นักศึกษาเห็น</a>`;
  document.getElementById('viewModal').classList.add('open');
}
document.getElementById('closeViewModal')?.addEventListener('click',
  ()=> document.getElementById('viewModal').classList.remove('open'));

// ---------------------------------------------------------------------------
// ฟอร์มเพิ่ม/แก้ไขหอพัก
// รูปภาพและสิ่งอำนวยความสะดวกเก็บไว้ในตัวแปรระหว่างกรอกฟอร์ม แล้วบันทึกทีเดียวตอนกดบันทึก
// ---------------------------------------------------------------------------
let editImages = [];        // ลิงก์รูปในฟอร์มตอนนี้
let editFacilities = [];    // รหัสมาตรฐาน + ข้อความที่เจ้าของหอพิมพ์เอง

function renderEditPhotos(){
  const grid = document.getElementById('photoGrid');
  if(!grid) return;
  grid.innerHTML = editImages.map((u,i)=>`
    <div class="op-photo ${i===0?'is-cover':''}">
      <img src="${escapeHtml(u)}" alt="รูปที่ ${i+1}" ${imgFallbackAttr()}>
      ${i===0 ? '<span class="op-cover-tag">รูปปก</span>' : ''}
      <div class="op-photo-tools">
        ${i===0?'':`<button type="button" class="op-mini" data-fcover="${i}" title="ตั้งเป็นรูปปก">⭐</button>`}
        <button type="button" class="op-mini danger" data-frm="${i}" title="เอารูปนี้ออก">✕</button>
      </div>
    </div>`).join('');
  grid.querySelectorAll('[data-fcover]').forEach(b=>{
    b.addEventListener('click', ()=>{
      const i = +b.dataset.fcover;
      const [pick] = editImages.splice(i,1);
      editImages.unshift(pick);
      renderEditPhotos();
    });
  });
  grid.querySelectorAll('[data-frm]').forEach(b=>{
    b.addEventListener('click', ()=>{
      editImages.splice(+b.dataset.frm, 1);
      renderEditPhotos();
    });
  });
}

// ป้ายสิ่งอำนวยความสะดวกที่พิมพ์เอง (ช่องติ๊ก 6 อย่างมาตรฐานอยู่แยกต่างหาก)
function renderFacilityChips(){
  const box = document.getElementById('facilityChips');
  if(!box) return;
  const custom = editFacilities.filter(isCustomFacility);
  box.innerHTML = custom.map(c=>`
    <span class="ef-chip">${escapeHtml(c)}
      <button type="button" data-rmfac="${escapeHtml(c)}" title="ลบ">✕</button>
    </span>`).join('');
  box.querySelectorAll('[data-rmfac]').forEach(b=>{
    b.addEventListener('click', ()=>{
      editFacilities = editFacilities.filter(x => x !== b.dataset.rmfac);
      renderFacilityChips();
    });
  });
}

function addCustomFacility(){
  const input = document.getElementById('fFacilityOther');
  const text = (input.value||'').trim().slice(0,40);
  if(!text) return;
  if(FACILITY_META[text]){ toast('รายการนี้มีในช่องติ๊กด้านบนแล้ว','error'); input.value=''; return; }
  if(editFacilities.some(x => x.toLowerCase() === text.toLowerCase())){
    toast('เพิ่มรายการนี้ไปแล้ว','error'); input.value=''; return;
  }
  editFacilities.push(text);
  input.value = '';
  renderFacilityChips();
}

let editTypeAmen = null;   // ตัวเลือกของในห้องแต่ละประเภทในฟอร์มเพิ่ม/แก้หอ

function openEdit(dorm){
  editingId = dorm ? dorm.id : null;
  document.getElementById('editTitle').textContent = dorm ? 'แก้ไข: '+dorm.name : 'เพิ่มหอพักใหม่';
  document.getElementById('fName').value = dorm ? dorm.name : '';
  document.getElementById('fHallType').value = dorm ? dorm.hallType : 'หอรวม';
  document.getElementById('fLat').value = (dorm && dorm.lat != null) ? dorm.lat : '';
  document.getElementById('fLng').value = (dorm && dorm.lng != null) ? dorm.lng : '';
  document.getElementById('fMapLink').value = '';
  showLocationState();
  document.getElementById('fDesc').value = dorm ? dorm.desc : '';

  editFacilities = dorm ? (dorm.facilities||[]).filter(Boolean).slice() : [];
  document.querySelectorAll('.fFacility').forEach(cb=> cb.checked = editFacilities.includes(cb.value));
  renderFacilityChips();

  // ราคาห้องพัดลม/ห้องแอร์ — หอเก่าที่เคยกรอก "ราคาเริ่มต้น" ไว้
  // ให้ยกราคานั้นมาใส่ช่องห้องพัดลมให้ จะได้ไม่ต้องกรอกใหม่และราคาไม่หาย
  document.getElementById('fPriceFan').value = dorm ? (fanPriceValue(dorm) || '') : '';
  document.getElementById('fPriceAir').value = dorm ? (airPriceValue(dorm) || '') : '';
  // จำนวนผู้เข้าพักต่อห้อง (v43)
  [['fan','Fan'], ['air','Air']].forEach(([code, C])=>{
    const cap = dorm ? (dormCapacity(dorm, code) || {}) : {};
    document.getElementById('fCapMin'+C).value = cap.min || '';
    document.getElementById('fCapMax'+C).value = cap.max || '';
  });
  // ของในห้องแต่ละประเภท (v41) — ฟอร์มเพิ่มหอใหม่ก็ติ๊กได้เลย
  const taBox = document.getElementById('fTypeAmen');
  if(taBox){
    taBox.innerHTML = typeAmenEditorHtml();
    editTypeAmen = mountTypeAmenEditor(taBox, code=> dorm ? typeAmenFor(dorm, code) : []);
  }

  editImages = dorm ? (dorm.images||[]).slice() : [];
  renderEditPhotos();
  const prog = document.getElementById('photoProgress');
  if(prog){ prog.style.display='none'; prog.textContent=''; }

  document.getElementById('fPhone').value = dorm ? (dorm.phone||'') : '';
  document.getElementById('fLine').value = dorm ? (dorm.lineId||'') : '';
  document.getElementById('fContactEmail').value = dorm ? (dorm.contactEmail||'') : '';
  document.getElementById('fFacebook').value = dorm ? (dorm.facebook||'') : '';
  document.getElementById('verifiedWrap').style.display = 'block';
  document.getElementById('fVerified').checked = dorm ? !!dorm.verified : false;
  openEditPanel();
}

// เปิด/ปิดแผงแก้ไข (เดิมเป็น pop up ตอนนี้เป็นส่วนหนึ่งของหน้า)
//
// ⚠️ สำคัญ: แผงนี้อยู่ใน #sec-overview
// ถ้าตอนนั้นผู้ใช้อยู่แท็บอื่น (เช่น หน้ารวมหอของผู้ดูแลระบบ แล้วกดปุ่มแก้ไขในตาราง)
// sec-overview จะถูกซ่อนอยู่ แผงก็จะกางออกมาแบบมองไม่เห็นอะไรเลย
// จึงต้องสลับกลับมาแท็บ "หน้าหอพักของฉัน" ก่อนเสมอ
function gotoOverviewTab(){
  DASH_SECTIONS.forEach(sec=>{
    const el = document.getElementById('sec-' + sec);
    if(el) el.style.display = (sec === 'overview') ? 'block' : 'none';
  });
  document.querySelectorAll('.side-link').forEach(b=>{
    b.classList.toggle('active', b.dataset.sec === 'overview');
  });
}

function openEditPanel(){
  const panel = document.getElementById('editPanel');
  if(!panel) return;
  gotoOverviewTab();
  panel.style.display = 'block';
  // เลื่อนหน้าจอมาที่แผงให้เลย มิฉะนั้นกดแก้ไขแล้วดูเหมือนไม่มีอะไรเกิดขึ้น
  setTimeout(()=> panel.scrollIntoView({ behavior:'smooth', block:'start' }), 20);
  // แผนที่ต้องสร้าง "หลัง" แผงแสดงแล้ว มิฉะนั้น Leaflet วัดขนาดกล่องได้ 0 แล้วแผนที่จะเพี้ยน
  setTimeout(openLocMap, 80);
}
function closeEditPanel(){
  const panel = document.getElementById('editPanel');
  if(panel) panel.style.display = 'none';
  stopGpsWatch();
}
// หมายเหตุ: ปุ่ม "+ เพิ่มหอพักใหม่" ในหน้ารวมหอถูกเอาออกแล้ว (v34)
// เพราะหน้านั้นเป็นของผู้ดูแลระบบ ซึ่งเพิ่มหอไม่ได้ — เจ้าของหอเพิ่มหอจากปุ่มในหน้าหอพักของฉันแทน
document.getElementById('btnAddDorm')?.addEventListener('click', ()=> openEdit(null));
document.getElementById('closeEditModal').addEventListener('click', closeEditPanel);

// ---------------------------------------------------------------------------
// ตำแหน่งหอบนแผนที่
//
// มี 3 วิธีปักหมุด เรียงจากที่แนะนำมากสุด:
//   1) ลากหมุดบนแผนที่เอง   <- แม่นที่สุดเสมอ เพราะเจ้าของหอเห็นกับตาว่าหมุดอยู่ตรงหอจริง
//   2) กดปุ่ม "ใช้ตำแหน่งที่ฉันยืนอยู่ตอนนี้" (ต้องยืนอยู่ที่หอ)
//   3) วางลิงก์ Google Maps / กรอกพิกัดเอง
//
// ทุกวิธีจะไปลงที่ setLocation() จุดเดียว เพื่อให้ช่อง lat/lng กับหมุดบนแผนที่
// ตรงกันเสมอ ไม่มีทางหลุดกัน
// ---------------------------------------------------------------------------
const LOCMAP = { map:null, marker:null, acc:null, failed:false };

// สร้าง marker แบบวาดด้วย CSS ไม่ใช้ไฟล์รูปของ Leaflet
// (ไฟล์รูป default ของ Leaflet อ้างพาธแบบ relative ซึ่งพังเมื่อโหลดจาก CDN)
function locPinIcon(kind){
  const face = kind === 'dorm' ? '🏠' : (kind === 'shop' ? '📍' : '🎓');
  return L.divIcon({
    className: 'loc-pin loc-pin-' + kind,
    html: `<span>${face}</span>`,
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
}

// ---------------------------------------------------------------------------
// แผนที่เลือกจุดแบบย่อ — ใช้ในการ์ดต่าง ๆ ของ "หน้าหอพักของฉัน"
//
// ทำงานเหมือนแผนที่ปักหมุดหอทุกอย่าง (แตะเพื่อวางหมุด ลากหมุดปรับได้)
// แต่ไม่ผูกกับช่อง lat/lng ในฟอร์มใหญ่ จึงเอาไปใช้ซ้ำได้หลายที่:
//   - เลือกตำแหน่งร้านรอบหอ  (การ์ด "รอบ ๆ หอมีอะไรบ้าง")
//   - ปักหมุดหอ              (การ์ด "ช่องทางติดต่อ")
//
// หน้าหอถูกวาดใหม่ทั้งก้อนทุกครั้งที่บันทึก กล่อง <div> เดิมจึงหลุดออกจาก DOM
// ถ้าเอา map ตัวเก่ามาใช้ต่อจะได้แผนที่เปล่า ๆ — จึงเช็ค S.box ทุกครั้ง
// แล้วสร้างใหม่เมื่อกล่องไม่ใช่ตัวเดิม
// ---------------------------------------------------------------------------
const PICK_MAPS = {};

function pickMap(elId, opts){
  const o = opts || {};
  const box = document.getElementById(elId);
  if(!box || typeof L === 'undefined') return null;

  let S = PICK_MAPS[elId];
  if(S && S.box !== box){ try{ S.map.remove(); }catch(e){} S = null; }
  if(!S){
    const map = L.map(box, { zoomControl:true })
      .setView([o.center.lat, o.center.lng], o.zoom || 17);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© OpenStreetMap'
    }).addTo(map);
    S = PICK_MAPS[elId] = { box, map, marker:null, ref:null, value:null };
    map.on('click', (e)=>{
      setPick(elId, e.latlng.lat, e.latlng.lng);
      if(S.onPick && S.value) S.onPick(S.value.lat, S.value.lng);
    });
  }
  S.onPick  = o.onPick;
  S.pinKind = o.pinKind || 'shop';

  // หมุดอ้างอิง (หอ หรือ มหาวิทยาลัย) ไว้ให้ดูว่าจุดที่เลือกอยู่ห่างแค่ไหน — แตะไม่ได้
  if(S.ref){ try{ S.map.removeLayer(S.ref); }catch(e){} S.ref = null; }
  if(o.ref){
    S.ref = L.marker([o.ref.lat, o.ref.lng], {
      icon: locPinIcon(o.refKind || 'dorm'), interactive:false, keyboard:false
    }).addTo(S.map);
  }

  setPick(elId, o.pin ? o.pin.lat : null, o.pin ? o.pin.lng : null);
  // Leaflet วัดขนาดกล่องตอนที่การ์ดยังซ่อนอยู่ไม่ได้ ต้องรอให้กางออกก่อน
  setTimeout(()=>{
    try{
      S.map.invalidateSize();
      const at = o.pin || o.center;
      S.map.setView([at.lat, at.lng], o.zoom || 17);
    }catch(e){}
  }, 60);
  return S;
}

// วาง/ย้าย/ลบหมุดที่เลือกไว้บนแผนที่ย่อ (ไม่เรียก onPick เพื่อไม่ให้วนลูป)
function setPick(elId, lat, lng){
  const S = PICK_MAPS[elId];
  if(!S) return null;
  if(lat == null || lng == null || isNaN(lat) || isNaN(lng)){
    if(S.marker){ try{ S.map.removeLayer(S.marker); }catch(e){} S.marker = null; }
    S.value = null;
    return null;
  }
  S.value = { lat:+(+lat).toFixed(6), lng:+(+lng).toFixed(6) };
  if(!S.marker){
    S.marker = L.marker([S.value.lat, S.value.lng], {
      icon: locPinIcon(S.pinKind), draggable:true
    }).addTo(S.map);
    S.marker.on('dragend', ()=>{
      const ll = S.marker.getLatLng();
      S.value = { lat:+ll.lat.toFixed(6), lng:+ll.lng.toFixed(6) };
      if(S.onPick) S.onPick(S.value.lat, S.value.lng);
    });
  }else{
    S.marker.setLatLng([S.value.lat, S.value.lng]);
  }
  return S.value;
}

// ---------------------------------------------------------------------------
// "ใช้ตำแหน่งที่ฉันยืนอยู่ตอนนี้" สำหรับแผนที่ย่อในการ์ด
// ใช้หลักเดียวกับในฟอร์มใหญ่: ขอตำแหน่งสด (maximumAge:0) เฝ้าหลายครั้ง
// เก็บค่าที่แม่นที่สุด แล้วบอกความแม่นยำตรง ๆ ไม่เงียบ ๆ รับค่าหยาบมาใช้
// ---------------------------------------------------------------------------
let ownerGpsWatch = null, ownerGpsTimer = null, ownerGpsBest = null;

function stopOwnerGps(){
  if(ownerGpsWatch != null){ try{ navigator.geolocation.clearWatch(ownerGpsWatch); }catch(e){} }
  ownerGpsWatch = null;
  if(ownerGpsTimer){ clearTimeout(ownerGpsTimer); ownerGpsTimer = null; }
  const btn = document.getElementById('opLocHere');
  if(btn){ btn.disabled = false; btn.textContent = '📱 ใช้ตำแหน่งที่ฉันยืนอยู่ตอนนี้'; }
}

function ownerGpsPick(onOk, onMsg){
  if(!navigator.geolocation){ onMsg('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง — กรุณาแตะเลือกตำแหน่งบนแผนที่ด้วยตนเอง','warn'); return; }
  if(window.isSecureContext === false){
    onMsg('⚠️ เบราว์เซอร์ยอมให้หาตำแหน่งเฉพาะเว็บที่เป็น https เท่านั้น — แตะบนแผนที่แทนได้','warn'); return;
  }
  stopOwnerGps();
  ownerGpsBest = null;
  const btn = document.getElementById('opLocHere');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ กำลังหาตำแหน่ง...'; }
  onMsg('กำลังหาตำแหน่ง... รอสัก 2-3 วินาที ระบบกำลังรอให้สัญญาณแม่นขึ้น','');

  const done = ()=>{
    stopOwnerGps();
    if(!ownerGpsBest){
      onMsg('⚠️ หาตำแหน่งไม่สำเร็จ — แตะบนแผนที่เอง หรือวางลิงก์ Google Maps แทนได้','warn');
      return;
    }
    const { lat, lng, acc } = ownerGpsBest;
    const accTxt = acc ? `±${Math.round(acc)} ม.` : 'ไม่ทราบความแม่นยำ';
    if(lat < 18.5 || lat > 20.5 || lng < 99.0 || lng > 100.6){
      onMsg(`⚠️ ตำแหน่งที่เครื่องบอกมา (${lat.toFixed(4)}, ${lng.toFixed(4)}) อยู่นอกพื้นที่เชียงราย
        จึงยังไม่ปักหมุดให้ — ปุ่มนี้ต้องกดตอนที่<strong>ยืนอยู่ที่หอจริง ๆ</strong>`, 'warn');
      return;
    }
    if(acc && acc > GPS_OK_M){
      onOk(lat, lng, acc,
        `⚠️ ปักหมุดให้แล้ว แต่ตำแหน่งที่ได้<strong>ยังหยาบมาก (${accTxt})</strong> —
         ${looksLikeMobile()
           ? 'ลองออกมาที่โล่ง ๆ แล้วกดใหม่ หรือลากหมุดไปวางตรงหอเอง'
           : '<strong>คอมพิวเตอร์ไม่มี GPS จริง</strong> มันเดาจาก Wi-Fi/เน็ตเท่านั้น — ลากหมุดไปวางตรงหอเองจะตรงกว่า'}`,
        'warn');
    }else{
      onOk(lat, lng, acc, `✓ ปักหมุดจากตำแหน่งปัจจุบันแล้ว (ความแม่นยำ ${accTxt}) — ${locationSummary({lat,lng})}`, 'ok');
    }
  };

  ownerGpsWatch = navigator.geolocation.watchPosition(
    (pos)=>{
      const acc = pos.coords.accuracy;
      if(!ownerGpsBest || (acc && acc < ownerGpsBest.acc)){
        ownerGpsBest = { lat:+pos.coords.latitude.toFixed(6), lng:+pos.coords.longitude.toFixed(6), acc };
      }
      if(ownerGpsBest.acc && ownerGpsBest.acc <= GPS_GOOD_M){ done(); return; }
      onMsg(`กำลังหาตำแหน่ง... ตอนนี้ได้ความแม่นยำ ±${Math.round(ownerGpsBest.acc||0)} ม. (กำลังรอให้แม่นขึ้น)`, '');
    },
    (err)=>{
      stopOwnerGps();
      let m = 'หาตำแหน่งไม่สำเร็จ';
      if(err && err.code === 1) m = 'คุณยังไม่ได้อนุญาตให้เว็บนี้เข้าถึงตำแหน่ง — กดไอคอนรูปกุญแจ/หมุดข้างช่อง URL แล้วเปิดสิทธิ์ "ตำแหน่ง" ให้เว็บนี้ก่อน';
      else if(err && err.code === 2) m = 'เครื่องหาตำแหน่งไม่เจอ (อาจอยู่ในอาคารหรือปิด GPS อยู่)';
      else if(err && err.code === 3) m = 'หาตำแหน่งนานเกินไป';
      onMsg(`⚠️ ${m} — ระหว่างนี้แตะบนแผนที่ตรงหอเองได้ทันที ได้ผลเหมือนกัน`,'warn');
    },
    { enableHighAccuracy:true, timeout:GPS_WATCH_MS, maximumAge:0 }
  );
  ownerGpsTimer = setTimeout(done, GPS_WATCH_MS);
}

function openLocMap(){
  const box = document.getElementById('locMap');
  const fb  = document.getElementById('locMapFallback');
  if(!box) return;

  // Leaflet โหลดไม่ขึ้น (เน็ตมีปัญหา/โดนบล็อก) — ไม่เป็นไร ยังกรอกพิกัดเองได้
  if(typeof L === 'undefined'){
    LOCMAP.failed = true;
    box.style.display = 'none';
    if(fb){
      fb.style.display = 'block';
      fb.textContent = 'โหลดแผนที่ไม่สำเร็จ — ใช้วิธีวางลิงก์ Google Maps หรือกรอกพิกัดเองด้านล่างได้';
    }
    // สำคัญ: ต้องกางช่องกรอกสำรองให้เห็นด้วย
    // มิฉะนั้นแผนที่ก็ไม่ขึ้น ช่องกรอกก็ยังพับอยู่ = เจ้าของหอปักหมุดไม่ได้เลย
    // ต้องระบุ #editPanel ด้วย เพราะตอนนี้การ์ด "ช่องทางติดต่อ" ก็มี .loc-adv ของตัวเอง
    document.querySelector('#editPanel .loc-adv')?.setAttribute('open', '');
    renderLocDeviceHint();
    showLocationState();
    return;
  }
  if(fb) fb.style.display = 'none';
  box.style.display = 'block';

  const cur = readLocation();
  const center = cur || CRRU_CENTER;

  if(!LOCMAP.map){
    LOCMAP.map = L.map(box, { zoomControl:true, attributionControl:true })
                  .setView([center.lat, center.lng], cur ? 17 : 15);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap'
    }).addTo(LOCMAP.map);

    // หมุดมหาวิทยาลัยไว้อ้างอิง จะได้รู้ว่าหอเราอยู่ทางไหนของมอ
    L.marker([CRRU_CENTER.lat, CRRU_CENTER.lng], { icon: locPinIcon('crru'), interactive:false })
      .addTo(LOCMAP.map)
      .bindTooltip('มหาวิทยาลัยราชภัฏเชียงราย', { permanent:false });

    // แตะที่ไหนบนแผนที่ = ย้ายหมุดไปตรงนั้น
    LOCMAP.map.on('click', (e)=>{
      setLocation(e.latlng.lat, e.latlng.lng, { pan:false, src:'map' });
    });
  }

  syncMapToInputs({ pan:false });

  // modal เพิ่งเปิด กล่องแผนที่เพิ่งมีขนาดจริง ต้องบอก Leaflet ให้วัดใหม่
  setTimeout(()=>{
    try{
      LOCMAP.map.invalidateSize();
      if(cur){
        // เปิดมาให้เห็นทั้งหมุดหอและหมุดมอในจอเดียว จะได้ดูออกว่าปักถูกที่ไหม
        LOCMAP.map.fitBounds(
          L.latLngBounds([[cur.lat, cur.lng], [CRRU_CENTER.lat, CRRU_CENTER.lng]]),
          { padding:[45,45], maxZoom:17 }
        );
      }else{
        LOCMAP.map.setView([CRRU_CENTER.lat, CRRU_CENTER.lng], 15);
      }
    }catch(e){}
  }, 40);

  // ล้างผลค้นหาของหอก่อนหน้า มิฉะนั้นเปิดหออื่นมาแล้วยังเห็นผลเก่าค้างอยู่
  const res = document.getElementById('locResults');
  if(res){ res.style.display = 'none'; res.innerHTML = ''; }
  const sq = document.getElementById('locSearch');
  if(sq) sq.value = '';

  renderLocDeviceHint();
  showLocationState();
}

// อ่านพิกัดจากช่อง lat/lng — คืน null ถ้ายังไม่ได้ปัก
function readLocation(){
  const lat = parseFloat(document.getElementById('fLat').value);
  const lng = parseFloat(document.getElementById('fLng').value);
  if(isNaN(lat) || isNaN(lng)) return null;
  return { lat, lng };
}

// เอาค่าจากช่อง lat/lng ไปวาดหมุดบนแผนที่
function syncMapToInputs(opts){
  if(!LOCMAP.map) return;
  const p = readLocation();
  if(!p){
    if(LOCMAP.marker){ LOCMAP.map.removeLayer(LOCMAP.marker); LOCMAP.marker = null; }
    clearAccuracyCircle();
    return;
  }
  if(!LOCMAP.marker){
    LOCMAP.marker = L.marker([p.lat, p.lng], { icon: locPinIcon('dorm'), draggable:true })
      .addTo(LOCMAP.map)
      .bindTooltip('ลากหมุดนี้ไปวางตรงหอของคุณ', { direction:'top' });
    // ลากหมุดเสร็จ = พิกัดใหม่
    LOCMAP.marker.on('dragend', ()=>{
      const ll = LOCMAP.marker.getLatLng();
      setLocation(ll.lat, ll.lng, { pan:false, src:'drag' });
    });
  }else{
    LOCMAP.marker.setLatLng([p.lat, p.lng]);
  }
  if(opts && opts.pan) LOCMAP.map.setView([p.lat, p.lng], Math.max(LOCMAP.map.getZoom(), 17));
}

function clearAccuracyCircle(){
  if(LOCMAP.acc && LOCMAP.map){ LOCMAP.map.removeLayer(LOCMAP.acc); }
  LOCMAP.acc = null;
}

// วงกลมบอก "ความแม่นยำ" ของ GPS — ให้เจ้าของหอเห็นว่าตำแหน่งที่ได้เชื่อถือได้แค่ไหน
function showAccuracyCircle(lat, lng, metres){
  if(!LOCMAP.map || !metres) return;
  clearAccuracyCircle();
  LOCMAP.acc = L.circle([lat, lng], {
    radius: metres, color:'#2563eb', weight:1, fillColor:'#2563eb', fillOpacity:.12
  }).addTo(LOCMAP.map);
}

// ---- ทางเข้าเดียวของการตั้งพิกัด ----
function setLocation(lat, lng, opts){
  opts = opts || {};
  const la = +Number(lat).toFixed(6), ln = +Number(lng).toFixed(6);
  document.getElementById('fLat').value = la;
  document.getElementById('fLng').value = ln;
  syncMapToInputs({ pan: opts.pan !== false });
  if(opts.src !== 'gps') clearAccuracyCircle();
  showLocationState(opts.msg, opts.kind);
}

function clearLocation(){
  document.getElementById('fLat').value = '';
  document.getElementById('fLng').value = '';
  syncMapToInputs({ pan:false });
  showLocationState();
}

function showLocationState(msg, kind){
  const el = document.getElementById('locState');
  if(!el) return;
  if(msg){
    el.className = 'loc-state ' + (kind || '');
    el.innerHTML = msg;
    el.style.display = 'block';
    return;
  }
  // ไม่ได้ส่งข้อความมา = สรุปสถานะจากพิกัดที่กรอกอยู่
  const p = readLocation();
  if(!p){
    el.className = 'loc-state warn';
    el.innerHTML = '⚠️ ยังไม่ได้ปักหมุดหอ — นักศึกษาจะกดนำทางมาหอไม่ได้ และเว็บจะบอกระยะจากมอไม่ได้';
    el.style.display = 'block';
    return;
  }
  const km = distanceToCrru(p);
  // ปักไกลจากมอผิดปกติ = น่าจะปักผิดที่ เตือนไว้ก่อน
  if(km != null && km > 15){
    el.className = 'loc-state warn';
    el.innerHTML = `⚠️ หมุดนี้ห่างจากมหาวิทยาลัยถึง <strong>${distanceLabel(km)}</strong> —
      ลองตรวจดูว่าลากหมุดไปถูกที่ไหม แล้วซูมแผนที่เข้าไปดูให้ชัด`;
    el.style.display = 'block';
    return;
  }
  el.className = 'loc-state ok';
  el.innerHTML = `✓ ปักหมุดแล้ว — <strong>${locationSummary(p)}</strong>
    <a href="https://www.google.com/maps?q=${p.lat},${p.lng}" target="_blank" rel="noopener">เปิดหมุดนี้ใน Google Maps เพื่อตรวจสอบ</a>`;
  el.style.display = 'block';
}

function applyParsedLocation(text){
  const r = parseLatLng(text);
  if(!r){ showLocationState('กรุณาวางลิงก์ Google Maps ของหอก่อน', 'warn'); return; }
  if(r.error){ showLocationState('⚠️ ' + r.error, 'warn'); return; }
  setLocation(r.lat, r.lng, { src:'link' });
  toast('ดึงพิกัดจากลิงก์เรียบร้อย — ตรวจบนแผนที่อีกทีว่าหมุดตรงหอไหม','success');
}

document.getElementById('btnParseMap')?.addEventListener('click', ()=>{
  applyParsedLocation(document.getElementById('fMapLink').value);
});
document.getElementById('fMapLink')?.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); applyParsedLocation(e.target.value); }
});
// วางลิงก์แล้วดึงพิกัดให้เลย ไม่ต้องกดปุ่มซ้ำ
document.getElementById('fMapLink')?.addEventListener('paste', (e)=>{
  const text = (e.clipboardData || window.clipboardData).getData('text');
  setTimeout(()=> applyParsedLocation(text), 30);
});
// ---------------------------------------------------------------------------
// ค้นหาสถานที่บนแผนที่
//
// นี่คือวิธีหลักสำหรับคนที่เปิดจากคอมพิวเตอร์ — คอมหาตำแหน่งตัวเองไม่แม่น
// (เดาจาก Wi-Fi/เน็ต คลาดเป็นกิโลได้) ปุ่ม "ใช้ตำแหน่งที่ฉันยืนอยู่"
// จึงเชื่อถือได้เฉพาะบนมือถือที่มี GPS จริง
// ---------------------------------------------------------------------------

// เครื่องนี้น่าจะเป็นมือถือไหม — ใช้ตัดสินว่าจะแนะนำวิธีไหนก่อน
// ดูจาก "ไม่มีเมาส์" + "จอแคบ" แทนการเดาจากชื่อเบราว์เซอร์ ซึ่งปลอมกันได้ง่าย
function looksLikeMobile(){
  try{
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const touch  = navigator.maxTouchPoints > 0;
    return !!(coarse && touch);
  }catch(e){ return false; }
}

function renderLocDeviceHint(){
  const el = document.getElementById('locDeviceHint');
  if(!el) return;
  el.innerHTML = looksLikeMobile()
    ? `📱 เปิดจากมือถืออยู่ — ถ้าตอนนี้<strong>ยืนอยู่ที่หอ</strong> กดปุ่ม
       "ใช้ตำแหน่งที่ฉันยืนอยู่ตอนนี้" จะแม่นที่สุด`
    : `💻 เปิดจากคอมพิวเตอร์อยู่ — คอมไม่มี GPS จริง มันเดาตำแหน่งจาก Wi-Fi/เน็ต
       ซึ่ง<strong>คลาดเคลื่อนได้เป็นกิโลเมตร</strong><br>
       แนะนำให้ <strong>ค้นหาชื่อสถานที่ด้านบน</strong> แล้วลากหมุดปรับให้ตรง
       หรือเปิดหน้านี้จากมือถือตอนอยู่ที่หอ`;
}

let locSearchBusy = false;

async function runLocSearch(){
  const input = document.getElementById('locSearch');
  const box   = document.getElementById('locResults');
  const btn   = document.getElementById('btnLocSearch');
  if(!input || !box || locSearchBusy) return;

  const q = input.value.trim();
  if(q.length < 2){
    box.style.display = 'block';
    box.innerHTML = '<div class="lr-msg">พิมพ์ชื่อสถานที่อย่างน้อย 2 ตัวอักษร</div>';
    return;
  }

  locSearchBusy = true;
  if(btn){ btn.disabled = true; btn.textContent = 'กำลังค้นหา...'; }
  box.style.display = 'block';
  box.innerHTML = '<div class="lr-msg">กำลังค้นหา...</div>';

  try{
    const list = await searchPlace(q);
    if(!list.length){
      box.innerHTML = `<div class="lr-msg">ไม่พบสถานที่ชื่อนี้ —
        ลองพิมพ์ชื่อถนนหรือหมู่บ้านแทน หรือลากหมุดบนแผนที่เอง</div>`;
      return;
    }
    box.innerHTML = list.map((p,i)=>{
      const km = haversineKm(p, CRRU_CENTER);
      return `<button type="button" class="lr-item" data-lr="${i}">
        <span class="lr-name">${escapeHtml(p.short || p.name)}</span>
        <span class="lr-sub">${escapeHtml(p.name)}</span>
        <span class="lr-dist">ห่างมหาวิทยาลัย ${escapeHtml(distanceLabel(km))}</span>
      </button>`;
    }).join('');
    box.querySelectorAll('[data-lr]').forEach(b=>{
      b.addEventListener('click', ()=>{
        const p = list[+b.dataset.lr];
        if(!p) return;
        setLocation(p.lat, p.lng, { src:'search', pan:true });
        box.style.display = 'none';
        showLocationState(`✓ ย้ายหมุดไปที่ <strong>${escapeHtml(p.short || p.name)}</strong> แล้ว —
          ซูมแผนที่เข้าไปดู แล้ว<strong>ลากหมุดปรับให้ตรงตัวอาคารหอ</strong>อีกที
          ผลค้นหาอาจชี้กลางถนนหรือกลางหมู่บ้าน`, '');
      });
    });
  }catch(err){
    console.error(err);
    box.innerHTML = `<div class="lr-msg">${escapeHtml(err.message || 'ค้นหาไม่สำเร็จ')}</div>`;
  }finally{
    locSearchBusy = false;
    if(btn){ btn.disabled = false; btn.textContent = '🔍 ค้นหา'; }
  }
}

document.getElementById('btnLocSearch')?.addEventListener('click', runLocSearch);
document.getElementById('locSearch')?.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); runLocSearch(); }
});

document.getElementById('btnCrruLoc')?.addEventListener('click', ()=>{
  if(LOCMAP.map) LOCMAP.map.setView([CRRU_CENTER.lat, CRRU_CENTER.lng], 15);
});
document.getElementById('btnClearLoc')?.addEventListener('click', clearLocation);

// ---------------------------------------------------------------------------
// ปุ่ม "ใช้ตำแหน่งที่ฉันยืนอยู่ตอนนี้"
//
// ของเดิมเรียก getCurrentPosition ครั้งเดียวแล้วรับค่าที่ได้มาเลย ซึ่งมีปัญหา 2 ข้อ:
//   1) ไม่ได้ใส่ maximumAge:0  -> เบราว์เซอร์คืน "ตำแหน่งเก่าที่ cache ไว้" ได้
//      เป็นเหตุผลที่บางทีมันขึ้นเป็นตำแหน่งที่เราเคยอยู่ ไม่ใช่ที่ยืนอยู่จริง
//   2) ไม่ได้ดู coords.accuracy -> ถ้าเปิดจากคอมที่หาตำแหน่งด้วย Wi-Fi/IP
//      ค่าที่ได้อาจคลาดไปเป็นกิโล แต่ระบบรับมาใช้เงียบ ๆ เหมือนมันแม่น
//
// ของใหม่: บังคับขอตำแหน่งสด (maximumAge:0) แล้วเฝ้าดูหลายครั้งด้วย watchPosition
// เก็บอันที่แม่นที่สุดไว้ พร้อมบอกค่าความแม่นยำ (± กี่เมตร) ให้เจ้าของหอเห็นตรง ๆ
// และวาดวงกลมความแม่นยำบนแผนที่ ถ้ามันหยาบก็ให้ลากหมุดแก้เองได้
// ---------------------------------------------------------------------------
const GPS_GOOD_M = 30;    // แม่นระดับนี้ = พอใช้ได้ทันที หยุดรอได้
const GPS_OK_M   = 100;   // ยังพอไหว แต่ควรลากหมุดตรวจอีกที
const GPS_WATCH_MS = 12000;   // รอไม่เกินเท่านี้ แล้วเอาค่าที่ดีที่สุดเท่าที่ได้
let gpsWatchId = null, gpsBest = null, gpsTimer = null;

function stopGpsWatch(){
  if(gpsWatchId != null){ try{ navigator.geolocation.clearWatch(gpsWatchId); }catch(e){} }
  gpsWatchId = null;
  if(gpsTimer){ clearTimeout(gpsTimer); gpsTimer = null; }
  const btn = document.getElementById('btnHereLoc');
  if(btn){ btn.disabled = false; btn.textContent = '📱 ใช้ตำแหน่งที่ฉันยืนอยู่ตอนนี้'; }
}

function finishGps(){
  stopGpsWatch();
  if(!gpsBest){
    showLocationState('⚠️ หาตำแหน่งไม่สำเร็จ — ลากหมุดบนแผนที่เอง หรือวางลิงก์ Google Maps แทนได้','warn');
    return;
  }
  const { lat, lng, acc } = gpsBest;
  const accTxt = acc ? `±${Math.round(acc)} ม.` : 'ไม่ทราบความแม่นยำ';

  if(lat < 18.5 || lat > 20.5 || lng < 99.0 || lng > 100.6){
    showLocationState(`⚠️ ตำแหน่งที่เครื่องบอกมา (${lat.toFixed(4)}, ${lng.toFixed(4)}) อยู่นอกพื้นที่เชียงราย
      จึงยังไม่ปักหมุดให้ — ปุ่มนี้ต้องกดตอนที่ <strong>ยืนอยู่ที่หอจริง ๆ</strong>
      ถ้าตอนนี้ไม่ได้อยู่ที่หอ ให้ลากหมุดบนแผนที่แทน`, 'warn');
    return;
  }

  setLocation(lat, lng, { src:'gps', pan:true });
  showAccuracyCircle(lat, lng, acc);

  if(acc && acc > GPS_OK_M){
    // ตำแหน่งหยาบมาก — ซูมแผนที่ให้พอดีกับวงความแม่นยำ
    // เจ้าของหอจะได้เห็นกับตาว่า "ที่เครื่องบอกมา" มันกว้างแค่ไหน ไม่ใช่เชื่อตัวเลขลอย ๆ
    try{
      if(LOCMAP.map && LOCMAP.acc) LOCMAP.map.fitBounds(LOCMAP.acc.getBounds(), { padding:[20,20] });
    }catch(e){}
    const onPc = !looksLikeMobile();
    showLocationState(`⚠️ ปักหมุดให้แล้ว แต่ตำแหน่งที่ได้<strong>ยังหยาบมาก (${accTxt})</strong> —
      หอจริงอาจอยู่ที่ไหนก็ได้ในวงกลมสีฟ้าบนแผนที่<br>
      ${onPc
        ? `สาเหตุคือ<strong>คอมพิวเตอร์ไม่มี GPS จริง</strong> มันเดาตำแหน่งจาก Wi-Fi/เน็ตเท่านั้น<br>
           <strong>ทางที่ได้ผลกว่า:</strong> พิมพ์ชื่อหอหรือชื่อถนนใน<strong>ช่องค้นหาด้านบน</strong>
           แล้วลากหมุดปรับให้ตรง — หรือเปิดหน้านี้จากมือถือตอนยืนอยู่ที่หอ`
        : `ลองออกมาที่โล่ง ๆ นอกอาคารแล้วกดใหม่ หรือ<strong>ลากหมุดไปวางตรงหอเอง</strong>
           — จะใช้ช่องค้นหาด้านบนก็ได้`}`, 'warn');
  }else if(acc && acc > GPS_GOOD_M){
    showLocationState(`✓ ปักหมุดจากตำแหน่งปัจจุบันแล้ว (ความแม่นยำ ${accTxt}) —
      ${locationSummary({lat,lng})}<br>
      กรุณาขยายแผนที่เพื่อตรวจสอบ หากหมุดยังไม่ตรงกับตัวอาคาร สามารถลากปรับได้`, 'ok');
  }else{
    showLocationState(`✓ ปักหมุดจากตำแหน่งปัจจุบันแล้ว ความแม่นยำดี (${accTxt}) —
      ${locationSummary({lat,lng})}`, 'ok');
    toast('ใช้ตำแหน่งปัจจุบันเป็นที่ตั้งหอแล้ว','success');
  }
}

document.getElementById('btnHereLoc')?.addEventListener('click', ()=>{
  if(!navigator.geolocation){
    showLocationState('เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง — กรุณาลากหมุดบนแผนที่ด้วยตนเอง','warn');
    return;
  }
  // เบราว์เซอร์ยอมให้ขอตำแหน่งเฉพาะหน้าที่ปลอดภัย (https หรือ localhost)
  // ใช้ isSecureContext เพราะเป็นตัวเดียวกับที่เบราว์เซอร์ใช้ตัดสินจริง ๆ
  if(window.isSecureContext === false){
    showLocationState('⚠️ เบราว์เซอร์ยอมให้หาตำแหน่งเฉพาะเว็บที่เป็น https เท่านั้น — ลากหมุดบนแผนที่แทนได้','warn');
    return;
  }

  stopGpsWatch();
  gpsBest = null;
  const btn = document.getElementById('btnHereLoc');
  if(btn){ btn.disabled = true; btn.textContent = '⏳ กำลังหาตำแหน่ง...'; }
  showLocationState('กำลังหาตำแหน่ง... รอสัก 2-3 วินาที ระบบกำลังรอให้สัญญาณแม่นขึ้น','');

  gpsWatchId = navigator.geolocation.watchPosition(
    (pos)=>{
      const acc = pos.coords.accuracy;
      // เก็บเฉพาะครั้งที่แม่นกว่าเดิม
      if(!gpsBest || (acc && acc < gpsBest.acc)){
        gpsBest = { lat:+pos.coords.latitude.toFixed(6), lng:+pos.coords.longitude.toFixed(6), acc };
      }
      // แม่นพอแล้ว ไม่ต้องรอต่อ
      if(gpsBest.acc && gpsBest.acc <= GPS_GOOD_M){ finishGps(); return; }
      // ยังไม่แม่น รอต่อ แต่ให้ปุ่มกดข้ามไว้ด้วย จะได้ไม่ต้องนั่งรอจนครบ
      showLocationState(`กำลังหาตำแหน่ง... ตอนนี้ได้ความแม่นยำ ±${Math.round(gpsBest.acc||0)} ม.
        (กำลังรอให้แม่นขึ้น)
        <button type="button" class="btn btn-sm btn-ghost" id="btnGpsNow"
          style="margin-left:8px">ใช้ค่านี้เลย</button>`, '');
      document.getElementById('btnGpsNow')?.addEventListener('click', finishGps);
    },
    (err)=>{
      stopGpsWatch();
      let m = 'หาตำแหน่งไม่สำเร็จ';
      if(err && err.code === 1) m = 'คุณยังไม่ได้อนุญาตให้เว็บนี้เข้าถึงตำแหน่ง — กดไอคอนรูปกุญแจ/หมุด ข้างช่อง URL แล้วเปิดสิทธิ์ "ตำแหน่ง" ให้เว็บนี้ก่อน';
      else if(err && err.code === 2) m = 'เครื่องหาตำแหน่งไม่เจอ (อาจอยู่ในอาคารหรือปิด GPS อยู่)';
      else if(err && err.code === 3) m = 'หาตำแหน่งนานเกินไป';
      showLocationState(`⚠️ ${m} — ระหว่างนี้ลากหมุดบนแผนที่ไปวางตรงหอเองได้ทันที ได้ผลเหมือนกัน`,'warn');
    },
    { enableHighAccuracy:true, timeout:GPS_WATCH_MS, maximumAge:0 }
  );
  // ครบเวลาแล้วก็เอาค่าที่ดีที่สุดเท่าที่ได้
  gpsTimer = setTimeout(finishGps, GPS_WATCH_MS);
});

// หมายเหตุ: การหยุดเฝ้า GPS ตอนปิดแผง ย้ายไปอยู่ใน closeEditPanel() แล้ว

['fLat','fLng'].forEach(id=>{
  document.getElementById(id)?.addEventListener('input', ()=>{
    syncMapToInputs({ pan:false });
    showLocationState();
  });
});

// ---- ปุ่มในฟอร์ม: เพิ่มสิ่งอำนวยความสะดวกเอง ----
document.getElementById('btnAddFacility')?.addEventListener('click', addCustomFacility);
document.getElementById('fFacilityOther')?.addEventListener('keydown', (e)=>{
  if(e.key === 'Enter'){ e.preventDefault(); addCustomFacility(); }
});

// ---- ปุ่มในฟอร์ม: เลือกรูปจากเครื่อง / ลากไฟล์มาวาง / วางลิงก์รูป ----
async function handlePickedFiles(files){
  const prog = document.getElementById('photoProgress');
  const show = (m)=>{ if(prog){ prog.style.display='block'; prog.textContent = m; } };
  try{
    show('กำลังเตรียมรูป...');
    const urls = await uploadDormImages(files, (done,total,name)=> show(`กำลังอัปโหลด ${done+1}/${total} — ${name||''}`));
    editImages = editImages.concat(urls);
    renderEditPhotos();
    show(`✓ เพิ่มรูปแล้ว ${urls.length} รูป — กด "บันทึกหอพัก" ด้านล่างเพื่อบันทึก`);
    setTimeout(()=>{ if(prog) prog.style.display='none'; }, 4000);
  }catch(err){
    console.error(err);
    if(prog) prog.style.display = 'none';
    toast(err.message || 'อัปโหลดรูปไม่สำเร็จ','error');
  }
}
document.getElementById('btnPickPhotos')?.addEventListener('click', ()=> document.getElementById('fPhotoInput').click());
document.getElementById('fPhotoInput')?.addEventListener('change', async (e)=>{
  const files = e.target.files;
  if(files && files.length) await handlePickedFiles(files);
  e.target.value = '';
});
const dropZone = document.getElementById('photoDrop');
if(dropZone){
  ['dragenter','dragover'].forEach(ev=> dropZone.addEventListener(ev, (e)=>{
    e.preventDefault(); dropZone.classList.add('drag');
  }));
  ['dragleave','drop'].forEach(ev=> dropZone.addEventListener(ev, (e)=>{
    e.preventDefault(); dropZone.classList.remove('drag');
  }));
  dropZone.addEventListener('drop', async (e)=>{
    const files = e.dataTransfer && e.dataTransfer.files;
    if(files && files.length) await handlePickedFiles(files);
  });
}
document.getElementById('btnAddImageUrl')?.addEventListener('click', ()=>{
  const input = document.getElementById('fImageUrl');
  const url = (input.value||'').trim();
  if(!url) return;
  if(!/^https?:\/\//i.test(url)){ toast('ลิงก์รูปต้องขึ้นต้นด้วย http:// หรือ https://','error'); return; }
  editImages.push(url);
  input.value = '';
  renderEditPhotos();
});

document.getElementById('saveEdit').addEventListener('click', async ()=>{
  // สิ่งอำนวยความสะดวก = ที่ติ๊กไว้ + ที่พิมพ์เอง (เรียงให้ของมาตรฐานขึ้นก่อน)
  const checked = Array.from(document.querySelectorAll('.fFacility:checked')).map(cb=>cb.value);
  const custom  = editFacilities.filter(isCustomFacility);
  const facilities = checked.concat(custom);
  const images = editImages.slice();
  if(images.length===0 && document.getElementById('fVerified').checked){
    toast('ถ้าจะยืนยันข้อมูล กรุณาเพิ่มรูปหอพักอย่างน้อย 1 รูปก่อน','error'); return;
  }
  // ---- ราคาห้องพัดลม / ห้องแอร์ (v34) ----
  // เก็บเป็น 2 รายการใน rooms (code 'fan' / 'air') ไม่ต้องเพิ่มคอลัมน์ในฐานข้อมูล
  const readEditPrice = (id, name)=>{
    const raw = plainNumber(document.getElementById(id).value);
    if(raw === '') return 0;
    const n = +raw;
    if(isNaN(n) || n < 0){ toast(`ราคา${name}ต้องเป็นตัวเลขที่ไม่ติดลบ`,'error'); return null; }
    return n;
  };
  const fanPrice = readEditPrice('fPriceFan', 'ห้องพัดลม');
  const airPrice = readEditPrice('fPriceAir', 'ห้องแอร์');
  if(fanPrice === null || airPrice === null) return;
  // จำนวนผู้เข้าพักต่อห้อง (v43)
  const caps = readCapInputs('fCap');
  if(caps === null) return;
  if(!(fanPrice > 0) && caps.fan){ toast('กรอกจำนวนผู้เข้าพักห้องพัดลมไว้ แต่ยังไม่ได้ใส่ราคา — กรุณาใส่ราคาห้องพัดลมด้วย','error'); return; }
  if(!(airPrice > 0) && caps.air){ toast('กรอกจำนวนผู้เข้าพักห้องแอร์ไว้ แต่ยังไม่ได้ใส่ราคา — กรุณาใส่ราคาห้องแอร์ด้วย','error'); return; }
  const editing = editingId ? myDorms.find(x=>x.id===editingId) : null;
  const rooms = buildPriceRooms(editing, fanPrice, airPrice, caps);
  // ติ๊ก "ยืนยันข้อมูล" ต้องมีราคาก่อน มิฉะนั้นการ์ดจะขึ้น "สอบถามกับหอโดยตรง" ทั้งที่บอกว่ายืนยันแล้ว
  if(rooms.length===0 && document.getElementById('fVerified').checked){
    toast('ถ้าจะยืนยันข้อมูล กรุณาใส่ราคาห้องพัดลมหรือห้องแอร์ก่อน','error'); return;
  }

  const data = {
    name: document.getElementById('fName').value.trim(),
    hallType: document.getElementById('fHallType').value,
    // ไม่ใช้ระยะจากประตูมอแล้ว — เว็บคำนวณระยะจากพิกัดหอให้เอง
    gates: null,
    lat: document.getElementById('fLat').value === '' ? null : +document.getElementById('fLat').value,
    lng: document.getElementById('fLng').value === '' ? null : +document.getElementById('fLng').value,
    desc: document.getElementById('fDesc').value.trim(),
    facilities, images, rooms,
    phone: document.getElementById('fPhone').value.trim(),
    lineId: document.getElementById('fLine').value.trim(),
    contactEmail: document.getElementById('fContactEmail').value.trim(),
    facebook: document.getElementById('fFacebook').value.trim()
  };
  // เจ้าของหอยืนยันข้อมูลหอของตัวเองได้เอง ไม่ต้องรอแอดมิน
  data.verified = document.getElementById('fVerified').checked;
  // ของในห้องแต่ละประเภท เก็บไว้ในผังห้อง (floor_plan.typeAmen) — หอใหม่เริ่มจากผังว่าง
  if(editTypeAmen){
    const plan = normalizeFloorPlan(editing ? editing.floorPlan : emptyFloorPlan());
    plan.typeAmen = normalizeTypeAmen(Object.assign({}, plan.typeAmen, editTypeAmen.values()));
    data.floorPlan = plan;
  }
  if(!data.name){ toast('กรุณาใส่ชื่อหอพัก','error'); return; }

  try{
    if(editingId){ await updateDorm(editingId, data); toast('บันทึกข้อมูลหอพักแล้ว','success'); }
    else{
      const newId = await addDorm(ME.uid, data);
      activeOwnerDormId = newId;         // เปิดหอที่เพิ่งสร้างในหน้าโปรไฟล์เลย
      toast('สร้างหน้าหอพักของคุณสำเร็จ — นักศึกษาเห็นหอนี้แล้ว','success');
    }
    closeEditPanel();
    renderListings(); renderStats(); renderOwnerPage();
  }catch(err){ console.error(err); toast('บันทึกไม่สำเร็จ: '+err.message,'error'); }
});

// หมายเหตุ: ฟังก์ชัน renderClaim / renderClaimReview (ระบบ "รับช่วงดูแลหอ")
// ถูกลบออกแล้ว เพราะตอนนี้เจ้าของหอสร้างหน้าหอของตัวเองได้เลย
// ไม่ต้องไปยื่นคำขอรับช่วงหอที่ระบบใส่ไว้ให้ก่อน


// ---------------------------------------------------------------------------
// ข้อความจากนักศึกษา (ฝั่งเจ้าของหอ)
// ---------------------------------------------------------------------------
let chatUnsub = null;
let chatCtx = null;

function escapeHtml(s){
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function renderMessages(list, myId){
  const box = document.getElementById('chatBody');
  if(!list.length){ box.innerHTML = '<div class="chat-empty">ยังไม่มีข้อความ</div>'; return; }
  box.innerHTML = list.map(m=>{
    const mine = m.senderId === myId;
    return `<div class="msg-row ${mine?'mine':'theirs'}">
      <div class="bubble">${escapeHtml(m.body)}<span class="msg-time">${fmtChatTime(m.createdAt)}</span></div>
    </div>`;
  }).join('');
  box.scrollTop = box.scrollHeight;
}

async function openOwnerChat(thread){
  const dorm = await getDormById(thread.dormId);
  if(!dorm){ toast('ไม่พบหอพักนี้','error'); return; }
  chatCtx = { dorm, studentId: thread.studentId, studentName: thread.studentName };
  document.getElementById('chatTitle').textContent = thread.studentName || 'นักศึกษา';
  document.getElementById('chatSub').textContent = 'สอบถามเรื่อง: ' + (thread.dormName||dorm.name);
  document.getElementById('chatBody').innerHTML = '<div class="chat-empty">กำลังโหลด...</div>';
  document.getElementById('chatModal').classList.add('open');

  const user = await waitForSession();
  if(chatUnsub) chatUnsub();
  chatUnsub = watchThread(thread.dormId, thread.studentId, (list)=>{
    renderMessages(list, user.id);
    markThreadRead(thread.dormId, thread.studentId, 'owner').then(()=>{ renderOwnerThreads(); refreshOwnerUnread(); });
  });
  setTimeout(()=> document.getElementById('chatInput').focus(), 200);
}

async function ownerSend(){
  const input = document.getElementById('chatInput');
  const body = input.value.trim();
  if(!body || !chatCtx) return;
  const btn = document.getElementById('chatSend');
  btn.disabled = true;
  try{
    await sendMessage({ dorm: chatCtx.dorm, studentId: chatCtx.studentId,
      studentName: chatCtx.studentName, body, profile: ME });
    input.value = ''; input.style.height='auto';
  }catch(err){ console.error(err); toast('ส่งไม่สำเร็จ: '+(err.message||''),'error'); }
  finally{ btn.disabled = false; input.focus(); }
}

async function renderOwnerThreads(){
  const box = document.getElementById('ownerThreads');
  try{
    const threads = await getMyThreads();
    if(!threads.length){
      box.innerHTML = '<div class="chat-empty">ยังไม่มีข้อความจากนักศึกษา</div>';
      return;
    }
    box.innerHTML = threads.map((t,i)=>`
      <div class="thread-item" data-t="${i}">
        <div class="ti-main">
          <div class="ti-name">${escapeHtml(t.studentName||'นักศึกษา')}</div>
          <div class="ti-last">${escapeHtml(t.dormName||'')} · ${escapeHtml(t.lastBody)}</div>
        </div>
        <div class="ti-meta">${fmtChatTime(t.lastAt)}<br>${t.unread?`<span class="unread-dot">${t.unread}</span>`:''}</div>
      </div>`).join('');
    box.querySelectorAll('[data-t]').forEach(el=>{
      el.addEventListener('click', ()=> openOwnerChat(threads[+el.dataset.t]));
    });
  }catch(err){
    console.error(err);
    box.innerHTML = '<div class="chat-empty">โหลดไม่สำเร็จ</div>';
  }
}

// ---------------------------------------------------------------------------
// คำขอนัดหมาย (ฝั่งเจ้าของหอ)
// ---------------------------------------------------------------------------
function fmtBookingDate(s){
  if(!s) return '';
  try{ return new Date(s).toLocaleDateString('th-TH', { day:'numeric', month:'long', year:'numeric' }); }
  catch(e){ return s; }
}

function bookingItemHtml(b){
  const isNew = !b.ownerReadAt && b.status === 'pending';
  const cls = b.status === 'confirmed' ? 'done' : (b.status === 'cancelled' ? 'cancelled' : (isNew ? 'is-new' : ''));
  const row = (k,v)=> v ? `<div><span class="k">${k}:</span> <strong>${escapeHtml(v)}</strong></div>` : '';
  return `
  <div class="booking-item ${cls}">
    <div class="bk-top">
      <div>
        <div class="bk-who">${escapeHtml(b.userName || 'นักศึกษา')} ${isNew?'<span class="chat-badge">ใหม่</span>':''}</div>
        <div class="bk-room">${escapeHtml(b.roomLabel || 'ยังไม่ระบุห้อง')} · ${escapeHtml(b.dormName || '')}</div>
      </div>
      ${statusPill(b.status)}
    </div>

    <div class="bk-grid">
      ${row('เบอร์ติดต่อ', b.contactPhone)}
      ${row('อีเมล', b.userEmail)}
      ${row('สะดวกเข้าชมห้อง', fmtVisitWhen(b.visitDate, b.visitTime))}
      ${row('ส่งคำขอเมื่อ', fmtChatTime(b.createdAt))}
    </div>

    ${b.note ? `<div class="bk-note">💬 ${escapeHtml(b.note)}</div>` : ''}
    ${b.ownerNote ? `<div class="bk-ownernote">
      <strong>เหตุผลที่คุณแจ้งนักศึกษา</strong>
      <p>${escapeHtml(b.ownerNote)}</p>
    </div>` : ''}

    <div class="bk-actions">
      <button class="btn btn-sm btn-outline" data-bkchat="${b.dormId}|${b.userId}|${escapeHtml(b.userName||'')}">💬 ตอบกลับข้อความ</button>
      ${b.status === 'pending' ? `
        <button class="btn btn-sm btn-approve" data-bkok="${b.id}">✓ ยืนยันรับนัดหมาย</button>
        <button class="btn btn-sm btn-reject" data-bkno="${b.id}">✕ ปฏิเสธ</button>` : ''}
      <span class="bk-mailstate">${b.notifiedAt ? '✉️ ส่งอีเมลแจ้งแล้ว' : '✉️ ยังไม่ได้ส่งอีเมล'}</span>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// หน้าต่างปฏิเสธคำขอนัดหมาย (v44)
//
// บังคับให้เจ้าของหอพิมพ์เหตุผลก่อนปฏิเสธ พร้อมปุ่มเหตุผลสำเร็จรูปให้กดเลือก
// เพราะเหตุผลที่พบบ่อยมีไม่กี่แบบ การให้กดเลือกเร็วกว่าพิมพ์เอง
// แต่ยังแก้ข้อความต่อได้ ไม่ได้ล็อกไว้แค่ตัวเลือกสำเร็จรูป
// ---------------------------------------------------------------------------
const REJECT_PRESETS = [
  'ห้องนี้มีผู้เช่าแล้ว',
  'ห้องนี้ปิดปรับปรุงอยู่',
  'วันและเวลาที่นัดหมายไม่สะดวก',
  'หอพักเต็มแล้วในช่วงนี้',
  'ติดต่อกลับไม่ได้'
];
let rejectCtx = null;

function openRejectModal(booking){
  if(!booking) return;
  rejectCtx = booking;
  document.getElementById('rejectWho').textContent =
    `${booking.userName || 'นักศึกษา'} · ${booking.roomLabel || 'ยังไม่ระบุห้อง'}`;
  document.getElementById('rejectNote').value = '';
  const err = document.getElementById('rejectErr');
  err.textContent = ''; err.style.display = 'none';

  const quick = document.getElementById('rejectQuick');
  quick.innerHTML = REJECT_PRESETS.map(t=>
    `<button type="button" class="ra-q" data-rjq="${escapeAttr(t)}">+ ${escapeHtml(t)}</button>`).join('');
  quick.querySelectorAll('[data-rjq]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      // กดปุ่มแล้วเติมข้อความลงในช่อง เจ้าของหอพิมพ์ต่อได้เลย
      document.getElementById('rejectNote').value = btn.dataset.rjq;
      document.getElementById('rejectNote').focus();
    });
  });

  document.getElementById('rejectModal').classList.add('open');
  setTimeout(()=> document.getElementById('rejectNote').focus(), 150);
}

function closeRejectModal(){
  document.getElementById('rejectModal')?.classList.remove('open');
  rejectCtx = null;
}
document.getElementById('closeRejectModal')?.addEventListener('click', closeRejectModal);
document.getElementById('rejectCancel')?.addEventListener('click', closeRejectModal);
document.getElementById('rejectModal')?.addEventListener('click', (e)=>{
  if(e.target.id === 'rejectModal') closeRejectModal();
});

document.getElementById('rejectConfirm')?.addEventListener('click', async ()=>{
  if(!rejectCtx) return;
  const note = document.getElementById('rejectNote').value.trim();
  const err  = document.getElementById('rejectErr');
  if(note.length < 5){
    err.textContent = 'กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร เพื่อให้นักศึกษาเข้าใจสาเหตุ';
    err.style.display = 'block';
    document.getElementById('rejectNote').focus();
    return;
  }
  const btn = document.getElementById('rejectConfirm');
  btn.disabled = true;
  try{
    await updateBookingStatus(rejectCtx.id, 'cancelled', note);
    closeRejectModal();
    toast('ปฏิเสธคำขอนัดหมายแล้ว พร้อมแจ้งเหตุผลให้นักศึกษาทราบ','success');
    renderBookings(); renderStats(); renderListings();
  }catch(e){
    console.error(e);
    err.textContent = 'ทำรายการไม่สำเร็จ: ' + (e.message || '');
    err.style.display = 'block';
  }finally{ btn.disabled = false; }
});

async function renderBookings(){
  const box = document.getElementById('bookingList');
  if(!box) return;
  try{
    const list = ME.role === 'admin' ? await getAllBookings() : await getBookingsForOwner(ME.uid);
    const pending = list.filter(b=>b.status==='pending').length;
    document.getElementById('bookingCount').textContent =
      list.length ? `ทั้งหมด ${list.length} รายการ · รอดำเนินการ ${pending}` : '';

    if(!list.length){
      box.innerHTML = `<div class="empty-state" style="padding:34px 10px"><div class="emoji">📌</div>
        <p>ยังไม่มีคำขอนัดหมาย<br><small class="muted">เมื่อนักศึกษากดปุ่ม "นัดหมายห้องนี้" ในหน้าหอของคุณ คำขอจะมาแสดงที่นี่ทันที</small></p></div>`;
      return;
    }
    box.innerHTML = list.map(bookingItemHtml).join('');

    box.querySelectorAll('[data-bkok]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(!confirm('ยืนยันรับนัดหมายห้องนี้?\n\nระบบจะตัดจำนวนห้องว่างลง 1 ห้องอัตโนมัติ')) return;
        try{
          await updateBookingStatus(btn.dataset.bkok, 'confirmed');
          toast('ยืนยันรับนัดหมายแล้ว','success');
          renderBookings(); renderStats(); renderListings();
        }catch(err){ console.error(err); toast('ยืนยันไม่สำเร็จ: '+(err.message||''),'error'); }
      });
    });
    box.querySelectorAll('[data-bkno]').forEach(btn=>{
      const b = list.find(x=> x.id === btn.dataset.bkno);
      btn.addEventListener('click', ()=> openRejectModal(b));
    });
    box.querySelectorAll('[data-bkchat]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const [dormId, studentId, studentName] = btn.dataset.bkchat.split('|');
        openOwnerChat({ dormId, studentId, studentName, dormName:'' });
      });
    });
  }catch(err){
    console.error(err);
    box.innerHTML = `<div class="chat-empty">โหลดคำขอนัดหมายไม่สำเร็จ: ${escapeHtml(err.message||'')}</div>`;
  }
}

// ---------------------------------------------------------------------------
// หอพักที่ผู้ดูแลระบบสั่งซ่อนไว้ (ตอนนี้หอใหม่เผยแพร่ทันที ไม่ต้องรออนุมัติแล้ว)
// ---------------------------------------------------------------------------
// ===========================================================================
// รายงานการนัดหมาย
//
// แสดงเฉพาะรายการที่เจ้าของหอ "กดยืนยันรับนัดหมายแล้ว" (status = confirmed)
// คำขอที่ยังรอ หรือที่ยกเลิกไป จะไม่นับเป็นนัดหมายจริง จึงไม่เอามาลงรายงาน
//
// คอลัมน์:
//   วันที่  = วันที่นักศึกษาเลือกไว้ว่าจะมาดูห้อง (ถ้าไม่ได้เลือก ใช้วันที่ส่งคำขอ)
//   ห้อง   = เลขห้องจากผัง ถ้าไม่มีก็ใช้ชื่อประเภทห้อง
//   ผู้นัดหมาย  = ชื่อนักศึกษา
//   เวลา   = เวลาที่นักศึกษาระบุว่าสะดวกเข้าชมห้อง (v44) ถ้าไม่ได้ระบุ ใช้เวลาที่ส่งคำขอแทน
// ===========================================================================
let reportRows = [];

// วันที่ของรายการหนึ่ง ๆ ในรูปแบบ YYYY-MM-DD เอาไว้เทียบกับช่วงที่เลือก
function reportDateKey(b){
  if(b.visitDate) return String(b.visitDate).slice(0, 10);
  const d = new Date(b.createdAt);
  // ใช้เวลาท้องถิ่น ไม่ใช่ UTC มิฉะนั้นนัดหมายช่วงดึกจะเพี้ยนไปอีกวัน
  const pad = (n)=> String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function reportDateText(b){
  const key = reportDateKey(b);
  try{
    return new Date(key + 'T00:00:00').toLocaleDateString('th-TH',
      { day:'numeric', month:'short', year:'numeric' });
  }catch(e){ return key; }
}
// v44: ถ้านักศึกษาระบุเวลานัดหมายมา ให้ใช้เวลานั้น (ตรงกับความหมายของคอลัมน์มากกว่า)
// หากไม่ได้ระบุ จึงใช้เวลาที่ส่งคำขอเป็นค่าสำรองเหมือนเดิม
function reportTimeText(b){
  const t = String(b.visitTime || '').trim().slice(0,5);
  if(/^\d{1,2}:\d{2}$/.test(t)) return t + ' น.';
  try{
    return new Date(b.createdAt).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' }) + ' น.';
  }catch(e){ return '-'; }
}
function reportRoomText(b){
  if(b.roomNo) return 'ห้อง ' + b.roomNo;
  return b.roomLabel || '-';
}

async function renderReport(){
  const body = document.getElementById('reportTable');
  if(!body) return;
  body.innerHTML = '<tr><td colspan="4" class="rp-empty">กำลังโหลด...</td></tr>';
  try{
    const all = ME.role === 'admin' ? await getAllBookings() : await getBookingsForOwner(ME.uid);
    reportRows = all.filter(b => b.status === 'confirmed');
    applyReportFilter();
  }catch(err){
    console.error(err);
    body.innerHTML = `<tr><td colspan="4" class="rp-empty">โหลดรายงานไม่สำเร็จ: ${escapeHtml(err.message||'')}</td></tr>`;
  }
}

// กรองตามช่วงวันที่ที่เลือก แล้ววาดตารางใหม่
function filteredReportRows(){
  const from = (document.getElementById('rpFrom') || {}).value || '';
  const to   = (document.getElementById('rpTo')   || {}).value || '';
  return reportRows.filter(b=>{
    const k = reportDateKey(b);
    if(from && k < from) return false;
    if(to   && k > to)   return false;
    return true;
  }).sort((a,b)=> reportDateKey(a) < reportDateKey(b) ? 1 : -1);   // วันล่าสุดอยู่บน
}

function applyReportFilter(){
  const body = document.getElementById('reportTable');
  const cnt  = document.getElementById('reportCount');
  if(!body) return;
  const rows = filteredReportRows();
  const from = (document.getElementById('rpFrom')||{}).value;
  const to   = (document.getElementById('rpTo')||{}).value;

  if(cnt){
    cnt.textContent = reportRows.length
      ? `แสดง ${rows.length} จากทั้งหมด ${reportRows.length} รายการ` : '';
  }
  if(!rows.length){
    body.innerHTML = `<tr><td colspan="4" class="rp-empty">${
      reportRows.length === 0
        ? 'ยังไม่มีนัดหมายที่ยืนยันแล้ว — เมื่อคุณกด "ยืนยันรับนัดหมาย" ในหน้าคำขอนัดหมาย รายการจะมาแสดงที่นี่'
        : (from || to) ? 'ไม่มีนัดหมายในช่วงวันที่ที่เลือก — ลองขยายช่วงวันที่ดู' : 'ไม่มีรายการ'
    }</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(b=>`
    <tr>
      <td>${escapeHtml(reportDateText(b))}</td>
      <td>${escapeHtml(reportRoomText(b))}</td>
      <td>${escapeHtml(b.userName || '-')}${b.contactPhone ? `<br><small class="muted">${escapeHtml(b.contactPhone)}</small>` : ''}</td>
      <td>${escapeHtml(reportTimeText(b))}</td>
    </tr>`).join('');
}

// บันทึกรายงานเป็นไฟล์ CSV เอาไปเปิดใน Excel ต่อได้
function downloadReportCsv(){
  const rows = filteredReportRows();
  if(!rows.length){ toast('ไม่มีรายการให้บันทึก','error'); return; }
  const esc = (v)=> `"${String(v == null ? '' : v).replace(/"/g,'""')}"`;
  const lines = [['วันที่','ห้อง','ผู้นัดหมาย','เบอร์ติดต่อ','เวลา'].map(esc).join(',')];
  rows.forEach(b=> lines.push([
    reportDateText(b), reportRoomText(b), b.userName || '', b.contactPhone || '', reportTimeText(b)
  ].map(esc).join(',')));
  // ﻿ = BOM ให้ Excel รู้ว่าเป็น UTF-8 มิฉะนั้นภาษาไทยจะเป็นตัวต่างดาว
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `รายงานการนัดหมาย-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

['rpFrom','rpTo'].forEach(id=>{
  document.getElementById(id)?.addEventListener('change', applyReportFilter);
});
document.getElementById('rpClear')?.addEventListener('click', ()=>{
  const f = document.getElementById('rpFrom'), t = document.getElementById('rpTo');
  if(f) f.value = ''; if(t) t.value = '';
  applyReportFilter();
});
document.getElementById('rpCsv')?.addEventListener('click', downloadReportCsv);

// ===========================================================================
// สรุปการเช่า — สมุดบันทึกผู้เช่าที่เจ้าของหอกรอกเองทั้งหมด
//
// ตั้งใจไม่ดึงข้อมูลจากใบนัดหมายหมายในเว็บ เพราะผู้เช่าจริงหลายคนไม่ได้นัดหมายผ่านเว็บ
// (เดินมาที่หอเอง / โทรมา / รุ่นพี่แนะนำ) ถ้าดึงจากใบนัดหมายหมายอย่างเดียว
// ตารางจะไม่ตรงกับความจริงของหอ
//
// วิธีใช้: กด "+ เพิ่มรายการเช่า" ได้แถวว่างมา แล้วพิมพ์ลงในช่องได้เลย
// พิมพ์เสร็จคลิกออกจากช่อง (blur) ระบบค่อยบันทึก — ไม่ใช่บันทึกทุกตัวอักษร
// ===========================================================================
let rentalRows = [];
let rentalUploadId = null;   // กำลังอัปสัญญาของรายการไหนอยู่

function rentalMonthKey(r){ return (r.rentDate || '').slice(0, 7); }   // YYYY-MM

function rentalDateText(iso){
  if(!iso) return '';
  try{
    return new Date(iso + 'T00:00:00').toLocaleDateString('th-TH',
      { day:'numeric', month:'short', year:'numeric' });
  }catch(e){ return iso; }
}

async function renderRental(){
  const body = document.getElementById('rentalTable');
  if(!body) return;
  body.innerHTML = '<tr><td colspan="6" class="rp-empty">กำลังโหลด...</td></tr>';
  try{
    rentalRows = await getRentals(ME.role === 'admin' ? null : ME.uid);
    applyRentalFilter();
  }catch(err){
    console.error(err);
    body.innerHTML = `<tr><td colspan="6" class="rp-empty">${escapeHtml(err.message||'โหลดข้อมูลไม่สำเร็จ')}</td></tr>`;
  }
}

function filteredRentalRows(){
  const m = (document.getElementById('rtMonth') || {}).value || '';
  return rentalRows
    .filter(r => !m || rentalMonthKey(r) === m)
    .sort((a,b)=>{
      // รายการที่ยังไม่ได้ใส่วันที่ ให้ลอยขึ้นบนสุด จะได้เห็นว่ายังกรอกไม่เสร็จ
      if(!a.rentDate && b.rentDate) return -1;
      if(a.rentDate && !b.rentDate) return 1;
      if(a.rentDate !== b.rentDate) return a.rentDate < b.rentDate ? 1 : -1;
      return b.createdAt - a.createdAt;
    });
}

function applyRentalFilter(){
  const body = document.getElementById('rentalTable');
  const cnt  = document.getElementById('rentalCount');
  if(!body) return;
  const rows = filteredRentalRows();
  const m = (document.getElementById('rtMonth')||{}).value;

  if(cnt) cnt.textContent = rentalRows.length ? `แสดง ${rows.length} จากทั้งหมด ${rentalRows.length} รายการ` : '';

  if(!rows.length){
    body.innerHTML = `<tr><td colspan="6" class="rp-empty">${
      rentalRows.length === 0
        ? 'ยังไม่มีรายการ — กดปุ่ม "+ เพิ่มรายการเช่า" ด้านบนเพื่อเริ่มบันทึกผู้เช่ารายแรก'
        : (m ? 'ไม่มีรายการในเดือนที่เลือก — ลองเลือกเดือนอื่น หรือกด "ดูทุกเดือน"' : 'ไม่มีรายการ')
    }</td></tr>`;
    return;
  }

  body.innerHTML = rows.map(r=>`
    <tr data-rt="${escapeAttr(r.id)}" class="${r.rentDate||r.roomNo||r.tenantName||r.contractNo ? '' : 'rt-blank'}">
      <td><input type="date" class="rt-in rt-date" data-f="rentDate" value="${escapeAttr(r.rentDate)}"></td>
      <td><input type="text" class="rt-in rt-docno" data-f="contractNo" value="${escapeAttr(r.contractNo)}"
                 placeholder="เช่น CT-001" maxlength="40"></td>
      <td><input type="text" class="rt-in rt-room" data-f="roomNo" value="${escapeAttr(r.roomNo)}"
                 placeholder="เช่น 302" maxlength="20"></td>
      <td>
        <input type="text" class="rt-in" data-f="tenantName" value="${escapeAttr(r.tenantName)}"
               placeholder="ชื่อผู้เช่า" maxlength="80">
        <input type="tel" class="rt-in rt-sub" data-f="tenantPhone" value="${escapeAttr(r.tenantPhone)}"
               placeholder="เบอร์ติดต่อ (ไม่บังคับ)" maxlength="20">
      </td>
      <td class="rt-contract">${r.contractUrl
        ? `<span class="rt-has">✓ แนบแล้ว</span>
           <button class="btn btn-sm btn-ghost" data-rtview="${escapeAttr(r.id)}">ดูรูป</button>
           <button class="btn btn-sm btn-ghost" data-rtdelfile="${escapeAttr(r.id)}">ลบรูป</button>`
        : `<button class="btn btn-sm btn-outline" data-rtup="${escapeAttr(r.id)}">📷 อัปรูปสัญญา</button>`}
      </td>
      <td><button class="btn btn-sm btn-ghost rt-x" data-rtdel="${escapeAttr(r.id)}" title="ลบรายการนี้">✕</button></td>
    </tr>`).join('');

  bindRentalRowEvents(body);
}

function bindRentalRowEvents(body){
  // ---- แก้ข้อความในช่อง แล้วบันทึกตอนคลิกออกจากช่อง ----
  body.querySelectorAll('.rt-in').forEach(inp=>{
    inp.addEventListener('change', async ()=>{
      const tr = inp.closest('tr');
      const id = tr.dataset.rt;
      const field = inp.dataset.f;
      const row = rentalRows.find(x=>x.id === id);
      if(!row) return;
      const val = inp.value.trim();
      if(row[field] === val) return;        // ไม่ได้เปลี่ยนอะไร ไม่ต้องยิง
      const prev = row[field];
      row[field] = val;
      inp.classList.add('rt-saving');
      try{
        await updateRental(id, { [field]: val });
        inp.classList.remove('rt-saving');
        inp.classList.add('rt-saved');
        setTimeout(()=> inp.classList.remove('rt-saved'), 1200);
        // แก้วันที่แล้วอาจหลุดออกนอกเดือนที่กรองอยู่ ต้องวาดใหม่
        if(field === 'rentDate' && (document.getElementById('rtMonth')||{}).value) applyRentalFilter();
      }catch(err){
        console.error(err);
        row[field] = prev; inp.value = prev || '';
        inp.classList.remove('rt-saving');
        toast('บันทึกไม่สำเร็จ: ' + (err.message||''), 'error');
      }
    });
    // กด Enter = เหมือนคลิกออกจากช่อง
    inp.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') inp.blur(); });
  });

  // ---- อัปรูปสัญญาจากเครื่อง ----
  body.querySelectorAll('[data-rtup]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      rentalUploadId = btn.dataset.rtup;
      const input = document.getElementById('rtFileInput');
      input.value = '';       // เลือกไฟล์เดิมซ้ำได้
      input.click();
    });
  });

  // ---- เปิดดูรูปสัญญา (ขอลิงก์ชั่วคราวใหม่ทุกครั้ง) ----
  body.querySelectorAll('[data-rtview]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const row = rentalRows.find(x=>x.id === btn.dataset.rtview);
      if(!row) return;
      btn.disabled = true;
      try{
        const url = await contractViewUrl(row.contractUrl);
        if(!url) throw new Error('เปิดไฟล์ไม่ได้');
        window.open(url, '_blank', 'noopener');
      }catch(err){
        console.error(err);
        toast('เปิดรูปสัญญาไม่สำเร็จ: ' + (err.message||''), 'error');
      }finally{ btn.disabled = false; }
    });
  });

  // ---- ลบเฉพาะรูปสัญญา (เก็บรายการไว้) ----
  body.querySelectorAll('[data-rtdelfile]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const row = rentalRows.find(x=>x.id === btn.dataset.rtdelfile);
      if(!row) return;
      if(!confirm('ลบรูปสัญญาของรายการนี้? (รายการยังอยู่)')) return;
      btn.disabled = true;
      try{
        const old = row.contractUrl;
        await updateRental(row.id, { contractUrl: '' });
        row.contractUrl = '';
        deleteContractImage(old);     // ลบไฟล์จริง ล้มเหลวก็ไม่เป็นไร
        applyRentalFilter();
        toast('ลบรูปสัญญาแล้ว','success');
      }catch(err){
        console.error(err);
        toast('ลบไม่สำเร็จ: ' + (err.message||''), 'error');
        btn.disabled = false;
      }
    });
  });

  // ---- ลบทั้งรายการ ----
  body.querySelectorAll('[data-rtdel]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      const row = rentalRows.find(x=>x.id === btn.dataset.rtdel);
      if(!row) return;
      const who = row.tenantName || row.roomNo || 'รายการนี้';
      if(!confirm(`ลบ "${who}" ออกจากสรุปการเช่า?\n\nลบแล้วกู้คืนไม่ได้`)) return;
      btn.disabled = true;
      try{
        await deleteRental(row.id);
        if(row.contractUrl) deleteContractImage(row.contractUrl);
        rentalRows = rentalRows.filter(x=>x.id !== row.id);
        applyRentalFilter();
        toast('ลบรายการแล้ว','success');
      }catch(err){
        console.error(err);
        toast('ลบไม่สำเร็จ: ' + (err.message||''), 'error');
        btn.disabled = false;
      }
    });
  });
}

// ---- ปุ่มเพิ่มรายการ ----
document.getElementById('rtAdd')?.addEventListener('click', async ()=>{
  const btn = document.getElementById('rtAdd');
  btn.disabled = true;
  try{
    // ถ้ากรองเดือนอยู่ ให้แถวใหม่ตกอยู่ในเดือนนั้น จะได้ไม่หายไปจากตารางทันทีที่สร้าง
    const m = (document.getElementById('rtMonth')||{}).value;
    const today = new Date();
    const pad = (n)=> String(n).padStart(2,'0');
    const rentDate = m ? `${m}-01`
                       : `${today.getFullYear()}-${pad(today.getMonth()+1)}-${pad(today.getDate())}`;
    const dormId = (myDorms && myDorms[0]) ? myDorms[0].id : null;

    const row = await createRental({ rentDate, dormId });
    rentalRows.unshift(row);
    applyRentalFilter();
    // โฟกัสช่อง "ห้อง" ของแถวใหม่ให้เลย จะได้พิมพ์ต่อได้ทันที
    const el = document.querySelector(`tr[data-rt="${row.id}"] .rt-room`);
    if(el){ el.focus(); el.scrollIntoView({ block:'center', behavior:'smooth' }); }
  }catch(err){
    console.error(err);
    toast('เพิ่มรายการไม่สำเร็จ: ' + (err.message||''), 'error');
  }finally{ btn.disabled = false; }
});

document.getElementById('rtFileInput')?.addEventListener('change', async (e)=>{
  const file = e.target.files && e.target.files[0];
  const id = rentalUploadId;
  rentalUploadId = null;
  if(!file || !id) return;

  const row = rentalRows.find(x=>x.id === id);
  const btn = document.querySelector(`[data-rtup="${id}"]`);
  if(btn){ btn.disabled = true; btn.textContent = 'กำลังอัปโหลด...'; }
  try{
    const path = await uploadContractImage(file);
    await updateRental(id, { contractUrl: path });
    if(row) row.contractUrl = path;
    applyRentalFilter();
    toast('แนบรูปสัญญาแล้ว','success');
  }catch(err){
    console.error(err);
    toast('อัปโหลดไม่สำเร็จ: ' + (err.message||''), 'error');
    if(btn){ btn.disabled = false; btn.textContent = '📷 อัปรูปสัญญา'; }
  }
});

function downloadRentalCsv(){
  const rows = filteredRentalRows();
  if(!rows.length){ toast('ไม่มีรายการให้บันทึก','error'); return; }
  const esc = (v)=> `"${String(v == null ? '' : v).replace(/"/g,'""')}"`;
  const lines = [['วันที่','เลขที่สัญญา','ห้อง','ผู้เช่า','เบอร์ติดต่อ','รูปสัญญา'].map(esc).join(',')];
  rows.forEach(r=> lines.push([
    rentalDateText(r.rentDate), r.contractNo, r.roomNo, r.tenantName, r.tenantPhone,
    r.contractUrl ? 'แนบแล้ว' : 'ยังไม่แนบ'
  ].map(esc).join(',')));
  // ﻿ = BOM ให้ Excel รู้ว่าเป็น UTF-8 มิฉะนั้นภาษาไทยจะเป็นตัวต่างดาว
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type:'text/csv;charset=utf-8;' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `สรุปการเช่า-${(document.getElementById('rtMonth')||{}).value || 'ทุกเดือน'}.csv`;
  document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

document.getElementById('rtMonth')?.addEventListener('change', applyRentalFilter);
document.getElementById('rtClear')?.addEventListener('click', ()=>{
  const m = document.getElementById('rtMonth');
  if(m) m.value = '';
  applyRentalFilter();
});
document.getElementById('rtCsv')?.addEventListener('click', downloadRentalCsv);
async function renderPendingDorms(){
  const box = document.getElementById('pendingDormList');
  if(!box) return;
  try{
    const list = await getPendingDorms();
    const badge = document.getElementById('dormReviewBadge');
    if(badge) badge.innerHTML = list.length ? `<span class="chat-badge">${list.length}</span>` : '';
    if(!list.length){
      box.innerHTML = `<div class="empty-state" style="padding:26px 10px"><div class="emoji">✅</div>
        <p>ไม่มีหอพักที่ถูกซ่อนอยู่<br>
        <small class="muted">หอทุกหอในระบบแสดงให้นักศึกษาเห็นตามปกติ</small></p></div>`;
      return;
    }
    box.innerHTML = list.map(d=>`
      <div class="booking-item is-new">
        <div class="bk-top">
          <div>
            <div class="bk-who">${escapeHtml(d.name)}</div>
            <div class="bk-room">${escapeHtml(d.hallType)}</div>
          </div>
          <span class="status-pill status-cancelled">🚫 ถูกซ่อนอยู่</span>
        </div>
        <div class="bk-grid">
          ${d.phone ? `<div><span class="k">เบอร์หอ:</span> <strong>${escapeHtml(d.phone)}</strong></div>` : ''}
          ${d.contactEmail ? `<div><span class="k">อีเมล:</span> <strong>${escapeHtml(d.contactEmail)}</strong></div>` : ''}
          ${d.facebook ? `<div><span class="k">Facebook:</span> <strong>${escapeHtml(d.facebook)}</strong></div>` : ''}
          <div><span class="k">ราคา:</span> <strong>${hasPrice(d)
            ? (hasRoomTypes(d)
                ? roomTypes(d).map(r=>escapeHtml(r.label)+' '+fmtBaht(r.price)+'฿').join(', ')
                : 'เริ่มต้น '+fmtBaht(minPrice(d))+'฿')
            : 'ยังไม่ระบุ'}</strong></div>
        </div>
        ${d.desc ? `<div class="bk-note">${escapeHtml(d.desc.slice(0,300))}</div>` : ''}
        ${d.reviewNote ? `<div class="bk-note" style="background:#FBE7E3;color:#B23A24">
          เหตุผลที่ซ่อน: ${escapeHtml(d.reviewNote)}</div>` : ''}
        <div class="bk-note" style="background:#FDF1DC;color:#946A0E">
          ⚠️ หอนี้ไม่แสดงให้นักศึกษาเห็นอยู่ตอนนี้ — ถ้าเจ้าของหอแก้ไขข้อมูลเรียบร้อยแล้ว
          กด "เผยแพร่กลับ" เพื่อให้กลับมาแสดงตามปกติ
        </div>
        <div class="bk-actions">
          <button class="btn btn-sm btn-outline" data-dormview="${d.id}">👁 ดูข้อมูล</button>
          <button class="btn btn-sm btn-approve" data-dormok="${d.id}">✓ เผยแพร่กลับ</button>
        </div>
      </div>`).join('');

    box.querySelectorAll('[data-dormok]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(!confirm('เผยแพร่หอพักนี้กลับให้นักศึกษาเห็น?')) return;
        try{
          await approveDorm(btn.dataset.dormok);
          toast('เผยแพร่แล้ว — หอนี้กลับมาแสดงให้นักศึกษาเห็นแล้ว','success');
          renderPendingDorms(); renderStats(); renderListings();
        }catch(err){ console.error(err); toast('ทำรายการไม่สำเร็จ: '+(err.message||''),'error'); }
      });
    });
    box.querySelectorAll('[data-dormview]').forEach(btn=>{
      btn.addEventListener('click', ()=> openViewDorm(list.find(x=>x.id===btn.dataset.dormview)));
    });
  }catch(err){
    console.error(err);
    box.innerHTML = `<div class="chat-empty">โหลดไม่สำเร็จ: ${escapeHtml(err.message||'')}</div>`;
  }
}

// ---------------------------------------------------------------------------
// การ์ด "ตั้งผู้ดูแลระบบคนแรก" — ขึ้นเฉพาะตอนระบบยังไม่มีแอดมินเลย
// ---------------------------------------------------------------------------
async function renderBootstrapAdmin(){
  const box = document.getElementById('bootstrapAdminBox');
  if(!box) return false;
  try{
    if(await adminExists()) return false;

    const canDo = await canBootstrapAdmin();
    box.style.display = 'block';
    box.innerHTML = `
      <div class="line-card" style="border-left:4px solid var(--coral)">
        <h3 style="margin-top:0">⚠️ ระบบนี้ยังไม่มีผู้ดูแลระบบ</h3>
        <p class="muted" style="font-size:.9rem">
          ต้องมีผู้ดูแลระบบอย่างน้อย 1 คน ถึงจะอนุมัติหอพักและเจ้าของหอได้
          ${canDo
            ? '<br>บัญชีนี้เป็นบัญชีแรกที่สมัครในระบบ จึงตั้งเป็นผู้ดูแลระบบคนแรกได้'
            : '<br><strong>บัญชีนี้ไม่ใช่บัญชีแรกที่สมัครในระบบ</strong> — ให้เข้าสู่ระบบด้วยบัญชีแรกแล้วกดปุ่มนี้ หรือตั้งด้วยคำสั่ง SQL ใน Supabase'}
        </p>
        ${canDo
          ? `<button class="btn btn-primary" id="btnBootstrapAdmin">ตั้งบัญชีนี้เป็นผู้ดูแลระบบคนแรก</button>`
          : `<pre style="background:var(--sage-bg);padding:12px;border-radius:8px;font-size:.8rem;overflow:auto">update profiles set role='admin', approved=true
 where email='อีเมลของคุณ';</pre>`}
        <p class="form-hint" style="margin-top:10px">
          ปุ่มนี้ใช้ได้ครั้งเดียวตอนระบบยังไม่มีผู้ดูแลระบบ พอมีแล้วจะหายไปถาวร
          หลังจากนั้นเพิ่มผู้ดูแลระบบคนอื่นได้จากเมนู "รายชื่อเจ้าของหอ"
        </p>
      </div>`;

    const btn = document.getElementById('btnBootstrapAdmin');
    if(btn){
      btn.addEventListener('click', async ()=>{
        btn.disabled = true;
        try{
          await bootstrapFirstAdmin();
          toast('ตั้งผู้ดูแลระบบเรียบร้อย — กำลังโหลดหน้าใหม่','success');
          setTimeout(()=> location.reload(), 900);
        }catch(err){
          console.error(err);
          toast('ตั้งไม่สำเร็จ: '+(err.message||''),'error');
          btn.disabled = false;
        }
      });
    }
    return true;
  }catch(err){ console.error(err); return false; }
}

async function refreshBookingBadge(){
  try{
    const n = await getUnreadBookingCount(ME && ME.uid);
    const el = document.getElementById('bookingBadge');
    if(el) el.innerHTML = n ? `<span class="chat-badge">${n}</span>` : '';
  }catch(err){ console.error(err); }
}

async function refreshOwnerUnread(){
  try{
    const n = await getUnreadCount();
    const el = document.getElementById('ownerUnread');
    if(el) el.innerHTML = n ? `<span class="nav-badge">${n}</span>` : '';
  }catch(err){ console.error(err); }
}

async function renderOwners(){
  const owners = await getAllOwners();
  document.getElementById('ownerTable').innerHTML = owners.map(o=>`<tr>
    <td>${o.name}</td><td>${o.orgName||'-'}</td><td>${o.email}</td><td>${o.phone||'-'}</td>
    <td>${o.approved ? '<span class="status-pill status-confirmed">อนุมัติแล้ว</span>' : '<span class="status-pill status-pending">รออนุมัติ</span>'}</td>
    <td>${o.approved ? '<span class="muted">—</span>' : `<button class="btn btn-sm btn-approve" data-approveowner="${o.uid}">อนุมัติ</button>`}</td>
  </tr>`).join('') || `<tr><td colspan="6" class="muted" style="text-align:center;padding:26px">ยังไม่มีเจ้าของหอพักสมัคร</td></tr>`;

  document.querySelectorAll('[data-approveowner]').forEach(btn=>{
    btn.addEventListener('click', async ()=>{
      try{ await approveOwner(btn.dataset.approveowner); toast('อนุมัติเจ้าของหอพักแล้ว','success'); renderOwners(); }
      catch(err){ console.error(err); toast('อนุมัติไม่สำเร็จ: '+err.message,'error'); }
    });
  });
}

// (เดิมมีโค้ดกดพื้นหลัง modal เพื่อปิด — ตอนนี้ฟอร์มอยู่ในหน้าแล้ว ไม่มีพื้นหลังให้กด)
// เอาปุ่ม "ส่งอีเมลทดสอบ" ออกจากหน้าต่างแก้ไขหอพักแล้ว
// (ฟังก์ชัน sendTestNotifyEmail ใน db.js ยังอยู่ เผื่อวันหลังอยากเอากลับมา)


(async ()=>{
  await showSetupBannerIfNeeded();
  let profile = null;
  try{ profile = await currentProfile(); }catch(err){ console.error(err); }

  if(!profile || (profile.role !== 'owner' && profile.role !== 'admin')){
    toast('กรุณาเข้าสู่ระบบด้วยบัญชีเจ้าของหอพักหรือแอดมิน','error');
    setTimeout(()=> location.href='login.html', 900);
    return;
  }
  ME = profile;
  await renderBootstrapAdmin();
  document.getElementById('dashShell').style.display='grid';

  // เจ้าของหอใช้งานได้ทันทีหลังสมัคร — จะถูกจำกัดสิทธิ์ก็ต่อเมื่อผู้ดูแลระบบ "ระงับบัญชี" เท่านั้น
  const isSuspended = (profile.role === 'owner' && !profile.approved);
  if(isSuspended){
    DASH_SECTIONS.forEach(sec=>{
      const btn = document.querySelector(`.side-link[data-sec="${sec}"]`);
      if(btn) btn.style.display = 'none';
      const el = document.getElementById('sec-'+sec);
      if(el) el.style.display = 'none';
    });
    const notice = document.getElementById('pendingNotice');
    if(notice){
      notice.style.display = 'block';
      notice.innerHTML = `<div class="setup-banner show" style="margin:16px 20px 0">
        🚫 <strong>บัญชีนี้ถูกระงับการใช้งานโดยผู้ดูแลระบบ</strong><br>
        หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อผู้ดูแลเว็บผ่านช่องทางท้ายหน้าเว็บ
      </div>`;
    }
  }
  if(profile.role==='admin'){
    // ---------------------------------------------------------------------
    // บัญชีผู้ดูแลระบบ = ดูแลระบบอย่างเดียว (v34)
    //
    // เหลือเมนูแค่ 2 อัน: "หอพักทั้งหมดในระบบ" กับ "รายชื่อเจ้าของหอ"
    // เมนูฝั่งเจ้าของหอ (หน้าหอพักของฉัน / คำขอนัดหมาย / ข้อความ / รายงาน /
    // สรุปการเช่า / หอพักที่ถูกซ่อน) ถูกเอาออกทั้งหมด เพราะเป็นงานของเจ้าของหอ
    // ไม่ใช่ของผู้ดูแลระบบ — และผู้ดูแลระบบเพิ่มหอ/แก้ไขหอไม่ได้อยู่แล้ว
    //
    // การเผยแพร่/ซ่อนหอที่เคยอยู่ในแท็บ "หอพักที่ถูกซ่อน" ยังทำได้เหมือนเดิม
    // จากปุ่ม "เผยแพร่ / ซ่อน" ในตารางหน้า "หอพักทั้งหมดในระบบ"
    // ---------------------------------------------------------------------
    document.getElementById('listingsTabBtn').style.display='flex';
    document.getElementById('ownersTabBtn').style.display='flex';
    ADMIN_HIDDEN_SECTIONS.forEach(sec=>{
      const btn = document.querySelector(`.side-link[data-sec="${sec}"]`);
      if(btn){ btn.style.display = 'none'; btn.classList.remove('active'); }
      const el = document.getElementById('sec-'+sec);
      if(el) el.style.display = 'none';
    });
    // v45: แดชบอร์ดยังเปิดให้ผู้ดูแลระบบดูได้ เพราะเป็นภาพรวมของทั้งระบบ
    // (ไม่ใช่การแก้ไขหอของคนอื่น)
    //
    // v46: เมนูแรกของเจ้าของหอคือ "หน้าหอพักของฉัน" ซึ่งผู้ดูแลระบบไม่มี
    // ผู้ดูแลระบบจึงเปิดมาที่แดชบอร์ดแทน และต้องย้ายแถบเมนูที่ไฮไลต์ไว้ตามไปด้วย
    document.querySelectorAll('.side-link').forEach(b=> b.classList.remove('active'));
    const dbBtn = document.querySelector('.side-link[data-sec="dashboard"]');
    if(dbBtn) dbBtn.classList.add('active');
    const dbSec = document.getElementById('sec-dashboard');
    if(dbSec) dbSec.style.display = 'block';
  }

  // (เอา QR โค้ดออกจากหน้าหลังบ้านแล้ว — QR ของเว็บยังมีอยู่ในหน้าฝั่งนักศึกษา)

  try{
    if(isSuspended) return;   // บัญชีถูกระงับ ไม่ต้องโหลดอะไรต่อ
    await renderStats();

    // ---- บัญชีผู้ดูแลระบบ: โหลดเฉพาะของที่ใช้ดูแลระบบ ----
    if(profile.role === 'admin'){
      const ov = document.getElementById('adminOverview');
      if(ov) ov.style.display = 'block';
      await renderListings();
      await renderOwners();
      await renderDashboard();
      return;   // ไม่โหลดของฝั่งเจ้าของหอเลย (หน้าหอ/คำขอนัดหมาย/แชท)
    }

    await renderOwnerPage();
    await renderDashboard();
    await renderOwnerThreads(); refreshOwnerUnread();
    setInterval(refreshOwnerUnread, 30000);

    // คำขอนัดหมาย — โหลดครั้งแรก + ติดตามแบบเรียลไทม์ (มีคำขอใหม่เด้งทันทีไม่ต้องรีเฟรช)
    await renderBookings(); refreshBookingBadge();
    let lastBookingCount = null;
    watchBookings(ME.uid, (list)=>{
      if(lastBookingCount !== null && list.length > lastBookingCount){
        toast('🔔 มีคำขอนัดหมายใหม่เข้ามา!','success');
      }
      lastBookingCount = list.length;
      renderBookings(); refreshBookingBadge();
    });

    document.getElementById('chatSend').addEventListener('click', ownerSend);
    document.getElementById('chatInput').addEventListener('keydown', (e)=>{
      if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); ownerSend(); }
    });
    document.getElementById('chatInput').addEventListener('input', (e)=>{
      e.target.style.height='auto';
      e.target.style.height = Math.min(e.target.scrollHeight,110)+'px';
    });
    document.getElementById('closeChatModal').addEventListener('click', ()=>{
      document.getElementById('chatModal').classList.remove('open');
      if(chatUnsub){ chatUnsub(); chatUnsub=null; }
    });
    document.getElementById('chatModal').addEventListener('click',(e)=>{
      if(e.target.id==='chatModal') e.currentTarget.classList.remove('open');
    }); await renderOwnerThreads();
  }catch(err){ console.error(err); toast('โหลดข้อมูลบางส่วนไม่สำเร็จ','error'); }
})();
