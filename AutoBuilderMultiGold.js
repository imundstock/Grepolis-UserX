// AutoBuilderMultiGold.js
// Adaptado para o BR79 ScriptHub (start/stop + ctx, sem @match/@grant)

// Manifesto lido pelo Hub (opcional)
export const manifest = {
  version: '1.1.0',
  niceName: 'AutoBuilder Multi Gold',
  defaultSelected: true
};

// ================== CONFIG ==================
const CONFIG = {
  // Nome do grupo de cidades (quando Curador estiver ativo).
  // Use 'Todos' para não filtrar (ou caso o grupo não exista).
  buildingTownGroupName: 'Todos',

  // Janela entre execuções completas (ms)
  minTimeBetweenRuns: 1000 * 60 * 5,
  maxTimeBetweenRuns: 1000 * 60 * 10,

  // Janela entre construções individuais (ms)
  minTimeBetweenBuildings: 1000,
  maxTimeBetweenBuildings: 5000
};

// Roteiro de prioridades (alvos por estágio)
const instructions = [
  { lumber: 1, stoner: 1, ironer: 1, temple: 1, farm: 2 },
  { lumber: 2, storage: 2, main: 2, farm: 3, barracks: 1 },
  { stoner: 2, ironer: 2 },
  { lumber: 3, stoner: 3, ironer: 3, temple: 3 },
  { storage: 5, main: 5, farm: 6 },
  { market: 5, barracks: 5 },
  { stoner: 7, lumber: 7, ironer: 7 },
  { main: 8},
  { academy: 7 },
  { main: 14, barracks: 5, farm: 11, storage: 13, academy: 13 },
  { stoner: 10, lumber: 15, ironer: 10 },
  { docks: 10 },
];

// ================== STATE ==================
let running = false;
let _ctx = null;
const blackList = []; // ordens que falharam nesta sessão (evita loop)

// ================== UTILS ==================
const randBetween = (min, max) => Math.floor(Math.random() * (max - min)) + min;

function compareResources(a, b){
  return (a.wood + a.iron + a.stone) >= (b.wood + b.iron + b.stone);
}
function hasEnough(resources, need){
  return resources.wood >= need.wood && resources.iron >= need.iron && resources.stone >= need.stone;
}
function isBlackListed(name, level, town){
  return !!blackList.find(e => e.name===name && e.level===level && e.town===town);
}

function wait(ms){
  // usa util do Hub se existir
  return _ctx?.wait ? _ctx.wait(ms) : new Promise(r => setTimeout(r, ms));
}

function softStop(){ return !!(_ctx && _ctx.softStopFlag && _ctx.softStopFlag()); }

function log(...a){ _ctx?.log ? _ctx.log('[Builder]', ...a) : console.log('BR79p2 [Builder]', ...a); }

async function waitForGameReady(timeoutMs=20000){
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs){
    if (window.Game && window.MM && window.ITowns && window.gpAjax) return true;
    await wait(200);
    if (softStop()) return false;
  }
  return !!(window.Game && window.MM && window.ITowns && window.gpAjax);
}

function isCuratorEnabled(){
  try {
    const cur = window.Game?.premium_features?.curator;
    return typeof cur === 'number' && cur > Date.now()/1000;
  } catch { return false; }
}

function resolveGroupIdByName(name){
  try{
    const grp = window.ITowns?.town_groups?.models?.find(m => m.getName() === name);
    return grp ? grp.id : 0;
  }catch{ return 0; }
}

function getBuildingModels(){
  const models = Object.values(window.MM.getModels().BuildingBuildData || {});
  // cada item tem .attributes com { id (townId), building_data, is_building_order_queue_full }
  return models.map(m => m.attributes);
}

function findBuildingsTargets(buildingData){
  return instructions.find(targets =>
    Object.entries(targets).some(([name, level]) => buildingData[name]?.level < level)
  );
}

