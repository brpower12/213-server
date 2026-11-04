/* Presentation only. No database writes or permission changes. */
(()=>{
  'use strict';
  const byId=id=>document.getElementById(id);
  const mobile=window.matchMedia('(max-width:640px)');
  const paths={compare:'M4 19V9m8 10V5m8 14V12',rank:'M8 4h8v5a4 4 0 0 1-8 0V4Zm4 9v6m-4 1h8M8 6H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4',entry:'m4 16 11-11 4 4L8 20H4v-4Zm9-9 4 4',subs:'M4 4h16v16H4V4Zm4 8 3 3 5-6',polls:'M5 20V10h14v10H5Zm2-14 5-3 5 3-5 3-5-3Zm2 7h6',migration:'M3 7h18v13H3V7Zm5 0V4h8v3M9 13h6m-3-3 3 3-3 3',manage:'M4 7h16M8 4v6M4 17h16m-4-3v6',history:'M4 8a9 9 0 1 1-1 7m1-7V3m0 5h5m3-1v6l4 2',tactical:'m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2V5Zm6-2v16m6-14v16'};
  function icon(key){const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.classList.add('sheet-icon');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[key]||paths.manage);svg.append(path);return svg;}
  const nav=document.querySelector('#appShell nav');
  nav.querySelectorAll('button[data-view]').forEach(button=>{const text=[...button.childNodes].find(n=>n.nodeType===Node.TEXT_NODE);if(text)text.textContent=text.textContent.replace(/^[^\p{L}\p{N}]+/u,'');button.prepend(icon(button.dataset.view));});
  document.querySelectorAll('.view').forEach(view=>{const holder=view.querySelector('.section-head-icon');if(holder)holder.replaceChildren(icon(view.id.replace('view-','')));});
  const shell=document.createElement('div');shell.className='sheet-nav-shell';
  const arrow=(label,direction)=>{const b=document.createElement('button');b.type='button';b.className='sheet-nav-arrow';b.setAttribute('aria-label',label);b.textContent=direction<0?'‹':'›';b.onclick=()=>nav.scrollBy({left:direction*Math.max(180,nav.clientWidth*.75),behavior:'smooth'});return b;};
  const back=arrow('이전 메뉴 보기',-1),forward=arrow('다음 메뉴 보기',1);
  nav.before(shell);shell.append(back,nav,forward);
  function syncNav(){
    shell.hidden=nav.style.display==='none';
    shell.dataset.overflow=String(nav.scrollWidth>nav.clientWidth+2);
    back.disabled=nav.scrollLeft<=1;forward.disabled=nav.scrollLeft+nav.clientWidth>=nav.scrollWidth-2;
    document.documentElement.style.setProperty('--sheet-header-height',`${document.querySelector('#appShell header').getBoundingClientRect().height}px`);
  }
  let navResizeFrame=0;
  const observer=new ResizeObserver(()=>{cancelAnimationFrame(navResizeFrame);navResizeFrame=requestAnimationFrame(syncNav);});observer.observe(nav);observer.observe(document.querySelector('#appShell header'));
  nav.addEventListener('scroll',syncNav,{passive:true});
  const apply=applyPerms;applyPerms=function(){apply();requestAnimationFrame(syncNav);};
  const toolbar=byId('view-compare').querySelector('.toolbar');
  const detail=document.createElement('details');detail.id='compareDetails';detail.className='sheet-disclosure';
  const summary=document.createElement('summary'),body=document.createElement('div');body.className='sheet-disclosure-body';detail.append(summary,body);
  const basis=byId('basisSeg').closest('.segwrap'),top=byId('topSeg').closest('.segwrap');
  basis.before(detail);body.append(basis,top);
  const syncCompare=()=>{const label=basis.querySelector('button.active')?.textContent.trim().replace(/^[^\p{L}\p{N}]+/u,'')||'1편대';summary.textContent=`상세 조건 / ${label} / ${topN?`상위 ${topN}명`:'전체 인원'}`;const hint=document.createElement('span');hint.className='sheet-disclosure-action';hint.textContent=detail.open?'접기':'펼치기';summary.append(hint);};
  detail.addEventListener('toggle',syncCompare);
  for(const name of ['setBasis','setTopN','resetCompare']){const original=window[name];window[name]=function(...args){const result=original(...args);syncCompare();return result;};}
  syncCompare();

  const columns=document.createElement('details');columns.id='rankColumns';columns.className='sheet-disclosure';
  columns.innerHTML='<summary>모바일 표시 항목 선택</summary><div class="sheet-disclosure-body"><p class="sheet-info">순위와 이름은 고정됩니다. 필요한 항목을 선택하면 표 안에서 좌우로 확인할 수 있습니다.</p><div class="sheet-column-options"></div></div>';
  byId('rankBox').before(columns);
  const advanced=document.createElement('details');advanced.id='rankAdvanced';advanced.className='sheet-disclosure';advanced.open=!mobile.matches;advanced.hidden=true;
  const advancedSummary=document.createElement('summary');advanced.append(advancedSummary);
  const band=byId('rankBandPanel');band.before(advanced);advanced.append(band);
  mobile.addEventListener('change',()=>{advanced.open=!mobile.matches;});
  const quick=document.createElement('div');quick.className='sheet-rank-quick';
  quick.innerHTML='<label>순위 종류<select aria-label="순위 종류"></select></label><label>집계 범위<select aria-label="순위 집계 범위"></select></label><button type="button" class="btn">새로고침</button>';
  byId('view-rank').querySelector('.toolbar').prepend(quick);
  const [quickMode,quickTop]=quick.querySelectorAll('select');
  quickMode.innerHTML=[...byId('rankSeg').querySelectorAll('button')].map(b=>`<option value="${b.dataset.r}">${esc(b.textContent.replace(/^[^\p{L}\p{N}]+/u,''))}</option>`).join('');
  quickMode.onchange=()=>setRankMode(quickMode.value);quickTop.onchange=()=>setRankTop(Number(quickTop.value));quick.querySelector('button').onclick=()=>loadRank(true);
  const preferences=new Map();
  function syncRankColumns(){
    quickMode.value=rankMode;
    quickTop.innerHTML=[...byId('rankTopSeg').querySelectorAll('button')].map(b=>`<option value="${b.dataset.t}">${esc(b.textContent)}</option>`).join('');quickTop.value=String(rankTopN);
    advanced.hidden=rankMode!=='user';
    advancedSummary.textContent=`고급 필터 / ${rankBandScopeLabel().replaceAll('·','/')} / ${rankBandRangeLabel().replaceAll('·','/')}`;
    const box=byId('rankBox'),table=box.querySelector('table');if(!table)return;
    const headers=[...table.querySelectorAll('thead th')];
    const required=new Set([0,1]);
    headers.forEach((h,i)=>{if(h.classList.contains('selected-power')||(rankMode!=='user'&&[2,3].includes(i)))required.add(i);});
    const defaults=new Set(required),selected=preferences.get(rankMode)||defaults;
    box.dataset.extraColumns=String([...selected].some(i=>!defaults.has(i)));
    const options=columns.querySelector('.sheet-column-options');options.replaceChildren();
    headers.forEach((h,i)=>{
      const label=document.createElement('label'),input=document.createElement('input');input.type='checkbox';input.checked=selected.has(i)||i<2;input.disabled=i<2;
      label.append(input,document.createTextNode(h.textContent.trim()));options.append(label);
      input.onchange=()=>{const next=new Set(selected);input.checked?next.add(i):next.delete(i);preferences.set(rankMode,next);syncRankColumns();};
      table.querySelectorAll('tr').forEach(r=>{if(r.cells[i])r.cells[i].dataset.mobileHidden=String(!input.checked);});
    });
  }
  const rank=renderRank;renderRank=function(){rank();syncRankColumns();};

  const scope=byId('subDateFrom').closest('label');
  const period=document.createElement('label');period.className='sub-scope-field';period.innerHTML='<span>빠른 기간 선택</span><select aria-label="제출 조회 기간"><option value="">기간 선택</option><option value="7">최근 7일</option><option value="30">최근 30일</option><option value="90">최근 90일</option></select>';
  scope.after(period);period.querySelector('select').onchange=e=>{if(!e.target.value)return;const d=new Date(Date.now()+9*3600000);d.setUTCDate(d.getUTCDate()-Number(e.target.value)+1);byId('subDateFrom').value=d.toISOString().slice(0,10);onSubScopeChange();};
  const shortcuts=document.createElement('div');shortcuts.className='sheet-shortcuts';
  for(const [label,filter] of [['미제출 확인','missing'],['명단 일치 실패 확인','unmatched']]){const b=document.createElement('button');b.className='btn';b.type='button';b.textContent=label;b.onclick=()=>{subAuditFilter=filter;setSubFilter('audit');document.querySelectorAll('#subAuditSeg button').forEach(x=>x.classList.toggle('active',x.dataset.audit===filter));};shortcuts.append(b);}
  const scopeNote=document.createElement('p');scopeNote.className='sheet-info';scopeNote.textContent='기준일 이후 최신 1,000건까지 조회합니다. 더 보기는 조회된 기록에서 표시 항목을 늘립니다.';
  byId('subList').before(shortcuts,scopeNote);
  const unmatched=document.createElement('button');unmatched.type='button';unmatched.dataset.audit='unmatched';unmatched.textContent='일치 실패';unmatched.onclick=()=>setSubAuditFilter('unmatched');byId('subAuditSeg').append(unmatched);

  const help=document.createElement('p');help.className='history-help';help.textContent='전투력과 킬수의 변경 전후를 비교합니다. 이전 값은 현재 조회된 기록 안에서 확인하며, 조회 범위 밖의 기록은 추정하지 않습니다.';byId('histList').before(help);
  const serverSearch=document.createElement('input');serverSearch.type='search';serverSearch.placeholder='서버 번호 또는 연맹 검색';serverSearch.setAttribute('aria-label',serverSearch.placeholder);serverSearch.className='sheet-server-search';byId('serverList').before(serverSearch);
  const filterServers=()=>{const q=serverSearch.value.trim().toLocaleLowerCase();[...byId('serverList').children].forEach(card=>card.hidden=!!q&&!card.textContent.toLocaleLowerCase().includes(q));};
  serverSearch.addEventListener('input',filterServers);const manage=renderManage;renderManage=function(){manage();filterServers();};
  syncNav();syncRankColumns();
})();
