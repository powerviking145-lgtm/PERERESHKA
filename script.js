/* =========================================================
   ПЕРЕКРЁСТОК · ОРЁЛ И РЕШКА — игровая логика
   ========================================================= */

(() => {
  'use strict';

  /* ---------- DOM ---------- */
  const $ = (id) => document.getElementById(id);

  const app          = $('app');
  const coin         = $('coin');
  const coinShadow   = $('coinShadow');
  const stageHint    = $('stageHint');
  const resultFlash  = $('resultFlash');
  const scoreValue   = $('scoreValue');
  const loyaltyValue = $('loyaltyValue');
  const scorePill    = $('scorePill');
  const loyaltyPill  = $('loyaltyPill');
  const progressFill = $('progressFill');
  const progressText = $('progressText');
  const historyEl    = $('history');
  const toastEl      = $('toast');

  const lootboxBtn    = $('lootboxBtn');
  const lootboxBadge  = $('lootboxBadge');
  const lootModalOverlay = $('lootModalOverlay');
  const lootCloseBtn  = $('lootCloseBtn');
  const chipsBox       = $('chipsBox');
  const lootPre        = $('lootPre');
  const lootReward     = $('lootReward');
  const openLootBtn    = $('openLootBtn');
  const notEnoughBtn   = $('notEnoughBtn');
  const promoCodeEl    = $('promoCode');
  const copyPromoBtn   = $('copyPromoBtn');
  const lootDoneBtn    = $('lootDoneBtn');

  const PACK_COST = 100;          // сколько баллов лояльности стоит открыть пачку чипсов
  const HEADS_PER_PACK = 10;      // сколько очков (орлов) нужно набрать для получения пачки
  const STARTING_LOYALTY = 13000; // стартовые / тестовые баллы лояльности
  const REFILL_ON_ZERO = 100;     // тестовое пополнение при обнулении баллов
  const BONUS_GRANT_ID = 'bonus_13000_v1'; // метка одноразового бонуса, чтобы не начислять его повторно

  /* ---------- СОСТОЯНИЕ (с сохранением в localStorage) ---------- */
  const STORAGE_KEY = 'perekrestok_coin_game_v1';

  function loadState(){
    let st = null;
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if(raw) st = JSON.parse(raw);
    }catch(e){}

    if(!st){
      return {
        score: 0,          // всего очков (орлов)
        loyalty: STARTING_LOYALTY,
        packs: 0,           // доступные нераспакованные пачки чипсов
        history: [],        // последние результаты 'H' | 'T'
        grants: [BONUS_GRANT_ID]
      };
    }

    if(!Array.isArray(st.grants)) st.grants = [];

    // одноразовое начисление тестового бонуса — не даст начислить его повторно при перезагрузке
    if(!st.grants.includes(BONUS_GRANT_ID)){
      st.loyalty = (st.loyalty || 0) + STARTING_LOYALTY;
      st.grants.push(BONUS_GRANT_ID);
    }

    return st;
  }

  let state = loadState();

  function saveState(){
    try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }catch(e){}
  }
  saveState();

  /* ---------- ВИБРАЦИЯ (ASMR-паттерны) ---------- */
  const canVibrate = 'vibrate' in navigator;
  function vibrate(pattern){
    if(!canVibrate) return;
    try{ navigator.vibrate(pattern); }catch(e){}
  }

  // короткий тик при касании монеты
  const V_TAP = 12;
  // "прокатка" во время полёта монеты — мелкие частые импульсы для АСМР-эффекта
  function vibrateSpin(durationMs){
    if(!canVibrate) return;
    const pattern = [];
    const tick = 55; // мс между тиками
    let t = 0;
    while(t < durationMs){
      pattern.push(6, tick - 6);
      t += tick;
    }
    navigator.vibrate(pattern);
  }
  const V_LAND      = 35;
  const V_HEADS_WIN = [0, 18, 40, 18, 40, 60];
  const V_TAILS_LOSE= [0, 90];
  const V_PACK_EARN = [0, 15, 30, 15, 30, 15, 90];
  const V_LOOT_OPEN = [0, 10, 20, 10, 20, 10, 20, 10, 130];
  const V_REFILL    = [0, 25, 60, 25, 60, 25];
  const V_COPY      = 8;

  /* ---------- ПРОМОКОДЫ ---------- */
  function generatePromoCode(){
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'PRK-CHIPS-';
    for(let i=0;i<6;i++) code += chars[Math.floor(Math.random()*chars.length)];
    return code;
  }

  /* ---------- ТОСТ ---------- */
  let toastTimer = null;
  function showToast(text, duration=2200){
    clearTimeout(toastTimer);
    toastEl.textContent = text;
    toastEl.classList.add('show');
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
  }

  /* ---------- ОБНОВЛЕНИЕ UI ---------- */
  function bump(el){
    el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump');
  }
  function shakePill(el){
    el.classList.remove('shake'); void el.offsetWidth; el.classList.add('shake');
  }

  function renderStats(){
    scoreValue.textContent = state.score;
    loyaltyValue.textContent = state.loyalty;

    const inPack = state.score % HEADS_PER_PACK;
    progressFill.style.width = (inPack / HEADS_PER_PACK * 100) + '%';
    progressText.textContent = `${inPack} / ${HEADS_PER_PACK}`;

    lootboxBadge.textContent = state.packs;
    lootboxBadge.classList.toggle('show', state.packs > 0);

    const ready = state.packs > 0 && state.loyalty >= PACK_COST;
    lootboxBtn.classList.toggle('ready', state.packs > 0);
    lootboxBtn.classList.toggle('pulse', ready);
  }

  function renderHistory(){
    historyEl.innerHTML = '';
    state.history.slice(-8).forEach(r => {
      const d = document.createElement('div');
      d.className = 'history__item';
      d.textContent = r === 'H' ? '🦅' : '🔻';
      d.style.background = r === 'H' ? '#EAFBDC' : '#FFE7DE';
      historyEl.appendChild(d);
    });
  }

  renderStats();
  renderHistory();

  /* ---------- ЛОГИКА ПОДБРОСА МОНЕТЫ ---------- */
  let isFlipping = false;
  let currentRotY = 0; // накопленный угол вращения по Y, чтобы монета не "прыгала" назад

  function flipCoin(){
    if(isFlipping) return;
    isFlipping = true;

    stageHint.classList.add('hidden');
    coin.classList.remove('idle-bob');
    vibrate(V_TAP);

    const isHeads = Math.random() < 0.5;
    const spins = 4 + Math.floor(Math.random()*3); // 4-6 полных оборотов
    // считаем абсолютный целевой угол на основе текущего кратного 360,
    // чтобы монета всегда докручивалась вперёд и не "прыгала" назад
    const base = Math.ceil(currentRotY / 360) * 360;
    currentRotY = base + spins*360 + (isHeads ? 0 : 180);

    const duration = 900; // мс

    coin.classList.add('flipping');
    coin.style.transition = `transform ${duration}ms cubic-bezier(.2,.8,.3,1)`;
    coin.style.transform = `translateY(-60px) rotateY(${currentRotY}deg) rotateX(10deg) scale(1.05)`;

    coinShadow.style.transform = 'translateX(-50%) scale(0.5)';
    coinShadow.style.opacity = '0.4';

    vibrateSpin(duration);

    setTimeout(() => {
      // приземление
      coin.style.transition = `transform 260ms cubic-bezier(.34,1.56,.64,1)`;
      coin.style.transform = `translateY(0) rotateY(${currentRotY}deg) rotateX(0deg) scale(1)`;
      coinShadow.style.transform = 'translateX(-50%) scale(1)';
      coinShadow.style.opacity = '1';
      vibrate(V_LAND);

      setTimeout(() => {
        onFlipResult(isHeads);
        isFlipping = false;
        setTimeout(() => {
          if(!isFlipping) coin.classList.add('idle-bob');
          stageHint.classList.remove('hidden');
        }, 400);
      }, 200);

    }, duration);
  }

  function onFlipResult(isHeads){
    state.history.push(isHeads ? 'H' : 'T');
    if(state.history.length > 30) state.history.shift();

    if(isHeads){
      state.score += 1;
      bump(scorePill);
      flashResult('heads', '🦅 Орёл! +1 очко');
      vibrate(V_HEADS_WIN);
      burstConfetti(28, ['#0F5A05','#2FA023','#EAFBDC','#7ED957']);

      if(state.score % HEADS_PER_PACK === 0){
        state.packs += 1;
        setTimeout(() => {
          showToast('🥡 Новая пачка чипсов доступна для открытия!', 3200);
          vibrate(V_PACK_EARN);
          bump(lootboxBtn);
        }, 500);
      }
    } else {
      state.loyalty -= 1;
      shakePill(loyaltyPill);
      flashResult('tails', '🔻 Решка. −1 балл');
      vibrate(V_TAILS_LOSE);
      app.classList.remove('shake-screen'); void app.offsetWidth;
      app.classList.add('shake-screen');

      if(state.loyalty <= 0){
        setTimeout(() => {
          state.loyalty = REFILL_ON_ZERO;
          renderStats();
          saveState();
          showToast(`🍃 Тест: баллы лояльности пополнены до ${REFILL_ON_ZERO}`, 3000);
          vibrate(V_REFILL);
        }, 550);
      }
    }

    renderStats();
    renderHistory();
    saveState();
  }

  function flashResult(type, text){
    resultFlash.textContent = text;
    resultFlash.classList.remove('show-heads','show-tails');
    void resultFlash.offsetWidth;
    resultFlash.classList.add(type === 'heads' ? 'show-heads' : 'show-tails');
  }

  /* ---------- CONFETTI (canvas) ---------- */
  const canvas = $('fxCanvas');
  const ctx = canvas.getContext('2d');
  let confettiParticles = [];
  let rafId = null;

  function resizeCanvas(){
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
  }
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  function burstConfetti(count, colors, originY){
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const oy = originY !== undefined ? originY : h*0.42;
    for(let i=0;i<count;i++){
      confettiParticles.push({
        x: w/2 + (Math.random()-0.5)*40,
        y: oy,
        vx: (Math.random()-0.5)*8,
        vy: -Math.random()*7 - 3,
        rot: Math.random()*360,
        vrot: (Math.random()-0.5)*14,
        size: 5 + Math.random()*5,
        color: colors[Math.floor(Math.random()*colors.length)],
        life: 0,
        maxLife: 60 + Math.random()*30
      });
    }
    if(!rafId) animateConfetti();
  }

  function animateConfetti(){
    ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    ctx.clearRect(0,0,canvas.clientWidth, canvas.clientHeight);

    confettiParticles.forEach(p => {
      p.vy += 0.22; // гравитация
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vrot;
      p.life++;

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot * Math.PI/180);
      ctx.globalAlpha = Math.max(0, 1 - p.life/p.maxLife);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size/2, -p.size/3, p.size, p.size*0.6);
      ctx.restore();
    });

    confettiParticles = confettiParticles.filter(p => p.life < p.maxLife);

    if(confettiParticles.length > 0){
      rafId = requestAnimationFrame(animateConfetti);
    } else {
      rafId = null;
      ctx.clearRect(0,0,canvas.clientWidth, canvas.clientHeight);
    }
  }

  /* ---------- ОБРАБОТЧИКИ КАСАНИЙ ---------- */
  const stage = $('stage');
  stage.addEventListener('click', (e) => {
    // избегаем срабатывания сквозь модалку
    if(lootModalOverlay.classList.contains('open')) return;
    flipCoin();
  });

  /* ---------- ЛУТБОКС ---------- */
  let pendingPromo = null;

  lootboxBtn.addEventListener('click', () => {
    if(state.packs <= 0){
      showToast('Копи очки — за каждые 10 орлов дают пачку чипсов 🦅', 2600);
      return;
    }
    openLootModal();
  });

  function openLootModal(){
    lootModalOverlay.classList.add('open');
    lootPre.style.display = 'block';
    lootReward.style.display = 'none';
    chipsBox.classList.remove('shaking','opened');

    const enough = state.loyalty >= PACK_COST;
    openLootBtn.style.display = enough ? 'block' : 'none';
    notEnoughBtn.style.display = enough ? 'none' : 'block';
  }

  function closeLootModal(){
    lootModalOverlay.classList.remove('open');
  }

  lootCloseBtn.addEventListener('click', closeLootModal);
  lootModalOverlay.addEventListener('click', (e) => {
    if(e.target === lootModalOverlay) closeLootModal();
  });

  openLootBtn.addEventListener('click', () => {
    if(state.loyalty < PACK_COST) return;

    openLootBtn.disabled = true;
    chipsBox.classList.add('shaking');
    vibrate([0,10,60,10,60,10,60]);

    setTimeout(() => {
      chipsBox.classList.remove('shaking');
      chipsBox.classList.add('opened');
      vibrate(V_LOOT_OPEN);
      burstConfetti(50, ['#FFC94A','#FF8A3D','#0F5A05','#7ED957','#FFFFFF'], 90);

      state.loyalty -= PACK_COST;
      state.packs -= 1;
      pendingPromo = generatePromoCode();
      promoCodeEl.textContent = pendingPromo;

      renderStats();
      saveState();

      setTimeout(() => {
        lootPre.style.display = 'none';
        lootReward.style.display = 'block';
        openLootBtn.disabled = false;
      }, 500);
    }, 900);
  });

  copyPromoBtn.addEventListener('click', async () => {
    if(!pendingPromo) return;
    vibrate(V_COPY);
    try{
      await navigator.clipboard.writeText(pendingPromo);
    }catch(e){
      // fallback для webview без Clipboard API
      const ta = document.createElement('textarea');
      ta.value = pendingPromo;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try{ document.execCommand('copy'); }catch(err){}
      document.body.removeChild(ta);
    }
    copyPromoBtn.textContent = 'Скопировано ✓';
    copyPromoBtn.classList.add('copied');
    showToast('Промокод скопирован в буфер обмена');
    setTimeout(() => {
      copyPromoBtn.textContent = 'Скопировать';
      copyPromoBtn.classList.remove('copied');
    }, 1800);
  });

  lootDoneBtn.addEventListener('click', closeLootModal);

  /* ---------- ORIENTATION LOCK (попытка) ---------- */
  if(screen.orientation && screen.orientation.lock){
    try{ screen.orientation.lock('portrait').catch(()=>{}); }catch(e){}
  }

  /* ---------- Первый рендер / idle анимация монеты ---------- */
  coin.classList.add('idle-bob');

})();
