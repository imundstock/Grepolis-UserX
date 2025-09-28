// AutoApagarNotificacoes.js
// Adaptado para o BR79 ScriptHub (start/stop + ctx)

// Manifesto lido pelo Hub
export const manifest = {
  version: '1.6.0',
  niceName: 'Auto Apagar Notificações',
  defaultSelected: true
};

let running = false;
let _ctx = null;
let intervalId = null;
let timeoutId = null;

function log(...a){ _ctx?.log ? _ctx.log('[Notif]', ...a) : console.log('BR79p2 [Notif]', ...a); }
function wait(ms){ return _ctx?.wait ? _ctx.wait(ms) : new Promise(r=>setTimeout(r,ms)); }
function softStop(){ return !!(_ctx && _ctx.softStopFlag && _ctx.softStopFlag()); }

function clicarNoX(){
  const botaoFechar = document.querySelector("#delete_all_notifications");
  if (botaoFechar){
    log("✅ Notificações encontradas! Clicando no 'X'...");
    botaoFechar.click();
  } else {
    log("⚠ Nenhum botão de apagar notificações encontrado.");
  }
}

export async function start(ctx){
  if (running) return;
  running = true;
  _ctx = ctx || _ctx;

  // primeira execução após ~30s
  timeoutId = setTimeout(()=>{
    if (running && !softStop()) clicarNoX();
  }, 30000);

  // depois a cada ~6min 40s (400000 ms)
  intervalId = setInterval(()=>{
    if (running && !softS
