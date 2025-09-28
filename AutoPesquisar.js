// AcademyPlannerAutoResearch.js
// Adaptado para o BR79 ScriptHub (start/stop + ctx, sem diretivas de UserScript)

export const manifest = {
  version: '0.2.0',
  niceName: 'Academy Planner (auto research)',
  defaultSelected: true
};

let running = false;
let _ctx = null;

// ===== Config =====
const CONF = {
  seedForMultiAccount: true,        // semeia lista padrão por cidade quando vazia
  tickMs: 60000,                    // intervalo entre tentativas de pesquisa
  cssId: 'gap-styles',              // id do <style> para remoção no stop()
  ns: 'GAP',                        // namespace para observers jQuery
  initialDelayMs: 3000
};

// ===== Helpers de contexto =====
const wait = (ms)=> _ctx?.wait ? _ctx.wait(ms) : new Promise(r=>setTimeout(r,ms));
const log  = (...a)=> _ctx?.log ? _ctx.log('[Academy]', ...a) : console.log('BR79p2 [Academy]', ...a);
const softStop = ()=> !!(_ctx && _ctx.softStopFlag && _ctx.softStopFlag());

// ===== Estado/recursos do script =====
let currentResearchIndex = 0;
let currentAcademyWindow = null;
let academyObserver = null;

// para facilitar unsubscribe/cleanup
let boundAjaxComplete = null;
let observersBound = false;

// jQuery/unsafeWindow
const uw = (typeof unsafeWindow === 'undefined' ? window : unsafeWindow);
const $J = uw.jQuery || uw.$;

// STORAGE por mundo
const STORAGE_KEY = ()=> (uw.Game?.world_id || 'WORLD') + '_RESEARCHES';

// ====== Utils de janela (patch seguro) ======
function getWndHandler(anyWnd){
  if (!anyWnd) return null;
  if (typeof anyWnd.getID === 'function') return anyWnd;
  if (anyWnd.wnd && typeof anyWnd.wnd.getID === 'function') return anyWnd.wnd;
  if (typeof anyWnd === 'number') return uw.GPWindowMgr?.getWindowById?.(anyWnd) || null;
  const id = anyWnd.wnd_id ?? anyWnd.id ?? (anyWnd.wnd && anyWnd.wnd.id);
  if (id != null) return uw.GPWindowMgr?.getWindowById?.(parseInt(id,10)) || null;
  return null;
}
function wndTypeOf(anyWnd){
  const wnd = getWndHandler(anyWnd);
  if (!wnd) return null;
  if (typeof wnd.getType === 'function') return wnd.getType();
  try { return wnd.getHandler?.().getType?.() ?? null; } catch { return null; }
}
function getWindowByTypeSafe(type){
  try {
    const list = uw.WM?.getWindowByType?.(type) || [];
    if (Array.isArray(list) && list.length) return list[0];
  } catch {}
  try {
    const all = uw.GPWindowMgr?.getOpenWindows?.() || [];
    for (const w of all){ if (wndTypeOf(w) === type) return getWndHandler(w); }
  } catch {}
  return null;
}

// ====== Persistência ======
function loadAll(){ try { return JSON.parse(localStorage.getItem(STORAGE_KEY()) || '{}'); } catch { return {}; } }
function saveAll(obj){ localStorage.setItem(STORAGE_KEY(), JSON.stringify(obj||{})); }
function loadResearches(townId){
  const all = loadAll(); return all[townId] || [];
}
function saveResearches(townId, arr){
  const all = loadAll(); all[townId] = arr; saveAll(all);
}

// ====== Seeding inicial por cidade (opcional) ======
function seedDefaultPerTown(){
  if (!CONF.seedForMultiAccount) return;
  const defaults = [
    'slinger','town_guard','booty_bpv','architecture','shipwright','building_crane',
    'colonize_ship','pottery','bireme'
  ];
  const towns = uw.ITowns?.towns || {};
  let updated = 0;
  Object.keys(towns).forEach(id=>{
    const all = loadAll();
    const cur = all[id] || [];
    if (cur.length === 0){ all[id] = [...defaults]; updated++; }
    saveAll(all);
  });
  if (updated) log('seed aplicado em', updated, 'cidades');
}

