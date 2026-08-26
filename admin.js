/* ==========================================================================
   DormCRU — admin.js ตรรกะหลังบ้านสำหรับเจ้าของหอพัก/แอดมิน (ใช้กับ admin.html)
   ========================================================================== */

let ME = null;
let editingId = null;
let myDorms = [];

document.getElementById('logoutBtn').addEventListener('click', async (e)=>{
  e.preventDefault();
  try{ await logout(); }catch(err){ console.error(err); }
  location.href = 'login.html';
});

document.querySelectorAll('.side-link').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.side-link').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    // เดิมลืมใส่ 'messages' ไว้ในรายการนี้ แท็บข้อความจึงกดแล้วไม่ขึ้นอะไรเลย
    ['overview','listings','bookings','messages','claim','owners'].forEach(s=>{
      const el = document.getElementById('sec-'+s);
      if(el) el.style.display = (s===btn.dataset.sec) ? 'block':'none';
    });
    // เปิดแท็บคำขอจอง = ถือว่าเจ้าของหออ่านแล้ว (ลบจุดแดง)
    if(btn.dataset.sec === 'bookings'){
      markBookingsRead(ME && ME.uid).then(refreshBookingBadge).catch(console.error);
    }
  });
});

async function renderStats(){
  const allDorms = await getDorms();
  const dorms = ME.role==='admin' ? allDorms : allDorms.filter(d=>d.ownerId===ME.uid);
  myDorms = dorms;
  document.getElementById('statDorms').textContent = dorms.length;
  document.getElementById('statVacant').textContent = dorms.reduce((s,d)=>s+totalVacancy(d),0);
  document.getElementById('statContact').textContent = dorms.filter(d=>d.phone||d.lineId||d.facebook).length;
  document.getElementById('statVerified').textContent = dorms.filter(d=>d.verified).length;
  if(allDorms.length===0){ document.getElementById('seedBox').style.display='block'; }
}

