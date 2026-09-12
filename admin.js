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

const DASH_SECTIONS = ['overview','listings','bookings','messages','dormreview','owners'];

document.querySelectorAll('.side-link').forEach(btn=>{
  btn.addEventListener('click', ()=>{
    document.querySelectorAll('.side-link').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active');
    // เดิมลืมใส่ 'messages' ไว้ในรายการนี้ แท็บข้อความจึงกดแล้วไม่ขึ้นอะไรเลย
    DASH_SECTIONS.forEach(s=>{
      const el = document.getElementById('sec-'+s);
      if(el) el.style.display = (s===btn.dataset.sec) ? 'block':'none';
    });
    if(btn.dataset.sec === 'dormreview'){ renderPendingDorms(); }
    if(btn.dataset.sec === 'overview'){ renderOwnerPage(); }
    // เปิดแท็บคำขอจอง = ถือว่าเจ้าของหออ่านแล้ว (ลบจุดแดง)
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
// หน้าหลักของเจ้าของหอ — "หน้าหอพักของฉัน"
// จัดหน้าคล้ายหน้าโปรไฟล์ที่พักในเว็บจองโรงแรม (รูปปก + แกลเลอรี + ข้อมูลหอ)
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
          สร้างหน้าหอพักของคุณเองได้เลย ไม่ต้องรอผู้ดูแลระบบอนุมัติ —
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
      </div>
      <div class="op-head-actions">
        <button class="btn btn-primary btn-sm" id="opEdit">✏️ แก้ไขข้อมูลหอ</button>
        <button class="btn btn-sm btn-reject" id="opDelete">🗑 ลบหอนี้</button>
      </div>
    </div>

    <div class="op-grid">
      <!-- ---------- คำอธิบายหอพัก (แก้ในหน้านี้ได้เลย) ---------- -->
      <section class="op-card">
        <h3>เกี่ยวกับหอพักนี้</h3>
        <p class="muted" style="font-size:.85rem;margin-top:-6px">
          เล่าให้น้อง ๆ ฟังว่าหอเป็นยังไง อยู่ตรงไหน มีอะไรใกล้ ๆ บ้าง เขียนแล้วกดบันทึกได้เลย
        </p>
        <textarea id="opDesc" rows="6" placeholder="เช่น หอพักหญิงล้วน 3 ชั้น ห่างประตู 1 เดิน 5 นาที มีร้านสะดวกซื้อหน้าหอ ห้องมีเฟอร์นิเจอร์ครบ...">${escapeHtml(d.desc||'')}</textarea>
        <div class="op-actions">
          <button class="btn btn-primary btn-sm" id="opSaveDesc">บันทึกคำอธิบาย</button>
          <span class="op-saved" id="opDescSaved"></span>
        </div>
      </section>

      <!-- ---------- สิ่งอำนวยความสะดวก ---------- -->
      <section class="op-card">
        <h3>สิ่งอำนวยความสะดวก</h3>
        ${facs.length
          ? `<div class="amenity-grid">${amenityGridHtml(facs)}</div>`
          : `<p class="muted" style="font-size:.88rem">ยังไม่ได้ระบุ — กด "แก้ไขข้อมูลหอ" เพื่อเลือก หรือพิมพ์เพิ่มเองในช่อง "อื่น ๆ"</p>`}
      </section>

      <!-- ---------- ห้องพักและราคา ----------
           แสดงเฉพาะหอที่ยังไม่ได้วาดผังห้อง เพราะถ้ามีผังแล้ว ผังบอกครบกว่า
           (เลขห้อง ชั้น ราคาเฉพาะห้อง ของในห้อง และจำนวนห้องว่างที่นับจากผังจริง) -->
      ${hasFloorPlan(d) ? '' : `
      <section class="op-card">
        <h3>ห้องพักและราคา</h3>
        ${(d.rooms && d.rooms.length)
          ? `<div class="op-rooms">${d.rooms.map(r=>`
              <div class="op-room">
                <div>
                  <strong>${escapeHtml(r.label)}</strong>
                  <div class="muted" style="font-size:.82rem">ทั้งหมด ${r.total} ห้อง</div>
                </div>
                <div class="op-room-price">${fmtBaht(r.price)} <span>บาท/เดือน</span></div>
                <div class="op-room-vac">
                  <button class="btn btn-sm btn-ghost" data-vac2="${d.id}|${escapeHtml(r.code)}|-1" title="ลดห้องว่าง">−</button>
                  <span class="op-vac-num">${r.vacant}</span>
                  <button class="btn btn-sm btn-ghost" data-vac2="${d.id}|${escapeHtml(r.code)}|1" title="เพิ่มห้องว่าง">+</button>
                  <small class="muted">ห้องว่าง</small>
                </div>
              </div>`).join('')}</div>`
          : `<p class="muted" style="font-size:.88rem">ยังไม่ได้ใส่ราคาห้อง — นักศึกษาจะเห็นว่า "สอบถามราคากับหอโดยตรง"</p>`}
      </section>`}

      <!-- ---------- รอบ ๆ หอมีอะไรบ้าง ---------- -->
      <section class="op-card op-nearby">
        <h3>รอบ ๆ หอมีอะไรบ้าง</h3>
        <p class="muted" style="font-size:.85rem;margin-top:-6px">
          บอกน้อง ๆ ว่าใกล้หอมีอะไร เช่น เซเว่น ร้านอาหาร ร้านทำเล็บ ตลาด ตู้ ATM —
          เรื่องนี้เป็นสิ่งที่นักศึกษาถามบ่อยที่สุดตอนเลือกหอ
        </p>
        <div class="ef-row">
          <select id="opNearCat">
            ${NEARBY_CAT_ORDER.map(c=>`<option value="${c}">${NEARBY_CATS[c].icon} ${escapeHtml(NEARBY_CATS[c].label)}</option>`).join('')}
          </select>
          <input type="text" id="opNearName" placeholder="ชื่อร้าน เช่น 7-Eleven หน้าหอ">
          <input type="text" id="opNearDist" placeholder="เดิน 2 นาที" style="max-width:130px">
          <button type="button" class="btn btn-outline btn-sm" id="opNearAdd">+ เพิ่ม</button>
        </div>
        <div id="opNearList" style="margin-top:12px">
          ${hasNearby(d)
            ? nearbyPlacesHtml(d.nearby, { edit:true })
            : '<p class="muted" style="font-size:.86rem">ยังไม่ได้กรอก — เพิ่มสัก 3-5 ที่ที่ใกล้หอที่สุดก็พอ</p>'}
        </div>
      </section>

      <!-- ---------- ช่องทางติดต่อ ---------- -->
      <section class="op-card">
        <h3>ช่องทางติดต่อที่นักศึกษาเห็น</h3>
        <div class="op-loc" id="opLoc">
          ${hasLocation(d)
            ? `<span class="ok">📍 ปักหมุดแล้ว · ${escapeHtml(locationSummary(d))}</span>
               <a href="${mapDirectionsLink(d)}" target="_blank" rel="noopener">ดูเส้นทางจากมอ</a>`
            : `<span class="warn">📍 ยังไม่ได้ปักหมุดหอ — กด "แก้ไขข้อมูลหอ" แล้ววางลิงก์ Google Maps
               นักศึกษาจะได้กดนำทางมาหอได้ และเว็บจะบอกได้ว่าหอห่างมอเท่าไหร่</span>`}
        </div>
        <div class="op-contact">
          <div><span class="k">เบอร์โทร</span> ${d.phone ? escapeHtml(d.phone) : '<span class="muted">ยังไม่ได้ใส่</span>'}</div>
          <div><span class="k">LINE</span> ${d.lineId ? escapeHtml(d.lineId) : '<span class="muted">ยังไม่ได้ใส่</span>'}</div>
          <div><span class="k">Facebook</span> ${d.facebook ? escapeHtml(d.facebook) : '<span class="muted">ยังไม่ได้ใส่</span>'}</div>
          <div><span class="k">อีเมลรับแจ้งเตือน</span> ${d.contactEmail ? escapeHtml(d.contactEmail) : '<span class="muted">ใช้อีเมลที่สมัครสมาชิก</span>'}</div>
        </div>
      </section>
    </div>

    <!-- ---------- ผังห้องพักแต่ละชั้น ---------- -->
    <section class="op-card op-plan">
      <div class="op-plan-head">
        <div>
          <h3>ผังห้องพัก</h3>
          <p class="muted" style="font-size:.85rem;margin:0">
            บอกว่าหอมีกี่ชั้น แต่ละชั้นมีห้องอะไรบ้าง — นักศึกษาจะเห็นผังนี้ในหน้าหอของคุณ
            และกดจองห้องที่ต้องการได้โดยตรง กดที่ช่องห้องเพื่อแก้เลขห้อง ราคา และสถานะ
          </p>
        </div>
        ${(()=>{ const s = planSummary(d.floorPlan); return s.total ? `
          <div class="op-plan-sum">
            <span><strong>${s.total}</strong> ห้อง</span>
            <span class="st-vacant-txt">ว่าง <strong>${s.vacant}</strong></span>
            <span class="st-booked-txt">จองแล้ว <strong>${s.booked}</strong></span>
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

  const editBtn = document.getElementById('opEdit');
  if(editBtn) editBtn.addEventListener('click', ()=> openEdit(d));

  // ลบหอของตัวเอง (ย้ายมาจากหน้า "จัดการห้องพัก" ที่ถูกเอาออกแล้ว)
  const delBtn = document.getElementById('opDelete');
  if(delBtn) delBtn.addEventListener('click', async ()=>{
    if(!confirm(`ลบหอ "${d.name}" ออกจากระบบ?\n\n` +
                'ผังห้อง รูปภาพ รีวิว และประวัติการจองของหอนี้จะหายไปทั้งหมด\nลบแล้วกู้คืนไม่ได้')) return;
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
      const rooms = d.rooms.map(r => r.code !== code ? r
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
  const addNear = async ()=>{
    const name = document.getElementById('opNearName').value.trim();
    if(!name){ toast('กรุณาใส่ชื่อร้านหรือสถานที่','error'); return; }
    const list = (d.nearby || []).slice();
    if(list.length >= 30){ toast('เพิ่มได้สูงสุด 30 รายการ','error'); return; }
    list.push({
      cat:  document.getElementById('opNearCat').value,
      name: name.slice(0,60),
      dist: document.getElementById('opNearDist').value.trim().slice(0,30)
    });
    document.getElementById('opNearName').value = '';
    document.getElementById('opNearDist').value = '';
    await saveNearby(d, list, 'เพิ่มแล้ว');
  };
  document.getElementById('opNearAdd')?.addEventListener('click', addNear);
  ['opNearName','opNearDist'].forEach(id=>{
    document.getElementById(id)?.addEventListener('keydown', (e)=>{
      if(e.key === 'Enter'){ e.preventDefault(); addNear(); }
    });
  });
  box.querySelectorAll('[data-rmnear]').forEach(b=>{
    b.addEventListener('click', async ()=>{
      const i = +b.dataset.rmnear;
      const list = (d.nearby || []).filter((_,idx)=> idx !== i);
      await saveNearby(d, list, 'ลบแล้ว');
    });
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
      const firstType = (d.rooms && d.rooms[0]) ? d.rooms[0].code : '';
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
const ROOM_AMEN_PRESETS = ['แอร์','พัดลม','เครื่องทำน้ำอุ่น','ตู้เย็น','ทีวี','ระเบียง',
                           'เตียง','ตู้เสื้อผ้า','โต๊ะเขียนหนังสือ','ห้องน้ำในตัว','อินเทอร์เน็ต','เฟอร์นิเจอร์ครบ'];
let editRoomAmen = [];     // ของในห้องที่กำลังแก้อยู่ใน pop up
let editRoomPhotos = [];   // รูปในห้องที่กำลังแก้อยู่ใน pop up

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
    quick.innerHTML = ROOM_AMEN_PRESETS.map(a=>{
      const on = editRoomAmen.some(x=>x.toLowerCase() === a.toLowerCase());
      return `<button type="button" class="ra-q ${on?'on':''}" data-amen="${escapeHtml(a)}">${on?'✓ ':'+ '}${escapeHtml(a)}</button>`;
    }).join('');
    quick.querySelectorAll('[data-amen]').forEach(b=>{
      b.addEventListener('click', ()=>{
        const v = b.dataset.amen;
        const i = editRoomAmen.findIndex(x=>x.toLowerCase() === v.toLowerCase());
        if(i >= 0) editRoomAmen.splice(i,1); else editRoomAmen.push(v);
        renderRoomAmen();
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
        renderRoomAmen();
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
  renderRoomAmen();
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
  document.getElementById('rmPrice').value = (cell.price == null) ? '' : cell.price;
  document.getElementById('rmNote').value  = cell.note || '';
  editRoomAmen = (cell.amen || []).slice();
  renderRoomAmen();
  editRoomPhotos = (cell.photos || []).slice();
  renderRoomPhotos();
  const rmProg = document.getElementById('rmPhotoProgress');
  if(rmProg){ rmProg.style.display='none'; rmProg.textContent=''; }

  // ตัวเลือกประเภทห้องมาจากราคาที่เจ้าของหอตั้งไว้
  const sel = document.getElementById('rmType');
  const types = (dorm.rooms || []);
  sel.innerHTML = `<option value="">— ไม่ระบุประเภท —</option>` + types.map(r=>
    `<option value="${escapeHtml(r.code)}">${escapeHtml(r.label)} · ${fmtBaht(r.price)} บาท/เดือน</option>`).join('');
  sel.value = cell.type || '';

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

function updateRoomStatusHint(status, cell){
  const el = document.getElementById('rmStatusHint');
  if(!el) return;
  if(status === 'booked'){
    el.innerHTML = (cell && cell.bookingId)
      ? 'ห้องนี้มีนักศึกษากดจองไว้ รอคุณกด <strong>"ยืนยันรับจอง"</strong> ในเมนู "คำขอจองห้อง"'
      : 'ห้องไม่ว่าง — ใช้กับห้องที่มีคนอยู่แล้ว หรือห้องที่ยังไม่ปล่อยเช่า เช่น กำลังซ่อม ' +
        'นักศึกษาจะเห็นเป็นสีแดงและกดจองไม่ได้';
  }else{
    el.textContent = 'ห้องว่างพร้อมให้เช่า นักศึกษากดจองห้องนี้ได้จากผังในหน้าหอของคุณ';
  }
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
  const priceRaw  = document.getElementById('rmPrice').value.trim();

  target.cell.no    = document.getElementById('rmNo').value.trim().slice(0,12);
  target.cell.type  = document.getElementById('rmType').value;
  target.cell.price = priceRaw === '' ? null : Math.max(0, Number(priceRaw) || 0);
  target.cell.note  = document.getElementById('rmNote').value.trim().slice(0,120);
  target.cell.amen  = editRoomAmen.slice(0,20);
  target.cell.photos = editRoomPhotos.slice(0, MAX_ROOM_PHOTOS);

  // เปลี่ยนสถานะจาก "มีคนจองแล้ว" เป็นอย่างอื่นด้วยมือ = ปล่อยห้องนั้นจากใบจองเดิม
  if(newStatus !== target.cell.status){
    if(target.cell.status === 'booked' && target.cell.bookingId){
      if(!confirm('ห้องนี้มีนักศึกษากดจองไว้อยู่\n\nเปลี่ยนสถานะเองตรงนี้จะเป็นการตัดห้องออกจากคำขอจองนั้น\n' +
                  '(คำขอจองยังอยู่ในเมนู "คำขอจองห้อง" ให้คุณตอบกลับนักศึกษา)\n\nยืนยันหรือไม่')) return;
    }
    target.cell.status = newStatus;
    if(newStatus === 'vacant'){ target.cell.bookingId = null; target.cell.userId = null; }
  }

  document.getElementById('roomModal').classList.remove('open');
  await savePlan(dorm, p, 'บันทึกห้องแล้ว');
});

document.getElementById('rmDelete')?.addEventListener('click', async ()=>{
  if(!planRoomCtx) return;
  const { dorm, cellId } = planRoomCtx;
  const found = eachRoomCell(dorm.floorPlan).find(x=>x.cell.id === cellId);
  if(found && found.cell.status === 'booked' && found.cell.bookingId){
    if(!confirm('ห้องนี้มีคนกดจองไว้อยู่ ยืนยันลบห้องนี้ออกจากผัง?')) return;
  }else if(!confirm('ลบห้องนี้ออกจากผัง?')) return;

  const p = normalizeFloorPlan(dorm.floorPlan);
  const gonePhotos = (found && found.cell.photos) ? found.cell.photos.slice() : [];
  p.floors.forEach(f=> f.rows.forEach(r=>{ r.cells = r.cells.filter(c=>c.id !== cellId); }));
  document.getElementById('roomModal').classList.remove('open');
  await savePlan(dorm, p, 'ลบห้องแล้ว');
  // ลบไฟล์รูปของห้องที่ถูกลบออกจากที่เก็บด้วย ไม่งั้นรูปจะค้างกินพื้นที่ไปเรื่อย ๆ
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
  if(hint){
    hint.innerHTML = (ME && ME.role === 'owner' && myDorms.length === 0)
      ? `<div class="setup-banner show" style="margin-bottom:14px">
           📝 ยังไม่มีหอพักในบัญชีของคุณ — กด <strong>"+ เพิ่มหอพักใหม่"</strong>
           เพื่อกรอกข้อมูลหอของคุณ หอจะแสดงให้นักศึกษาเห็นทันทีหลังบันทึก
         </div>`
      : '';
  }
  await loadVisibleDorms();
  const dorms = myDorms;
  document.getElementById('listingTable').innerHTML = dorms.map(d=>{
    // ผู้ดูแลระบบ "ดู" และ "ลบ" หอของคนอื่นได้ แต่แก้ไขข้อมูลไม่ได้
    // (ฝั่งฐานข้อมูลก็ปิดไว้อีกชั้นในไฟล์ fix-v15.sql — ปุ่มนี้แค่ไม่หลอกให้กด)
    const isMine = d.ownerId === ME.uid;
    const canEdit = isMine;
    return `
    <tr>
      <td><strong>${escapeHtml(d.name)}</strong>
        ${isMine ? '' : '<br><small class="muted">หอของเจ้าของหอรายอื่น</small>'}</td>
      <td>${escapeHtml(d.hallType)}</td>
      <td>${d.rooms.length? d.rooms.map(r=>`${escapeHtml(r.label)}: ${fmtBaht(r.price)}฿`).join('<br>') : '<span class="muted">ยังไม่ระบุ</span>'}</td>
      <td>${d.rooms.length===0 ? '<span class="muted">ยังไม่ระบุ</span>' : ''}${d.rooms.map(r=>`
        <div style="white-space:nowrap;margin:2px 0">
          ${escapeHtml(r.label)}: <strong>${r.vacant}</strong>/${r.total}
          ${canEdit ? `
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
  }).join('') || `<tr><td colspan="5" class="muted" style="text-align:center;padding:26px">ยังไม่มีหอพัก กด "+ เพิ่มหอพักใหม่" เพื่อเริ่มต้น</td></tr>`;

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
    ${(d.rooms||[]).length
      ? `<ul style="margin:0;padding-left:18px;font-size:.9rem">${d.rooms.map(r=>
          `<li>${escapeHtml(r.label)} — ${fmtBaht(r.price)} บาท/เดือน · ว่าง ${r.vacant}/${r.total}</li>`).join('')}</ul>`
      : '<p class="muted" style="font-size:.88rem">ยังไม่ระบุ</p>'}
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

  const fan = dorm && dorm.rooms.find(r=>r.code==='fan');
  const air = dorm && dorm.rooms.find(r=>r.code==='air');
  document.getElementById('fFanPrice').value = fan ? fan.price : '';
  document.getElementById('fFanTotal').value = fan ? fan.total : '';
  document.getElementById('fAirPrice').value = air ? air.price : '';
  document.getElementById('fAirTotal').value = air ? air.total : '';

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
  document.getElementById('editModal').classList.add('open');
  // แผนที่ต้องสร้าง "หลัง" modal เปิดแล้ว ไม่งั้น Leaflet วัดขนาดกล่องได้ 0 แล้วแผนที่จะเพี้ยน
  setTimeout(openLocMap, 60);
}
document.getElementById('btnAddDorm').addEventListener('click', ()=> openEdit(null));
document.getElementById('closeEditModal').addEventListener('click', ()=> document.getElementById('editModal').classList.remove('open'));

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
  return L.divIcon({
    className: 'loc-pin loc-pin-' + kind,
    html: kind === 'dorm' ? '<span>🏠</span>' : '<span>🎓</span>',
    iconSize: [34, 34],
    iconAnchor: [17, 17]
  });
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
    // ไม่งั้นแผนที่ก็ไม่ขึ้น ช่องกรอกก็ยังพับอยู่ = เจ้าของหอปักหมุดไม่ได้เลย
    document.querySelector('.loc-adv')?.setAttribute('open', '');
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
const GPS_GOOD_M = 30;    // แม่นระดับนี้ = พอใช้ได้เลย หยุดรอได้
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
    showLocationState(`⚠️ ปักหมุดให้แล้ว แต่ตำแหน่งที่ได้<strong>ยังหยาบมาก (${accTxt})</strong> —
      หอจริงอาจอยู่ห่างจากหมุดเป็นร้อยเมตร<br>
      มักเกิดตอนเปิดจากคอมพิวเตอร์ (คอมเดาตำแหน่งจาก Wi-Fi/เน็ต ไม่ได้ใช้ GPS จริง)<br>
      <strong>แนะนำ: ลากหมุดบนแผนที่ไปวางตรงหอเอง</strong> หรือเปิดหน้านี้จากมือถือตอนยืนอยู่ที่หอ
      แล้วกดปุ่มนี้ใหม่`, 'warn');
  }else if(acc && acc > GPS_GOOD_M){
    showLocationState(`✓ ปักหมุดจากตำแหน่งปัจจุบันแล้ว (ความแม่นยำ ${accTxt}) —
      ${locationSummary({lat,lng})}<br>
      ซูมแผนที่เข้าไปดูอีกนิด ถ้าหมุดยังไม่ตรงตัวอาคาร ลากปรับได้เลย`, 'ok');
  }else{
    showLocationState(`✓ ปักหมุดจากตำแหน่งปัจจุบันแล้ว ความแม่นยำดี (${accTxt}) —
      ${locationSummary({lat,lng})}`, 'ok');
    toast('ใช้ตำแหน่งปัจจุบันเป็นที่ตั้งหอแล้ว','success');
  }
}

document.getElementById('btnHereLoc')?.addEventListener('click', ()=>{
  if(!navigator.geolocation){
    showLocationState('เบราว์เซอร์นี้ไม่รองรับการหาตำแหน่ง — ลากหมุดบนแผนที่เองได้เลย','warn');
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
      showLocationState(`⚠️ ${m} — ระหว่างนี้ลากหมุดบนแผนที่ไปวางตรงหอเองได้เลย ได้ผลเหมือนกัน`,'warn');
    },
    { enableHighAccuracy:true, timeout:GPS_WATCH_MS, maximumAge:0 }
  );
  // ครบเวลาแล้วก็เอาค่าที่ดีที่สุดเท่าที่ได้
  gpsTimer = setTimeout(finishGps, GPS_WATCH_MS);
});

// ปิด modal ระหว่างกำลังหาตำแหน่งอยู่ ต้องหยุด watch ไม่งั้นมันวิ่งค้างกิน battery
document.getElementById('closeEditModal')?.addEventListener('click', stopGpsWatch);

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
  if(!data.name){ toast('กรุณาใส่ชื่อหอพัก','error'); return; }

  try{
    if(editingId){ await updateDorm(editingId, data); toast('บันทึกข้อมูลหอพักแล้ว','success'); }
    else{
      const newId = await addDorm(ME.uid, data);
      activeOwnerDormId = newId;         // เปิดหอที่เพิ่งสร้างในหน้าโปรไฟล์เลย
      toast('สร้างหน้าหอพักของคุณสำเร็จ — นักศึกษาเห็นหอนี้แล้ว','success');
    }
    document.getElementById('editModal').classList.remove('open');
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

// ---------------------------------------------------------------------------
// หอพักที่ผู้ดูแลระบบสั่งซ่อนไว้ (ตอนนี้หอใหม่เผยแพร่ทันที ไม่ต้องรออนุมัติแล้ว)
// ---------------------------------------------------------------------------
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
          <div><span class="k">ราคา:</span> <strong>${d.rooms.length
            ? d.rooms.map(r=>escapeHtml(r.label)+' '+fmtBaht(r.price)+'฿').join(', ')
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

['editModal'].forEach(id=>{
  document.getElementById(id).addEventListener('click',(e)=>{ if(e.target.id===id) e.currentTarget.classList.remove('open'); });
});
// ปุ่ม "ส่งอีเมลทดสอบ" ในหน้าต่างแก้ไขหอพัก — เช็คว่าแจ้งเตือนถึงจริงไหม
document.getElementById('btnTestMail')?.addEventListener('click', async ()=>{
  if(!editingId){
    toast('บันทึกหอพักก่อน แล้วค่อยกดทดสอบส่งอีเมล','error');
    return;
  }
  const btn = document.getElementById('btnTestMail');
  btn.disabled = true; btn.textContent = 'กำลังส่ง...';
  try{
    const r = await sendTestNotifyEmail(editingId);
    if(r && r.ok){
      toast('ส่งอีเมลทดสอบไปที่ ' + (r.sentTo||'') + ' แล้ว — ลองเช็กกล่องขาเข้าและโฟลเดอร์สแปม','success');
    }else{
      toast('ส่งไม่สำเร็จ: ' + ((r && (r.reason || r.error)) || 'ไม่ทราบสาเหตุ'), 'error');
      console.warn('รายละเอียด:', r);
    }
  }catch(err){
    console.error(err);
    toast('ส่งไม่สำเร็จ: ' + (err.message||''),'error');
  }finally{
    btn.disabled = false; btn.textContent = '✉️ ส่งอีเมลทดสอบ';
  }
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
    // เจ้าของหอใช้หน้า "หน้าหอพักของฉัน" หน้าเดียวจบ — หน้ารวมหอเหลือไว้ให้ผู้ดูแลระบบตรวจสอบ
    document.getElementById('listingsTabBtn').style.display='flex';
    document.getElementById('ownersTabBtn').style.display='flex';
    document.getElementById('dormReviewTabBtn').style.display='flex';
  }

  // (เอา QR โค้ดออกจากหน้าหลังบ้านแล้ว — QR ของเว็บยังมีอยู่ในหน้าฝั่งนักศึกษา)

  try{
    if(isSuspended) return;   // บัญชีถูกระงับ ไม่ต้องโหลดอะไรต่อ
    await renderStats();
    if(profile.role === 'admin') await renderListings();
    await renderOwnerPage();
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
    if(profile.role==='admin'){
      await renderOwners();
      await renderPendingDorms();
      setInterval(renderPendingDorms, 60000);
    }
  }catch(err){ console.error(err); toast('โหลดข้อมูลบางส่วนไม่สำเร็จ','error'); }
})();