// ====== Estilos ======
function injectCss(){
  if (document.getElementById(CONF.cssId)) return;
  const style = document.createElement('style');
  style.id = CONF.cssId;
  style.textContent = `
    .GAP_highlight_inactive::after {
      content: '';
      position: absolute;
      width: 100%;
      height: 100%;
      background-color: rgba(0, 255, 0, 0.5);
    }
    .GAP_highlight_active {
      border: 1px solid rgba(0, 255, 0, 1);
    }
  `;
  document.head.appendChild(style);
}
function removeCss(){
  const el = document.getElementById(CONF.cssId);
  if (el) el.remove();
}

// ====== jQuery Observers / Ajax hooks ======
function bindObservers(){
  if (observersBound || !$J?.Observer) return;
  observersBound = true;

  // game.load -> attach ajax listener
  $J.Observer(uw.GameEvents.game.load).subscribe(`${CONF.ns}_load`, attachAjaxListener);

  // window open/close
  $J.Observer(uw.GameEvents.window.open).subscribe(`${CONF.ns}_window_open`, (e, raw)=>{
    const wnd = getWndHandler(raw); if (!wnd) return;
    if (wndTypeOf(wnd) === 'academy'){
      currentAcademyWindow = wnd;
      openAcademy(wnd);
    }
  });

  $J.Observer(uw.GameEvents.window.close).subscribe(`${CONF.ns}_window_close`, (e, raw)=>{
    const wnd = getWndHandler(raw); if (!wnd) return;
    if (wndTypeOf(wnd) === 'academy'){
      currentAcademyWindow = null;
      if (academyObserver){ academyObserver.disconnect(); academyObserver = null; }
    }
  });

  // troca de cidade -> re-render
  $J.Observer(uw.GameEvents.town.town_switch).subscribe(`${CONF.ns}_town_switch`, resetAcademy);

  // ajax global (para atualizações da janela academia)
  const onAjaxComplete = function(e, xhr, opt){
    try{
      const url = opt?.url || '';
      const [path, qs] = url.split('?');
      const action = (path||'').substr(5);
      if (!qs) return;

      const params = new URLSearchParams(qs);
      const fbType = params.get('window_type');

      if ((action === 'frontend_bridge/fetch' || action === 'notify/fetch') &&
          (fbType === 'academy' || currentAcademyWindow)){
        const wnd = currentAcademyWindow || getWindowByTypeSafe('academy');
        if (wnd) setTimeout(()=> openAcademy(wnd), 100);
      }
    }catch{}
  };
  boundAjaxComplete = onAjaxComplete;
  $J(document).on('ajaxComplete', boundAjaxComplete);
}

function unbindObservers(){
  if (!$J?.Observer) return;
  $J.Observer(uw.GameEvents.game.load).unsubscribe(`${CONF.ns}_load`);
  $J.Observer(uw.GameEvents.window.open).unsubscribe(`${CONF.ns}_window_open`);
  $J.Observer(uw.GameEvents.window.close).unsubscribe(`${CONF.ns}_window_close`);
  $J.Observer(uw.GameEvents.town.town_switch).unsubscribe(`${CONF.ns}_town_switch`);
  observersBound = false;

  if (boundAjaxComplete){ $J(document).off('ajaxComplete', boundAjaxComplete); boundAjaxComplete = null; }
  if (academyObserver){ academyObserver.disconnect(); academyObserver = null; }
}

// ====== Lógica principal ======
function getTownId(){ return uw.Game?.townId; }

function toggleResearch(research, element, isInactive){
  const tid = getTownId(); if (!tid) return;
  const list = loadResearches(tid);
  const idx = list.indexOf(research);

  if (idx >= 0){
    list.splice(idx,1);
    removeClass(element);
  }else{
    list.push(research);
    if (isInactive) addClassInactive(element); else addClassActive(element);
    tryAutoResearch(research, tid);
  }
  saveResearches(tid, list);
}

