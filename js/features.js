// ============================================================
// features.js — 6가지 신규 기능
// 1. BibTeX / RIS 내보내기
// 2. 즐겨찾기 컬렉션(폴더)
// 3. 검색 결과 태그 & 메모
// 4. 인용/연관 논문 네트워크 시각화
// 5. 연구자 심층 프로필
// 6. 기관별 연구 성과 비교
// ============================================================

// ──────────────────────────────────────────────────────────────
// Feature 1: BibTeX / RIS 내보내기
// ──────────────────────────────────────────────────────────────

function toggleExportMenu() {
  const menu = document.getElementById('exportMenu');
  if (!menu) return;
  menu.classList.toggle('hidden');
  // 바깥 클릭 시 닫기
  const handler = (e) => {
    if (!menu.contains(e.target) && !e.target.closest('#exportMenuBtn')) {
      menu.classList.add('hidden');
      document.removeEventListener('click', handler);
    }
  };
  if (!menu.classList.contains('hidden')) {
    setTimeout(() => document.addEventListener('click', handler), 0);
  }
}

function exportBibTeX(items) {
  const rows = items || STATE.currentItems;
  if (!rows || rows.length === 0) { showToast('내보낼 결과가 없습니다.', 'warning'); return; }

  const typeMap = { '논문': 'article', '특허': 'patent', '보고서': 'techreport', '동향': 'misc', '연구자': 'misc', '연구기관': 'misc', '트렌드': 'misc', 'R&D과제': 'techreport' };

  const entries = rows.map((r, i) => {
    const ty = typeMap[r.type] || 'misc';
    const year = (r.year || '').substring(0, 4);
    const safeTitle = (r.title || '').replace(/[{}\\]/g, '');
    const key = `scienceon${i + 1}_${year || 'nd'}`;
    let bib = `@${ty}{${key},\n`;
    bib += `  title     = {${safeTitle}},\n`;
    if (r.authors) {
      const authorStr = r.authors.split(/[;,|]/).map(a => a.trim()).filter(Boolean).join(' and ');
      bib += `  author    = {${authorStr}},\n`;
    }
    if (year) bib += `  year      = {${year}},\n`;
    if (r.url) bib += `  url       = {${r.url}},\n`;
    if (r.keywords) bib += `  keywords  = {${r.keywords.replace(/[{}\\]/g, '')}},\n`;
    if (r.abstract) bib += `  abstract  = {${r.abstract.replace(/[{}\\]/g, '').replace(/\n/g, ' ').substring(0, 300)}},\n`;
    bib += `  note      = {ScienceON 통합검색}\n}`;
    return bib;
  }).join('\n\n');

  const blob = new Blob([entries], { type: 'text/plain;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `scienceon_${STATE.currentQuery || 'export'}_${new Date().toISOString().slice(0, 10)}.bib`;
  link.click();
  showToast(`${rows.length}건을 BibTeX(.bib)로 내보냈습니다.`, 'success');
  document.getElementById('exportMenu')?.classList.add('hidden');
}

function exportRIS(items) {
  const rows = items || STATE.currentItems;
  if (!rows || rows.length === 0) { showToast('내보낼 결과가 없습니다.', 'warning'); return; }

  const typeMap = { '논문': 'JOUR', '특허': 'PAT', '보고서': 'RPRT', '동향': 'JOUR', 'R&D과제': 'RPRT' };

  const entries = rows.map(r => {
    const ty = typeMap[r.type] || 'GEN';
    const year = (r.year || '').substring(0, 4);
    let ris = `TY  - ${ty}\n`;
    if (r.title) ris += `TI  - ${r.title}\n`;
    if (r.authors) {
      r.authors.split(/[;,|]/).map(a => a.trim()).filter(Boolean).forEach(a => {
        ris += `AU  - ${a}\n`;
      });
    }
    if (year) ris += `PY  - ${year}\n`;
    if (r.url) ris += `UR  - ${r.url}\n`;
    if (r.keywords) {
      r.keywords.split(/[;,|]/).map(k => k.trim()).filter(Boolean).forEach(k => {
        ris += `KW  - ${k}\n`;
      });
    }
    if (r.abstract) ris += `AB  - ${r.abstract.replace(/\n/g, ' ').substring(0, 500)}\n`;
    ris += `DB  - ScienceON\nER  - \n`;
    return ris;
  }).join('\n');

  const blob = new Blob([entries], { type: 'text/plain;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `scienceon_${STATE.currentQuery || 'export'}_${new Date().toISOString().slice(0, 10)}.ris`;
  link.click();
  showToast(`${rows.length}건을 RIS(.ris)로 내보냈습니다.`, 'success');
  document.getElementById('exportMenu')?.classList.add('hidden');
}


// ──────────────────────────────────────────────────────────────
// Feature 2: 즐겨찾기 컬렉션(폴더)
// ──────────────────────────────────────────────────────────────
// 컬렉션 구조: [{ id, name, color, itemIds: [] }]
// STATE.favorites 는 그대로 유지 (단일 아이템 풀)
// 컬렉션은 itemIds 로 favorites 를 참조

let _collections = JSON.parse(localStorage.getItem('sc_collections') || '[]');

function saveCollections() {
  localStorage.setItem('sc_collections', JSON.stringify(_collections));
}

function openCollectionManager() {
  renderCollectionManager();
  document.getElementById('collectionModal').classList.remove('hidden');
}
function closeCollectionManager() {
  document.getElementById('collectionModal').classList.add('hidden');
}

function renderCollectionManager() {
  const list = document.getElementById('collectionList');
  if (!list) return;

  if (_collections.length === 0) {
    list.innerHTML = '<p class="text-gray-400 text-sm text-center py-6">컬렉션이 없습니다. 아래에서 새로 만드세요.</p>';
    return;
  }

  list.innerHTML = _collections.map(col => {
    const items = STATE.favorites.filter(f => col.itemIds.includes(f.id));
    return `
      <div class="col-card" style="border-left: 3px solid ${col.color};">
        <div class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <span style="width:10px;height:10px;border-radius:50%;background:${col.color};flex-shrink:0;"></span>
            <span class="font-semibold text-sm truncate">${escHtml(col.name)}</span>
            <span class="text-xs text-gray-400">${items.length}건</span>
          </div>
          <div class="flex items-center gap-1.5 flex-shrink-0">
            <button type="button" class="btn-secondary text-xs" onclick="openAddToCollection('${escAttr(col.id)}')">
              <iconify-icon icon="solar:add-circle-bold-duotone" width="13"></iconify-icon>추가
            </button>
            <button type="button" class="btn-secondary text-xs" onclick="deleteCollection('${escAttr(col.id)}')">
              <iconify-icon icon="solar:trash-bin-2-bold-duotone" width="13"></iconify-icon>
            </button>
          </div>
        </div>
        ${items.length > 0 ? `
          <div class="mt-2 space-y-1">
            ${items.slice(0, 3).map(f => `
              <div class="flex items-center justify-between gap-2">
                <p class="text-xs text-gray-600 truncate flex-1">${escHtml(f.title || '')}</p>
                <button type="button" onclick="removeFromCollection('${escAttr(col.id)}','${escAttr(f.id)}')" class="text-gray-300 hover:text-red-400 flex-shrink-0">
                  <iconify-icon icon="solar:close-circle-bold-duotone" width="13"></iconify-icon>
                </button>
              </div>`).join('')}
            ${items.length > 3 ? `<p class="text-xs text-gray-400">+ ${items.length - 3}건 더</p>` : ''}
          </div>` : ''}
      </div>`;
  }).join('');
}

function createCollection() {
  const nameEl = document.getElementById('newColName');
  const colorEl = document.getElementById('newColColor');
  const name = nameEl?.value.trim();
  if (!name) { showToast('컬렉션 이름을 입력하세요.', 'warning'); return; }

  const col = {
    id: 'col_' + Date.now(),
    name,
    color: colorEl?.value || '#6366f1',
    itemIds: []
  };
  _collections.push(col);
  saveCollections();
  nameEl.value = '';
  renderCollectionManager();
  showToast(`"${name}" 컬렉션이 생성됐습니다.`, 'success');
}

function deleteCollection(colId) {
  _collections = _collections.filter(c => c.id !== colId);
  saveCollections();
  renderCollectionManager();
}

function removeFromCollection(colId, itemId) {
  const col = _collections.find(c => c.id === colId);
  if (!col) return;
  col.itemIds = col.itemIds.filter(id => id !== itemId);
  saveCollections();
  renderCollectionManager();
}

function openAddToCollection(colId) {
  const col = _collections.find(c => c.id === colId);
  if (!col) return;
  const available = STATE.favorites.filter(f => !col.itemIds.includes(f.id));
  if (available.length === 0) { showToast('추가할 즐겨찾기가 없습니다.', 'info'); return; }

  const picker = document.getElementById('colItemPicker');
  if (!picker) return;
  picker.dataset.colId = colId;
  picker.innerHTML = available.map(f => `
    <label class="flex items-center gap-2 p-2 rounded hover:bg-gray-50 cursor-pointer">
      <input type="checkbox" value="${escAttr(f.id)}" class="col-item-check accent-indigo-500">
      <span class="text-sm text-gray-700 flex-1 truncate">${escHtml(f.title || '')}</span>
      <span class="text-xs text-gray-400">${escHtml(f.type || '')}</span>
    </label>`).join('');
  document.getElementById('colItemPickerWrap').classList.remove('hidden');
}

function confirmAddToCollection() {
  const picker = document.getElementById('colItemPicker');
  if (!picker) return;
  const colId = picker.dataset.colId;
  const col = _collections.find(c => c.id === colId);
  if (!col) return;
  const checked = Array.from(picker.querySelectorAll('.col-item-check:checked')).map(el => el.value);
  if (checked.length === 0) { showToast('항목을 선택하세요.', 'warning'); return; }
  col.itemIds = [...new Set([...col.itemIds, ...checked])];
  saveCollections();
  document.getElementById('colItemPickerWrap').classList.add('hidden');
  renderCollectionManager();
  showToast(`${checked.length}건을 컬렉션에 추가했습니다.`, 'success');
}

function exportCollectionCSV(colId) {
  const col = _collections.find(c => c.id === colId);
  if (!col) return;
  const items = STATE.favorites.filter(f => col.itemIds.includes(f.id));
  exportCSV(items.map(f => ({ ...f, authors: f.authors || '', keywords: '', abstract: '' })));
}


// ──────────────────────────────────────────────────────────────
// Feature 3: 검색 결과 태그 & 메모
// ──────────────────────────────────────────────────────────────

let _memos = JSON.parse(localStorage.getItem('sc_memos') || '{}');

function saveMemos() {
  localStorage.setItem('sc_memos', JSON.stringify(_memos));
}

function getMemo(id) {
  return _memos[id] || { tags: [], memo: '' };
}

function hasMemo(id) {
  const m = _memos[id];
  return m && (m.memo || (m.tags && m.tags.length > 0));
}

function openMemoPanel(id, title) {
  const panel = document.getElementById('memoPanel');
  if (!panel) return;
  const m = getMemo(id);
  panel.dataset.itemId = id;
  document.getElementById('memoPanelTitle').textContent = title || '메모';
  document.getElementById('memoTags').value = (m.tags || []).join(', ');
  document.getElementById('memoText').value = m.memo || '';
  panel.classList.add('open');
}

function closeMemoPanel() {
  document.getElementById('memoPanel')?.classList.remove('open');
}

function saveMemoPanel() {
  const panel = document.getElementById('memoPanel');
  if (!panel) return;
  const id = panel.dataset.itemId;
  if (!id) return;

  const tagsRaw = document.getElementById('memoTags')?.value || '';
  const memo = document.getElementById('memoText')?.value || '';
  const tags = tagsRaw.split(/[,;]/).map(t => t.trim()).filter(Boolean);

  _memos[id] = { tags, memo, updated: new Date().toISOString() };
  saveMemos();

  // 카드 내 메모 인디케이터 업데이트
  document.querySelectorAll(`[data-memo-id="${CSS.escape(id)}"]`).forEach(btn => {
    btn.classList.toggle('memo-active', hasMemo(id));
    const icon = btn.querySelector('iconify-icon');
    if (icon) icon.setAttribute('icon', hasMemo(id) ? 'solar:notes-bold' : 'solar:notes-bold-duotone');
  });

  closeMemoPanel();
  showToast('메모가 저장됐습니다.', 'success');
}

function deleteMemo() {
  const panel = document.getElementById('memoPanel');
  if (!panel) return;
  const id = panel.dataset.itemId;
  if (!id) return;
  delete _memos[id];
  saveMemos();
  document.querySelectorAll(`[data-memo-id="${CSS.escape(id)}"]`).forEach(btn => {
    btn.classList.remove('memo-active');
    const icon = btn.querySelector('iconify-icon');
    if (icon) icon.setAttribute('icon', 'solar:notes-bold-duotone');
  });
  closeMemoPanel();
  showToast('메모가 삭제됐습니다.', 'info');
}


// ──────────────────────────────────────────────────────────────
// Feature 4(구): 논문 연관 네트워크 — 제거됨
// ──────────────────────────────────────────────────────────────

// Feature 5: 연구자 심층 프로필
// ──────────────────────────────────────────────────────────────

async function showDeepProfile(name, inst) {
  const panel = document.getElementById('deepProfilePanel');
  if (!panel) return;

  document.getElementById('deepProfileName').textContent = name;
  document.getElementById('deepProfileInst').textContent = inst || '';
  document.getElementById('deepProfileContent').innerHTML = `
    <div class="flex justify-center py-12"><div class="spinner"></div></div>
    <p class="text-center text-gray-400 text-sm mt-2">ScienceON에서 연구 데이터를 불러오는 중...</p>`;
  panel.classList.add('open');

  if (!STATE.clientId || !STATE.token) {
    document.getElementById('deepProfileContent').innerHTML =
      '<p class="text-center text-gray-400 py-12">ScienceON API 토큰이 필요합니다.</p>';
    return;
  }

  try {
    const fetchByName = async (target, rowCount = 20) => {
      const searchQuery = JSON.stringify({ AU: name });
      const params = new URLSearchParams({
        client_id: STATE.clientId, token: STATE.token,
        version: '1.0', action: 'search', target,
        searchQuery, curPage: 1, rowCount,
      });
      const resp = await fetch(`${getApiBase()}?${params}`);
      return new DOMParser().parseFromString(await resp.text(), 'text/xml');
    };

    const [artiXml, patentXml] = await Promise.all([
      fetchByName('ARTI', 50),
      fetchByName('PATENT', 20),
    ]);

    const getCount = (xml) => parseInt(xml.querySelector('TotalCount,totalCount')?.textContent) || 0;
    const getItems = (xml) => Array.from(xml.querySelectorAll('recordList record, record'));

    const artiTotal = getCount(artiXml);
    const patentTotal = getCount(patentXml);
    const artiItems = getItems(artiXml);
    const patentItems = getItems(patentXml);

    // 연도별 논문 분포
    const yearMap = {};
    artiItems.forEach(item => {
      const y = (getVal(item, 'Pubyear', 'PublDate') || '').substring(0, 4);
      if (y && y >= '2000') yearMap[y] = (yearMap[y] || 0) + 1;
    });
    const years = Object.keys(yearMap).sort();
    const yearCounts = years.map(y => yearMap[y]);

    // 키워드 빈도
    const kwMap = {};
    artiItems.forEach(item => {
      (getVal(item, 'Keyword') || '').split(/[;,|]/).map(k => k.trim()).filter(k => k.length >= 2).forEach(k => {
        kwMap[k] = (kwMap[k] || 0) + 1;
      });
    });
    const topKws = Object.entries(kwMap).sort((a, b) => b[1] - a[1]).slice(0, 10);

    // 공동저자
    const coMap = {};
    artiItems.forEach(item => {
      const aus = (getVal(item, 'Author') || '').split(/[;,|]/).map(a => a.trim()).filter(Boolean);
      aus.forEach(a => {
        if (a !== name && a.length >= 2) coMap[a] = (coMap[a] || 0) + 1;
      });
    });
    const topCo = Object.entries(coMap).sort((a, b) => b[1] - a[1]).slice(0, 8);

    // 최근 논문 5편
    const recentPapers = artiItems.slice(0, 5).map(item => ({
      title: getVal(item, 'Title') || '(제목 없음)',
      year: (getVal(item, 'Pubyear', 'PublDate') || '').substring(0, 4),
      journal: getVal(item, 'JournalName') || '',
      url: getVal(item, 'ContentURL', 'FulltextURL') || '',
    }));

    renderDeepProfile({ name, inst, artiTotal, patentTotal, years, yearCounts, topKws, topCo, recentPapers });

  } catch (e) {
    document.getElementById('deepProfileContent').innerHTML =
      `<p class="text-center text-red-400 py-12">데이터 로딩 오류: ${escHtml(e.message)}</p>`;
  }
}

function renderDeepProfile({ name, inst, artiTotal, patentTotal, years, yearCounts, topKws, topCo, recentPapers }) {
  const content = document.getElementById('deepProfileContent');
  if (!content) return;

  const kwHtml = topKws.map(([k, v]) => `
    <div class="flex items-center gap-2">
      <span class="text-xs text-gray-700 flex-1 truncate">${escHtml(k)}</span>
      <div class="flex-shrink-0 h-2 rounded-full bg-gray-200" style="width:80px;">
        <div class="h-2 rounded-full bg-black" style="width:${Math.round((v / (topKws[0]?.[1] || 1)) * 80)}px;"></div>
      </div>
      <span class="text-xs text-gray-400 w-5 text-right">${v}</span>
    </div>`).join('');

  const coHtml = topCo.map(([a, v]) => `
    <button type="button" class="coauthor-chip" onclick="closseDeepProfile();document.getElementById('searchInput').value='${escAttr(a)}';setTarget(document.querySelector('[data-target=ARTI]'));doSearch()">
      ${escHtml(a)} <span class="text-gray-400">${v}</span>
    </button>`).join('');

  const papersHtml = recentPapers.map(p => `
    <div class="${p.url ? 'cursor-pointer hover:bg-gray-50' : ''} p-2 rounded-lg" ${p.url ? `onclick="window.open('${escAttr(p.url)}','_blank')"` : ''}>
      <p class="text-sm font-medium text-gray-800 leading-snug line-clamp-2">${escHtml(p.title)}</p>
      <p class="text-xs text-gray-400 mt-1">${[p.year, p.journal].filter(Boolean).join(' · ')}</p>
    </div>`).join('');

  content.innerHTML = `
    <!-- KPI -->
    <div class="grid grid-cols-2 gap-3 mb-5">
      <div class="profile-kpi">
        <iconify-icon icon="solar:document-text-bold-duotone" width="18" class="text-blue-500"></iconify-icon>
        <div>
          <p class="text-xl font-bold text-black">${artiTotal.toLocaleString()}</p>
          <p class="text-xs text-gray-400">논문</p>
        </div>
      </div>
      <div class="profile-kpi">
        <iconify-icon icon="solar:lightbulb-bold-duotone" width="18" class="text-amber-500"></iconify-icon>
        <div>
          <p class="text-xl font-bold text-black">${patentTotal.toLocaleString()}</p>
          <p class="text-xs text-gray-400">특허</p>
        </div>
      </div>
    </div>

    <!-- 연도별 발표 추이 -->
    ${years.length > 0 ? `
    <div class="mb-5">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">연도별 논문 발표</p>
      <div style="height:100px; position:relative;">
        <canvas id="profileYearChart"></canvas>
      </div>
    </div>` : ''}

    <!-- 주요 키워드 -->
    ${topKws.length > 0 ? `
    <div class="mb-5">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">주요 연구 키워드</p>
      <div class="space-y-1.5">${kwHtml}</div>
    </div>` : ''}

    <!-- 공동저자 -->
    ${topCo.length > 0 ? `
    <div class="mb-5">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">주요 공동저자</p>
      <div class="flex flex-wrap gap-1.5">${coHtml}</div>
    </div>` : ''}

    <!-- 최근 논문 -->
    ${recentPapers.length > 0 ? `
    <div class="mb-4">
      <p class="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">최근 논문</p>
      <div class="space-y-1 divide-y divide-gray-100">${papersHtml}</div>
    </div>` : ''}

    <!-- 논문 검색 버튼 -->
    <button type="button" class="btn-primary w-full justify-center mt-2"
      onclick="closeDeepProfile();document.getElementById('searchInput').value='${escAttr(name)}';document.querySelector('[data-target=ARTI]')&&setTarget(document.querySelector('[data-target=ARTI]'));doSearch()">
      <iconify-icon icon="solar:magnifer-bold" width="14"></iconify-icon>
      "${escHtml(name)}" 논문 전체 검색
    </button>`;

  // Chart.js 연도별 차트
  if (years.length > 0) {
    setTimeout(() => {
      const canvas = document.getElementById('profileYearChart');
      if (!canvas || typeof Chart === 'undefined') return;
      new Chart(canvas, {
        type: 'bar',
        data: {
          labels: years,
          datasets: [{ data: yearCounts, backgroundColor: '#111', borderRadius: 3 }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.raw}편` } } },
          scales: {
            x: { ticks: { font: { size: 10 }, maxRotation: 45 }, grid: { display: false } },
            y: { ticks: { font: { size: 10 }, stepSize: 1 }, grid: { color: '#f3f4f6' } }
          }
        }
      });
    }, 50);
  }
}

function closeDeepProfile() {
  document.getElementById('deepProfilePanel')?.classList.remove('open');
}


