/* Local capital battle board. No Supabase or Apps Script operations. */
(()=>{
  'use strict';
  const view=document.getElementById('view-tactical');if(!view)return;
  const season=view.querySelector('.tactical-frame-wrap');
  const controls=document.createElement('div');controls.className='strategy-tool-switch';controls.setAttribute('role','tablist');controls.setAttribute('aria-label','전략 도구 선택');
  controls.innerHTML='<button type="button" role="tab" data-strategy-tool="season" aria-selected="true">전략맵</button><button type="button" role="tab" data-strategy-tool="capital" aria-selected="false">수도전 / 최고의 전장</button>';
  const expand=document.createElement('button');expand.type='button';expand.className='strategy-fullscreen-toggle';expand.textContent='화면 확대';expand.setAttribute('aria-pressed','false');controls.append(expand);
  function setStrategyFullscreen(on){document.body.classList.toggle('strategy-fullscreen',on);expand.textContent=on?'화면 복귀':'화면 확대';expand.setAttribute('aria-pressed',String(on));requestAnimationFrame(syncTacticalViewport);}
  expand.onclick=()=>{if(authorized())setStrategyFullscreen(!document.body.classList.contains('strategy-fullscreen'));};
  addEventListener('keydown',event=>{if(event.key==='Escape')setStrategyFullscreen(false);});
  const panel=document.createElement('div');panel.className='capital-tool-panel';panel.hidden=true;
  const notice=document.createElement('p');notice.className='capital-host-note';notice.textContent=window.PREVIEW_ONLY?'가상 데이터 / 임시 작업':'개인 작업 / 이 브라우저에 저장';notice.title='운영진별 개인 배치입니다. 다른 기기나 운영진에게는 배치 백업 파일로 전달하세요.';notice.hidden=true;controls.append(notice);
  const frame=document.createElement('iframe');frame.id='capitalFrame';frame.title='213 수도전과 최고의 전장 배치 도구';frame.name='capitalFrame';frame.setAttribute('sandbox','allow-scripts allow-downloads allow-modals');frame.referrerPolicy='no-referrer';
  const status=document.createElement('div');status.className='capital-tool-status';status.hidden=true;status.setAttribute('role','status');
  panel.append(frame,status);view.prepend(controls);view.append(panel);
  window.activeStrategyTool='season';
  const draftKey='battle_layout_editor_v28_repaired_regions';
  let owner='',channel='',source='',epoch=0,loaded=false;
  const authorized=()=>deviceStatus==='approved'&&!!getEditor()&&canView('tactical');
  const scopedKey=()=>`213_capital_v1_${encodeURIComponent(owner)}`;
  const encode=value=>JSON.stringify(value).replace(/</g,String.fromCharCode(92)+'u003c');
  function childStorage(config){
    document.documentElement.classList.add('capital-embedded');
    const values=new Map();if(config.seed!==null)values.set(config.draftKey,config.seed);
    let revision=0;
    const changed=value=>parent.postMessage({type:'213-capital:draft',channel:config.channel,revision:++revision,value},config.parentOrigin);
    const storage={get length(){return values.size;},key:i=>[...values.keys()][i]??null,
      getItem:key=>values.has(String(key))?values.get(String(key)):null,
      setItem(key,value){if(!config.available)throw Error('Storage unavailable');key=String(key);value=String(value);values.set(key,value);if(key===config.draftKey)changed(value);},
      removeItem(key){values.delete(String(key));if(key===config.draftKey)changed(null);},
      clear(){values.clear();changed(null);}};
    Object.defineProperty(window,'localStorage',{value:storage});
    window.CAPITAL_PREVIEW=config.preview;
    window.CAPITAL_SESSION=config.channel;
    addEventListener('message',event=>{
      if(event.source!==parent||event.origin!==config.parentOrigin||event.data?.channel!==config.channel||event.data?.type!=='213-capital:saved'||event.data.revision!==revision)return;
      if(!event.data.ok)CAN_STORE=false;
      if(typeof updateSaveInfo==='function')updateSaveInfo(event.data.ok?'이 브라우저의 내 작업으로 저장했습니다.':'이 브라우저에 저장하지 못했습니다. 배치 백업으로 보관해 주세요.');
    });
  }
  function resetSession(){epoch++;owner='';channel='';loaded=false;frame.srcdoc='';}
  async function loadCapital(){
    if(!authorized())return;
    if(loaded&&owner===getEditor())return;
    if(owner&&owner!==getEditor())resetSession();
    owner=getEditor();const currentOwner=owner,request=++epoch;
    status.hidden=false;status.replaceChildren(document.createTextNode('수도전 도구를 불러오는 중입니다.'));
    try{
      if(!source){
        if(typeof window.__previewCapitalHTML==='string')source=window.__previewCapitalHTML;
        else{const response=await fetch('./capital.html',{credentials:'same-origin'});if(!response.ok)throw Error('HTTP '+response.status);source=await response.text();}
        if(!source.includes('window.CapitalBattleBoard='))throw Error('Invalid capital tool');
      }
      if(request!==epoch||!authorized()||currentOwner!==getEditor())return;
      let seed=null,available=true;try{seed=localStorage.getItem(scopedKey());}catch(_){available=false;}
      channel=crypto.randomUUID?.()||String(Date.now())+Math.random();
      frame.dataset.session=channel;
      const config={seed,available,draftKey,channel,parentOrigin:location.origin,preview:window.PREVIEW_ONLY===true};
      const bootstrap='('+childStorage.toString()+')('+encode(config)+');';
      frame.srcdoc=source.replace('<head>','<head><script>'+bootstrap+'<'+'/script>');loaded=true;status.hidden=true;
    }catch(error){
      loaded=false;status.replaceChildren(document.createTextNode('수도전 도구를 불러오지 못했습니다. 파일 배포 상태를 확인해 주세요. '));
      const retry=document.createElement('button');retry.type='button';retry.textContent='다시 불러오기';retry.onclick=()=>{source='';loadCapital();};status.append(retry);
    }
  }
  window.addEventListener('message',event=>{
    const data=event.data;
    if(event.source!==frame.contentWindow||event.origin!=='null'||data?.type!=='213-capital:draft'||data.channel!==channel)return;
    let ok=false;
    if(authorized()&&owner===getEditor())try{
      if(data.value===null)localStorage.removeItem(scopedKey());
      else{
        if(typeof data.value!=='string'||data.value.length>2*1024*1024)throw Error('Invalid draft');
        const state=JSON.parse(data.value);if(!Array.isArray(state?.objs)||state.objs.length>1200)throw Error('Invalid draft');
        localStorage.setItem(scopedKey(),data.value);
      }
      ok=true;
    }catch(_){}
    frame.contentWindow.postMessage({type:'213-capital:saved',channel,revision:data.revision,ok},'*');
  });
  function render(){
    const capital=window.activeStrategyTool==='capital';season.hidden=capital;panel.hidden=!capital;notice.hidden=!capital;
    controls.querySelectorAll('[data-strategy-tool]').forEach(button=>button.setAttribute('aria-selected',String(button.dataset.strategyTool===window.activeStrategyTool)));
    if(capital)loadCapital();requestAnimationFrame(syncTacticalViewport);
  }
  window.selectStrategyTool=tool=>{
    if(!authorized()){toast('승인된 전략맵 권한이 필요합니다.');return;}
    window.activeStrategyTool=tool==='capital'?'capital':'season';switchView('tactical');
  };
  controls.querySelectorAll('[data-strategy-tool]').forEach(button=>button.onclick=()=>selectStrategyTool(button.dataset.strategyTool));
  const originalSwitch=switchView;window.switchView=function(key){if(key!=='tactical')setStrategyFullscreen(false);originalSwitch(key);if(key==='tactical'&&authorized())render();};
  const originalPerms=applyPerms;window.applyPerms=function(){originalPerms();if(!authorized()||(owner&&owner!==getEditor())){resetSession();setStrategyFullscreen(false);}};
  let switchResizeFrame=0;
  new ResizeObserver(()=>{cancelAnimationFrame(switchResizeFrame);switchResizeFrame=requestAnimationFrame(()=>{const height=controls.getBoundingClientRect().height+'px';if(view.style.getPropertyValue('--strategy-switch-height')!==height)view.style.setProperty('--strategy-switch-height',height);});}).observe(controls);
})();
