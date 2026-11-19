/* Additive intake for decoded, user-provided game observations.
 * No game-server requests, token storage, or writes to existing power_records. */
(()=>{
  'use strict';
  const Core=window.DWGameData,entry=document.getElementById('view-entry');
  if(!Core||!entry)return;
  const panel=document.createElement('details');panel.className='dw-game-panel';panel.id='dwGameData';
  panel.innerHTML=`<summary>게임 데이터 <span class="dw-status">실시간 수신 미연결</span></summary>
    <div class="dw-game-body">
      <p>가져온 게임 조회 기록에서 총투력·이민 투력과 세부 전력을 확인합니다. 데이터는 UID로 구분하며, 기존 편대 투력과 별도로 관리합니다.</p>
      <p class="dw-info">현재는 해석된 JSON 기록을 검토해 저장하는 단계입니다. 휴대폰이나 게임 계정에 자동 연결하지 않습니다. 확인되지 않은 편대 투력은 계산하거나 채우지 않습니다.</p>
      <div class="dw-game-actions">
        <label>조회 기록 파일<input id="dwGameFile" type="file" accept=".json,application/json"></label>
        <label>관측 시각 · 파일에 없을 때<input id="dwGameObservedAt" type="datetime-local" step="1"></label>
      </div>
      <label>JSON 붙여넣기<textarea id="dwGameInput" spellcheck="false" placeholder="해석된 조회 기록을 붙여넣으세요. 로그인 정보나 원본 패킷 파일은 받지 않습니다."></textarea></label>
      <details class="dw-game-example"><summary>지원 형식 보기</summary><p>관측 시각에는 시간대가 있어야 합니다. 아래는 형식 설명용 예시이며 실제 데이터가 아닙니다.</p><pre id="dwGameExample"></pre></details>
      <div class="dw-game-actions">
        <button class="btn" id="dwGamePreview" type="button">내용 검토</button>
        <button class="btn primary" id="dwGameSave" type="button" disabled>검토한 기록 저장</button>
        <button class="btn" id="dwGameLoad" type="button">저장 기록 불러오기</button>
        <button class="btn" id="dwGameClear" type="button">미리보기 지우기</button>
      </div>
      <div class="dw-game-state" id="dwGameMessage" role="status" aria-live="polite"></div>
      <div class="dw-game-mode" id="dwGameMode">조회 기록 없음</div>
      <div class="dw-game-actions">
        <label>플레이어 찾기<input id="dwGameSearch" type="search" placeholder="닉네임 · UID · 연맹 · 서버"></label>
        <label>정렬<select id="dwGameSort"><option value="total_power">총투력 높은 순</option><option value="migration_power">이민 투력 높은 순</option><option value="observed_at">최근 관측 순</option></select></label>
        <button class="btn" id="dwGameCSV" type="button" disabled>현재 결과 CSV</button>
        <button class="btn" id="dwGameJSON" type="button" disabled>현재 결과 JSON</button>
      </div>
      <div class="dw-game-stats"><div><span>현재 결과 인원</span><b id="dwGameCount">0</b></div><div><span>확인된 총투력 합계</span><b id="dwGameTotal">—</b></div><div><span>이민 투력 확인 인원</span><b id="dwGameMigrationCount">0</b></div></div>
      <p id="dwGameCoverage" style="font-size:13px">합계는 가져온 기록의 조회 결과이며 서버 전체 전력이 아닙니다.</p>
      <div class="dw-game-table-wrap" id="dwGameTable"><div class="dw-game-empty">검토하거나 불러온 조회 기록이 없습니다.</div></div>
      <details class="dw-game-extra"><summary>출처와 누락값 안내</summary><p>공란은 아직 확인하지 못한 값이며, 0과 다릅니다. 항목별로 마지막 관측 시각이 다르면 각 값 아래에 해당 시각을 표시합니다. 킬수·기지 레벨과 세부 전력은 플레이어의 상세 항목에서 확인할 수 있습니다.</p></details>
    </div>`;
  const target=entry.querySelector('.entry-control-panel');
  (target||entry.firstElementChild).after(panel);
  const el=id=>document.getElementById('dwGame'+id);
  el('Example').textContent=JSON.stringify({command:'get.new.user.info',observed_at:'2026-11-19T09:00:00+09:00',payload:{uid:'1234567890000213',name:'예시 플레이어',abbr:'NXT',serverId:213,power:100000000,armyPower:20000000}},null,2);
  let observations=[],pending=[],filtered=[],mode='empty',revision=0,busy=false,loadLimit=500;
  const message=(text,error=false)=>{el('Message').textContent=text;el('Message').dataset.error=String(error);};
  const permitted=()=>typeof canView==='function'&&canView('entry')&&typeof deviceStatus!=='undefined'&&deviceStatus==='approved';
  const authorized=async()=>{
    if(typeof loadPerms==='function')await loadPerms();
    if(!permitted()||typeof getEditor!=='function'||!getEditor()||!sb)throw new Error('승인된 기기와 입력 권한이 필요합니다. 운영진 등록 상태를 확인해 주세요.');
    return {p_actor:getEditor(),p_device_id:getDeviceId()};
  };
  const setBusy=value=>{busy=value;el('Preview').disabled=value;el('Load').disabled=value;el('Clear').disabled=value;el('Save').disabled=value||!pending.length||!permitted();};
  const text=(tag,value,cls)=>{const node=document.createElement(tag);node.textContent=value;if(cls)node.className=cls;return node;};
  const date=value=>value?new Date(value).toLocaleString('ko-KR',{timeZone:'Asia/Seoul',hour12:false}):'시각 없음';
  const metric=(row,key)=>{
    const td=text('td',row[key]==null?'—':Core.formatPower(row[key]),'dw-num');
    const when=row.field_observed_at?.[key];
    if(when){td.title=`${row[key].toLocaleString('ko-KR')} · ${date(when)} · ${row.field_source?.[key]||''}`;if(when!==row.observed_at)td.append(text('small',date(when)));}
    return td;
  };
  function render(){
    let rows=Core.mergeLatest(observations),q=el('Search').value.trim().toLocaleLowerCase(),sort=el('Sort').value;
    filtered=rows.filter(row=>!q||[row.name,row.uid,row.alliance,row.server].some(v=>String(v??'').toLocaleLowerCase().includes(q)));
    filtered.sort((a,b)=>sort==='observed_at'?Core.compareObservedAt(b.observed_at,a.observed_at):(b[sort]??-1)-(a[sort]??-1)||a.uid.localeCompare(b.uid));
    el('Mode').textContent=mode==='preview'?`저장 전 미리보기 · ${pending.length}개 관측 기록`:mode==='saved'?`저장 기록 · 최근 ${observations.length}개 관측`:'조회 기록 없음';
    el('Count').textContent=String(filtered.length);
    // BigInt preserves exact sums even when many individually safe values exceed JS's safe range.
    const totals=filtered.filter(row=>row.total_power!=null),total=totals.reduce((sum,row)=>sum+BigInt(row.total_power),0n);
    el('Total').textContent=totals.length?total.toLocaleString('ko-KR'):'—';
    el('MigrationCount').textContent=String(filtered.filter(row=>row.migration_power!=null).length);
    el('Coverage').textContent=`총투력 ${totals.length}/${filtered.length}명 확인. 합계는 조회된 인원 기준입니다. ${mode==='saved'?`최근 ${loadLimit}개 관측 기록 범위이며 과거 관측은 포함되지 않을 수 있습니다.`:'서버 전체 명단을 뜻하지 않습니다.'}`;
    el('CSV').disabled=!filtered.length;el('JSON').disabled=!filtered.length;el('Save').disabled=busy||!pending.length||!permitted();
    const box=el('Table');box.replaceChildren();
    if(!filtered.length){box.append(text('div',q?'검색 결과가 없습니다.':'검토하거나 불러온 조회 기록이 없습니다.','dw-game-empty'));return;}
    const table=document.createElement('table');table.className='dw-game-table';
    const head=document.createElement('thead'),tr=document.createElement('tr');
    ['플레이어 / UID','서버 / 연맹','총투력','이민 투력','최근 관측 · 한국 시간','출처 / 상세'].forEach(label=>tr.append(text('th',label)));
    head.append(tr);table.append(head);const body=document.createElement('tbody');
    for(const row of filtered){
      const tr=document.createElement('tr'),who=text('td',row.name||'닉네임 미확인');who.append(text('small',row.uid));tr.append(who);
      const group=text('td',row.server==null?'서버 미확인':`#${row.server}`);group.append(text('small',row.alliance||'연맹 미확인'));tr.append(group);
      tr.append(metric(row,'total_power'),metric(row,'migration_power'),text('td',date(row.observed_at)));
      const info=document.createElement('td'),details=document.createElement('details');details.className='dw-game-extra';details.append(text('summary','상세 항목'));
      const dl=document.createElement('dl');
      for(const [key,label] of [['army_power','병력'],['hero_power','영웅'],['building_power','건물'],['science_power','과학'],['pet_power','펫'],['vehicle_power','개조차'],['kills','킬수'],['base_level','기지 레벨']]){
        const dd=text('dd',row[key]==null?'—':row[key].toLocaleString('ko-KR'));if(row.field_observed_at?.[key])dd.title=date(row.field_observed_at[key]);dl.append(text('dt',label),dd);
      }
      details.append(dl,text('small',[...new Set(Object.values(row.field_source||{}))].join(' / ')));info.append(details);tr.append(info);body.append(tr);
    }
    table.append(body);box.append(table);
  }
  async function preview(raw,expectedRevision){
    if(busy)return;
    if(!permitted())throw new Error('승인된 기기와 입력 권한이 필요합니다.');
    if(expectedRevision!=null&&expectedRevision!==revision)return;
    revision++;pending=[];observations=[];mode='empty';render();
    const localTime=el('ObservedAt').value;
    if(localTime&&Number.isNaN(new Date(localTime).getTime()))throw new Error('관측 시각을 확인해 주세요.');
    const opts=localTime?{observedAt:new Date(localTime).toISOString()}:{};
    if(typeof raw!=='string'||new Blob([raw]).size>2*1024*1024)throw new Error('JSON 파일은 2MB 이하로 가져와 주세요.');
    const parsed=Core.normalize(JSON.parse(raw),opts);
    if(!parsed.length||parsed.length>500)throw new Error('한 번에 1~500개 관측 기록을 가져올 수 있습니다.');
    // Only whitelisted normalized objects survive preview; never retain raw tokens.
    pending=parsed;observations=parsed;mode='preview';el('Input').value='';el('File').value='';render();
    message(`${parsed.length}개 관측 기록을 검토했습니다. 저장 버튼을 누르기 전에는 서버에 보내지 않습니다.`);
  }
  el('Preview').onclick=()=>preview(el('Input').value).catch(error=>message(error.message,true));
  el('File').onchange=async event=>{
    const file=event.target.files?.[0];if(!file)return;
    if(busy||!permitted()){event.target.value='';return;}
    const request=++revision;pending=[];observations=[];mode='empty';render();
    try{
      if(file.size>2*1024*1024)throw new Error('JSON 파일은 2MB 이하로 가져와 주세요.');
      const raw=await file.text();
      if(request!==revision||!permitted()||busy)return;
      await preview(raw,request);
    }catch(error){if(request===revision&&permitted()){message(error.message,true);event.target.value='';}}
  };
  el('Clear').onclick=()=>{if(busy)return;revision++;pending=[];observations=[];mode='empty';el('Input').value='';el('File').value='';render();message('미리보기를 지웠습니다. 저장된 서버 기록은 삭제하지 않았습니다.');};
  function rpcError(error){
    if(error?.code==='PGRST202'||/Could not find the function|does not exist/.test(error?.message||''))return new Error('공유 저장 기능이 아직 설치되지 않았습니다. 관리자가 게임 데이터 추가 SQL을 먼저 적용해야 합니다. 미리보기와 내보내기는 사용할 수 있습니다.');
    if(error?.code==='42501')return new Error('현재 기기 또는 입력 권한으로는 조회·저장할 수 없습니다. 관리자에게 승인 상태를 확인해 주세요.');
    return new Error('서버 요청을 완료하지 못했습니다. 연결 상태를 확인하고 다시 시도해 주세요.');
  }
  async function loadRecords(auth){
    const {data,error}=await sb.rpc('dw_game_observations_list',{...auth,p_limit:loadLimit});if(error)throw rpcError(error);
    if(!Array.isArray(data))throw new Error('저장 기록 응답 형식을 확인해 주세요.');
    // Validate backend data again before rendering, retaining no raw fields.
    // RPC returns newest first. Reverse before merging so the newest import
    // wins for differing observations with the exact same capture timestamp.
    return data.length?Core.normalize({schema_version:1,observations:data.slice().reverse()}):[];
  }
  el('Load').onclick=async()=>{
    if(busy)return;if(pending.length&&!confirm('저장하지 않은 미리보기를 닫고 저장 기록을 불러올까요?'))return;
    const request=++revision;setBusy(true);message('저장 기록을 불러오는 중입니다.');
    try{const auth=await authorized(),rows=await loadRecords(auth);if(request!==revision)return;observations=rows;pending=[];mode='saved';render();message('저장 기록을 불러왔습니다. 게임 서버를 새로 조회한 것은 아닙니다.');}catch(error){message(error.message,true);}finally{setBusy(false);}
  };
  el('Save').onclick=async()=>{
    if(busy||!pending.length)return;
    const rows=pending.slice();
    if(!confirm(`${rows.length}개 관측 기록을 운영진 공유 저장소에 저장할까요? 기존 편대 투력은 변경하지 않습니다.`))return;
    const request=++revision;setBusy(true);message('기기 승인과 입력 권한을 확인하는 중입니다.');
    try{
      const auth=await authorized();
      const {data,error}=await sb.rpc('dw_game_observations_import',{...auth,p_rows:rows});if(error)throw rpcError(error);
      if(request!==revision)return;
      pending=[];mode='saved';
      const result=data||{};message(`저장 완료 · 신규 ${result.inserted??0}개 · 중복 ${result.duplicates??0}개`);
      try{const loaded=await loadRecords(auth);if(request!==revision||!permitted())return;observations=loaded;render();}catch(error){if(request!==revision||!permitted())return;observations=rows;render();message('저장은 완료됐지만 목록을 다시 불러오지 못했습니다. 저장 기록 불러오기를 눌러 확인해 주세요.',true);}
    }catch(error){message(error.message,true);}finally{setBusy(false);}
  };
  el('Search').oninput=render;el('Sort').onchange=render;
  function download(content,type,extension){
    const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`213-game-data-${new Date().toISOString().slice(0,10)}.${extension}`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  el('CSV').onclick=()=>{if(filtered.length)download('\ufeff'+Core.toCSV(filtered),'text/csv;charset=utf-8','csv');};
  el('JSON').onclick=()=>{
    if(!filtered.length)return;
    const uids=new Set(filtered.map(row=>row.uid));
    download(JSON.stringify({schema_version:1,observations:observations.filter(row=>uids.has(row.uid))},null,2),'application/json;charset=utf-8','json');
  };
  // Clear in-memory personal observations if the app revokes this device/tab.
  const originalApply=window.applyPerms;
  if(typeof originalApply==='function')window.applyPerms=function(...args){
    const result=originalApply.apply(this,args);panel.hidden=!permitted();
    if(!permitted()){revision++;pending=[];observations=[];mode='empty';el('Input').value='';el('File').value='';render();}
    else el('Save').disabled=busy||!pending.length;
    return result;
  };
  panel.hidden=!permitted();render();
})();