async function renderListings(){
  const allDorms = await getDorms();
  const dorms = ME.role==='admin' ? allDorms : allDorms.filter(d=>d.ownerId===ME.uid);
  document.getElementById('listingTable').innerHTML = dorms.map(d=>`
    <tr>
      <td><strong>${d.name}</strong></td>
      <td>${d.hallType}</td>
      <td>${d.rooms.length? d.rooms.map(r=>`${r.label}: ${fmtBaht(r.price)}฿`).join('<br>') : '<span class="muted">ยังไม่ระบุ</span>'}</td>
      <td>${d.rooms.length===0 ? '<span class="muted">ยังไม่ระบุ — กด "แก้ไข" เพื่อเพิ่มห้อง</span>' : ''}${d.rooms.map(r=>`
        <div style="white-space:nowrap;margin:2px 0">
          ${r.label}: <strong>${r.vacant}</strong>/${r.total}
          <button class="btn btn-sm btn-ghost" data-vac="${d.id}|${r.code}|-1" title="ลดห้องว่าง (ปิดห้อง)" style="padding:2px 8px">−</button>
          <button class="btn btn-sm btn-ghost" data-vac="${d.id}|${r.code}|1" title="เพิ่มห้องว่าง (เปิดห้อง)" style="padding:2px 8px">+</button>
        </div>`).join('')}</td>
      <td>
        ${d.verified ? '<span class="status-pill status-confirmed">ยืนยันแล้ว</span>' : '<span class="status-pill status-pending">รอยืนยัน</span>'}<br>
        <button class="btn btn-outline btn-sm" data-edit="${d.id}" style="margin-top:6px">แก้ไข</button>
        <button class="btn btn-sm btn-reject" data-del="${d.id}" style="margin-top:6px">ลบ</button>
      </td>
    </tr>
  `).join('') || `<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">ยังไม่มีหอพัก กด "+ เพิ่มหอพักใหม่" เพื่อเริ่มต้น</td></tr>`;

  document.querySelectorAll('[data-edit]').forEach(btn=>{
    btn.addEventListener('click', ()=> openEdit(dorms.find(d=>d.id===btn.dataset.edit)));
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
      const rooms = dorm.rooms.map(r=>{
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

function openEdit(dorm){
  editingId = dorm ? dorm.id : null;
  document.getElementById('editTitle').textContent = dorm ? 'แก้ไข: '+dorm.name : 'เพิ่มหอพักใหม่';
  document.getElementById('fName').value = dorm ? dorm.name : '';
  document.getElementById('fHallType').value = dorm ? dorm.hallType : 'หอรวม';
  document.getElementById('fGate1').value = (dorm && dorm.gates) ? dorm.gates.gate1 : '';
  document.getElementById('fGate2').value = (dorm && dorm.gates) ? dorm.gates.gate2 : '';
  document.getElementById('fGate3').value = (dorm && dorm.gates) ? dorm.gates.gate3 : '';
  document.getElementById('fLat').value = dorm ? dorm.lat : 19.9074;
  document.getElementById('fLng').value = dorm ? dorm.lng : 99.8230;
  document.getElementById('fDesc').value = dorm ? dorm.desc : '';
  document.querySelectorAll('.fFacility').forEach(cb=> cb.checked = dorm ? dorm.facilities.includes(cb.value) : false);
  const fan = dorm && dorm.rooms.find(r=>r.code==='fan');
  const air = dorm && dorm.rooms.find(r=>r.code==='air');
  document.getElementById('fFanPrice').value = fan ? fan.price : '';
  document.getElementById('fFanTotal').value = fan ? fan.total : '';
  document.getElementById('fAirPrice').value = air ? air.price : '';
  document.getElementById('fAirTotal').value = air ? air.total : '';
  document.getElementById('fImages').value = dorm ? dorm.images.join(' , ') : '';
  document.getElementById('fPhone').value = dorm ? (dorm.phone||'') : '';
  document.getElementById('fLine').value = dorm ? (dorm.lineId||'') : '';
  document.getElementById('fFacebook').value = dorm ? (dorm.facebook||'') : '';
  document.getElementById('verifiedWrap').style.display = 'block';
  document.getElementById('fVerified').checked = dorm ? !!dorm.verified : false;
  document.getElementById('editModal').classList.add('open');
}
document.getElementById('btnAddDorm').addEventListener('click', ()=> openEdit(null));
document.getElementById('closeEditModal').addEventListener('click', ()=> document.getElementById('editModal').classList.remove('open'));

document.getElementById('saveEdit').addEventListener('click', async ()=>{
  const facilities = Array.from(document.querySelectorAll('.fFacility:checked')).map(cb=>cb.value);
  const images = document.getElementById('fImages').value.split(',').map(s=>s.trim()).filter(Boolean);
  if(images.length===0 && document.getElementById('fVerified').checked){
    toast('ถ้าจะยืนยันข้อมูล กรุณาใส่ลิงก์รูปภาพอย่างน้อย 1 รูปก่อน','error'); return;
  }
  const rooms = [];
  const fanPrice = +document.getElementById('fFanPrice').value, fanTotal = +document.getElementById('fFanTotal').value;
  const airPrice = +document.getElementById('fAirPrice').value, airTotal = +document.getElementById('fAirTotal').value;
  const existing = editingId ? myDorms.find(d=>d.id===editingId) : null;
  if(fanPrice>0 && fanTotal>0){
    const prevVacant = existing && existing.rooms.find(r=>r.code==='fan');
    rooms.push({ code:'fan', label:'พัดลม', price:fanPrice, total:fanTotal, vacant: prevVacant ? Math.min(prevVacant.vacant, fanTotal) : fanTotal });
  }
  if(airPrice>0 && airTotal>0){
    const prevVacant = existing && existing.rooms.find(r=>r.code==='air');
    rooms.push({ code:'air', label:'แอร์', price:airPrice, total:airTotal, vacant: prevVacant ? Math.min(prevVacant.vacant, airTotal) : airTotal });
  }
  // อนุญาตให้บันทึกได้แม้ยังไม่ใส่ห้อง (เจ้าของหอมากรอกทีหลังได้) แต่ถ้าจะติ๊ก "ยืนยันข้อมูล" ต้องมีห้องก่อน
  if(rooms.length===0 && document.getElementById('fVerified').checked){
    toast('ถ้าจะยืนยันข้อมูล กรุณาใส่ราคาและจำนวนห้องอย่างน้อย 1 ประเภทก่อน','error'); return;
  }

  const data = {
    name: document.getElementById('fName').value.trim(),
    hallType: document.getElementById('fHallType').value,
    gates: (document.getElementById('fGate1').value==='' && document.getElementById('fGate2').value==='' && document.getElementById('fGate3').value==='')
      ? null
      : { gate1:+document.getElementById('fGate1').value||0, gate2:+document.getElementById('fGate2').value||0, gate3:+document.getElementById('fGate3').value||0 },
    lat: +document.getElementById('fLat').value, lng: +document.getElementById('fLng').value,
    desc: document.getElementById('fDesc').value.trim(),
    facilities, images, rooms,
    phone: document.getElementById('fPhone').value.trim(),
    lineId: document.getElementById('fLine').value.trim(),
    facebook: document.getElementById('fFacebook').value.trim()
  };
  // เจ้าของหอยืนยันข้อมูลหอของตัวเองได้เอง ไม่ต้องรอแอดมิน
  data.verified = document.getElementById('fVerified').checked;
  if(!data.name){ toast('กรุณาใส่ชื่อหอพัก','error'); return; }

  try{
    if(editingId){ await updateDorm(editingId, data); toast('บันทึกข้อมูลหอพักแล้ว','success'); }
    else{ await addDorm(ME.uid, data); toast('เพิ่มหอพักใหม่สำเร็จ','success'); }
    document.getElementById('editModal').classList.remove('open');
    renderListings(); renderStats();
  }catch(err){ console.error(err); toast('บันทึกไม่สำเร็จ: '+err.message,'error'); }
});

async function renderClaim(){
  const tbody = document.getElementById('claimTable');
  try{
    const list = (await getUnclaimedDorms()).filter(d => d.ownerId !== ME.uid);
    tbody.innerHTML = list.map(d=>`<tr>
      <td><strong>${d.name}</strong></td>
      <td>${d.hallType}</td>
      <td>${d.rooms.length? d.rooms.map(r=>`${r.label}: ${fmtBaht(r.price)}฿`).join('<br>') : '<span class="muted">ยังไม่ระบุ</span>'}</td>
      <td style="max-width:340px"><small class="muted">${d.desc||''}</small></td>
      <td><button class="btn btn-sm btn-approve" data-claim="${d.id}">นี่คือหอของฉัน</button></td>
    </tr>`).join('') || `<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">ไม่มีหอพักที่รอเจ้าของรับช่วงดูแล</td></tr>`;

    document.querySelectorAll('[data-claim]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(!confirm('ยืนยันว่าคุณเป็นเจ้าของหอพักนี้?\n\nหลังรับช่วงดูแลแล้ว คุณจะแก้ไขข้อมูลหอนี้ได้ และคำขอจองจากนักศึกษาจะส่งถึงคุณโดยตรง')) return;
        try{
          await claimDorm(btn.dataset.claim);
          toast('รับช่วงดูแลหอพักเรียบร้อย — ไปที่เมนู "จัดการห้องพัก" เพื่ออัปเดตข้อมูลได้เลย','success');
          renderClaim(); renderListings(); renderStats();
        }catch(err){ console.error(err); toast('รับช่วงดูแลไม่สำเร็จ: '+err.message,'error'); }
      });
    });
  }catch(err){
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">โหลดข้อมูลไม่สำเร็จ</td></tr>`;
  }
}

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
// คำขอจองห้อง (ฝั่งเจ้าของหอ)
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
      ${row('วันที่สะดวกดูห้อง', fmtBookingDate(b.visitDate))}
      ${row('ส่งคำขอเมื่อ', fmtChatTime(b.createdAt))}
    </div>

    ${b.note ? `<div class="bk-note">💬 ${escapeHtml(b.note)}</div>` : ''}

    <div class="bk-actions">
      ${b.contactPhone ? `<a class="btn btn-primary btn-sm" href="tel:${escapeHtml(b.contactPhone)}" style="text-decoration:none">📞 โทรหานักศึกษา</a>` : ''}
      <button class="btn btn-sm btn-outline" data-bkchat="${b.dormId}|${b.userId}|${escapeHtml(b.userName||'')}">💬 ตอบในแชท</button>
      ${b.status === 'pending' ? `
        <button class="btn btn-sm btn-approve" data-bkok="${b.id}">✓ ยืนยันรับจอง</button>
        <button class="btn btn-sm btn-reject" data-bkno="${b.id}">✕ ปฏิเสธ</button>` : ''}
      <span class="bk-mailstate">${b.notifiedAt ? '✉️ ส่งอีเมลแจ้งแล้ว' : '✉️ ยังไม่ได้ส่งอีเมล'}</span>
    </div>
  </div>`;
}

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
        <p>ยังไม่มีคำขอจอง<br><small class="muted">เมื่อนักศึกษากดปุ่ม "จองห้องนี้" ในหน้าหอของคุณ คำขอจะมาแสดงที่นี่ทันที</small></p></div>`;
      return;
    }
    box.innerHTML = list.map(bookingItemHtml).join('');

    box.querySelectorAll('[data-bkok]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(!confirm('ยืนยันรับจองห้องนี้?\n\nระบบจะตัดจำนวนห้องว่างลง 1 ห้องอัตโนมัติ')) return;
        try{
          await updateBookingStatus(btn.dataset.bkok, 'confirmed');
          toast('ยืนยันรับจองแล้ว','success');
          renderBookings(); renderStats(); renderListings();
        }catch(err){ console.error(err); toast('ยืนยันไม่สำเร็จ: '+(err.message||''),'error'); }
      });
    });
    box.querySelectorAll('[data-bkno]').forEach(btn=>{
      btn.addEventListener('click', async ()=>{
        if(!confirm('ปฏิเสธคำขอจองนี้?')) return;
        try{
          await updateBookingStatus(btn.dataset.bkno, 'cancelled');
          toast('ปฏิเสธคำขอจองแล้ว','success');
          renderBookings();
        }catch(err){ console.error(err); toast('ทำรายการไม่สำเร็จ: '+(err.message||''),'error'); }
      });
    });
    box.querySelectorAll('[data-bkchat]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const [dormId, studentId, studentName] = btn.dataset.bkchat.split('|');
        openOwnerChat({ dormId, studentId, studentName, dormName:'' });
      });
    });
  }catch(err){
    console.error(err);
    box.innerHTML = `<div class="chat-empty">โหลดคำขอจองไม่สำเร็จ: ${escapeHtml(err.message||'')}</div>`;
  }
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