function tryAutoResearch(research, townIdOverride = null){
  const townId = townIdOverride || getTownId();
  const town = uw.ITowns?.getTown?.(townId);
  if (!town || !research) return;

  let resKey = research;
  if (resKey.endsWith('_old')) resKey = resKey.replace('_old','');
  if (resKey.endsWith('_bpv')) resKey = resKey.replace('_bpv','');

  const academyLvl = town.buildings()?.attributes?.academy;
  if (!academyLvl) return;

  const techs = town.researches()?.attributes || {};
  const qa = uw.MM.getFirstTownAgnosticCollectionByName('ResearchOrder');
  const queue = qa?.fragments?.[townId]?.models || [];
  const queueLimit = uw.GameDataPremium?.isAdvisorActivated?.('curator') ? 7 : 2;

  // já pesquisado ou na fila?
  if (techs[resKey]) {
    // remover dos salvos e tirar highlight
    const list = loadResearches(townId);
    const idx = list.indexOf(resKey);
    if (idx >= 0){ list.splice(idx,1); saveResearches(townId, list); }
    if (currentAcademyWindow){
      const sel = '#window_'+currentAcademyWindow.getIdentifier();
      const el = (uw.$)(sel).find(`.research.${resKey}`)[0];
      if (el) removeClass(el);
    }
    return;
  }
  if (queue.length >= queueLimit) return;
  if (queue.some(m => m?.attributes?.research_type === resKey)) return;

  const reqsTech = uw.GameData?.researches?.[resKey];
  if (!reqsTech){
    // não existe mais -> remover
    const list = loadResearches(townId);
    const idx = list.indexOf(resKey);
    if (idx >= 0){ list.splice(idx,1); saveResearches(townId, list); }
    log(`Pesquisa "${resKey}" inexistente no GameData — removida da lista.`);
    return;
  }

  // pontos de pesquisa disponíveis
  const perLevel = uw.GameDataResearches?.getResearchPointsPerAcademyLevel?.() || 0;
  let available = (town.getBuildings().getBuildingLevel('academy')|0) * perLevel;
  Object.keys(uw.GameData.researches||{}).forEach(k=>{
    if (town.getResearches().get(k)) available -= uw.GameData.researches[k].research_points;
  });
  available = Math.max(0, available);

  const {wood,stone,iron} = town.resources();

  // requisitos
  if (!reqsTech.building_dependencies || !reqsTech.resources) return;
  if ((academyLvl|0) < (reqsTech.building_dependencies.academy|0)) return;
  if (available < (reqsTech.research_points|0)) return;
  if (wood < reqsTech.resources.wood || stone < reqsTech.resources.stone || iron < reqsTech.resources.iron) return;

  const data = {
    model_url: 'ResearchOrder',
    action_name: 'research',
    captcha: null,
    arguments: { id: resKey },
    town_id: townId,
    nl_init: true
  };

  uw.gpAjax.ajaxPost('frontend_bridge','execute', data, false, (resp)=>{
    if (resp && typeof resp.success === 'string' && resp.success.includes('começou')){
      const list = loadResearches(townId);
      const idx = list.indexOf(resKey);
      if (idx >= 0){ list.splice(idx,1); saveResearches(townId, list); }
      log('Pesquisa iniciada:', resKey, 'na cidade', townId);
    }
  });
}

// Render da Academia com destaques + clique para toggle
function openAcademy(wnd){
  const selector = '#window_'+wnd.getIdentifier();
  let retries = 0;

  function tryRender(){
    const $techTree = $J(selector).find('.tech_tree_box');
    if ($techTree.length === 0){
      if (retries++ < 15) return setTimeout(tryRender, 200);
      return;
    }

    const tid = getTownId();
    const saved = tid ? loadResearches(tid) : [];

    // limpa marcas
    $techTree.find('div.research').each((_, el)=> removeClass(el));

    $techTree.find('div.research').each((_, el)=>{
      const $el = $J(el);
      const classes = ($el.attr('class')||'').split(/\s+/);
      const research = classes.find(c => c !== 'research' && !c.startsWith('type_')) || classes[2];
      const isInactive = $el.hasClass('inactive');

      $el.off('click.GAP').on('click.GAP', (e)=>{
        e.preventDefault(); e.stopPropagation();
        toggleResearch(research, el, isInactive);
      });

      if (saved.includes(research)){
        if (isInactive) addClassInactive(el); else addClassActive(el);
      }
    });

    setupAcademyObserver(selector);
  }

  tryRender();
}

function setupAcademyObserver(selector){
  if (academyObserver) academyObserver.disconnect();

  const node = $J(selector)[0];
  if (!node) return;

  academyObserver = new MutationObserver((mutations)=>{
    let shouldReapply = false;

    for (const m of mutations){
      if (m.type === 'childList'){
        const nodes = [...m.addedNodes, ...m.removedNodes];
        const changed = nodes.some(n=>{
          if (n.nodeType !== 1) return false;
          return (n.matches && (n.matches('.tech_tree_box') || n.matches('.research')))
              || (n.querySelector && (n.querySelector('.tech_tree_box') || n.querySelector('.research')));
        });
        if (changed) shouldReapply = true;
      }
      if (m.type === 'attributes' && m.attributeName === 'class'){
        const t = m.target;
        if (t.matches && (t.matches('.t
