/* Display the host's existing permissions; never change editing policy. */
(()=>{
  const style=document.createElement('style');style.textContent=`
    .app{height:100dvh!important;min-height:0!important;max-height:100dvh!important;overflow:hidden!important}
    .workspace{flex:1 1 0!important;min-height:0!important;height:auto!important;grid-template-rows:minmax(0,1fr)}
    .mapwrap{min-height:0!important;overflow:hidden!important}
    .panel{min-height:0!important}
    body #tools{min-height:0!important;flex-wrap:nowrap!important;scrollbar-width:thin!important;scrollbar-color:#8b9cb3 #152033!important;overscroll-behavior:contain}
    body #tools::-webkit-scrollbar{display:block!important;width:8px!important;height:8px!important}
    body #tools::-webkit-scrollbar-thumb{background:#8b9cb3;border:2px solid #152033;border-radius:8px}
    body #tools .tool-button{flex-shrink:0!important}
    .tactical-mode-banner{display:flex;flex-shrink:0;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;background:#142033;color:#dfebff;border:1px solid #35445c;font-family:inherit;font-weight:700;font-size:14px;line-height:1.5}
    .tactical-mode-banner[data-kind="view"]{border-color:#3e8b77;background:#102820}
    .tactical-mode-banner[data-kind="shared"]{border-color:#bf8046;background:#302213}
    .tactical-mode-banner small{font-size:12px;font-weight:500}
    .tactical-tool-groups{display:none;flex-shrink:0;gap:5px;padding:7px;background:#111925}
    .tactical-tool-groups button{min-height:44px;min-width:0;border:1px solid #35445c;border-radius:8px;background:#192335;color:#d9e4f4;font-family:inherit;font-weight:700;font-size:13px;line-height:1.4}
    .tactical-tool-groups button[aria-pressed="true"]{border-color:#f2c14e;color:#ffde8a;background:#30291b}
    .tactical-inspector-heading,.tactical-inspector-backdrop{display:none}
    @media(max-width:1000px){
      #btnRight{min-width:108px!important;min-height:44px!important;height:auto!important;padding:8px 10px!important;white-space:nowrap!important;font-size:13px!important;font-weight:750!important;flex:0 0 auto!important}
      #panelRight .tactical-inspector-heading{display:flex;position:sticky;top:0;z-index:20;align-items:center;justify-content:space-between;gap:8px;min-height:52px;padding:4px 0 10px;margin-bottom:10px;background:#1b232e;border-bottom:1px solid #3a4655}
      .tactical-inspector-heading strong{font-size:14px;color:#ffdf97}
      #tacticalInspectorClose{min-width:64px;min-height:44px;padding:8px 12px;border:1px solid #9b7b36;border-radius:8px;background:#30291b;color:#ffdf97;font-family:inherit;font-size:14px;line-height:1.4;font-weight:750;cursor:pointer;white-space:nowrap}
      #panelRight .right-tabs{position:static!important;margin:0 0 12px!important;padding:0 0 10px!important}
      .tactical-inspector-backdrop:not([hidden]){display:block;position:absolute;inset:0;z-index:59;border:0;padding:0;background:rgba(4,8,14,.34);cursor:pointer}
    }
    @media(max-width:720px){
      .tactical-tool-groups{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
      #tools .tool-button[data-ui-hidden="true"]{display:none!important}
      #tools .tool-button{min-height:44px!important;font-size:13px!important;white-space:nowrap}
      #tools{scrollbar-width:thin;scrollbar-color:#f2c14e #152033}
      .tactical-mode-banner{font-size:13px;padding:8px 10px}
      .tactical-mode-banner small{font-size:12px}
    }
    @media(max-height:480px){
      .tactical-mode-banner{padding:6px 10px;font-size:13px}
      .tactical-mode-banner small,.tactical-tool-groups{display:none!important}
      body.embedded .topbar{display:flex!important;flex-wrap:nowrap!important;min-height:44px!important;height:auto!important;padding:5px!important;gap:5px!important}
      body.embedded .topbar .scenario{display:none!important}
      body.embedded .topbar-actions{display:flex!important;flex:1 1 auto!important;flex-wrap:nowrap!important;overflow-x:auto!important;min-width:0!important;gap:5px!important}
      body.embedded .topbar-actions .tb{flex:0 0 auto!important}
    }
  `;document.head.append(style);
  const tools=document.getElementById('tools');if(!tools)return;
  tools.tabIndex=0;tools.setAttribute('aria-label','전략맵 도구 목록 / 스크롤하여 전체 도구 보기');
  tools.title='휠이나 스크롤 막대로 나머지 도구를 볼 수 있습니다.';
  const banner=document.createElement('div');banner.className='tactical-mode-banner';banner.setAttribute('role','status');
  const title=document.createElement('strong'),description=document.createElement('small');banner.append(title,description);
  const anchor=tools.closest('.workspace')||tools;anchor.before(banner);
  const groups=document.createElement('div');groups.className='tactical-tool-groups';groups.setAttribute('aria-label','전략맵 도구 분류');anchor.before(groups);
  let selected='all';
  const categories=[['all','전체'],['navigate','이동/선택'],['build','배치/점령'],['draw','지형/표시']];
  function classify(b){const t=b.dataset.tool||b.dataset.ttool;if(!t||['select','pan'].includes(t))return 'navigate';return ['place','claim','site','shelter'].includes(t)?'build':'draw';}
  function filter(){const active=innerHeight<=480?'all':selected;tools.querySelectorAll('.tool-button').forEach(b=>b.dataset.uiHidden=String(active!=='all'&&classify(b)!==active));groups.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.group===active)));}
  addEventListener('resize',filter);
  categories.forEach(([key,label])=>{const b=document.createElement('button');b.type='button';b.dataset.group=key;b.textContent=label;b.onclick=()=>{selected=key;filter();};groups.append(b);});filter();
  const inspector=document.getElementById('panelRight'),inspectorToggle=document.getElementById('btnRight');
  if(inspector&&inspectorToggle){
    const drawerMedia=matchMedia('(max-width:1000px)');
    const heading=document.createElement('div');heading.className='tactical-inspector-heading';
    const headingLabel=document.createElement('strong');headingLabel.textContent='현황 / 선택 항목 편집';
    const close=document.createElement('button');close.id='tacticalInspectorClose';close.type='button';close.textContent='닫기';close.setAttribute('aria-label','편집창 닫기');
    heading.append(headingLabel,close);inspector.prepend(heading);
    const backdrop=document.createElement('button');backdrop.type='button';backdrop.className='tactical-inspector-backdrop';backdrop.hidden=true;backdrop.tabIndex=-1;backdrop.setAttribute('aria-label','편집창 닫기');
    inspector.before(backdrop);inspectorToggle.setAttribute('aria-controls','panelRight');
    function syncInspectorDrawer(){
      const open=inspector.classList.contains('open'),shown=!drawerMedia.matches||open;
      inspectorToggle.textContent=open?'편집창 닫기':'편집창 열기';
      inspectorToggle.setAttribute('aria-expanded',String(open));inspectorToggle.setAttribute('aria-label',inspectorToggle.textContent);inspectorToggle.title=inspectorToggle.textContent;
      inspector.setAttribute('aria-hidden',String(!shown));inspector.inert=!shown;backdrop.hidden=!drawerMedia.matches||!open;
    }
    function closeInspectorDrawer(){
      if(!drawerMedia.matches||!inspector.classList.contains('open'))return;
      inspector.classList.remove('open');syncInspectorDrawer();
      if(inspectorToggle.getClientRects().length)inspectorToggle.focus({preventScroll:true});
    }
    const originalToggle=inspectorToggle.onclick;
    inspectorToggle.onclick=function(event){
      const opening=!inspector.classList.contains('open');
      if(originalToggle)originalToggle.call(this,event);else inspector.classList.toggle('open');
      syncInspectorDrawer();if(opening&&drawerMedia.matches)close.focus({preventScroll:true});
    };
    close.onclick=closeInspectorDrawer;backdrop.onclick=closeInspectorDrawer;
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!event.defaultPrevented&&drawerMedia.matches&&inspector.classList.contains('open')){event.preventDefault();closeInspectorDrawer();}});
    new MutationObserver(syncInspectorDrawer).observe(inspector,{attributes:true,attributeFilter:['class']});
    drawerMedia.addEventListener('change',syncInspectorDrawer);syncInspectorDrawer();
  }
  function render(data={}){
    const policy=window.__tacticalHost?.policy||{};
    const mode=data.viewMode||policy.viewMode,workspace=data.workspaceId??policy.workspaceId;
    if(!workspace){title.textContent='작업공간 미선택';description.textContent='서버와 연맹 작업공간을 선택해 주세요.';banner.dataset.kind='view';return;}
    const labels={shared:['공용 지도 / 보기 전용','이 화면에서는 지도 내용을 변경하지 않습니다.','view'],personal:['개인 작업본 / 편집','수정 내용은 내 작업본에 저장됩니다. 공용 게시와 구분해 주세요.','personal'],'shared-edit':['공용 지도 / 공동편집','저장하면 다른 운영진이 보는 공용 지도가 변경됩니다.','shared'],project:['공유 작업본 / 보기 전용','공동편집을 시작하기 전에는 내용을 변경하지 않습니다.','view'],'project-edit':['공유 작업본 / 공동편집','공동 저장으로 이 공유 작업본에 반영됩니다.','shared']};
    const [label,help,kind]=labels[mode]||labels.shared;title.textContent=label;description.textContent=help;banner.dataset.kind=kind;
  }
  addEventListener('message',event=>{
    if(event.source!==parent||(location.origin!=='null'&&event.origin!==location.origin))return;
    if(['nxt-tactical-map:configure','nxt-tactical-map:workspace-context'].includes(event.data?.type))render(event.data);
  });render();
  const stage=document.getElementById('stage');
  let lastStageWidth=0;
  if(stage)new ResizeObserver(()=>{
    const {width,height}=stage.getBoundingClientRect(),refit=lastStageWidth===0||Math.abs(width-lastStageWidth)>1;
    lastStageWidth=width;if(width<=0||height<=0)return;
    requestAnimationFrame(()=>{dispatchEvent(new Event('resize'));if(refit&&window.__app?.S?.mapMode==='world')window.__app.fit();});
  }).observe(stage);
})();
