// AutoMissoesHeraWedding.js
// Adaptado para o BR79 ScriptHub (start/stop + ctx, sem diretivas de UserScript)

export const manifest = {
  version: '1.0.0',
  niceName: 'Auto Missões + Hera Wedding',
  defaultSelected: true
};

let running = false;
let _ctx = null;

const STOP_ON_QUEST_ID = 'CastPowerQuest'; // nunca aceitar
const TICK_MS = 5000;
const STORAGE_MARGIN = 50; // margem para não lotar armazém

/* ================= helpers de contexto ================= */
const wait = (ms)=> _ctx?.wait ? _ctx.wait(ms) : new Promise(r=>setTimeout(r,ms));
const log  = (...a)=> _ctx?.log ? _ctx.log('[Quests]', ...a) : console.log('BR79p2 [Quests]', ...a);
const softStop = ()=> !!(_ctx && _ctx.softStopFlag && _ctx.softStopFlag());

async function waitForReady(timeoutMs=20000){
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs){
    if (window.Game && window.ITowns && window.MM && window.gpAjax) return true;
    if (softStop()) return false;
    await wait(200);
  }
  return !!(window.Game && window.ITowns && window.MM && window.gpAjax);
}

/* ================= API grepolis wrappers ================= */
function ajaxExecute(model_url, action_name, args={}, town_id){
  return new Promise((resolve, reject)=>{
    window.gpAjax.ajaxPost(
      'frontend_bridge', 'execute',
      { model_url, action_name, arguments: args, ...(town_id?{town_id}:{}) },
      ()=>resolve(true),
      ()=>reject(new Error('ajaxPost error'))
    );
  });
}

// Progressable -> aceitar/fechar missão
async function claimReward(progressable){
  await ajaxExecute(`Progressable/${progressable.id}`, 'progressTo', {
    progressable_id: progressable.progressable_id,
    state: 'closed'
  });
}

// Temple -> setar Hera
async function setHera(town_id){
  return new Promise((resolve, reject)=>{
    window.gpAjax.ajaxPost('building_temple', 'change_god', {
      god_id: 'hera',
      town_id
    }, ()=>resolve(true), ()=>reject(new Error('change_god error')));
  });
}

// Cast -> Wedding (Hera)
async function castWedding(town_id){
  await ajaxExecute('CastedPowers', 'cast', {
    power_id: 'wedding',
    target_id: town_id
  });
}

/* ================= lógica ================= */
function getFinishedTasks(){
  const col = window.MM.getCollections().Progressable?.[0];
  const models = col?.models || [];
  const fin = [];
  for (const m of models){
    const a = m?.attributes;
    if (a && a.state === 'satisfied') fin.push(a);
  }
  return fin;
}

function canAcceptResources(town, rewardData, margin=STORAGE_MARGIN){
  const { wood, iron, stone, storage } = town.resources();
  if (rewardData.wood  + wood  + margin > storage) return false;
  if (rewardData.iron  + iron  + margin > storage) return false;
  if (rewardData.stone + stone + margin > storage) return false;
  return true;
}

async function maybeEnsureHeraAndWeddingSingleTown(){
  // só tenta em conta de 1 cidade
  const townsCount = Object.keys(window.ITowns.towns||{}).length;
  if (townsCount !== 1) return;

  const town = window.ITowns.getCurrentTown();
  if (!town) return;

  // se tem templo e não tem deus -> Hera
  const templeLvl = town.buildings()?.attributes?.temple || 0;
  if (templeLvl > 0 && !town.god()){
    await setHera(town.id);
    log('Deus ausente — setando Hera');
    // pequeno respiro para refletir
    await wait(300);
  }

  // favor Hera + armazém com espaço -> casar
  const heraFavor = window.ITowns?.player_gods?.attributes?.hera_favor ?? 0;
  const { wood, iron, stone, storage } = town.resources();
  const hasSpace = wood + STORAGE_MARGIN < storage && iron + STORAGE_MARGIN < storage && stone + STORAGE_MARGIN < storage;

  if (heraFavor > 30 && hasSpace){
    await castWedding(town.id);
    log('Hera Wedding lançado na cidade', town.id);
  }
}

async function tickOnce(){
  // 1) Hera/ Wedding em conta de 1 cidade (se aplicável)
  await maybeEnsureHeraAndWeddingSingleTown();
  if (!running || softStop()) return;

  // 2) Coletar missões finalizadas
  const missions = getFinishedTasks();
  if (!missions.length) return;

  // 3) Se missão proibida estiver concluída -> parar script (sem aceitar)
  const forbidden = missions.find(m => m.progressable_id === STOP_ON_QUEST_ID);
  if (forbidden){
    log('⚠️ Missão proibida (CastPowerQuest) detectada — parando o script.');
    running = false; // deixa o loop principal encerrar
    return;
  }

  // 4) Priorizar recompensas: resources (com espaço) > units/favor > powers (whitelist)
  const town = window.ITowns.getCurrentTown();

  for (const mission of missions){
    if (!running || softStop()) return;

    const rewards = mission.static_data?.rewards || [];
    for (const reward of rewards){
      const { type, data } = reward;

      // resources
      if (type === 'resources' && town && canAcceptResources(town, data)){
        await claimReward(mission);
        log('✅ Aceitou missão (recursos):', mission);
        return;
      }

      // units / favor
      if (type === 'units' || type === 'favor'){
        await claimReward(mission);
        log('✅ Aceitou missão (unidades/favor):', mission);
        return;
      }

      // powers (lista branca)
      if (type === 'power'){
        const pid = reward.power_id;
        if (pid === 'population_boost' || pid === 'coins_of_wisdom'){
          await claimReward(mission);
          log('✅ Aceitou missão (poder):', mission);
          return;
        }
      }
    }
  }
}

/* ================= ciclo controlado pelo Hub ================= */
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

  log('Iniciado');
  try{
    // loop cooperativo (checa softStop/running entre ciclos)
    while (running && !softStop()){
      await tickOnce();
      // aguarda próximo tick
      const step = Math.max(500, TICK_MS);
      for (let t=0; t<step; t+=200){
        if (!running || softStop()) break;
        await wait(200);
      }
    }
  } finally {
    running = false;
    log('Parado');
  }
}

export function stop(){
  running = false; // o loop honra este flag e softStop()
}