function townShouldBuild(name, wantedLevel, townId, data){
  if (!data) return false;
  if (isBlackListed(name, data.next_level, townId)) return false;
  const res = window.ITowns.towns[townId].resources();
  if (!hasEnough(res, data.resources_for)) return false;
  return data.level < wantedLevel;
}

function findBuildingOrder(targets, buildingData, townId){
  return Object.entries(targets).reduce((order, [name, level])=>{
    const data = buildingData[name];
    const can = townShouldBuild(name, level, townId, data);
    if (!can) return order;
    if (!order) return { name, level: data.next_level, town: townId };
    return compareResources(buildingData[order.name].resources_for, data.resources_for)
      ? { name, level: data.next_level, town: townId }
      : order;
  }, null);
}

function collectOrders(groupId){
  const models = getBuildingModels();
  const curator = isCuratorEnabled();
  return models.reduce((orders, m)=>{
    const townId = m.id;
    const data = m.building_data;
    if (!data) return orders;
    if (m.is_building_order_queue_full) return orders;
    if (curator && groupId && !window.ITowns.town_group_towns.hasTown(groupId, townId)) return orders;

    const targets = findBuildingsTargets(data);
    if (!targets) return orders;

    const order = findBuildingOrder(targets, data, townId);
    if (order) orders.push(order);
    return orders;
  }, []);
}

function buildOrder(order){
  return new Promise((resolve, reject)=>{
    window.gpAjax.ajaxPost('frontend_bridge', 'execute', {
      model_url: 'BuildingOrder',
      action_name: 'buildUp',
      arguments: { building_id: order.name },
      town_id: order.town
    }, false, {
      success: resolve,
      error: reject
    });
  });
}

// ================== CORE LOOP ==================
async function cycle(groupId){
  const minB = CONFIG.minTimeBetweenBuildings|0, maxB = CONFIG.maxTimeBetweenBuildings|0;
  const minR = CONFIG.minTimeBetweenRuns|0,       maxR = CONFIG.maxTimeBetweenRuns|0;

  while (running && !softStop()){
    const orders = collectOrders(groupId);
    log('ordens coletadas:', orders.length);

    for (const order of orders){
      if (!running || softStop()) break;

      try{
        await buildOrder(order);
        log(`Construindo ${order.name} lvl ${order.level} em ${window.ITowns.towns[order.town].name}`);
      }catch(err){
        log('Falha ao construir, adicionando à blacklist', order, err?.message||err);
        blackList.push(order);
      }

      const delayB = randBetween(minB, Math.max(minB+1, maxB));
      for (let t=0; t<delayB; t+=200){
        if (!running || softStop()) break;
        await wait(200);
      }
    }

    // intervalo entre ciclos
    const delayR = randBetween(minR, Math.max(minR+1, maxR));
    log('esperando', Math.round(delayR/1000), 's até próximo ciclo');

    for (let t=0; t<delayR; t+=500){
      if (!running || softStop()) return;
      await wait(500);
    }
  }
}

// ================== API esperada pelo Hub ==================
export async function start(ctx){
  if (running) return; // idempotente
  _ctx = ctx || _ctx;
  running = true;

  const ready = await waitForGameReady();
  if (!ready){
    log('Game não ficou pronto a tempo; abortando');
    running = false;
    return;
  }

  // Curador + grupo
  let groupId = 0;
  if (CONFIG.buildingTownGroupName && isCuratorEnabled()){
    groupId = resolveGroupIdByName(CONFIG.buildingTownGroupName) || 0;
    log('Grupo alvo:', CONFIG.buildingTownGroupName, '-> id:', groupId);
  } else {
    log('Curador inativo ou sem grupo válido; executando em todas as cidades visíveis');
  }

  try{
    await cycle(groupId);
  } finally {
    running = false;
    log('Finalizado');
  }
}

export function stop(){
  running = false; // o loop verifica este flag e ctx.softStopFlag()
}
