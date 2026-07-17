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
    ['overview','listings','bookings','owners'].forEach(s=>{
      const el = document.getElementById('sec-'+s);
      if(el) el.style.display = (s===btn.dataset.sec) ? 'block':'none';
    });
  });
});

async function renderStats(){
  const allDorms = await getDorms();
  const dorms = ME.role==='admin' ? allDorms : allDorms.filter(d=>d.ownerId===ME.uid);
  myDorms = dorms;
  const bookings = ME.role==='admin' ? await getAllBookings() : await getBookingsForOwner(ME.uid);
  document.getElementById('statDorms').textContent = dorms.length;
  document.getElementById('statVacant').textContent = dorms.reduce((s,d)=>s+totalVacancy(d),0);
  document.getElementById('statPending').textContent = bookings.filter(b=>b.status==='pending').length;
  document.getElementById('statConfirmed').textContent = bookings.filter(b=>b.status==='confirmed').length;
  if(ME.role==='admin' && allDorms.length===0){ document.getElementById('seedBox').style.display='block'; }
}

async function renderListings(){
  const allDorms = await getDorms();
  const dorms = ME.role==='admin' ? allDorms : allDorms.filter(d=>d.ownerId===ME.uid);
  document.getElementById('listingTable').innerHTML = dorms.map(d=>`
    <tr>
      <td><strong>${d.name}</strong></td>
      <td>${d.hallType}</td>
      <td>${d.rooms.map(r=>`${r.label}: ${fmtBaht(r.price)}฿`).join('<br>')}</td>
      <td>${d.rooms.map(r=>`
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
  document.getElementById('fGate1').value = dorm ? dorm.gates.gate1 : '';
  document.getElementById('fGate2').value = dorm ? dorm.gates.gate2 : '';
  document.getElementById('fGate3').value = dorm ? dorm.gates.gate3 : '';
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
  document.getElementById('verifiedWrap').style.display = ME.role==='admin' ? 'block' : 'none';
  document.getElementById('fVerified').checked = dorm ? !!dorm.verified : false;
  document.getElementById('editModal').classList.add('open');
}
document.getElementById('btnAddDorm').addEventListener('click', ()=> openEdit(null));
document.getElementById('closeEditModal').addEventListener('click', ()=> document.getElementById('editModal').classList.remove('open'));

document.getElementById('saveEdit').addEventListener('click', async ()=>{
  const facilities = Array.from(document.querySelectorAll('.fFacility:checked')).map(cb=>cb.value);
  const images = document.getElementById('fImages').value.split(',').map(s=>s.trim()).filter(Boolean);
  if(images.length===0){ toast('กรุณาใส่ลิงก์รูปภาพอย่างน้อย 1 รูป','error'); return; }
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
  if(rooms.length===0){ toast('กรุณาใส่ราคาและจำนวนห้องอย่างน้อย 1 ประเภท','error'); return; }

  const data = {
    name: document.getElementById('fName').value.trim(),
    hallType: document.getElementById('fHallType').value,
    gates: { gate1:+document.getElementById('fGate1').value, gate2:+document.getElementById('fGate2').value, gate3:+document.getElementById('fGate3').value },
    lat: +document.getElementById('fLat').value, lng: +document.getElementById('fLng').value,
    desc: document.getElementById('fDesc').value.trim(),
    facilities, images, rooms,
    phone: document.getElementById('fPhone').value.trim(),
    lineId: document.getElementById('fLine').value.trim(),
    facebook: document.getElementById('fFacebook').value.trim()
  };
  if(ME.role==='admin'){ data.verified = document.getElementById('fVerified').checked; }
  else if(editingId){ const cur = myDorms.find(x=>x.id===editingId); data.verified = cur ? cur.verified : false; }
  else { data.verified = true; } // เจ้าของหอเพิ่มหอใหม่เอง = ข้อมูลจากเจ้าของโดยตรง ถือว่ายืนยันแล้ว
  if(!data.name){ toast('กรุณาใส่ชื่อหอพัก','error'); return; }

  try{
    if(editingId){ await updateDorm(editingId, data); toast('บันทึกข้อมูลหอพักแล้ว','success'); }
    else{ await addDorm(ME.uid, data); toast('เพิ่มหอพักใหม่สำเร็จ','success'); }
    document.getElementById('editModal').classList.remove('open');
    renderListings(); renderStats();
  }catch(err){ console.error(err); toast('บันทึกไม่สำเร็จ: '+err.message,'error'); }
});

async function renderBookings(){
  const bookings = ME.role==='admin' ? await getAllBookings() : await getBookingsForOwner(ME.uid);
  document.getElementById('bookingTable').innerHTML = bookings.map(b=>`<tr>
      <td>${b.userName}</td>
      <td>${b.dormName}</td>
      <td>${b.roomLabel}</td>
      <td>${b.deposit>0?fmtBaht(b.deposit)+'฿':'-'}<br><small class="muted">📞 ${b.contactPhone||'-'}</small>${b.note?`<br><small class="muted">📝 ${b.note}</small>`:''}</td>
      <td>${b.slipUrl?`<img class="slip-thumb" src="${b.slipUrl}" data-slip="${b.slipUrl}">`:'<span class="muted">ไม่มีสลิป</span>'}</td>
      <td>${statusPill(b.status)}</td>
      <td class="row-actions">
        ${b.status==='pending' ? `
          <button class="btn btn-sm btn-approve" data-approve="${b.id}">ยืนยัน</button>
          <button class="btn btn-sm btn-reject" data-reject="${b.id}">ปฏิเสธ</button>` : '<span class="muted">—</span>'}
      </td>
    </tr>`).join('') || `<tr><td colspan="7" class="muted" style="text-align:center;padding:26px">ยังไม่มีรายการจอง</td></tr>`;

  document.querySelectorAll('[data-slip]').forEach(img=>{
    img.addEventListener('click', ()=>{
      document.getElementById('slipModalImg').src = img.dataset.slip;
      document.getElementById('slipModal').classList.add('open');
    });
  });
  document.querySelectorAll('[data-approve]').forEach(btn=>{
    btn.addEventListener('click', ()=> updateBooking(btn.dataset.approve, 'confirmed'));
  });
  document.querySelectorAll('[data-reject]').forEach(btn=>{
    btn.addEventListener('click', ()=> updateBooking(btn.dataset.reject, 'cancelled'));
  });
}
async function updateBooking(id, status){
  try{
    await updateBookingStatus(id, status);
    toast(status==='confirmed' ? 'ยืนยันการจองแล้ว ตัดห้องว่างอัตโนมัติ' : 'ปฏิเสธการจองแล้ว','success');
    renderBookings(); renderListings(); renderStats();
  }catch(err){ console.error(err); toast('ดำเนินการไม่สำเร็จ: '+err.message,'error'); }
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

document.getElementById('closeSlipModal').addEventListener('click', ()=> document.getElementById('slipModal').classList.remove('open'));
['editModal','slipModal'].forEach(id=>{
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
    await renderStats(); await renderListings(); await renderBookings();
    if(profile.role==='admin') await renderOwners();
  }catch(err){ console.error(err); toast('โหลดข้อมูลบางส่วนไม่สำเร็จ','error'); }
})();
