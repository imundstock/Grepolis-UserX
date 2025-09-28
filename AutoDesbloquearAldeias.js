// AutoDesbloquearAldeias.js
// Adaptado para o BR79 ScriptHub (start/stop + ctx, sem diretivas de UserScript)

export const manifest = {
  version: '1.0.0',
  niceName: 'Auto Desbloquear Aldeias (ilha atual)',
  defaultSelected: true
};

let running = false;
let _ctx = null;

const CONFIG = {
  targetStage: 2,      // alvo mínimo de expansão (1->2)
  afterUnlockDelay: 500 // ms para dar tempo ao backend após o unlock
};

function log(...a){ _ctx?.log ? _ctx.log('[Aldeias]', ...a) : console.log('BR79p2 [Aldeias]', ...a); }
function wait(ms){ return _ctx?.wait ? _ctx.wait(ms) : new Promise(r=>setTimeout(r, ms)); }
function softStop(){ return !!(_ctx && _ctx.softStopFlag && _ctx.softStopFlag()); }

async function waitForReady(timeoutMs=20000){
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs){
    // objetos essenciais carregados?
    if (window.Game?.townId &&
        window.ITowns?.towns &&
        window.MM?.getCollections?.() &&
        window.MM.getCollections().FarmTown?.[0]?.models?.length >= 0 &&
        window.MM.getCollections().FarmTownPlayerRelation?.[0]?.models?.length >= 0 &&
        window.gpAjax) {
      return true;
    }
    if (softStop()) return false;
    await wait(200);
  }
  return false;
}

function ajaxExecute(model_url, action_name, args, town_id){
  return new Promise((resolve, reject)=>{
    window.gpAjax.ajaxPost(
      'frontend_bridge','execute',
      { model_url, action_name, arguments: args, town_id },
      ()=>resolve(true),
      ()=>reject(new Error('ajaxPost error'))
    );
  });
}

async function unlock(polisID, farmTownPlayerID, ruralID){
  await ajaxExecute(`FarmTownPlayerRelation/${farmTownPlayerID}`, 'unlock', { farm_town_id: ruralID }, polisID);
  log(`✅ Desbloqueada aldeia ${ruralID} (cidade ${polisID})`);
}

async function upgrade(polisID, farmTownPlayerID, ruralID, target=CONFIG.targetStage){
  await ajaxExecute(`FarmTownPlayerRelation/${farmTownPlayerID}`, 'upgrade', { farm_town_id: ruralID }, polisID);
  log(`⬆️ Upgrade pedido para aldeia ${ruralID} → nível ${target} (cidade ${polisID})`);
}

async function processIslandForCurrentTown(){
  const polisID = window.Game.townId;
  const town = window.ITowns.towns[polisID];
  const islandX = town.getIslandCoordinateX();
  const islandY = town.getIslandCoordinateY();

  const aldeias = window.MM.getCollections().FarmTown?.[0]?.models || [];
  const relacoes = window.MM.getCollections().FarmTownPlayerRelation?.[0]?.models || [];

  let actions = 0;

  for (let i=0; i<aldeias.length; i++){
    if (softStop() || !running) break;

    const aldeia = aldeias[i];
    const ax = aldeia.attributes.island_x;
    const ay = aldeia.attributes.island_y;
    if (ax !== islandX || ay !== islandY) continue;

    const ruralID = aldeia.id;

    // encontrar a relação player<->aldeia correspondente
    const rel = relacoes.find(r => r.getFarmTownId?.() === ruralID);
    if (!rel) continue;

    const farmTownPlayerID = rel.id;
    const relationStatus = rel.attributes?.relation_status ?? 0; // 0 = bloqueada
    const stage = rel.attributes?.expansion_stage ?? 1;

    try{
      if (relationStatus === 0){
        await unlock(polisID, farmTownPlayerID, ruralID);
        actions++;
        if (softStop() || !running) break;

        await wait(CONFIG.afterUnlockDelay);
        if ((rel.attributes?.expansion_stage ?? 1) < CONFIG.targetStage){
          await upgrade(polisID, farmTownPlayerID, ruralID, CONFIG.targetStage);
          actions++;
        }
      } else if (stage < CONFIG.targetStage){
        await upgrade(polisID, farmTownPlayerID, ruralID, CONFIG.targetStage);
        actions++;
      }
    }catch(err){
      log('⚠️ Falha ao operar aldeia', ruralID, err?.message||err);
    }

    // respiro curto entre aldeias para não saturar
    await wait(150);
  }

  log(`Concluído na ilha atual de "${town.name}" — ações executadas: ${actions}`);
}

export async function start(ctx){
  if (running) return;
  running = true;
  _ctx = ctx || _ctx;

  const ready = await waitForReady();
  if (!ready){
    log('Jogo não ficou pronto; abortando.');
    running = false;
    return;
  }

  try{
    await processIslandForCurrentTown();
  } finally {
    running = false;
    log('Finalizado.');
  }
}

export function stop(){
  // laço é curto e verifica running/softStop entre passos
  running = false;
}
