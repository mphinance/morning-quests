(function(){
'use strict';

// ============ CONSTANTS ============
const STORAGE_KEY = 'morning_quests_v2';
const ROBUX_TO_USD = 9.99/800;
const MC_PER_ROBUX = (320/1.99)/(800/9.99);
const CIRCUMFERENCE = 2 * Math.PI * 90; // timer ring
const API_BASE = ''; // same-origin

const DEFAULT_QUESTS = [
  {id:'breakfast',icon:'🥣',name:'Eat Breakfast',subtitle:'Fuel up for your adventure!',xp:20,timer:0},
  {id:'dressed',icon:'👕',name:'Get Dressed',subtitle:'Armor up, adventurer!',xp:20,timer:0},
  {id:'teeth',icon:'🪥',name:'Brush Teeth',subtitle:'Keep that smile sparkling!',xp:20,timer:60},
  {id:'pills',icon:'💊',name:'Take Pills',subtitle:'Power-up activated!',xp:20,timer:0},
  {id:'shoes',icon:'👟',name:'Shoes & Coat',subtitle:'Ready for the world!',xp:20,timer:0}
];

// ============ SOUND ENGINE ============
const Sound = (() => {
  let ctx;
  function getCtx(){ if(!ctx) ctx=new (window.AudioContext||window.webkitAudioContext)(); return ctx; }
  function play(freq,dur,type='square',vol=0.08){
    const c=getCtx(),o=c.createOscillator(),g=c.createGain();
    o.type=type; o.frequency.value=freq;
    g.gain.setValueAtTime(vol,c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001,c.currentTime+dur);
    o.connect(g); g.connect(c.destination);
    o.start(); o.stop(c.currentTime+dur);
  }
  return {
    click(){ play(800,.05,'square',.04); },
    complete(){
      const c=getCtx(); const t=c.currentTime;
      [523,659,784].forEach((f,i)=>{
        const o=c.createOscillator(),g=c.createGain();
        o.type='square'; o.frequency.value=f;
        g.gain.setValueAtTime(0.06,t+i*.08);
        g.gain.exponentialRampToValueAtTime(0.001,t+i*.08+.15);
        o.connect(g); g.connect(c.destination);
        o.start(t+i*.08); o.stop(t+i*.08+.15);
      });
    },
    victory(){
      const c=getCtx(); const t=c.currentTime;
      [523,587,659,698,784,880,988,1047].forEach((f,i)=>{
        const o=c.createOscillator(),g=c.createGain();
        o.type='square'; o.frequency.value=f;
        g.gain.setValueAtTime(0.07,t+i*.07);
        g.gain.exponentialRampToValueAtTime(0.001,t+i*.07+.2);
        o.connect(g); g.connect(c.destination);
        o.start(t+i*.07); o.stop(t+i*.07+.2);
      });
    },
    error(){ play(200,.08,'sawtooth',.06); setTimeout(()=>play(150,.08,'sawtooth',.06),100); },
    tick(){ play(1200,.02,'square',.02); },
    timerDone(){
      const c=getCtx(); const t=c.currentTime;
      [784,988,1175,1319].forEach((f,i)=>{
        const o=c.createOscillator(),g=c.createGain();
        o.type='square'; o.frequency.value=f;
        g.gain.setValueAtTime(0.08,t+i*.1);
        g.gain.exponentialRampToValueAtTime(0.001,t+i*.1+.25);
        o.connect(g); g.connect(c.destination);
        o.start(t+i*.1); o.stop(t+i*.1+.25);
      });
    }
  };
})();

// ============ STATE ============
let state, pinBuffer='', pinMode=null, newPinCandidate='',
    timerInterval=null, calYear, calMonth, pendingTimerQuest=null;

const $=id=>document.getElementById(id);

function loadStateLocal(){
  try{
    const raw=localStorage.getItem(STORAGE_KEY);
    if(raw){ const s=JSON.parse(raw); if(s.version===2) return s; }
    const v1=localStorage.getItem('kilian_morning_quests');
    if(v1){ return migrateV1(JSON.parse(v1)); }
  }catch(e){}
  return freshState();
}

async function loadStateFromServer(){
  try{
    const r=await fetch(`${API_BASE}/api/state`);
    if(r.ok && r.status===200){ const s=await r.json(); if(s&&s.version===2) return s; }
  }catch(e){}
  return null;
}

async function loadState(){
  const server=await loadStateFromServer();
  if(server) return server;
  return loadStateLocal();
}

function migrateV1(v1){
  const profile = {
    id:0, name:'Kilian', avatar:'⚔️',
    quests: JSON.parse(JSON.stringify(DEFAULT_QUESTS)),
    config:{ daysPerStar:7, robuxPerStar:100, interestRate:0.10, savingsGoal:500 },
    streak: v1.streak||0, lastCompleteDate: v1.lastCompleteDate||null,
    totalXp: v1.totalXp||0, stars: v1.stars||0,
    robuxBalance: v1.robuxBalance||0, robuxInterestEarned: v1.robuxInterestEarned||0,
    robuxLifetime: v1.robuxLifetime||0, lastInterestDate: v1.lastInterestDate||null,
    robuxCashedOut: v1.robuxCashedOut||0,
    history:{},
    today:{ date: v1.date||today(), completed: v1.completed||{}, approved: v1.approved||false }
  };
  return { version:2, pin: v1.pin||'1234', activeProfileId:0, profiles:[profile] };
}

function freshState(){
  return {
    version:2, pin:'1234', activeProfileId:0,
    profiles:[{
      id:0, name:'Player 1', avatar:'⚔️',
      quests: JSON.parse(JSON.stringify(DEFAULT_QUESTS)),
      config:{ daysPerStar:7, robuxPerStar:100, interestRate:0.10, savingsGoal:500 },
      streak:0, lastCompleteDate:null, totalXp:0, stars:0,
      robuxBalance:0, robuxInterestEarned:0, robuxLifetime:0,
      lastInterestDate:null, robuxCashedOut:0, history:{},
      today:{ date:today(), completed:{}, approved:false }
    }]
  };
}

function save(){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(state));}catch(e){}
  // Fire-and-forget server sync
  try{fetch(`${API_BASE}/api/state`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)}).catch(()=>{});}catch(e){}
}
function prof(){ return state.profiles.find(p=>p.id===state.activeProfileId)||state.profiles[0]; }
function today(){ const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function yesterday(){ const d=new Date(); d.setDate(d.getDate()-1); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

function checkDayReset(){
  const p=prof(), t=today();
  if(p.today.date!==t){
    // Save yesterday to history if had data
    if(Object.keys(p.today.completed).length>0 || p.today.approved){
      p.history[p.today.date]={ completed:Object.keys(p.today.completed), approved:p.today.approved };
    } else if(p.lastCompleteDate && p.today.date > p.lastCompleteDate){
      // Mark as missed if there was a previous completion
      p.history[p.today.date]={ completed:[], approved:false };
    }
    if(p.lastCompleteDate!==yesterday() && p.lastCompleteDate!==t){ p.streak=0; }
    p.today={ date:t, completed:{}, approved:false };
    save();
  }
}

function applyInterest(){
  const p=prof();
  if(p.robuxBalance<=0) return;
  if(!p.lastInterestDate){ p.lastInterestDate=today(); save(); return; }
  const last=new Date(p.lastInterestDate), now=new Date();
  const weeks=Math.floor((now-last)/(7*864e5));
  if(weeks>0){
    const old=p.robuxBalance;
    p.robuxBalance=Math.floor(old*Math.pow(1+p.config.interestRate,weeks));
    p.robuxInterestEarned+=(p.robuxBalance-old);
    const nd=new Date(last.getTime()+weeks*7*864e5);
    p.lastInterestDate=`${nd.getFullYear()}-${String(nd.getMonth()+1).padStart(2,'0')}-${String(nd.getDate()).padStart(2,'0')}`;
    save();
  }
}

// ============ RENDER ============
function renderAll(){
  const p=prof(), quests=p.quests, done=Object.keys(p.today.completed).length;
  const totalXp=quests.reduce((s,q)=>s+q.xp,0), earnedXp=quests.filter(q=>p.today.completed[q.id]).reduce((s,q)=>s+q.xp,0);

  // Header
  $('appTitle').textContent=`⚔️ ${p.name}'s Quests`;
  $('profileAvatarBtn').textContent=p.avatar;
  $('streakCount').textContent=p.streak;
  renderMilestones(p);

  // Progress
  $('progressFill').style.width=`${(done/quests.length)*100}%`;
  $('progressText').textContent=`${done} / ${quests.length} Quests`;
  renderProgressStars(quests.length, done);

  // Quest cards
  renderQuests(p);

  // XP
  $('xpValue').textContent=earnedXp;
  $('xpTotal').textContent=`/ ${totalXp}`;

  // Approval
  const allDone=done===quests.length;
  const banner=$('approvalBanner');
  if(allDone && !p.today.approved){ banner.classList.add('visible'); } else { banner.classList.remove('visible'); }

  // Bank
  renderBank(p);
}

function renderQuests(p){
  const list=$('questList');
  list.innerHTML='';
  p.quests.forEach(q=>{
    const done=!!p.today.completed[q.id];
    const card=document.createElement('div');
    card.className=`quest-card glass-card${done?' completed':''}`;
    card.id=`quest-${q.id}`;
    card.innerHTML=`
      <div class="quest-icon-wrap">
        <span class="quest-icon">${q.icon}</span>
        ${q.timer>0?`<span class="quest-timer-badge">⏱️</span>`:''}
        <div class="quest-check">✓</div>
      </div>
      <div class="quest-info">
        <span class="quest-name">${q.name}</span>
        <span class="quest-subtitle">${q.subtitle}</span>
      </div>
      <div class="quest-xp">+${q.xp} XP</div>`;
    card.addEventListener('click',()=>toggleQuest(q.id));
    list.appendChild(card);
  });
}

function renderMilestones(p){
  const el=$('milestones'); el.innerHTML='';
  for(let i=0;i<p.stars;i++){
    const s=document.createElement('span');
    s.className='milestone-star'; s.textContent='⭐'; el.appendChild(s);
  }
  const d=p.streak%p.config.daysPerStar;
  if(p.stars>0||d>0){
    const sp=document.createElement('span');
    sp.className='milestone-progress';
    sp.textContent=`${d}/${p.config.daysPerStar} → ⭐`;
    el.appendChild(sp);
  }
}

function renderProgressStars(total,done){
  const el=$('progressStars'); el.innerHTML='';
  for(let i=0;i<total;i++){
    const s=document.createElement('span');
    s.className='progress-star'+(i<done?' active':''); s.textContent='⭐'; el.appendChild(s);
  }
}

function renderBank(p){
  const c=p.config;
  $('bankBalance').textContent=p.robuxBalance;
  $('bankDaysLabel').textContent=c.daysPerStar;
  $('bankRobuxLabel').textContent=`+${c.robuxPerStar} R$`;
  $('bankInterestLabel').textContent=`+${Math.round(c.interestRate*100)}% / week`;
  $('bankInterest').textContent=`${p.robuxInterestEarned} R$`;
  $('bankNextInterest').textContent=p.robuxBalance>0?getNextInterestDay(p):'—';
  const gp=Math.min(100,(p.robuxBalance/c.savingsGoal)*100);
  $('bankGoalText').textContent=`${p.robuxBalance} / ${c.savingsGoal} R$`;
  $('bankGoalFill').style.width=`${gp}%`;
  $('fxUSD').textContent=`$${(p.robuxBalance*ROBUX_TO_USD).toFixed(2)}`;
  $('fxMinecoins').textContent=`${Math.floor(p.robuxBalance*MC_PER_ROBUX)} MC`;
}

function getNextInterestDay(p){
  if(!p.lastInterestDate) return 'earn to start';
  const last=new Date(p.lastInterestDate);
  const next=new Date(last.getTime()+7*864e5);
  const diff=Math.ceil((next-Date.now())/864e5);
  if(diff<=0) return 'today!';
  if(diff===1) return 'tomorrow';
  return `${diff} days`;
}

// ============ QUEST INTERACTION ============
function toggleQuest(qid){
  const p=prof();
  if(p.today.approved) return;
  const q=p.quests.find(x=>x.id===qid);
  if(!q) return;

  if(p.today.completed[qid]){
    delete p.today.completed[qid];
    save(); renderAll(); return;
  }

  // Timer quest?
  if(q.timer>0 && !p.today.completed[qid]){
    startTimer(q); return;
  }

  completeQuest(qid);
}

function completeQuest(qid){
  const p=prof(), card=document.querySelector(`#quest-${qid}`);
  p.today.completed[qid]=true;
  save();

  if(card){
    card.classList.add('completed','just-completed');
    const r=card.getBoundingClientRect();
    spawnBurst(r.left+r.width/2, r.top+r.height/2);
    spawnFloatXP(r.left+r.width/2, r.top+r.height/2, p.quests.find(q=>q.id===qid)?.xp||20);
    setTimeout(()=>card.classList.remove('just-completed'),500);
  }

  Sound.complete();
  if(navigator.vibrate) navigator.vibrate(30);

  const xpEl=$('xpValue');
  xpEl.classList.add('bump'); setTimeout(()=>xpEl.classList.remove('bump'),400);

  renderAll();
}

// ============ TIMER ============
function startTimer(quest){
  pendingTimerQuest=quest;
  let remaining=quest.timer;
  $('timerQuestName').textContent=`${quest.icon} ${quest.name}`;
  $('timerDisplay').textContent=remaining;
  const ring=$('timerRingProgress');
  ring.style.strokeDasharray=CIRCUMFERENCE;
  ring.style.strokeDashoffset=0;
  $('timerOverlay').classList.add('active');

  timerInterval=setInterval(()=>{
    remaining--;
    $('timerDisplay').textContent=remaining;
    const pct=(quest.timer-remaining)/quest.timer;
    ring.style.strokeDashoffset=CIRCUMFERENCE*pct;
    if(remaining<=3 && remaining>0) Sound.tick();
    if(remaining<=0){
      clearInterval(timerInterval); timerInterval=null;
      Sound.timerDone();
      if(navigator.vibrate) navigator.vibrate([100,50,100]);
      setTimeout(()=>{
        $('timerOverlay').classList.remove('active');
        if(pendingTimerQuest) completeQuest(pendingTimerQuest.id);
        pendingTimerQuest=null;
      },600);
    }
  },1000);
}

// ============ PIN ============
function openPin(mode){
  pinMode=mode; pinBuffer=''; $('pinError').textContent='';
  updatePinDots();
  const titles={approve:'🔒 Parent Approval',settings:'🔒 Settings',
    'change-old':'🔑 Current PIN','change-new':'🔑 New PIN','change-confirm':'🔑 Confirm PIN',
    'excuse':'🔒 Excuse Day'};
  const subs={approve:'Enter PIN to approve',settings:'Enter PIN for settings',
    'change-old':'Verify current PIN','change-new':'Choose new 4-digit PIN',
    'change-confirm':'Enter new PIN again','excuse':'Enter PIN to excuse this day'};
  $('pinTitle').textContent=titles[mode]||'🔒 PIN';
  $('pinSubtitle').textContent=subs[mode]||'';
  $('pinOverlay').classList.add('active');
  Sound.click();
}

function closePin(){ $('pinOverlay').classList.remove('active'); pinBuffer=''; pinMode=null; newPinCandidate=''; }

function onPinKey(key){
  if(key==='delete'){ pinBuffer=pinBuffer.slice(0,-1); $('pinError').textContent=''; updatePinDots(); Sound.click(); return; }
  if(pinBuffer.length>=4) return;
  pinBuffer+=key; updatePinDots(); Sound.click();
  if(navigator.vibrate) navigator.vibrate(10);
  if(pinBuffer.length===4) setTimeout(checkPin,200);
}

function updatePinDots(){
  $('pinDots').querySelectorAll('.pin-dot').forEach((d,i)=>{
    d.classList.remove('filled','success','error');
    if(i<pinBuffer.length) d.classList.add('filled');
  });
}

function checkPin(){
  const dots=$('pinDots').querySelectorAll('.pin-dot');
  const success=()=>dots.forEach(d=>{d.classList.remove('filled');d.classList.add('success');});
  const fail=(msg)=>{
    dots.forEach(d=>{d.classList.remove('filled');d.classList.add('error');});
    $('pinError').textContent=msg||'Wrong PIN';
    Sound.error(); if(navigator.vibrate) navigator.vibrate([50,50,50]);
    setTimeout(()=>{pinBuffer='';dots.forEach(d=>d.classList.remove('error'));updatePinDots();},600);
  };

  if(pinMode==='approve'){
    if(pinBuffer===state.pin){ success(); approveDay(); setTimeout(closePin,500); }
    else fail();
  } else if(pinMode==='settings'){
    if(pinBuffer===state.pin){ success(); setTimeout(()=>{closePin();openSettings();},400); }
    else fail();
  } else if(pinMode==='change-old'){
    if(pinBuffer===state.pin){ success(); setTimeout(()=>{closePin();openPin('change-new');},400); }
    else fail();
  } else if(pinMode==='change-new'){
    newPinCandidate=pinBuffer; success();
    const saved=newPinCandidate;
    setTimeout(()=>{closePin();newPinCandidate=saved;openPin('change-confirm');},400);
  } else if(pinMode==='change-confirm'){
    if(pinBuffer===newPinCandidate){ state.pin=newPinCandidate; save(); success(); setTimeout(()=>{closePin();openSettings();},400); }
    else fail("PINs don't match");
  } else if(pinMode==='excuse'){
    if(pinBuffer===state.pin){ success(); setTimeout(()=>{closePin();excuseDay();},400); }
    else fail();
  }
}

// ============ APPROVE & BANK ============
function approveDay(){
  const p=prof();
  p.today.approved=true;
  p.streak++;
  p.totalXp+=p.quests.reduce((s,q)=>s+q.xp,0);
  p.lastCompleteDate=today();

  let earnedStar=false;
  if(p.streak>0 && p.streak%p.config.daysPerStar===0){
    p.stars++;
    earnedStar=true;
    p.robuxBalance+=p.config.robuxPerStar;
    p.robuxLifetime+=p.config.robuxPerStar;
    if(!p.lastInterestDate) p.lastInterestDate=today();
  }

  // Save to history
  p.history[today()]={ completed:Object.keys(p.today.completed), approved:true };
  save();

  setTimeout(()=>{
    renderAll();
    showVictory(earnedStar,p);
  },300);
}

function showVictory(earnedStar,p){
  const totalXp=p.quests.reduce((s,q)=>s+q.xp,0);
  $('victoryXp').textContent=`+${totalXp} XP Earned Today`;
  $('victoryStreak').textContent=`🔥 ${p.streak} day streak!`;
  if(earnedStar){
    $('victoryMilestone').textContent='🌟 NEW STAR EARNED! 🌟';
    $('victoryRobux').textContent=`+${p.config.robuxPerStar} R$ deposited!`;
  } else {
    $('victoryMilestone').textContent='';
    $('victoryRobux').textContent='';
  }
  $('victoryOverlay').classList.add('active');
  Sound.victory();
  launchConfetti();
}

// ============ CALENDAR ============
function renderCalendar(){
  const p=prof();
  const months=['January','February','March','April','May','June','July','August','September','October','November','December'];
  $('calMonth').textContent=`${months[calMonth]} ${calYear}`;

  const grid=$('calGrid'); grid.innerHTML='';
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const todayStr=today();

  // Empty cells before first day
  for(let i=0;i<firstDay;i++){
    const c=document.createElement('div'); c.className='cal-cell empty'; grid.appendChild(c);
  }

  for(let d=1;d<=daysInMonth;d++){
    const dateStr=`${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cell=document.createElement('div');
    cell.className='cal-cell';
    cell.textContent=d;

    if(dateStr===todayStr){
      cell.classList.add('today');
      if(p.today.approved) cell.classList.add('done');
    } else if(dateStr>todayStr){
      cell.classList.add('future');
    } else {
      const hist=p.history[dateStr];
      if(hist){
        if(hist.excused) cell.classList.add('excused');
        else if(hist.approved) cell.classList.add('done');
        else cell.classList.add('missed');
      } else {
        cell.classList.add('missed');
      }
      // Allow parent to excuse missed days
      if(!hist?.approved && !hist?.excused && dateStr<todayStr){
        cell.classList.add('clickable');
        cell.addEventListener('click',()=>{
          window._excuseDate=dateStr;
          openPin('excuse');
        });
      }
    }
    grid.appendChild(cell);
  }

  renderWeeklySummary(p);
}

function excuseDay(){
  const p=prof(), dateStr=window._excuseDate;
  if(!dateStr) return;
  if(!p.history[dateStr]) p.history[dateStr]={ completed:[], approved:false };
  p.history[dateStr].excused=true;

  // Recalculate streak from history
  recalcStreak(p);
  save();
  renderCalendar();
  renderAll();
}

function recalcStreak(p){
  let streak=0, d=new Date();
  // If today is approved, count it
  if(p.today.approved || p.history[today()]?.approved || p.history[today()]?.excused){
    streak=1;
    d.setDate(d.getDate()-1);
  } else {
    d.setDate(d.getDate()-1);
  }
  // Count backwards
  for(let i=0;i<365;i++){
    const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const h=p.history[ds];
    if(h && (h.approved || h.excused)){ streak++; }
    else break;
    d.setDate(d.getDate()-1);
  }
  p.streak=streak;
}

function renderWeeklySummary(p){
  const bars=$('weeklyBars'); bars.innerHTML='';
  const days=['S','M','T','W','T','F','S'];
  const d=new Date(); d.setDate(d.getDate()-6);
  for(let i=0;i<7;i++){
    const ds=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const h=p.history[ds];
    const isDone=(ds===today() && p.today.approved) || (h && (h.approved||h.excused));
    const wrap=document.createElement('div'); wrap.className='weekly-bar-wrap';
    const bar=document.createElement('div'); bar.className='weekly-bar'+(isDone?'':' zero');
    bar.style.height=isDone?'100%':'8px';
    const label=document.createElement('div'); label.className='weekly-bar-label'; label.textContent=days[d.getDay()];
    wrap.appendChild(bar); wrap.appendChild(label); bars.appendChild(wrap);
    d.setDate(d.getDate()+1);
  }
}

// ============ SETTINGS ============
function openSettings(){
  const p=prof(), body=$('settingsBody');
  body.innerHTML=`
    <div class="setting-group">
      <label class="setting-label">Edit Quests</label>
      <p class="setting-desc">Add, remove, or change daily quests</p>
      <button class="setting-action" id="editQuestsBtn">📝 Edit Quest List</button>
    </div>
    <div class="setting-group">
      <label class="setting-label">Profiles</label>
      <p class="setting-desc">Manage kid profiles</p>
      <button class="setting-action" id="manageProfilesBtn">👥 Manage Profiles</button>
    </div>
    <div class="setting-group">
      <label class="setting-label">Change PIN</label>
      <p class="setting-desc">Set a new 4-digit parent PIN</p>
      <button class="setting-action" id="changePinBtn">🔑 Change PIN</button>
    </div>
    <div class="setting-group">
      <label class="setting-label">Robux Bank</label>
      <p class="setting-desc">Manage balance & cashouts</p>
      <div class="bank-settings-info">
        <span>Balance: <strong>${p.robuxBalance}</strong> R$</span>
        <span>Interest earned: <strong>${p.robuxInterestEarned}</strong> R$</span>
      </div>
      <button class="setting-action setting-cashout" id="cashoutBtn">💸 Cash Out All</button>
    </div>
    <div class="setting-group">
      <label class="setting-label">Reset Today</label>
      <p class="setting-desc">Clear today's quests for a redo</p>
      <button class="setting-action setting-danger" id="resetTodayBtn">🔄 Reset Quests</button>
    </div>
    <div class="setting-group">
      <label class="setting-label">Stats</label>
      <div class="stats-grid">
        <div class="stat-item"><span class="stat-value">${p.streak}</span><span class="stat-label">Streak</span></div>
        <div class="stat-item"><span class="stat-value">${p.stars}</span><span class="stat-label">Stars</span></div>
        <div class="stat-item"><span class="stat-value">${p.totalXp}</span><span class="stat-label">XP</span></div>
        <div class="stat-item"><span class="stat-value">${p.robuxLifetime}</span><span class="stat-label">R$ earned</span></div>
      </div>
    </div>`;

  $('editQuestsBtn').addEventListener('click',()=>{ $('settingsOverlay').classList.remove('active'); openQuestEditor(); });
  $('manageProfilesBtn').addEventListener('click',()=>{ $('settingsOverlay').classList.remove('active'); openProfileManager(); });
  $('changePinBtn').addEventListener('click',()=>{ $('settingsOverlay').classList.remove('active'); openPin('change-old'); });
  $('cashoutBtn').addEventListener('click',cashOut);
  $('resetTodayBtn').addEventListener('click',resetToday);
  $('settingsOverlay').classList.add('active');
}

function cashOut(){
  const p=prof();
  if(p.robuxBalance<=0) return;
  p.robuxCashedOut+=p.robuxBalance;
  p.robuxBalance=0; save();
  openSettings();
  renderAll();
}

function resetToday(){
  const p=prof();
  p.today.completed={}; p.today.approved=false;
  save(); $('settingsOverlay').classList.remove('active'); renderAll();
}

// ============ QUEST EDITOR ============
let editorQuests=[];

function openQuestEditor(){
  const p=prof();
  editorQuests=JSON.parse(JSON.stringify(p.quests));
  renderEditorList();
  $('questEditorOverlay').classList.add('active');
}

function renderEditorList(){
  const list=$('editorList'); list.innerHTML='';
  editorQuests.forEach((q,i)=>{
    const item=document.createElement('div'); item.className='editor-item';
    item.innerHTML=`
      <button class="editor-icon-btn" data-idx="${i}">${q.icon}</button>
      <div class="editor-fields">
        <input class="editor-input" data-idx="${i}" data-field="name" placeholder="Quest name" value="${q.name}">
        <input class="editor-input" data-idx="${i}" data-field="subtitle" placeholder="Subtitle" value="${q.subtitle}">
        <div class="editor-row">
          <input class="editor-input editor-input-sm" data-idx="${i}" data-field="xp" type="number" value="${q.xp}">
          <span class="editor-timer-label">XP</span>
          <input class="editor-input editor-input-sm" data-idx="${i}" data-field="timer" type="number" value="${q.timer}" min="0">
          <span class="editor-timer-label">⏱️ sec</span>
        </div>
      </div>
      <button class="editor-delete" data-idx="${i}">✕</button>`;
    list.appendChild(item);
  });

  // Icon buttons → cycle through emoji picker
  list.querySelectorAll('.editor-icon-btn').forEach(btn=>{
    btn.addEventListener('click',()=>{
      const idx=+btn.dataset.idx;
      const emojis=['🥣','👕','🪥','💊','👟','📚','🧹','🐕','💤','🎒','🚿','🧘','✏️','🎵','🏃','🍎','💻','📖','🧸','🎮'];
      const cur=emojis.indexOf(editorQuests[idx].icon);
      editorQuests[idx].icon=emojis[(cur+1)%emojis.length];
      btn.textContent=editorQuests[idx].icon;
      Sound.click();
    });
  });

  // Input changes
  list.querySelectorAll('.editor-input').forEach(inp=>{
    inp.addEventListener('change',()=>{
      const idx=+inp.dataset.idx, field=inp.dataset.field;
      if(field==='xp'||field==='timer') editorQuests[idx][field]=parseInt(inp.value)||0;
      else editorQuests[idx][field]=inp.value;
    });
  });

  // Delete buttons
  list.querySelectorAll('.editor-delete').forEach(btn=>{
    btn.addEventListener('click',()=>{
      editorQuests.splice(+btn.dataset.idx,1);
      renderEditorList();
      Sound.click();
    });
  });
}

function saveQuestEditor(){
  const p=prof();
  // Generate IDs for new quests
  editorQuests.forEach(q=>{ if(!q.id) q.id='q_'+Date.now()+'_'+Math.random().toString(36).slice(2,6); });
  p.quests=editorQuests;
  // Clean up completed for removed quests
  const ids=new Set(p.quests.map(q=>q.id));
  Object.keys(p.today.completed).forEach(k=>{ if(!ids.has(k)) delete p.today.completed[k]; });
  save();
  $('questEditorOverlay').classList.remove('active');
  renderAll();
  Sound.complete();
}

// ============ PROFILE MANAGER ============
function openProfilePicker(){
  if(state.profiles.length<=1){ $('app').classList.remove('hidden'); return; }
  const list=$('profileList'); list.innerHTML='';
  state.profiles.forEach(p=>{
    const card=document.createElement('div'); card.className='profile-card';
    card.innerHTML=`<span class="profile-emoji">${p.avatar}</span><span class="profile-name">${p.name}</span>`;
    card.addEventListener('click',()=>{
      state.activeProfileId=p.id; save();
      $('profilePicker').classList.remove('active');
      $('app').classList.remove('hidden');
      checkDayReset(); applyInterest(); renderAll();
      Sound.click();
    });
    list.appendChild(card);
  });
  $('profilePicker').classList.add('active');
}

function openProfileManager(){
  const list=$('pmList'); list.innerHTML='';
  state.profiles.forEach(p=>{
    const card=document.createElement('div'); card.className='profile-card';
    card.innerHTML=`<span class="profile-emoji">${p.avatar}</span><span class="profile-name">${p.name}</span>
      ${state.profiles.length>1?`<button class="pm-delete" data-id="${p.id}">✕</button>`:''}`;
    card.querySelector('.pm-delete')?.addEventListener('click',(e)=>{
      e.stopPropagation();
      state.profiles=state.profiles.filter(x=>x.id!==p.id);
      if(state.activeProfileId===p.id) state.activeProfileId=state.profiles[0].id;
      save(); openProfileManager(); renderAll();
    });
    list.appendChild(card);
  });
  $('profileManagerOverlay').classList.add('active');
}

function addProfile(){
  const emojis=['🦊','🐉','🦄','🐱','🐶','🦁','🐸','🦇','🐧','🐼'];
  const id=Date.now();
  const name=prompt('Kid name:');
  if(!name) return;
  const newP={
    id, name, avatar:emojis[state.profiles.length%emojis.length],
    quests:JSON.parse(JSON.stringify(DEFAULT_QUESTS)),
    config:{daysPerStar:7,robuxPerStar:100,interestRate:0.10,savingsGoal:500},
    streak:0,lastCompleteDate:null,totalXp:0,stars:0,
    robuxBalance:0,robuxInterestEarned:0,robuxLifetime:0,
    lastInterestDate:null,robuxCashedOut:0,history:{},
    today:{date:today(),completed:{},approved:false}
  };
  state.profiles.push(newP);
  save(); openProfileManager();
  Sound.complete();
}

// ============ EFFECTS ============
function createParticles(){
  const c=$('particles'), colors=['#e94560','#ffd700','#00e676','#448aff','#b388ff'];
  for(let i=0;i<18;i++){
    const p=document.createElement('div'); p.className='particle';
    const sz=Math.random()*5+2;
    p.style.cssText=`width:${sz}px;height:${sz}px;left:${Math.random()*100}%;background:${colors[i%colors.length]};animation-duration:${Math.random()*12+8}s;animation-delay:${Math.random()*10}s`;
    c.appendChild(p);
  }
}

function spawnBurst(x,y){
  const colors=['#e94560','#ffd700','#00e676','#448aff','#b388ff'];
  for(let i=0;i<10;i++){
    const p=document.createElement('div'); p.className='burst-particle';
    p.style.left=`${x}px`; p.style.top=`${y}px`; p.style.background=colors[i%colors.length];
    const a=(Math.PI*2*i)/10, d=35+Math.random()*35;
    document.body.appendChild(p);
    requestAnimationFrame(()=>{
      p.style.transform=`translate(${Math.cos(a)*d}px,${Math.sin(a)*d}px) scale(0)`;
      p.style.transition='all .5s ease-out'; p.style.opacity='0';
    });
    setTimeout(()=>p.remove(),600);
  }
}

function spawnFloatXP(x,y,xp){
  const el=document.createElement('div'); el.className='float-xp';
  el.textContent=`+${xp} XP`;
  el.style.left=`${x-25}px`; el.style.top=`${y-15}px`;
  document.body.appendChild(el);
  setTimeout(()=>el.remove(),1000);
}

const confettiCanvas=$('confettiCanvas');
const confettiCtx=confettiCanvas.getContext('2d');
function resizeCanvas(){ confettiCanvas.width=innerWidth; confettiCanvas.height=innerHeight; }

function launchConfetti(){
  const parts=[], colors=['#e94560','#ffd700','#00e676','#448aff','#b388ff','#ff6b6b','#ff9900'];
  for(let i=0;i<120;i++){
    parts.push({
      x:confettiCanvas.width/2,y:confettiCanvas.height/2,
      vx:(Math.random()-.5)*14,vy:(Math.random()-.5)*14-5,
      w:Math.random()*8+4,h:Math.random()*5+2,
      color:colors[Math.floor(Math.random()*colors.length)],
      rot:Math.random()*360,rs:(Math.random()-.5)*10,
      g:.12+Math.random()*.08,opacity:1,decay:.004+Math.random()*.004
    });
  }
  (function anim(){
    confettiCtx.clearRect(0,0,confettiCanvas.width,confettiCanvas.height);
    let alive=false;
    parts.forEach(p=>{
      if(p.opacity<=0) return; alive=true;
      p.x+=p.vx; p.y+=p.vy; p.vy+=p.g; p.vx*=.99; p.rot+=p.rs; p.opacity-=p.decay;
      confettiCtx.save(); confettiCtx.translate(p.x,p.y); confettiCtx.rotate(p.rot*Math.PI/180);
      confettiCtx.globalAlpha=Math.max(0,p.opacity); confettiCtx.fillStyle=p.color;
      confettiCtx.fillRect(-p.w/2,-p.h/2,p.w,p.h); confettiCtx.restore();
    });
    if(alive) requestAnimationFrame(anim);
    else confettiCtx.clearRect(0,0,confettiCanvas.width,confettiCanvas.height);
  })();
}

// ============ NAV & VIEWS ============
function switchView(viewId){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  $(viewId)?.classList.add('active');
  document.querySelector(`[data-view="${viewId}"]`)?.classList.add('active');
  if(viewId==='viewCalendar') renderCalendar();
  Sound.click();
}

// ============ EVENTS ============
function bindEvents(){
  $('approvalBanner').addEventListener('click',()=>openPin('approve'));
  $('settingsBtn').addEventListener('click',()=>openPin('settings'));
  $('pinClose').addEventListener('click',closePin);
  document.querySelectorAll('.pin-key[data-key]').forEach(k=>{
    k.addEventListener('click',()=>onPinKey(k.dataset.key));
  });
  $('settingsClose').addEventListener('click',()=>$('settingsOverlay').classList.remove('active'));
  $('editorClose').addEventListener('click',()=>$('questEditorOverlay').classList.remove('active'));
  $('editorAdd').addEventListener('click',()=>{
    editorQuests.push({id:'',icon:'📌',name:'New Quest',subtitle:'Do the thing!',xp:20,timer:0});
    renderEditorList(); Sound.click();
  });
  $('editorSave').addEventListener('click',saveQuestEditor);
  $('pmClose').addEventListener('click',()=>$('profileManagerOverlay').classList.remove('active'));
  $('pmAdd').addEventListener('click',addProfile);
  $('profileAvatarBtn').addEventListener('click',()=>{
    if(state.profiles.length>1){
      $('app').classList.add('hidden'); openProfilePicker();
    }
  });
  $('victoryOverlay').addEventListener('click',()=>$('victoryOverlay').classList.remove('active'));
  $('calPrev').addEventListener('click',()=>{calMonth--;if(calMonth<0){calMonth=11;calYear--;}renderCalendar();});
  $('calNext').addEventListener('click',()=>{calMonth++;if(calMonth>11){calMonth=0;calYear++;}renderCalendar();});
  document.querySelectorAll('.nav-tab').forEach(tab=>{
    tab.addEventListener('click',()=>switchView(tab.dataset.view));
  });
}

// ============ INIT ============
async function init(){
  state=await loadState();
  const now=new Date(); calYear=now.getFullYear(); calMonth=now.getMonth();

  createParticles();
  resizeCanvas();
  window.addEventListener('resize',resizeCanvas);

  // Splash
  setTimeout(()=>{
    $('splash').classList.add('hidden');
    checkDayReset();
    applyInterest();

    if(state.profiles.length>1){
      openProfilePicker();
    } else {
      $('app').classList.remove('hidden');
      renderAll();
    }
    bindEvents();
  },900);
}

init();
})();