['editModal'].forEach(id=>{
  document.getElementById(id).addEventListener('click',(e)=>{ if(e.target.id===id) e.currentTarget.classList.remove('open'); });
});
document.getElementById('btnSeed')?.addEventListener('click', async ()=>{
  try{
    const n = await seedSampleDormsIfEmpty(ME.uid);
    if(n>0){ toast(`โหลดข้อมูลตัวอย่าง ${n} หอพักสำเร็จ`,'success'); document.getElementById('seedBox').style.display='none'; renderListings(); renderStats(); }
    else{ toast('มีข้อมูลหอพักอยู่แล้ว ไม่โหลดซ้ำ','error'); }
  }catch(err){ console.error(err); toast('โหลดข้อมูลตัวอย่างไม่สำเร็จ: '+err.message,'error'); }
});

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
  if(profile.role==='owner' && !profile.approved){
    document.getElementById('pendingNotice').style.display='block';
    return;
  }
  document.getElementById('dashShell').style.display='grid';
  if(profile.role==='admin') document.getElementById('ownersTabBtn').style.display='flex';

  try{
    new QRCode(document.getElementById('qrcode2'), {
      text: location.href.replace(/admin\.html.*$/,''),
      width: 100, height:100, colorDark:'#1F3A2E', colorLight:'#ffffff'
    });
  }catch(err){ console.error(err); }

  try{
    await renderStats(); await renderListings(); await renderClaim();
    await renderOwnerThreads(); refreshOwnerUnread();
    setInterval(refreshOwnerUnread, 30000);

    // คำขอจอง — โหลดครั้งแรก + ติดตามแบบเรียลไทม์ (มีคำขอใหม่เด้งทันทีไม่ต้องรีเฟรช)
    await renderBookings(); refreshBookingBadge();
    let lastBookingCount = null;
    watchBookings(ME.uid, (list)=>{
      if(lastBookingCount !== null && list.length > lastBookingCount){
        toast('🔔 มีคำขอจองห้องใหม่เข้ามา!','success');
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
    if(profile.role==='admin') await renderOwners();
  }catch(err){ console.error(err); toast('โหลดข้อมูลบางส่วนไม่สำเร็จ','error'); }
})();
