const APP_EDITION = 'PRO';
const { ipcRenderer } = require('electron');
const pkg = require('./package.json');

const DISCORD_URL = 'https://discord.gg/EfndfUnApv';
const VERSION_URL = 'https://raw.githubusercontent.com/parasma501/resell-control-update/main/version.json';
const FALLBACK_DOWNLOAD_URL = 'https://github.com/parasma501/resell-control-update';
const CURRENT_VERSION = pkg.version;

let updateInfo = null;
let isAppFocused = true;
let properties = [];
let currentProperty = null;
let rentOperations = [];
let rentOperationFilter = localStorage.getItem('rentOperationFilter') || 'all';
let selectedRentMonth = new Date().getMonth();
let selectedRentYear = new Date().getFullYear();
let newPropertyPhoto = null;
let currentDealPhoto = null;
let focusedPhotoArea = null;
let rentShowAllMode = false;
let endRentalSelectedId = null;

let rentHistoryPropertyFilter = null;
let rentHistoryFilter = localStorage.getItem('rentHistoryFilter') || 'all';
let selectedRentHistoryMonth = new Date().getMonth();
let selectedRentHistoryYear = new Date().getFullYear();

let activeScreen = localStorage.getItem('activeScreen') || 'resell';
let operationFilter = localStorage.getItem('operationFilter') || 'all';
let selectedStatsMonth = new Date().getMonth();
let selectedStatsYear = new Date().getFullYear();
let items = [];
let extraProfit = 0;
let currentImg = null;
let currentSellItem = null;
let pendingDeleteItemId = null;
let pendingDeletePropertyId = null;
let bpMode = localStorage.getItem('bpMode') || 'base';

function normalizeVersion(version){
  return String(version || '0.0.0').trim().replace(/^v/i, '');
}

function compareVersions(a, b){
  const pa = normalizeVersion(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = normalizeVersion(b).split('.').map(n => parseInt(n, 10) || 0);
  const maxLen = Math.max(pa.length, pb.length);

  for(let i = 0; i < maxLen; i++){
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if(av > bv) return 1;
    if(av < bv) return -1;
  }

  return 0;
}

function setCurrentVersionLabel(){
  const label = document.getElementById('currentVersionLabel');
  if(label){
    label.textContent = CURRENT_VERSION;
  }
}

async function fetchVersionInfo(){
  const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
    cache: 'no-store'
  });

  if(!response.ok){
    throw new Error(`Не удалось загрузить version.json: ${response.status}`);
  }

  const data = await response.json();

  return {
    latestVersion: normalizeVersion(data.latestVersion),
    downloadUrl: data.downloadUrl || '',
    notes: data.notes || 'Описание обновления отсутствует'
  };
}

function applyUpdateUi(hasUpdate, info){
  const helpBtn = document.getElementById('helpBtn');
  const updateInfoBlock = document.getElementById('updateInfoBlock');
  const updateVersionText = document.getElementById('updateVersionText');
  const updateNotesText = document.getElementById('updateNotesText');
  const helpStatus = document.getElementById('helpStatus');

  if(hasUpdate && info){
    if(helpBtn) helpBtn.classList.add('has-update');
    if(updateInfoBlock) updateInfoBlock.style.display = 'block';
    if(updateVersionText) updateVersionText.textContent = `Доступна версия ${info.latestVersion}`;
    if(updateNotesText) updateNotesText.textContent = info.notes;
    if(helpStatus) helpStatus.textContent = `Доступно обновление: ${info.latestVersion}`;
  } else {
    if(helpBtn) helpBtn.classList.remove('has-update');
    if(updateInfoBlock) updateInfoBlock.style.display = 'none';
    if(helpStatus) helpStatus.textContent = 'У тебя установлена актуальная версия.';
  }
}

async function checkForUpdates(showNoUpdatesMessage = false){
  const helpStatus = document.getElementById('helpStatus');

  try {
    if(helpStatus){
      helpStatus.textContent = 'Проверяю обновления...';
    }

    const remoteInfo = await fetchVersionInfo();
    updateInfo = remoteInfo;

    const hasUpdate = compareVersions(remoteInfo.latestVersion, CURRENT_VERSION) > 0;

    applyUpdateUi(hasUpdate, remoteInfo);

    if(!hasUpdate && showNoUpdatesMessage && helpStatus){
      helpStatus.textContent = `Обновлений нет. Текущая версия: ${CURRENT_VERSION}`;
    }
  } catch (error){
    console.error('Ошибка проверки обновлений:', error);

    if(helpStatus){
      helpStatus.textContent = 'Не удалось проверить обновления.';
    }

    const helpBtn = document.getElementById('helpBtn');
    const updateInfoBlock = document.getElementById('updateInfoBlock');

    if(helpBtn) helpBtn.classList.remove('has-update');
    if(updateInfoBlock) updateInfoBlock.style.display = 'none';
  }
}

async function openDownloadPage(){
  try {
    if(!updateInfo){
      updateInfo = await fetchVersionInfo();
    }

    const url = updateInfo?.downloadUrl || FALLBACK_DOWNLOAD_URL;
    openExternalUrl(url);
  } catch (error){
    console.error('Ошибка открытия страницы загрузки:', error);
    openExternalUrl(FALLBACK_DOWNLOAD_URL);
  }
}

if(!['base', 'base_x2', 'vip', 'vip_x2'].includes(bpMode)){
  bpMode = 'base';
}

let bpGroupFilter = localStorage.getItem('bpGroupFilter') || 'all';
let bpDifficultyFilter = localStorage.getItem('bpDifficultyFilter') || 'all';
let demorganAtTop = localStorage.getItem('demorganAtTop') === 'true';
updateInfo = { available: false, latestVersion: CURRENT_VERSION, notes: '', downloadUrl: FALLBACK_DOWNLOAD_URL };
let operations = [];
const bpChecked = JSON.parse(localStorage.getItem('bpChecked') || '{}');
const bpPinned = JSON.parse(localStorage.getItem('bpPinned') || '{}');
const bpHistory = JSON.parse(localStorage.getItem('bpHistory') || '{}');
const bpDifficultyMap = JSON.parse(localStorage.getItem('bpDifficultyMap') || '{}');
let online3hCycles = parseInt(localStorage.getItem('online3hCycles') || '0', 10) || 0;
const hintTimers = {};
let userTimers = [];
let userTimerIdSeq = 1;

function loadSavedUserTimers(){
  const saved = JSON.parse(localStorage.getItem('savedUserTimers') || '[]');

  userTimers = saved.map((timer, index) => ({
    id: timer.id || ('savedTimer_' + Date.now() + '_' + index),
    name: timer.name || 'Сохранённый таймер',
    initial: timer.initial || 60,
    remaining: timer.remaining || timer.initial || 60,
    interval: null,
    isSaved: true,
    isPinned: !!timer.isPinned
  }));

  userTimerIdSeq = userTimers.length + 1;
}

function saveUserTimersToStorage(){
  const onlySaved = userTimers
    .filter(timer => timer.isSaved)
    .map(timer => ({
      id: timer.id,
      name: timer.name,
      initial: timer.initial,
      remaining: timer.remaining,
      isPinned: !!timer.isPinned
    }));

  localStorage.setItem('savedUserTimers', JSON.stringify(onlySaved));
}

const bpTasks = [
  {id:'online3h',title:'3 часа в онлайне (можно выполнять многократно за день)',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'casino_zero',title:'Нули в казино',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'build25',title:'25 действий на стройке',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'port25',title:'25 действий в порту',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'mine25',title:'25 действий в шахте',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'dance3',title:'3 победы в Дэнс Баттлах',base:2,vip:4,group:'pair',difficulty:'easy'},
  {id:'materials',title:'Заказ материалов для бизнеса вручную (просто прожать вкл/выкл)',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'gym20',title:'20 подходов в тренажерном зале',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'range',title:'Успешная тренировка в тире',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'mail10',title:'10 посылок на почте',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'studio',title:'Арендовать киностудию',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'lottery',title:'Купить лотерейный билет',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'karting',title:'Выиграть гонку в картинге',base:1,vip:2,group:'pair',difficulty:'easy'},
  {id:'farm10',title:'10 действий на ферме (10 коров, 10 пшеницы и т.д. - один любой способ в день)',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'fire25',title:'Потушить 25 "огоньков" пожарным',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'treasure',title:'Выкопать 1 сокровище (не мусор)',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'streetRace',title:'Проехать 1 уличную гонку (через регистрацию в телефоне, ставка минимум 1000$)',base:1,vip:2,group:'pair',difficulty:'easy'},
  {id:'truck3',title:'Выполнить 3 заказа дальнобойщиком (кроме клубов)',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'surgeon2',title:'Два раза оплатить смену внешности у хирурга в EMS',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'cinema5',title:'Добавить 5 видео в кинотеатре',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'training5',title:'Выиграть 5 игр в тренировочном комплексе со ставкой (от 100$)',base:1,vip:2,group:'pair',difficulty:'easy'},
  {id:'arena3',title:'Выиграть 3 любых игры на арене со ставкой (от 100$)',base:1,vip:2,group:'pair',difficulty:'easy'},
  {id:'bus2',title:'2 круга на любом маршруте автобусника',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'animal5',title:'5 раз снять 100% шкуру с животных',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'browser',title:'Посетить любой сайт в браузере',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'brawl',title:'Зайти в любой канал в Brawl',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'match',title:'Поставить лайк любой анкете в Match',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'caseDp',title:'Прокрутить за DP серебряный, золотой, driver кейс или кейс события',base:10,vip:20,group:'single',difficulty:'easy'},
  {id:'petBall',title:'Кинуть мяч питомцу 15 раз',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'petCommands',title:'15 выполненных питомцем команд',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'wheel',title:'Ставка в колесе удачи в казино (межсерверное колесо)',base:3,vip:6,group:'single',difficulty:'easy'},
  {id:'metro',title:'Проехать 1 станцию на метро',base:2,vip:4,group:'single',difficulty:'easy'},
  {id:'fish20',title:'Поймать 20 рыб',base:4,vip:8,group:'single',difficulty:'easy'},
  {id:'clubs2',title:'Выполнить 2 квеста любых клубов',base:4,vip:8,group:'single',difficulty:'easy'},
  {id:'servicePart',title:'Починить деталь в автосервисе',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'basket2',title:'Забросить 2 мяча в баскетболе',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'football2',title:'Забить 2 гола в футболе',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'armwrestling',title:'Победить в армрестлинге',base:1,vip:2,group:'pair',difficulty:'easy'},
  {id:'darts',title:'Победить в дартс',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'volleyball',title:'Поиграть 1 минуту в волейбол',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'tableTennis',title:'Поиграть 1 минуту в настольный теннис',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'bigTennis',title:'Поиграть 1 минуту в большой теннис',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'mafia',title:'Сыграть в мафию в казино',base:3,vip:6,group:'pair',difficulty:'easy'},
  {id:'leasing',title:'Сделать платеж по лизингу',base:1,vip:2,group:'single',difficulty:'easy'},
  {id:'greenhouse',title:'Посадить траву в теплице',base:4,vip:8,group:'single',difficulty:'easy'},
  {id:'lab',title:'Запустить переработку обезболивающих в лаборатории',base:4,vip:8,group:'single',difficulty:'easy'},
  {id:'airdrops2',title:'Принять участие в двух аирдропах',base:4,vip:8,group:'single',difficulty:'easy'},
  {id:'repairOtherCar',title:'Починить чужой автомобиль в автосервисе с прочностью детали ниже 90%',base:2,vip:4,group:'pair',difficulty:'easy'}
];
const hintCards = [
{id:'mail',name:'Почта',time:'10:00',note:'Локальный таймер внутри карточки'},
{id:'tarot',name:'Карты таро',time:'3:00:00',note:'Большой кд без ручного запоминания'},
{id:'training',name:'Дрессировка',time:'15:00',note:'Короткий быстрый таймкод'},
{id:'carjacking',name:'Автоугон',time:'1:30:00',note:'Чтобы не держать в голове'},
{id:'pimp',name:'Сутенерка',time:'1:30:00',note:'Та же логика через один клик'},
{id:'bus',name:'Автобус',time:'3:00',note:'Для короткого запуска'},
{id:'club',name:'Задание клуба',time:'2:00:00',note:'Отдельный таймер в карточке'},
{id:'rangehint',name:'Тир',time:'1:30:00',note:'Тоже можно крутить отдельно'}
];
const defaultHintOrder = hintCards.map(h => h.id);

function getSavedHintOrder(){
  try{
    const saved = JSON.parse(localStorage.getItem('hintOrder') || '[]');
    if(!Array.isArray(saved) || !saved.length) return [...defaultHintOrder];

    const validSaved = saved.filter(id => defaultHintOrder.includes(id));
    const missing = defaultHintOrder.filter(id => !validSaved.includes(id));

    return [...validSaved, ...missing];
  }catch(e){
    return [...defaultHintOrder];
  }
}

let hintOrder = getSavedHintOrder();

function saveHintOrder(){
  localStorage.setItem('hintOrder', JSON.stringify(hintOrder));
}

function moveHintCard(id, direction){
  const index = hintOrder.indexOf(id);
  if(index === -1) return;

  const newIndex = direction === 'up' ? index - 1 : index + 1;
  if(newIndex < 0 || newIndex >= hintOrder.length) return;

  [hintOrder[index], hintOrder[newIndex]] = [hintOrder[newIndex], hintOrder[index]];
  saveHintOrder();
  renderHints();
}
const timers = {
  custom:{initial:60,remaining:60,interval:null,displayId:'customTimerDisplay'},
  demorganBox:{initial:69,remaining:69,interval:null,displayId:'demorganBoxDisplay'},
  demorganSew:{initial:89,remaining:89,interval:null,displayId:'demorganSewDisplay'},
  online3h:{initial:10800,remaining:10800,interval:null,displayId:null}
};

function appMinimize(){ ipcRenderer.send('window:minimize'); }
function openDiscord(){
  ipcRenderer.send('open-external', DISCORD_URL);
}

function openUpdateDownload(){
  ipcRenderer.send('open-external', updateInfo.downloadUrl || FALLBACK_DOWNLOAD_URL);
}

function appClose(){ ipcRenderer.send('window:close'); }

function openExternalUrl(url){
  if(!url) return;
  ipcRenderer.send('open-external', url);
}

function toggleNavMenu(){ document.getElementById('navMenu').classList.toggle('open'); }
function toggleHelpMenu(){ document.getElementById('helpMenu').classList.toggle('open'); }
document.addEventListener('click',(e)=>{
  const nav=document.getElementById('navMenu'), burger=document.getElementById('burgerBtn');
  const help=document.getElementById('helpMenu'), helpBtn=document.getElementById('helpBtn');
  if(!nav.contains(e.target) && !burger.contains(e.target)) nav.classList.remove('open');
  if(!help.contains(e.target) && !helpBtn.contains(e.target)) help.classList.remove('open');
});

function switchScreen(screen){
  activeScreen = screen;
  localStorage.setItem('activeScreen', screen);

  document.querySelectorAll('.screen').forEach(el => {
    el.classList.toggle('active', el.id === screen + 'Screen');
  });

  document.querySelectorAll('[data-screen-btn]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.screenBtn === screen);
  });

  document.getElementById('titlebarSubtitle').textContent =
    ({
      resell: 'Перекуп',
      bp: 'Фарм бонус поинтов',
      timers: 'Таймеры',
      rent: 'Аренда',
      settings: 'Настройки'
    })[screen] || 'Перекуп';

  document.getElementById('navMenu').classList.remove('open');
  setTimeout(updateScrollToTopButton, 50);
}

function renderUpdateUI(){
  document.getElementById('currentVersionLabel').textContent = CURRENT_VERSION;
  const helpBtn=document.getElementById('helpBtn'), updateBlock=document.getElementById('updateInfoBlock'), helpStatus=document.getElementById('helpStatus');
  if(updateInfo.available){
    helpBtn.classList.add('has-update');
    updateBlock.style.display='block';
    document.getElementById('updateVersionText').textContent = `Новая версия: ${updateInfo.latestVersion}`;
    document.getElementById('updateNotesText').textContent = updateInfo.notes || 'Описание обновления не указано.';
    helpStatus.textContent='Найдена новая версия. Можно перейти в Discord и скачать свежую сборку.';
  }else{
    helpBtn.classList.remove('has-update');
    updateBlock.style.display='none';
    helpStatus.textContent='Установлена актуальная версия или обновление пока не найдено.';
  }
}

function parseMoney(value){
  if(typeof value==='number') return value;
  let str=String(value||'').trim();
  const negative = str.startsWith('-');
  str = str.replace(/[^\d]/g,'');
  const num = parseInt(str,10) || 0;
  return negative ? -num : num;
}
function formatMoney(value){ return (Number(value)||0).toLocaleString('de-DE'); }
function moneyWithCurrency(value){ return `${formatMoney(value)}$`; }
function bindMoneyInputs(){
  document.querySelectorAll('.text-money').forEach(input=>input.addEventListener('input',()=>{
    let raw=input.value.trim();
    const negative = raw.startsWith('-');
    const digits=raw.replace(/[^\d]/g,'');
    const formatted=digits ? formatMoney(digits) : '';
    input.value = negative ? (formatted ? '-' + formatted : '-') : formatted;
  }));
}
function saveItems(){ localStorage.setItem('items', JSON.stringify(items)); }
function saveOperations(){ localStorage.setItem('operations', JSON.stringify(operations)); }
function saveBpState(){ localStorage.setItem('bpChecked', JSON.stringify(bpChecked)); localStorage.setItem('bpPinned', JSON.stringify(bpPinned)); localStorage.setItem('bpHistory', JSON.stringify(bpHistory)); localStorage.setItem('bpMode', bpMode); }
function formatDate(ts){ const d=new Date(ts); return `${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`; }
function startOfDay(d){ return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime(); }

function loadData(){
  try{ items = JSON.parse(localStorage.getItem('items')||'[]') || []; }catch(e){ items=[]; }
  try{ operations = JSON.parse(localStorage.getItem('operations')||'[]') || []; }catch(e){ operations=[]; }
  extraProfit = operations.reduce((sum,op)=> op.type!=='sale' ? sum + (op.amount||0) : sum, 0);
}
function pushOperation(amount, comment, type='manual'){
  operations.unshift({id:Date.now()+Math.random(),amount,comment,type,timestamp:Date.now()});
  if(type!=='sale') extraProfit += amount;
  saveOperations();
}
function setOperationFilter(filter){
  operationFilter = filter;
  localStorage.setItem('operationFilter', filter);
  document.querySelectorAll('[data-filter]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.filter === filter)
  );
  updateMonthPeriodControls();
  renderOperations();
  updateStats();  // <-- добавь эту строку
}
function initStatsMonthSelectors(){
  const monthSelect = document.getElementById('monthSelect');
  const yearSelect = document.getElementById('yearSelect');

  if(!monthSelect || !yearSelect) return;

  monthSelect.value = String(selectedStatsMonth);
  yearSelect.innerHTML = '';

  const currentYear = new Date().getFullYear();
  const startYear = 2026;

  for(let year = startYear; year <= currentYear + 1; year++){
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year);
    if(year === selectedStatsYear) option.selected = true;
    yearSelect.appendChild(option);
  }
}

function changeStatsMonth(){
  const monthSelect = document.getElementById('monthSelect');
  const yearSelect = document.getElementById('yearSelect');
  if(!monthSelect || !yearSelect) return;
  
  selectedStatsMonth = parseInt(monthSelect.value, 10);
  selectedStatsYear = parseInt(yearSelect.value, 10);
  
  renderOperations();
  updateStats();  // <-- добавь эту строку
}

function updateMonthPeriodControls(){
  const controls = document.getElementById('monthPeriodControls');
  if(!controls) return;
  controls.style.display = operationFilter === 'month' ? 'flex' : 'none';
}
function getFilteredOperations(){
  const now = new Date();

  return operations.filter(op => {
    const ts = op.timestamp || Date.now();
    const d = new Date(ts);

    if(operationFilter === 'today'){
      return ts >= startOfDay(now);
    }

    if(operationFilter === 'week'){
      const w = new Date(now);
      w.setDate(now.getDate() - 6);
      return ts >= startOfDay(w);
    }

    if(operationFilter === 'month'){
      return d.getMonth() === selectedStatsMonth
        && d.getFullYear() === selectedStatsYear;
    }

    return true;
  });
}

function renderOperations(){
  const body = document.getElementById('operationsTable');
  const filtered = getFilteredOperations();
  body.innerHTML = '';
  
  if(!filtered.length){
    body.innerHTML = '<div class="empty-state">Записей нет</div>';
    return;
  }
  
  // Строим карту покупок по имени товара из items (карточки)
  const buyMap = {};
  items.forEach(item => {
    if(item.buy && item.name){
      buyMap[item.name] = item.buy;
    }
  });
  
  filtered.forEach(op => {
    const row = document.createElement('div');
    row.className = 'row-entry';
    const moneyClass = op.amount < 0 ? 'money-minus' : 'money-plus';
    
    // Для продаж считаем чистую прибыль из карточки товара
    let netProfit = '-';
    if(op.type === 'sale' && op.comment){
      // Извлекаем имя товара из комментария "Продажа товара: Название"
      const productName = op.comment.replace('Продажа товара: ', '');
      const buyCost = buyMap[productName] || 0;
      if(buyCost > 0){
        netProfit = moneyWithCurrency((op.amount || 0) - buyCost);
      }
    }
    
    row.innerHTML = `
      <div class="${moneyClass}">${moneyWithCurrency(op.amount)}</div>
      <div>${op.comment}</div>
      <div class="net-profit-cell">${netProfit}</div>
      <div>${formatDate(op.timestamp)}</div>
      <button class="op-delete" title="Удалить запись" onclick="deleteOperation('${op.id}')">×</button>
    `;
    body.appendChild(row);
  });
}

function scrollToTopRent(){
  const el = document.querySelector('.property-list');
  if(el) el.scrollTo({ top: 0, behavior: 'smooth' });
}

function openAddPropertyModal(){
    newPropertyPhoto = null;
  focusedPhotoArea = null;
}

function addNewProperty(){
  const newProp = {
    id: Date.now(),
    name: 'Новая категория',
    description: '',
    image: null
  };
  
  properties.push(newProp);
  saveProperties();
  renderProperties();
  
  // Сразу выбираем новую категорию для редактирования
  selectProperty(newProp);
}

function getCommentSuggestions(){
  const comments = operations.map(op => op.comment).filter(c => c && c.trim());
  return [...new Set(comments)].slice(0, 20);
}

let activeAutocompleteIndex = -1;

function setupCommentAutocomplete(){
  const input = document.getElementById('leftName');
  const container = document.getElementById('autocompleteContainer');
  const list = document.getElementById('autocompleteList');
  
  console.log('Autocomplete setup:', { input, container, list });
  
  if(!input || !container || !list) return;
  
  // Позиционируем контейнер рядом с input
  function positionContainer(){
    const rect = input.getBoundingClientRect();
    container.style.left = rect.left + 'px';
    container.style.top = (rect.bottom + 4) + 'px';
    container.style.width = rect.width + 'px';
  }
  
  input.addEventListener('input', () => {
    const value = input.value.toLowerCase();
    console.log('Input value:', value);
    
    if(value.length < 1){
      container.classList.remove('visible');
      return;
    }
    
    const suggestions = getCommentSuggestions().filter(c => c.toLowerCase().includes(value));
    console.log('Suggestions:', suggestions);
    
    if(suggestions.length === 0){
      container.classList.remove('visible');
      return;
    }
    
    list.innerHTML = suggestions.map((s, index) => 
      `<div class="autocomplete-item" data-value="${s}">${s}</div>`
    ).join('');
    
    positionContainer();
    container.classList.add('visible');
    console.log('Container visible!', container.style.top, container.style.left);
    activeAutocompleteIndex = -1;
    
    const items = list.querySelectorAll('.autocomplete-item');
    items.forEach(item => {
      item.addEventListener('click', () => {
        input.value = item.dataset.value;
        container.classList.remove('visible');
      });
    });
  });
  
  input.addEventListener('focus', () => {
    if(input.value.length > 0){
      input.dispatchEvent(new Event('input'));
    }
  });
}

// Сброс фокуса при клике вне области фото
document.addEventListener('click', (e) => {
  const rentPhotoPreview = document.getElementById('rentPhotoPreview');
  if(rentPhotoPreview && !rentPhotoPreview.contains(e.target)){
    focusedPhotoArea = null;
    rentPhotoPreview.style.borderColor = '#28374a';
    rentPhotoPreview.style.boxShadow = 'none';
  }
});

// Глобальный слушатель Ctrl+V для вставки фото
document.addEventListener('paste', (e) => {
  if(!focusedPhotoArea || focusedPhotoArea !== 'rent') return;
  if(!currentProperty) return;
  
  const items = e.clipboardData?.items || [];
  for(const item of items){
    if(item.type.includes('image')){
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        currentProperty.image = ev.target.result;
        saveProperties();
        document.getElementById('rentPhotoPreview').innerHTML = `<img src="${currentProperty.image}">`;
        // Сброс фокуса
        focusedPhotoArea = null;
        const rentPhotoPreview = document.getElementById('rentPhotoPreview');
        if(rentPhotoPreview){
          rentPhotoPreview.style.borderColor = '#28374a';
          rentPhotoPreview.style.boxShadow = 'none';
        }
      };
      reader.readAsDataURL(file);
      e.preventDefault();
      break;
    }
  }
});

function saveProperties(){ localStorage.setItem('rentProperties', JSON.stringify(properties)); }
function saveRentOperations(){ localStorage.setItem('rentOperations', JSON.stringify(rentOperations)); }
function loadRentData(){
    try{ properties = JSON.parse(localStorage.getItem('rentProperties')||'[]') || []; }catch(e){ properties=[]; }
    try{ rentOperations = JSON.parse(localStorage.getItem('rentOperations')||'[]') || []; }catch(e){ rentOperations=[]; }
}
function renderProperties(){
  const list = document.getElementById('propertyList');
  if(!list) return;
  list.innerHTML = '';
  if(!properties.length){
    list.innerHTML = '<div class="empty-state" style="padding:20px;text-align:center">Нет имущества</div>';
    return;
  }
  properties.forEach(prop => {
    const div = document.createElement('div');
    div.className = 'property-item' + (currentProperty && currentProperty.id === prop.id ? ' active' : '');
    div.dataset.propertyId = prop.id;
    
    const displayName = prop.name || 'Новая категория';
    const isDeleteConfirm = pendingDeletePropertyId === prop.id;
    
    div.innerHTML = `
      <div class="property-content">
        <div class="property-name">${displayName}</div>
        ${!isDeleteConfirm 
          ? `<button class="property-delete-btn">✕</button>` 
          : `<div class="property-delete-confirm">
              <button class="property-confirm-btn yes">Да</button>
              <button class="property-confirm-btn no">Нет</button>
            </div>`
        }
      </div>
    `;
    
    // Клик по кнопке удаления
    const deleteBtn = div.querySelector('.property-delete-btn');
    if(deleteBtn){
      deleteBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        requestDeleteProperty(prop.id);
      });
    }
    
    // Клик по кнопкам подтверждения
    const yesBtn = div.querySelector('.property-confirm-btn.yes');
    const noBtn = div.querySelector('.property-confirm-btn.no');
    if(yesBtn){
      yesBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteProperty(prop.id);
      });
    }
    if(noBtn){
      noBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        cancelDeleteProperty(prop.id);
      });
    }
    
    // Клик по самой карточке
    div.addEventListener('click', (e) => {
      if(!e.target.closest('button') && !isDeleteConfirm) {
        selectProperty(prop);
      }
    });
    
    list.appendChild(div);
  });
}

function requestDeleteProperty(id){
  pendingDeletePropertyId = id;
  renderProperties();
}

function cancelDeleteProperty(id){
  if (pendingDeletePropertyId === id) {
    pendingDeletePropertyId = null;
    renderProperties();
  }
}

function deleteProperty(id){
  properties = properties.filter(p => p.id !== id);
  if (pendingDeletePropertyId === id) pendingDeletePropertyId = null;
  
  if(currentProperty && currentProperty.id === id){
    currentProperty = null;
    const preview = document.getElementById('rentPhotoPreview');
    if(preview) preview.innerHTML = 'Нет фото';
    const nameInput = document.getElementById('propertyName');
    const descriptionInput = document.getElementById('propertyDescription');
    if(nameInput) nameInput.value = '';
    if(descriptionInput) descriptionInput.value = '';
  }
  
  saveProperties();
  renderProperties();
}

function confirmAddProperty(){
  const name = document.getElementById('newPropertyName').value.trim();
  const category = document.getElementById('newPropertyCategory').value.trim();
  const description = document.getElementById('newPropertyDescription').value.trim();
  
  if(!name && !category) return;
  
  const newProp = {
    id: Date.now(),
    name: name || category || 'Новая категория',
    description: description || '',
    image: newPropertyPhoto
  };
  
  properties.push(newProp);
  saveProperties();
  renderProperties();
  closeAddPropertyModal();
}

function closeAddPropertyModal(){
  document.getElementById('addPropertyModal').style.display = 'none';
}
function newPropertyPhotoFromClipboard(){
  document.addEventListener('paste', handleNewPropertyPaste);
}
function handleNewPropertyPaste(e){
  const items = e.clipboardData?.items || [];
  for(const item of items){
    if(item.type.includes('image')){
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        newPropertyPhoto = ev.target.result;
        document.getElementById('newPropertyPhotoPreview').innerHTML = `<img src="${newPropertyPhoto}">`;
      };
      reader.readAsDataURL(file);
      break;
    }
  }
}
function handlePropertyPhotoPaste(e){
  const items = e.clipboardData?.items || [];
  for(const item of items){
    if(item.type.includes('image')){
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        newPropertyPhoto = ev.target.result;
        document.getElementById('newPropertyPhotoPreview').innerHTML = `<img src="${newPropertyPhoto}">`;
      };
      reader.readAsDataURL(file);
      break;
    }
  }
}
function handlePropertyPhotoPaste(e){
  const addModal = document.getElementById('addPropertyModal');
  if(!addModal || addModal.style.display !== 'flex') return;
  
  const items = e.clipboardData?.items || [];
  for(const item of items){
    if(item.type.includes('image')){
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        newPropertyPhoto = ev.target.result;
        document.getElementById('newPropertyPhotoPreview').innerHTML = `<img src="${newPropertyPhoto}">`;
      };
      reader.readAsDataURL(file);
      break;
    }
  }
}
function openDealModal(){
  document.getElementById('dealModal').style.display = 'flex';
  initDealModal();
}
function closeDealModal(){ document.getElementById('dealModal').style.display = 'none'; }
function initDealModal(){
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.getElementById('dealStart').value = now.toISOString().slice(0,16);
  const end = new Date(now.getTime() + 1 * 60 * 60 * 1000);
  document.getElementById('dealEnd').value = end.toISOString().slice(0,16);
  document.getElementById('dealHours').value = 1;
  document.getElementById('dealPricePerHour').value = '';
  document.getElementById('dealTotal').value = '';
  document.getElementById('dealComment').value = '';
}
function applyDealTemplate(hours){
  document.getElementById('dealHours').value = hours;
  const start = new Date();
  start.setMinutes(start.getMinutes() - start.getTimezoneOffset());
  document.getElementById('dealStart').value = start.toISOString().slice(0,16);
  const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
  document.getElementById('dealEnd').value = end.toISOString().slice(0,16);
  calculateDealTotal();
}
function calculateDealTotal(){
  const hours = parseInt(document.getElementById('dealHours').value) || 0;
  const pricePerHour = parseMoney(document.getElementById('dealPricePerHour').value);
  const total = hours * pricePerHour;
  document.getElementById('dealTotal').value = formatMoney(total);
}
function confirmDeal(){
    if(!currentProperty) return;
    const start = document.getElementById('dealStart').value;
    const end = document.getElementById('dealEnd').value;
    const hours = parseInt(document.getElementById('dealHours').value) || 0;
    const pricePerHour = parseMoney(document.getElementById('dealPricePerHour').value);
    const total = parseMoney(document.getElementById('dealTotal').value);
    const comment = document.getElementById('dealComment').value.trim();
    
    if(!start || !end || hours <= 0) return;
    
    const operation = {
        id: Date.now(),
        propertyId: currentProperty.id,
        propertyName: currentProperty.name,
        start,
        end,
        hours,
        pricePerHour,
        total,
        comment: comment || `Аренда: ${currentProperty.name}`,
        timestamp: Date.now()
    };
    
    rentOperations.unshift(operation);
    saveRentOperations();  // ← УБЕДИСЬ, ЧТО ЭТА СТРОКА ЕСТЬ!
    updateRentStats();
    closeDealModal();
    
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('notify-rental-created', operation);
}
function setRentFilter(filter){
  rentOperationFilter = filter;
  localStorage.setItem('rentOperationFilter', filter);
  document.querySelectorAll('[data-filter]').forEach(btn =>
    btn.classList.toggle('active', btn.dataset.filter === filter)
  );
  updateRentMonthControls();
  updateRentStats();
}
function updateRentMonthControls(){
  const controls = document.getElementById('rentMonthPeriodControls');
  if(!controls) return;
  controls.style.display = rentOperationFilter === 'month' ? 'flex' : 'none';
}
function initRentMonthSelectors(){
  const monthSelect = document.getElementById('rentMonthSelect');
  const yearSelect = document.getElementById('rentYearSelect');
  if(!monthSelect || !yearSelect) return;
  
  // Заполняем месяцы (точно как в перекупе)
  monthSelect.innerHTML = '';
  const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
  months.forEach((month, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = month;
    if(index === selectedRentMonth) option.selected = true;
    monthSelect.appendChild(option);
  });
  
  // Заполняем годы
  yearSelect.innerHTML = '';
  const currentYear = new Date().getFullYear();
  const startYear = 2026;
  for(let year = startYear; year <= currentYear + 1; year++){
    const option = document.createElement('option');
    option.value = String(year);
    option.textContent = String(year);
    if(year === selectedRentYear) option.selected = true;
    yearSelect.appendChild(option);
  }
}
function changeRentMonth(){
  const monthSelect = document.getElementById('rentMonthSelect');
  const yearSelect = document.getElementById('rentYearSelect');
  if(!monthSelect || !yearSelect) return;
  selectedRentMonth = parseInt(monthSelect.value, 10);
  selectedRentYear = parseInt(yearSelect.value, 10);
  updateRentStats();
}
function getFilteredRentOperations(){
  const now = new Date();
  return rentOperations.filter(op => {
    const ts = op.timestamp || Date.now();
    const d = new Date(ts);
    if(rentOperationFilter === 'today'){
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      return ts >= startOfDay.getTime();
    }
    if(rentOperationFilter === 'week'){
      const weekAgo = new Date(now);
      weekAgo.setDate(now.getDate() - 6);
      return ts >= weekAgo.getTime();
    }
    if(rentOperationFilter === 'month'){
      return d.getMonth() === selectedRentMonth && d.getFullYear() === selectedRentYear;
    }
    return true;
  });
}
function updateRentStats(){
    if(!currentProperty) {
        // Если машина не выбрана — показываем общие данные
        const filtered = getFilteredRentOperations();
        const total = filtered.reduce((sum, op) => sum + (op.total || 0), 0);
        const lastOp = filtered[0];
        document.getElementById('rentIncome').innerText = moneyWithCurrency(total);
        document.getElementById('rentComment').innerText = lastOp ? lastOp.propertyName : 'Выберите машину';
        document.getElementById('rentDate').innerText = lastOp ? formatDate(lastOp.timestamp) : '-';
        return;
    }
    
    // Данные по выбранной машине
    const propertyRentals = rentOperations.filter(op => op.propertyId === currentProperty.id);
    
    // Фильтруем по периоду (как в getFilteredRentOperations)
    const now = new Date();
    const filtered = propertyRentals.filter(op => {
        const ts = op.timestamp || Date.now();
        const d = new Date(ts);
        if(rentOperationFilter === 'today'){
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return ts >= startOfDay.getTime();
        }
        if(rentOperationFilter === 'week'){
            const weekAgo = new Date(now);
            weekAgo.setDate(now.getDate() - 6);
            return ts >= weekAgo.getTime();
        }
        if(rentOperationFilter === 'month'){
            return d.getMonth() === selectedRentMonth && d.getFullYear() === selectedRentYear;
        }
        return true;
    });
    
    const total = filtered.reduce((sum, op) => sum + (op.total || 0), 0);
    const lastOp = filtered[0];
    
    // Деньги — сумма по машине
    document.getElementById('rentIncome').innerText = moneyWithCurrency(total);
    
    // Комментарий — название машины
    document.getElementById('rentComment').innerText = currentProperty.name;
    
    // Дата — начало → конец последней аренды
    if(lastOp) {
        const start = formatDate(lastOp.start);
        const end = formatDate(lastOp.end);
        document.getElementById('rentDate').innerText = `${start} → ${end}`;
    } else {
        document.getElementById('rentDate').innerText = '-';
    }
}

function renderRentalsForCurrentProperty() {
    const list = document.getElementById('rentalsList');
    if(!list || !currentProperty) return;
    
    const propertyRentals = rentOperations.filter(op => op.propertyId === currentProperty.id);
    
    if(propertyRentals.length === 0) {
        list.innerHTML = '<div class="empty-state">Нет аренд для этой машины</div>';
        return;
    }
    
    list.innerHTML = '';
    propertyRentals.forEach(rental => {
        const div = document.createElement('div');
        div.className = 'rental-item';
        div.innerHTML = `
            <div class="rental-info">
                <div class="rental-dates">${formatDate(rental.start)} → ${formatDate(rental.end)}</div>
                <div class="rental-hours">${rental.hours} часов</div>
                <div class="rental-total">${moneyWithCurrency(rental.total)}</div>
            </div>
        `;
        list.appendChild(div);
    });
}


function deleteOperation(id){
  operations = operations.filter(op => String(op.id) !== String(id));
  saveOperations();
  renderOperations();
  updateStats();
}

function manualAddLeftProfit(e){
  e.stopPropagation();
  const name = document.getElementById('leftName').value.trim();
  const sum = parseMoney(document.getElementById('leftBuy').value);
  if(!name || sum === 0) return;
  pushOperation(sum, name, 'manual');
  renderOperations();
  updateStats();
  document.getElementById('leftName').value = '';
  document.getElementById('leftBuy').value = '';
}
function updateStats(){
  // Получаем отфильтрованные операции по текущему фильтру
  const filtered = getFilteredOperations();
  
  // Расход = сумма ручных записей за период
  const manual = filtered.filter(op => op.type === 'manual').reduce((sum, op) => sum + (op.amount || 0), 0);
  
  // Доход = сумма продаж за период
  const sales = filtered.filter(op => op.type === 'sale').reduce((sum, op) => sum + (op.amount || 0), 0);
  
  // Прибыль = Доход - Расход
  const profit = sales - manual;
  
  document.getElementById('income').innerText = moneyWithCurrency(sales);
  document.getElementById('expense').innerText = moneyWithCurrency(manual);
  document.getElementById('profit').innerText = moneyWithCurrency(profit);
}
function openAddModal(){
  document.getElementById('addModal').style.display = 'flex';
}
function closeAddModal(){ document.getElementById('addModal').style.display='none'; document.getElementById('modalName').value=''; document.getElementById('modalBuy').value=''; document.getElementById('modalSell').value=''; currentImg=null; document.getElementById('modalImgContainer').innerHTML='Вставьте фото через Ctrl+V'; }
function handlePaste(e){
  const addModal = document.getElementById('addModal');
  if(!addModal || addModal.style.display !== 'flex') return;

  const itemsClipboard = e.clipboardData?.items || [];

  for(const item of itemsClipboard){
    if(item.type.includes('image')){
      const file = item.getAsFile();
      const reader = new FileReader();

      reader.onload = ev => {
        currentImg = ev.target.result;
        document.getElementById('modalImgContainer').innerHTML =
          `<img src="${currentImg}" style="width:100%;height:100%;object-fit:cover">`;
      };

      reader.readAsDataURL(file);
      e.preventDefault();
      return;
    }
  }
}
function bindGlobalPaste(){
  if(document.body.dataset.pasteBound === '1') return;
  document.body.dataset.pasteBound = '1';

  document.addEventListener('paste', handlePaste);
}
function bindGlobalPasteForAddModal(){
  if(document.body.dataset.addModalPasteBound === '1') return;
  document.body.dataset.addModalPasteBound = '1';

  document.addEventListener('paste', (e)=>{
    const addModal = document.getElementById('addModal');
    if(!addModal || addModal.style.display !== 'flex') return;

    handlePaste(e);
  });
}
function bindAddModalHotkeys(){
  const addModal = document.getElementById('addModal');
  const addModalContent = document.getElementById('addModalContent');

  if(!addModal || !addModalContent || addModalContent.dataset.hotkeysBound === '1') return;

  addModalContent.dataset.hotkeysBound = '1';

  addModalContent.addEventListener('keydown', (e)=>{
    if(e.key !== 'Enter') return;
    if(addModal.style.display !== 'flex') return;

    e.preventDefault();
    confirmAddItem();
  });
}
function confirmAddItem(){
  const name = document.getElementById('modalName').value.trim();
  const buy = parseMoney(document.getElementById('modalBuy').value);
  const sell = parseMoney(document.getElementById('modalSell').value) || null;

  if(!name && !buy) return;

  const newItem = {
    id: Date.now(),
    name,
    buy,
    sell,
    img: currentImg
  };

  items.unshift(newItem);

  // Если указана цена продажи — добавляем запись о продаже
  if(sell){
    pushOperation(sell, `Продажа товара: ${name}`, 'sale');
  }

  saveItems();
  renderItems();
  renderOperations();
  updateStats();
  closeAddModal();
}
function openSellModal(id){
  currentSellItem=items.find(i=>i.id===id);
  if(!currentSellItem) return;
  document.getElementById('sellModal').style.display='flex';
  document.getElementById('sellInput').value=currentSellItem.sell ? formatMoney(currentSellItem.sell) : '';
}
function closeSellModal(){ document.getElementById('sellModal').style.display='none'; currentSellItem=null; }
function confirmSell(){
  if(!currentSellItem) return;
  currentSellItem.sell=parseMoney(document.getElementById('sellInput').value);
  if(currentSellItem.sell) pushOperation(currentSellItem.sell, `Продажа товара: ${currentSellItem.name}`, 'sale');
  saveItems(); renderItems(); renderOperations(); closeSellModal();
}
function requestDeleteItem(id, e){
  e.stopPropagation();
  pendingDeleteItemId = id;
  renderItems();
}

function cancelDeleteItem(id, e){
  e.stopPropagation();
  if (pendingDeleteItemId === id) {
    pendingDeleteItemId = null;
    renderItems();
  }
}

function deleteItem(id, e){
  e.stopPropagation();
  items = items.filter(i => i.id !== id);
  if (pendingDeleteItemId === id) pendingDeleteItemId = null;
  saveItems();
  renderItems();
}
function confirmResetStats(){
  document.getElementById('resetConfirmModal').style.display = 'flex';
}

function closeResetModal(){
  document.getElementById('resetConfirmModal').style.display = 'none';
}

function resetAllData(){
  items = [];
  operations = [];
  extraProfit = 0;

  saveItems();
  saveOperations();
  renderItems();
  renderOperations();
  updateStats();
  closeResetModal();
}

function resetLeftSide(){
  operations = [];
  extraProfit = 0;

  saveOperations();
  renderOperations();
  updateStats();
  closeResetModal();
}

function resetRightSide(){
  items = [];

  saveItems();
  renderItems();
  updateStats();
  closeResetModal();
}
function renderItems(){
  const inStock=document.getElementById('inStock'), sold=document.getElementById('soldItems');
  const search=(document.getElementById('search').value||'').toLowerCase();
  inStock.innerHTML=''; sold.innerHTML='';
  items.filter(i=>i.name.toLowerCase().includes(search)).forEach(i=>{
    const div=document.createElement('div');
    div.className='item-card';
    const isDeleteConfirm = pendingDeleteItemId === i.id;

div.innerHTML = `
  ${!isDeleteConfirm ? `<button class="item-delete" onclick="requestDeleteItem(${i.id},event)">X</button>` : ''}
  <div class="item-media">
    ${i.img ? `<img src="${i.img}">` : 'Нет фото'}
    ${
      isDeleteConfirm
        ? `<div class="item-confirm-delete">
            <button class="item-confirm-yes" onclick="deleteItem(${i.id},event)">Да</button>
            <button class="item-confirm-cancel" onclick="cancelDeleteItem(${i.id},event)">Отмена</button>
          </div>`
        : `<button class="item-overlay ${i.sell ? 'sold' : 'sell'}" onclick="${i.sell ? '' : `openSellModal(${i.id})`}">${i.sell ? 'ПРОДАНО' : 'ПРОДАТЬ'}</button>`
    }
  </div>
  <div class="item-body">
    <div class="item-name">${i.name}</div>
    <div class="item-price">${moneyWithCurrency(i.buy)}</div>
    ${i.sell ? `<div class="item-price">Продажа: ${moneyWithCurrency(i.sell)}</div>` : ''}
  </div>
`;
    if(i.sell) sold.appendChild(div); else inStock.appendChild(div);
  });
  updateStats();
}

function selectProperty(prop){
  currentProperty = prop;
  
  const nameInput = document.getElementById('propertyName');
  const descriptionInput = document.getElementById('propertyDescription');
  
  if(nameInput){
    nameInput.value = prop.name || '';
  }
  
  if(descriptionInput){
    descriptionInput.value = prop.description || '';
  }
  
  const preview = document.getElementById('rentPhotoPreview');
  if(prop.image){
    preview.innerHTML = `<img src="${prop.image}">`;
  } else {
    preview.innerHTML = 'Нет фото';
  }
  
  renderProperties();
  updateRentStats();
  renderRentalsForCurrentProperty();
}

function getBpPoints(task){
  if(bpMode === 'base') return task.base;
  if(bpMode === 'base_x2') return task.base * 2;
  if(bpMode === 'vip') return task.vip;
  if(bpMode === 'vip_x2') return task.vip * 2;
  return task.base;
}

function getOnline3hTask(){
  return bpTasks.find(task => task.id === 'online3h');
}

function saveOnline3hCycles(){
  localStorage.setItem('online3hCycles', String(online3hCycles));
}

function getOnline3hBpValue(){
  const task = getOnline3hTask();
  if(!task) return 0;
  return online3hCycles * getBpPoints(task);
}

function getTaskDifficulty(task){
  return bpDifficultyMap[task.id] || task.difficulty || 'easy';
}

function cycleTaskDifficulty(event, id){
  event.stopPropagation();

  const current = bpDifficultyMap[id] || 'easy';
  let next = 'easy';

  if(current === 'easy') next = 'medium';
  else if(current === 'medium') next = 'hard';
  else next = 'easy';

  bpDifficultyMap[id] = next;
  localStorage.setItem('bpDifficultyMap', JSON.stringify(bpDifficultyMap));
  renderBpTasks();
}

function getDifficultyLabel(difficulty){
  if(difficulty === 'easy') return '🟢';
  if(difficulty === 'medium') return '🟡';
  return '🔴';
}

function setBpMode(mode){
  bpMode = mode;
  document.querySelectorAll('[data-bp-mode]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.bpMode === mode);
  });
  saveBpState();
  renderBpTasks();
}
function recordBpUsage(id){
  if(!bpHistory[id]) bpHistory[id] = [];
  bpHistory[id].push(Date.now());
  bpHistory[id] = bpHistory[id].slice(-60);
}
function getBpRecentCount(id, days){
  const history = bpHistory[id] || [];
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return history.filter(ts => ts >= cutoff).length;
}
function getBpScore(id){
  const history = bpHistory[id] || [];
  if(!history.length) return 0;
  return getBpRecentCount(id, 3) * 5 + getBpRecentCount(id, 7) * 3 + getBpRecentCount(id, 30) * 1 + history.length * 0.05;
}
function sortBpTasks(tasks){
  return [...tasks].sort((a,b)=>{
    const aPinned = !!bpPinned[a.id], bPinned = !!bpPinned[b.id];
    if(aPinned !== bPinned) return aPinned ? -1 : 1;
    const aScore = getBpScore(a.id), bScore = getBpScore(b.id);
    if(aScore !== bScore) return bScore - aScore;
    const aChecked = !!bpChecked[a.id], bChecked = !!bpChecked[b.id];
    if(aChecked !== bChecked) return aChecked ? -1 : 1;
    return a.title.localeCompare(b.title, 'ru');
  });
}
function buildBpRow(task, options = {}){
  const points = getBpPoints(task);
  const isFrequent = !!options.isFrequent;
  const difficulty = getTaskDifficulty(task);
  const isOnline3h = task.id === 'online3h';

  const row = document.createElement('div');
  row.className = 'bp-item bp-difficulty-' + getTaskDifficulty(task) + (bpChecked[task.id] ? ' is-checked' : '');

  if(!isOnline3h){
    row.setAttribute('onclick', `toggleTaskFromRow('${task.id}')`);
  }

  const leftContent = isOnline3h
    ? `
      <div class="bp-main">
        <div class="bp-title">${task.title}</div>
      </div>
    `
    : `
      <div class="bp-main">
        <input
          type="checkbox"
          ${bpChecked[task.id] ? 'checked' : ''}
          onclick="event.stopPropagation()"
          onchange="toggleTask('${task.id}', this.checked)"
        >
        <div class="bp-title">${task.title}</div>
      </div>
    `;

  const inlineTimerControls = isOnline3h
    ? `
      <div class="bp-inline-timer">
        <div class="bp-inline-timer-value" id="bp-online3h-timer">${formatTimer(timers.online3h.remaining)}</div>
        <div class="bp-inline-timer-cycles" id="bp-online3h-cycles">x${online3hCycles}</div>
        <div class="bp-inline-timer-actions">
          <button class="hint-mini-btn play" title="Старт" onclick="startBpOnlineTimer(event)">▶</button>
          <button class="hint-mini-btn" title="Стоп" onclick="stopBpOnlineTimer(event)">■</button>
          <button class="hint-mini-btn reset" title="Сброс" onclick="resetBpOnlineTimer(event)">↺</button>
        </div>
      </div>
    `
    : '';

  row.innerHTML = `
    <div class="bp-left">
      ${leftContent}
    </div>
    ${inlineTimerControls}
    <div class="bp-right">
      <div class="bp-points">${points} BP</div>
      <button class="bp-difficulty-btn bp-difficulty-btn-${difficulty}" title="Сменить сложность" onclick="cycleTaskDifficulty(event, '${task.id}')">${getDifficultyLabel(difficulty)}</button>
      ${isFrequent ? `<button class="bp-remove-frequent" title="Убрать из частых" onclick="removeFromFrequent(event, '${task.id}')">×</button>` : ''}
      <button class="bp-pin ${bpPinned[task.id] ? 'active' : ''}" title="Закрепить" onclick="toggleBpPin(event, '${task.id}')">📌</button>
    </div>
  `;

  return row;
}

function appendBpSection(root, title, tasks, emptyText = ''){
  const section = document.createElement('div');
  section.className = 'bp-section';
  section.innerHTML = `<div class="bp-section-title">${title}</div>`;

  if(tasks.length){
    const isFrequent = title === 'Часто выполняемые';
    tasks.forEach(task => section.appendChild(buildBpRow(task, { isFrequent })));
  }else if(emptyText){
    const empty = document.createElement('div');
    empty.className = 'bp-group-empty';
    empty.textContent = emptyText;
    section.appendChild(empty);
  }

  root.appendChild(section);
}
function setBpGroupFilter(filter){
  bpGroupFilter = filter;
  localStorage.setItem('bpGroupFilter', filter);
  document.querySelectorAll('[data-bp-group-filter]').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.bpGroupFilter === filter);
  });
  renderBpTasks();
}

function setBpDifficultyFilter(filter){
  bpDifficultyFilter = filter;
  localStorage.setItem('bpDifficultyFilter', filter);
  const select = document.getElementById('bpDifficultyFilter');
  if(select) select.value = filter;
  renderBpTasks();
}

function applyBpFilters(tasks){
  return tasks.filter(task=>{
    const groupOk =
      bpGroupFilter === 'all' ||
      task.group === bpGroupFilter;

    const difficultyOk =
      bpDifficultyFilter === 'all' ||
      getTaskDifficulty(task) === bpDifficultyFilter;

    return groupOk && difficultyOk;
  });
}

function renderBpTasks(){
  const list=document.getElementById('bpList');
  const query=(document.getElementById('bpSearch').value||'').trim().toLowerCase();
  list.innerHTML='';
  const searched = bpTasks.filter(task => task.title.toLowerCase().includes(query));
const filtered = applyBpFilters(searched);
  const sorted = sortBpTasks(filtered);
  const pinned = sorted.filter(task => !!bpPinned[task.id]);
  const frequent = sorted.filter(task => !bpPinned[task.id] && getBpScore(task.id) > 0).slice(0, 8);
  const frequentIds = new Set(frequent.map(task => task.id));
  const others = sorted.filter(task => !bpPinned[task.id] && !frequentIds.has(task.id));
  appendBpSection(list, 'Закрепленные', pinned, 'Закрепи нужные BP, чтобы они всегда были сверху.');
appendBpSection(list, 'Часто выполняемые', frequent, 'Когда накопится история использования, здесь появятся твои частые задания.');
appendBpSection(list, 'Все BP', others);
updateBpTotal();
updateBpInlineTimerDisplay();
}
function toggleBpPin(event, id){
  event.stopPropagation();
  bpPinned[id] = !bpPinned[id];
  if(!bpPinned[id]) delete bpPinned[id];
  saveBpState();
  renderBpTasks();
}
function toggleTask(id, checked){
  const wasChecked = !!bpChecked[id];
  bpChecked[id] = checked;
  if(checked && !wasChecked) recordBpUsage(id);
  saveBpState();
  renderBpTasks();
}

function toggleTaskFromRow(id){
  const nextValue = !bpChecked[id];
  toggleTask(id, nextValue);
}

function removeFromFrequent(event, id){
  event.stopPropagation();
  delete bpHistory[id];
  saveBpState();
  renderBpTasks();
}

function updateBpTotal(){
  const checkedTotal = bpTasks.reduce((sum, task)=>{
    if(task.id === 'online3h') return sum;
    return !bpChecked[task.id] ? sum : sum + getBpPoints(task);
  }, 0);

  document.getElementById('bpTotal').textContent = checkedTotal + getOnline3hBpValue();
}
function resetBpTasks(){
  Object.keys(bpChecked).forEach(k=>delete bpChecked[k]);
  saveBpState();
  renderBpTasks();
}
function clearBpPins(){
  Object.keys(bpPinned).forEach(k=>delete bpPinned[k]);
  saveBpState();
  renderBpTasks();
}
function clearBpHistory(){
  Object.keys(bpHistory).forEach(k=>delete bpHistory[k]);
  saveBpState();
  renderBpTasks();
}

function getMoscowParts(){
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(now);
  const map = {};
  parts.forEach(p => { if (p.type !== 'literal') map[p.type] = p.value; });
  return map;
}
function getMoscowResetKey(){
  const parts = getMoscowParts();
  let year = parseInt(parts.year, 10);
  let month = parseInt(parts.month, 10);
  let day = parseInt(parts.day, 10);
  const hour = parseInt(parts.hour, 10);
  const baseUtc = Date.UTC(year, month - 1, day);
  const effectiveUtc = hour >= 7 ? baseUtc : baseUtc - 86400000;
  const d = new Date(effectiveUtc);
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
function runDailyBpResetCheck(force=false){
  const key = getMoscowResetKey();
  const savedKey = localStorage.getItem('bpDailyResetKey') || '';
  if(force || savedKey !== key){
    Object.keys(bpChecked).forEach(k => delete bpChecked[k]);
    localStorage.setItem('bpDailyResetKey', key);
    saveBpState();
    renderBpTasks();
  }
}
function startDailyBpResetWatcher(){
  runDailyBpResetCheck(false);
  setInterval(() => runDailyBpResetCheck(false), 60000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) runDailyBpResetCheck(false);
  });
}

function getBeepRepeats(){ const saved=parseInt(localStorage.getItem('beepRepeats')||'3',10); return Math.max(1,Math.min(10,saved)); }
function saveBeepRepeats(){ const input=document.getElementById('beepRepeatsInput'); let value=parseInt(input.value||'3',10); value=Math.max(1,Math.min(10,value)); input.value=value; localStorage.setItem('beepRepeats', String(value)); }
function initBeepRepeats(){ document.getElementById('beepRepeatsInput').value=getBeepRepeats(); }
function parseTimeToSeconds(time){ const parts=time.split(':').map(Number); if(parts.length===2) return parts[0]*60+parts[1]; if(parts.length===3) return parts[0]*3600+parts[1]*60+parts[2]; return 0; }
function formatTimer(total){
  total = Math.max(0, total);

  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}
function playSingleBeep(delayMs){ setTimeout(()=>{ try{ const ctx=new(window.AudioContext||window.webkitAudioContext)(); const o=ctx.createOscillator(); const g=ctx.createGain(); o.type='sine'; o.frequency.value=880; o.connect(g); g.connect(ctx.destination); g.gain.setValueAtTime(0.0001,ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.15,ctx.currentTime+0.02); g.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.22); o.start(); o.stop(ctx.currentTime+0.24);}catch(e){} }, delayMs); }
function beepSequence(){ const repeats=getBeepRepeats(); for(let i=0;i<repeats;i++) playSingleBeep(i*320); }
function updateTimerDisplay(key){
  if(key === 'custom'){
    const hoursEl = document.getElementById('customTimerHours');
    const minsEl = document.getElementById('customTimerMinutes');
    const secsEl = document.getElementById('customTimerSeconds');
    if(hoursEl && minsEl && secsEl){
      const total = Math.max(0, timers.custom.remaining);
      const hours = Math.floor(total / 3600);
      const mins = Math.floor((total % 3600) / 60);
      const secs = total % 60;
      hoursEl.value = hours;
      minsEl.value = mins;
      secsEl.value = secs;
    }
    return;
  }
  const el = document.getElementById(timers[key].displayId);
  if(el) el.textContent = formatTimer(timers[key].remaining);
}
function stopInterval(key){
  if(timers[key].interval){
    clearInterval(timers[key].interval);
    timers[key].interval = null;
  }
}


function resumeAllTimers(){
  // Не запускаем таймеры автоматически, только если они были запущены до паузы
  // Это будет обработано в отдельных функциях при запуске
}

function startTimer(key){
  const t = timers[key];
  if(t.remaining <= 0) t.remaining = t.initial;
  if(t.interval) return;
  
  let startTime = Date.now();
  let remainingAtStart = t.remaining;
  
  function tick(){
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    t.remaining = remainingAtStart - elapsed;
    
    if(t.remaining <= 0){
      t.remaining = 0;
      updateTimerDisplay(key);
      beepSequence();
      return;
    }
    
    updateTimerDisplay(key);
  }
  
  t.interval = setInterval(tick, 1000);
  tick(); // Сразу обновляем
}
function pauseTimer(key){ stopInterval(key); }
function resetTimer(key){
  if(key === 'custom'){
    stopInterval('custom');

    timers.custom.initial = 0;
    timers.custom.remaining = 0;

    const hoursInput = document.getElementById('customTimerHours');
    const minutesInput = document.getElementById('customTimerMinutes');
    const secondsInput = document.getElementById('customTimerSeconds');

    if(hoursInput) hoursInput.value = 0;
    if(minutesInput) minutesInput.value = 0;
    if(secondsInput) secondsInput.value = 0;

    updateTimerDisplay('custom');
    saveCustomTimerSettings();
    return;
  }

  stopInterval(key);
  timers[key].remaining = timers[key].initial;
  updateTimerDisplay(key);
}

function updateBpInlineTimerDisplay(){
  const timerEl = document.getElementById('bp-online3h-timer');
  if(timerEl) timerEl.textContent = formatTimer(timers.online3h.remaining);

  const cyclesEl = document.getElementById('bp-online3h-cycles');
  if(cyclesEl) cyclesEl.textContent = `x${online3hCycles}`;
}

function startBpOnlineTimer(event){
  if(event) event.stopPropagation();
  const t = timers.online3h;
  if(t.interval) return;
  if(t.remaining <= 0){
    t.remaining = t.initial;
    updateBpInlineTimerDisplay();
  }
  
  let startTime = Date.now();
  let remainingAtStart = t.remaining;
  
  function tick(){
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    t.remaining = remainingAtStart - elapsed;
    
    if(t.remaining <= 0){
      online3hCycles += 1;
      saveOnline3hCycles();
      t.remaining = t.initial;
      startTime = Date.now();
      remainingAtStart = t.initial;
      updateBpTotal();
      renderBpTasks();
      updateBpInlineTimerDisplay();
      beepSequence();
      return;
    }
    
    updateBpInlineTimerDisplay();
  }
  
  t.interval = setInterval(tick, 1000);
  tick();
}

function stopBpOnlineTimer(event){
  if(event) event.stopPropagation();

  const t = timers.online3h;
  if(t.interval){
    clearInterval(t.interval);
    t.interval = null;
  }

  updateBpInlineTimerDisplay();
}

function resetBpOnlineTimer(event){
  if(event) event.stopPropagation();

  const t = timers.online3h;
  if(t.interval){
    clearInterval(t.interval);
    t.interval = null;
  }

  t.remaining = t.initial;
  online3hCycles = 0;
  saveOnline3hCycles();
  updateBpTotal();
  updateBpInlineTimerDisplay();
}

function saveCustomTimerSettings(){
  const hours = Math.max(0, parseInt(document.getElementById('customTimerHours')?.value || 0, 10));
  const minutes = Math.max(0, Math.min(59, parseInt(document.getElementById('customTimerMinutes')?.value || 0, 10)));
  const seconds = Math.max(0, Math.min(59, parseInt(document.getElementById('customTimerSeconds')?.value || 0, 10)));

  localStorage.setItem('customTimerHours', String(hours));
  localStorage.setItem('customTimerMinutes', String(minutes));
  localStorage.setItem('customTimerSeconds', String(seconds));
}

function loadCustomTimerSettings(){
  const savedHours = parseInt(localStorage.getItem('customTimerHours') || '0', 10);
  const savedMinutes = parseInt(localStorage.getItem('customTimerMinutes') || '1', 10);
  const savedSeconds = parseInt(localStorage.getItem('customTimerSeconds') || '0', 10);

  document.getElementById('customTimerHours').value = Math.max(0, savedHours);
  document.getElementById('customTimerMinutes').value = Math.max(0, Math.min(59, savedMinutes));
  document.getElementById('customTimerSeconds').value = Math.max(0, Math.min(59, savedSeconds));
}
function saveCustomTimerName(){
  const name = document.getElementById('customTimerName').value || '';
  localStorage.setItem('customTimerName', name);
}

function loadCustomTimerName(){
  const savedName = localStorage.getItem('customTimerName') || '';
  document.getElementById('customTimerName').value = savedName;
}
function applyCustomTimer(){
  const hours = Math.max(0, parseInt(document.getElementById('customTimerHours').value || 0, 10));
  const mins = Math.max(0, Math.min(59, parseInt(document.getElementById('customTimerMinutes').value || 0, 10)));
  const secs = Math.max(0, Math.min(59, parseInt(document.getElementById('customTimerSeconds').value || 0, 10)));
  const total = hours * 3600 + mins * 60 + secs;

  document.getElementById('customTimerHours').value = hours;
  document.getElementById('customTimerMinutes').value = mins;
  document.getElementById('customTimerSeconds').value = secs;

  timers.custom.initial = total;
  timers.custom.remaining = total;
  stopInterval('custom');
  updateTimerDisplay('custom');

  saveCustomTimerSettings();
}

function applyCustomPreset(minutes){
  const hoursInput = document.getElementById('customTimerHours');
  const minutesInput = document.getElementById('customTimerMinutes');
  const secondsInput = document.getElementById('customTimerSeconds');

  const currentTotal =
    Math.max(0, parseInt(hoursInput?.value || 0, 10)) * 3600 +
    Math.max(0, Math.min(59, parseInt(minutesInput?.value || 0, 10))) * 60 +
    Math.max(0, Math.min(59, parseInt(secondsInput?.value || 0, 10)));

  const presetMinutes = Math.max(1, parseInt(minutes, 10) || 1);
  const newTotal = currentTotal + presetMinutes * 60;

  const hours = Math.floor(newTotal / 3600);
  const mins = Math.floor((newTotal % 3600) / 60);
  const secs = newTotal % 60;

  hoursInput.value = hours;
  minutesInput.value = mins;
  secondsInput.value = secs;

  timers.custom.initial = newTotal;
  timers.custom.remaining = newTotal;

  stopInterval('custom');
  updateTimerDisplay('custom');
  saveCustomTimerSettings();
}

function getHintState(id){
  if(!hintTimers[id]){
    const hint = hintCards.find(h => h.id === id);
    const seconds = parseTimeToSeconds(hint.time);
    hintTimers[id] = {
      initial: seconds,
      remaining: seconds,
      interval: null
    };
  }
  return hintTimers[id];
}

function updateHintDisplay(id){
  const el = document.getElementById('hint-live-' + id);
  if(el){
    el.textContent = formatTimer(getHintState(id).remaining);
  }
}

function startHintTimer(id){
  const st = getHintState(id);
  if(st.remaining <= 0){
    st.remaining = st.initial;
  }
  if(st.interval) return;
  
  let startTime = Date.now();
  let remainingAtStart = st.remaining;
  
  function tick(){
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    st.remaining = remainingAtStart - elapsed;
    
    updateHintDisplay(id);
    
    if(st.remaining <= 0){
      stopHintTimer(id);
      st.remaining = 0;
      updateHintDisplay(id);
      beepSequence();
    }
  }
  
  st.interval = setInterval(tick, 1000);
  tick();
}

function stopHintTimer(id){
  const st = getHintState(id);
  if(st.interval){
    clearInterval(st.interval);
    st.interval = null;
  }
}

function resetHintTimer(id){
  const st = getHintState(id);
  stopHintTimer(id);
  st.remaining = st.initial;
  updateHintDisplay(id);
}

function getCustomEditorTotalSeconds(){
  const hoursInput = document.getElementById('customTimerHours');
  const minutesInput = document.getElementById('customTimerMinutes');
  const secondsInput = document.getElementById('customTimerSeconds');

  const hours = Math.max(0, parseInt(hoursInput?.value || 0, 10));
  const minutes = Math.max(0, Math.min(59, parseInt(minutesInput?.value || 0, 10)));
  const seconds = Math.max(0, Math.min(59, parseInt(secondsInput?.value || 0, 10)));

  if(hoursInput) hoursInput.value = hours;
  if(minutesInput) minutesInput.value = minutes;
  if(secondsInput) secondsInput.value = seconds;

  return hours * 3600 + minutes * 60 + seconds;
}

function getCustomEditorName(){
  return (document.getElementById('customTimerName')?.value || '').trim() || 'Новый таймер';
}

function createUserTimerFromEditor(){
  const total = getCustomEditorTotalSeconds();
  if(total <= 0) return null;

  const timer = {
    id: 'userTimer_' + Date.now() + '_' + (userTimerIdSeq++),
    name: getCustomEditorName(),
    initial: total,
    remaining: total,
    interval: null,
    isSaved: false,
    isPinned: false,
    confirmDelete: false
  };

  userTimers.unshift(timer);
  renderUserTimers();
  return timer;
}

function stopUserTimerInterval(timer){
  if(timer.interval){
    clearInterval(timer.interval);
    timer.interval = null;
  }
}

function startUserTimer(id){
  const timer = userTimers.find(t => t.id === id);
  if(!timer) return;
  if(timer.remaining <= 0){
    timer.remaining = timer.initial;
  }
  if(timer.interval) return;
  
  let startTime = Date.now();
  let remainingAtStart = timer.remaining;
  
  function tick(){
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    timer.remaining = remainingAtStart - elapsed;
    
    saveUserTimersToStorage();
    renderUserTimers();
    
    if(timer.remaining <= 0){
      stopUserTimerInterval(timer);
      beepSequence();
      saveUserTimersToStorage();
      renderUserTimers();
    }
  }
  
  timer.interval = setInterval(tick, 1000);
  tick();
}

function pauseUserTimer(id){
  const timer = userTimers.find(t => t.id === id);
  if(!timer) return;

  stopUserTimerInterval(timer);
  saveUserTimersToStorage();
  renderUserTimers();
}

function resetUserTimer(id){
  const timer = userTimers.find(t => t.id === id);
  if(!timer) return;

  stopUserTimerInterval(timer);
  timer.remaining = timer.initial;
  saveUserTimersToStorage();
  renderUserTimers();
}

function saveUserTimer(id){
  const timer = userTimers.find(t => t.id === id);
  if(!timer) return;

  timer.isSaved = true;
  saveUserTimersToStorage();
  renderUserTimers();
}

function deleteUserTimer(id){
  const timer = userTimers.find(t => t.id === id);
  if(!timer) return;

  stopUserTimerInterval(timer);
  userTimers = userTimers.filter(t => t.id !== id);
  saveUserTimersToStorage();
  renderUserTimers();
}

function askDeleteUserTimer(id){
  userTimers = userTimers.map(timer => ({
    ...timer,
    confirmDelete: timer.id === id ? true : false
  }));
  renderUserTimers();
}

function cancelDeleteUserTimer(id){
  userTimers = userTimers.map(timer =>
    timer.id === id ? { ...timer, confirmDelete: false } : timer
  );
  renderUserTimers();
}

function togglePinUserTimer(id){
  const timer = userTimers.find(t => t.id === id);
  if(!timer) return;

  timer.isPinned = !timer.isPinned;
  saveUserTimersToStorage();
  renderUserTimers();
}

function renderUserTimers(){
  const list = document.getElementById('userTimersList');
  const empty = document.getElementById('userTimersEmpty');
  if(!list) return;

  list.innerHTML = '';

  if(!userTimers.length){
    if(empty) list.appendChild(empty);
    return;
  }

  const sorted = [...userTimers].sort((a, b) => {
    if(a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return 0;
  });

  sorted.forEach(timer => {
    const card = document.createElement('div');
    card.className = 'user-timer-card' + (timer.isSaved ? '' : ' unsaved');

    card.innerHTML = `
      <div class="user-timer-main">
        ${timer.isSaved ? '' : `<div class="user-timer-alert">Не забудь сохранить таймер</div>`}
        <div class="user-timer-title">${timer.name || 'Новый таймер'}</div>
        <div class="user-timer-time">${formatTimer(timer.remaining)}</div>

        <div class="user-timer-actions">
          <button class="hint-mini-btn play" title="Старт" onclick="startUserTimer('${timer.id}')">▶</button>
          <button class="hint-mini-btn" title="Пауза" onclick="pauseUserTimer('${timer.id}')">■</button>
          <button class="hint-mini-btn reset" title="Сброс" onclick="resetUserTimer('${timer.id}')">↺</button>
        </div>

        ${timer.confirmDelete ? `{
          <div class="user-timer-delete-confirm">
            <div class="user-timer-delete-text">Действительно хотите удалить таймер?</div>
            <div class="user-timer-delete-actions">
              <button class="btn btn-red" onclick="deleteUserTimer('${timer.id}')">Да, удалить</button>
              <button class="btn btn-dark" onclick="cancelDeleteUserTimer('${timer.id}')">Отмена</button>
            </div>
          </div>
        ` : ''}
      </div>

      <div class="user-timer-side">
        ${timer.isSaved ? '' : `<button class="btn btn-dark" onclick="saveUserTimer('${timer.id}')">Сохранить</button>`}
        <button class="btn btn-dark ${timer.isPinned ? 'active' : ''}" onclick="togglePinUserTimer('${timer.id}')">
          ${timer.isPinned ? 'Открепить' : 'Закрепить'}
        </button>
        <button class="user-timer-icon-btn delete" onclick="askDeleteUserTimer('${timer.id}')">
          ${timer.isSaved ? 'Удалить' : 'Закрыть'}
        </button>
      </div>
    `;

    list.appendChild(card);
  });
}

function startCustomEditorTimer(){
  const timer = createUserTimerFromEditor();
  if(!timer) return;
  startUserTimer(timer.id);
}


function renderHints(){
  const wrap = document.getElementById('hintsGrid');
  wrap.innerHTML = '';

  const orderedHints = hintOrder
    .map(id => hintCards.find(h => h.id === id))
    .filter(Boolean);

  orderedHints.forEach((hint, index) => {
    const st = getHintState(hint.id);
    const el = document.createElement('div');
    el.className = 'hint-card';

    el.innerHTML = `
      <div class="hint-top">
        <div class="hint-name">${hint.name}</div>
        <div class="hint-move-actions">
          <button class="hint-move-btn" title="Выше" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button class="hint-move-btn" title="Ниже" ${index === orderedHints.length - 1 ? 'disabled' : ''}>↓</button>
        </div>
      </div>

      <div class="hint-live" id="hint-live-${hint.id}">${formatTimer(st.remaining)}</div>

      <div class="hint-actions">
        <button class="hint-mini-btn play" title="Старт">▶</button>
        <button class="hint-mini-btn" title="Пауза">■</button>
        <button class="hint-mini-btn reset" title="Сброс">↺</button>
      </div>
    `;

    const moveBtns = el.querySelectorAll('.hint-move-btn');
    moveBtns[0].addEventListener('click', () => moveHintCard(hint.id, 'up'));
    moveBtns[1].addEventListener('click', () => moveHintCard(hint.id, 'down'));

    const timerBtns = el.querySelectorAll('.hint-mini-btn');
    timerBtns[0].addEventListener('click', () => startHintTimer(hint.id));
    timerBtns[1].addEventListener('click', () => stopHintTimer(hint.id));
    timerBtns[2].addEventListener('click', () => resetHintTimer(hint.id));

    wrap.appendChild(el);
  });
}
function toggleDemorganPosition(forceValue = null){
  const block = document.getElementById('demorganBlock');
  const top = document.getElementById('topAnchor');
  const bottom = document.getElementById('bottomAnchor');
  const btn = document.getElementById('demorganMoveBtn');

  demorganAtTop = forceValue !== null ? forceValue : !demorganAtTop;

  if(demorganAtTop){
    top.insertAdjacentElement('afterend', block);
    btn.textContent = 'Переместить вниз';
  } else {
    bottom.insertAdjacentElement('beforebegin', block);
    btn.textContent = 'Переместить наверх';
  }

  localStorage.setItem('demorganAtTop', String(demorganAtTop));
}

function handleRentPhotoPaste(e){
  // Проверяем, что мы на экране аренды и есть активная категория
  if(activeScreen !== 'rent') return;
  if(!currentProperty) return;
  
  const items = e.clipboardData?.items || [];
  for(const item of items){
    if(item.type.includes('image')){
      const file = item.getAsFile();
      const reader = new FileReader();
      reader.onload = ev => {
        currentProperty.image = ev.target.result;
        saveProperties();
        document.getElementById('rentPhotoPreview').innerHTML = `<img src="${currentProperty.image}">`;
      };
      reader.readAsDataURL(file);
      break;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const editionBadge = document.getElementById('appEditionBadge');
if(editionBadge) editionBadge.textContent = APP_EDITION;
  setCurrentVersionLabel();
  loadData();

// Автосохранение при вводе
const nameInput = document.getElementById('propertyName');
const descriptionInput = document.getElementById('propertyDescription');

if(nameInput){
  nameInput.addEventListener('input', () => {
    if(currentProperty){
      currentProperty.name = nameInput.value;
      saveProperties();
      renderProperties();
    }
  });
}

if(descriptionInput){
  descriptionInput.addEventListener('input', () => {
    if(currentProperty){
      currentProperty.description = descriptionInput.value;
      saveProperties();
      renderProperties();
    }
  });
}
const rentMain = document.getElementById('rentMain');
if(rentMain){
  rentMain.addEventListener('paste', handleRentPhotoPaste);
}

// Клик по области фото для фокуса
const rentPhotoPreview = document.getElementById('rentPhotoPreview');
if(rentPhotoPreview){
  rentPhotoPreview.addEventListener('click', () => {
    focusedPhotoArea = 'rent';
    rentPhotoPreview.style.borderColor = 'rgba(68,192,106,.45)';
    rentPhotoPreview.style.boxShadow = '0 0 0 2px rgba(68,192,106,.15)';
  });
}
calculatePass();
resetPassCalc();
  loadRentData();
  initScrollToTopRent();
renderProperties();
renderRentalsForCurrentProperty();
  checkSubscription();
initRentMonthSelectors();
updateRentMonthControls();
updateRentStats();
  bindMoneyInputs();
  setupCommentAutocomplete();
  initBeepRepeats();
  renderItems();
   document.getElementById('search')?.addEventListener('input', renderItems);
  initStatsMonthSelectors();
  updateMonthPeriodControls();
  renderOperations();
  setBpMode(bpMode);
  setBpGroupFilter(bpGroupFilter);
  setBpDifficultyFilter(bpDifficultyFilter);
  updateBpInlineTimerDisplay();
  updateBpTotal();
  startDailyBpResetWatcher();
  loadSavedUserTimers();
  renderHints();
  renderUserTimers();
  toggleDemorganPosition(demorganAtTop);
  loadCustomTimerSettings();
  applyCustomTimer();
  bindCustomTimerEditor();
  updateTimerDisplay('demorganBox');
  updateTimerDisplay('demorganSew');
  switchScreen(activeScreen);
  setOperationFilter(operationFilter);
  renderUpdateUI();
  checkForUpdates(false);
  bindGlobalPaste();
  bindGlobalPasteForAddModal();
  bindAddModalHotkeys();
  loadRentData();
renderProperties();
initRentMonthSelectors();
updateRentMonthControls();
updateRentStats();

document.getElementById('dealHours')?.addEventListener('input', calculateDealTotal);
document.getElementById('dealPricePerHour')?.addEventListener('input', calculateDealTotal);

document.getElementById('rentMain')?.addEventListener('paste', handleRentPhotoPaste);
});

function bindCustomTimerEditor(){
  const hoursInput = document.getElementById('customTimerHours');
  const minutesInput = document.getElementById('customTimerMinutes');
  const secondsInput = document.getElementById('customTimerSeconds');
  const nameInput = document.getElementById('customTimerName');

  if(!hoursInput || !minutesInput || !secondsInput || !nameInput) return;

  function handleTimeInput(){
    let hours = Math.max(0, parseInt(hoursInput.value || 0, 10));
    let mins = Math.max(0, Math.min(59, parseInt(minutesInput.value || 0, 10)));
    let secs = Math.max(0, Math.min(59, parseInt(secondsInput.value || 0, 10)));

    hoursInput.value = hours;
    minutesInput.value = mins;
    secondsInput.value = secs;

    timers.custom.initial = hours * 3600 + mins * 60 + secs;
    timers.custom.remaining = timers.custom.initial;

    updateTimerDisplay('custom');
    saveCustomTimerSettings();
  }

  hoursInput.addEventListener('input', handleTimeInput);
  minutesInput.addEventListener('input', handleTimeInput);
  secondsInput.addEventListener('input', handleTimeInput);

  hoursInput.addEventListener('change', handleTimeInput);
  minutesInput.addEventListener('change', handleTimeInput);
  secondsInput.addEventListener('change', handleTimeInput);

  nameInput.addEventListener('input', saveCustomTimerName);
}

function getCurrentScrollableElements() {
  const activeScreen = document.querySelector('.screen.active');
  if (!activeScreen) return [];

  if (activeScreen.id === 'timersScreen') {
    const el = activeScreen.querySelector('.timers-scroll');
    return el ? [el] : [];
  }

  if (activeScreen.id === 'bpScreen') {
    const el = activeScreen.querySelector('.bp-list');
    return el ? [el] : [];
  }

  if (activeScreen.id === 'resellScreen') {
    const operations = activeScreen.querySelector('.operations-body');
    const items = activeScreen.querySelector('.items-scroll');
    return [operations, items].filter(Boolean);
  }

  return [activeScreen];
}

function updateScrollToTopButton() {
  const btn = document.getElementById('scrollToTopBtn');
  if (!btn) return;

  const scrollEls = getCurrentScrollableElements();
  const shouldShow = scrollEls.some(el => el && el.scrollTop > 80);

  if (shouldShow) {
    btn.classList.add('visible');
  } else {
    btn.classList.remove('visible');
  }
}

function scrollCurrentScreenToTop() {
  const scrollEls = getCurrentScrollableElements();

  scrollEls.forEach(el => {
    if (!el) return;
    el.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  });
}

function initScrollToTopButton() {
  document.addEventListener('scroll', updateScrollToTopButton, true);
  document.addEventListener('wheel', () => {
    setTimeout(updateScrollToTopButton, 0);
  }, { passive: true });

  setInterval(updateScrollToTopButton, 150);

  updateScrollToTopButton();
}



function calculatePass(){
  console.log('=== START calculatePass ===');
  
  // Константы
  const XP_FIRST_LEVEL = 1000;
  const XP_STEP = 100;
  const BASE_XP_PER_DAY = 6000;  // ФИКСИРОВАННОЕ значение
  const DOUBLE_XP_PER_DAY = 12000;  // ФИКСИРОВАННОЕ значение
  const NORMAL_CASE_XP = 1000;
  const CAR_CASE_XP = 5000;
  
  // Получаем значения
  const targetLevel = parseInt(document.getElementById('passTargetLevel').value) || 115;
  const currentLevel = parseInt(document.getElementById('passCurrentLevel').value) || 1;
  const serverBonus = parseFloat(document.getElementById('passServerSelect').value) || 0;
  const doubleDays = parseInt(document.getElementById('passDoubleDays').value) || 0;
  const plannedDays = parseInt(document.getElementById('passPlannedDays').value) || 90;
  const normalCases = parseInt(document.getElementById('passNormalCases').value) || 0;
  const carCases = parseInt(document.getElementById('passCarCases').value) || 0;
  
  // Считаем XP для уровня
  function getXPForLevel(level){
    if(level <= 1) return 0;
    const transitions = level - 1;
    const firstXP = XP_FIRST_LEVEL;
    const lastXP = firstXP + (transitions - 1) * XP_STEP;
    return (transitions / 2) * (firstXP + lastXP);
  }
  
  const totalXPForTarget = getXPForLevel(targetLevel);
  const currentXP = getXPForLevel(currentLevel);
  const xpNeeded = totalXPForTarget - currentXP;
  
  // Опыт от кейсов
  const xpFromNormalCases = normalCases * NORMAL_CASE_XP;
  const xpFromCarCases = carCases * CAR_CASE_XP;
  const xpFromCases = xpFromNormalCases + xpFromCarCases;
  
  // Опыт в день (с серверным бонусом для расчёта)
  const xpPerDayWithoutDouble = BASE_XP_PER_DAY * (1 + serverBonus);
  const xpPerDayWithDouble = DOUBLE_XP_PER_DAY * (1 + serverBonus);
  
  // Пассивный опыт за планируемые дни
  const doubleDaysInPlan = Math.min(doubleDays, plannedDays);
  const daysWithoutDoubleInPlan = plannedDays - doubleDaysInPlan;
  const totalXPFromPass = daysWithoutDoubleInPlan * xpPerDayWithoutDouble + doubleDaysInPlan * xpPerDayWithDouble;
  
  // Общий XP
  const totalXP = currentXP + xpFromCases + totalXPFromPass;
  const remaining = totalXPForTarget - totalXP;
  
  // Минимум дней для закрытия
  let minDaysForClose = 0;
  if(remaining > 0 && xpPerDayWithDouble > 0){
    const xpNeededAfterCases = Math.max(0, xpNeeded - xpFromCases);
    const daysWithDouble = Math.min(doubleDays, Math.ceil(xpNeededAfterCases / xpPerDayWithDouble));
    const xpAfterDouble = Math.max(0, xpNeededAfterCases - daysWithDouble * xpPerDayWithDouble);
    const daysWithoutDouble = xpAfterDouble > 0 ? Math.ceil(xpAfterDouble / xpPerDayWithoutDouble) : 0;
    minDaysForClose = daysWithDouble + daysWithoutDouble;
  }
  
  // Проверка: ввёл ли пользователь данные (кейсы или x2 дни)
  const hasData = doubleDays > 0 || normalCases > 0 || carCases > 0;
  
  // Обновляем UI
  // ФИКСИРОВАННЫЕ значения (без бонуса сервера)
  document.getElementById('baseXP').textContent = formatMoney(BASE_XP_PER_DAY);
  document.getElementById('boosterXP').textContent = formatMoney(DOUBLE_XP_PER_DAY);
  document.getElementById('carCasesXP').textContent = formatMoney(xpFromCarCases);
  document.getElementById('normalCasesXP').textContent = formatMoney(xpFromNormalCases);
  document.getElementById('serverBonusXP').textContent = '+' + Math.floor(serverBonus * 100) + '%';
  document.getElementById('currentXPValue').textContent = formatMoney(currentXP);
  document.getElementById('totalToTarget').textContent = formatMoney(totalXPForTarget);
  document.getElementById('remainingToTarget').textContent = formatMoney(xpNeeded);
  
  // "Осталось опыта": если нет данных - показываем как "Осталось до цели", иначе с учётом пассива
  const remainingToShow = hasData ? Math.max(0, Math.ceil(remaining)) : xpNeeded;
  document.getElementById('remainingXP').textContent = formatMoney(remainingToShow);
  
  // Прогресс
  const progress = totalXPForTarget > 0 
    ? Math.min(100, (currentXP / totalXPForTarget) * 100) 
    : 0;
  document.getElementById('passProgressFill').style.width = progress + '%';
  document.getElementById('passProgressText').textContent = Math.floor(progress) + '%';
  
  // Статус
  const statusEl = document.getElementById('passStatus');
  if(!hasData){
    statusEl.textContent = 'Введите данные для прогноза';
    statusEl.className = 'pass-calc-status';
  } else if(currentLevel >= targetLevel){
    statusEl.textContent = '✅ Цель достигнута!';
    statusEl.className = 'pass-calc-status success';
  } else if(remaining <= 0){
    statusEl.textContent = '✅ Пропуск закрыт! (хватит на ' + minDaysForClose + ' дн.)';
    statusEl.className = 'pass-calc-status success';
  } else {
    statusEl.textContent = '❌ Недостаточно опыта: ещё ' + formatMoney(Math.ceil(remaining)) + ' (нужно ' + minDaysForClose + ' дн.)';
    statusEl.className = 'pass-calc-status';
  }
  
  console.log('=== END calculatePass ===');
}

function resetPassCalc(){
  // Сброс инпутов
  document.getElementById('passDoubleDays').value = '0';
  document.getElementById('passNormalCases').value = '0';
  document.getElementById('passCarCases').value = '0';
  
  // Сброс UI
  document.getElementById('baseXP').textContent = '6.000';
  document.getElementById('boosterXP').textContent = '12.000';
  document.getElementById('carCasesXP').textContent = '0';
  document.getElementById('serverBonusXP').textContent = '+0%';
  document.getElementById('currentXPValue').textContent = '0';
  document.getElementById('remainingToTarget').textContent = '758.100';
  document.getElementById('totalToTarget').textContent = '758.100';
  document.getElementById('passProgressFill').style.width = '0%';
  document.getElementById('passProgressText').textContent = '0%';
  
  const statusEl = document.getElementById('passStatus');
  statusEl.textContent = 'Введите данные для прогноза';
  statusEl.className = 'pass-calc-status';
}

// Вспомогательная функция для resetPassCalc
function getXPForLevel(level){
  if(level <= 1) return 0;
  const transitions = level - 1;
  const firstXP = 1000;
  const lastXP = firstXP + (transitions - 1) * 100;
  return (transitions / 2) * (firstXP + lastXP);
}

window.addEventListener('load', () => {
  initScrollToTopButton();
  setTimeout(updateScrollToTopButton, 50);
  setTimeout(updateScrollToTopButton, 250);
});

window.addEventListener('load', () => {
  initScrollToTopButton();
  setTimeout(updateScrollToTopButton, 50);
  setTimeout(updateScrollToTopButton, 250);
});

function scrollToTopRent(){
  const el = document.querySelector('.property-list');
  if(el) el.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateScrollToTopRent(){
  const btn = document.getElementById('scrollToTopBtnRent');
  if(!btn) return;
  const el = document.querySelector('.property-list');
  if(!el) return;
  
  const shouldShow = el.scrollTop > 80;
  if(shouldShow){
    btn.classList.add('visible');
  } else {
    btn.classList.remove('visible');
  }
}

function initScrollToTopRent(){
  const el = document.querySelector('.property-list');
  if(!el) return;
  
  el.addEventListener('scroll', () => {
    setTimeout(updateScrollToTopRent, 0);
  }, { passive: true });
  
  setInterval(updateScrollToTopRent, 150);
  updateScrollToTopRent();
}

// ======== ИНТЕГРАЦИЯ С БОТОМ ========

// Отправка события аренды в бота
function notifyBotRentalCreated(rental) {
    if (window.require) {
        const { ipcRenderer } = require('electron');
        ipcRenderer.send('notify-rental-created', rental);
    } else {
        // Fallback для тестирования в браузере
        console.log('📩 Rental notification (browser mode):', rental);
    }
}

// Проверка статуса подписки
async function checkSubscriptionStatus() {
    if (window.require) {
        const { ipcRenderer } = require('electron');
        try {
            const status = await ipcRenderer.invoke('check-subscription');
            return status;
        } catch (error) {
            console.error('Ошибка проверки подписки:', error);
            return { isActive: false, expiryDate: null };
        }
    }
    return { isActive: false, expiryDate: null };
}

// Переопределяем confirmDeal для отправки уведомления боту
const originalConfirmDeal = confirmDeal;
confirmDeal = function() {
    if(!currentProperty) return;
    const start = document.getElementById('dealStart').value;
    const end = document.getElementById('dealEnd').value;
    const hours = parseInt(document.getElementById('dealHours').value) || 0;
    const pricePerHour = parseMoney(document.getElementById('dealPricePerHour').value);
    const total = parseMoney(document.getElementById('dealTotal').value);
    const comment = document.getElementById('dealComment').value.trim();
    
    if(!start || !end || hours <= 0) return;
    
    const operation = {
        id: Date.now(),
        propertyId: currentProperty.id,
        propertyName: currentProperty.name,
        start,
        end,
        hours,
        pricePerHour,
        total,
        comment: comment || `Аренда: ${currentProperty.name}`,
        timestamp: Date.now()
    };
    
    rentOperations.unshift(operation);
    saveRentOperations();
    updateRentStats();
    closeDealModal();
    
    // Отправляем уведомление боту
    notifyBotRentalCreated(operation);
};

function toggleRentShowAll(){
    rentShowAllMode = !rentShowAllMode;
    updateRentStats();
}

function openRentHistoryModal(){
    const modal = document.getElementById('rentHistoryModal');
    if(modal) {
        modal.style.display = 'flex';
    }
    
    initRentHistoryMonthSelectors();
    updateRentHistoryMonthControls();
    renderRentHistoryTable();
    updateRentHistoryTotal();
}

function closeRentHistoryModal(){
    document.getElementById('rentHistoryModal').style.display = 'none';
}

function setRentHistoryFilter(filter){
    rentHistoryFilter = filter;
    localStorage.setItem('rentHistoryFilter', filter);
    document.querySelectorAll('#rentHistoryModal .filter-chip').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.filter === filter)
    );
    updateRentHistoryMonthControls();
    renderRentHistoryTable();
    updateRentHistoryTotal();
}

function updateRentHistoryMonthControls(){
    const controls = document.getElementById('rentHistoryMonthControls');
    if(!controls) return;
    controls.style.display = rentHistoryFilter === 'month' ? 'flex' : 'none';
}

function initRentHistoryMonthSelectors(){
    const monthSelect = document.getElementById('rentHistoryMonthSelect');
    const yearSelect = document.getElementById('rentHistoryYearSelect');
    if(!monthSelect || !yearSelect) return;
    
    monthSelect.innerHTML = '';
    const months = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 
                    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
    months.forEach((month, index) => {
        const option = document.createElement('option');
        option.value = String(index);
        option.textContent = month;
        if(index === selectedRentHistoryMonth) option.selected = true;
        monthSelect.appendChild(option);
    });
    
    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    const startYear = 2026;
    for(let year = startYear; year <= currentYear + 1; year++){
        const option = document.createElement('option');
        option.value = String(year);
        option.textContent = String(year);
        if(year === selectedRentHistoryYear) option.selected = true;
        yearSelect.appendChild(option);
    }
}

function changeRentHistoryMonth(){
    const monthSelect = document.getElementById('rentHistoryMonthSelect');
    const yearSelect = document.getElementById('rentHistoryYearSelect');
    if(!monthSelect || !yearSelect) return;
    selectedRentHistoryMonth = parseInt(monthSelect.value, 10);
    selectedRentHistoryYear = parseInt(yearSelect.value, 10);
    renderRentHistoryTable();
    updateRentHistoryTotal();
}

function getFilteredRentHistory(){
    const now = new Date();
    return rentOperations.filter(op => {
        const ts = op.timestamp || Date.now();
        const d = new Date(ts);
        if(rentHistoryFilter === 'today'){
            const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            return ts >= startOfDay.getTime();
        }
        if(rentHistoryFilter === 'week'){
            const weekAgo = new Date(now);
            weekAgo.setDate(now.getDate() - 6);
            return ts >= weekAgo.getTime();
        }
        if(rentHistoryFilter === 'month'){
            return d.getMonth() === selectedRentHistoryMonth && d.getFullYear() === selectedRentHistoryYear;
        }
        return true;
    });
}

function renderRentHistoryTable(){
    const body = document.getElementById('rentHistoryTable');
    if(!body) {
        console.error('❌ rentHistoryTable элемент не найден!');
        return;
    }
    
    console.log('📊 Body элемент:', body);
    console.log('Body offsetHeight:', body.offsetHeight);
    console.log('Body offsetWidth:', body.offsetWidth);
    
    const filtered = getFilteredRentHistory();
    body.innerHTML = '';
    
    if(!filtered.length){
        body.innerHTML = '<div class="empty-state">Записей нет</div>';
        return;
    }
    
    filtered.forEach(op => {
        const row = document.createElement('div');
        row.className = 'row-entry';
        row.innerHTML = `
            <div>${op.propertyName || '-'}</div>
            <div>${formatDate(op.start)}</div>
            <div>${formatDate(op.end)}</div>
            <div class="money-plus">${moneyWithCurrency(op.total)}</div>
            <div></div>
        `;
        body.appendChild(row);
    });
    
    console.log('✅ Добавлено строк:', body.children.length);
}

function updateRentHistoryTotal(){
    const filtered = getFilteredRentHistory();
    const total = filtered.reduce((sum, op) => sum + (op.total || 0), 0);
    document.getElementById('rentHistoryTotal').innerText = moneyWithCurrency(total);
}

// Закрытие модального окна по клику вне контента
document.addEventListener('click', (e) => {
    const modal = document.getElementById('rentHistoryModal');
    if(modal && e.target === modal){
        closeRentHistoryModal();
    }
});

// ======== ДОСРОЧНОЕ ЗАВЕРШЕНИЕ АРЕНДЫ ========

function openEndRentalModal(){
    endRentalSelectedId = null;
    document.getElementById('endRentalDetails').style.display = 'none';
    document.getElementById('confirmEndRentalBtn').disabled = true;
    
    const now = new Date();
    const activeRentals = rentOperations.filter(op => {
        const endDate = new Date(op.end);
        return endDate > now;
    });
    
    const list = document.getElementById('activeRentalsList');
    if(!list) return;
    
    if(activeRentals.length === 0){
        list.innerHTML = '<div class="empty-state">Нет активных аренд</div>';
        document.getElementById('confirmEndRentalBtn').disabled = true;
        return;
    }
    
    list.innerHTML = '';
    activeRentals.forEach(rental => {
        const div = document.createElement('div');
        div.className = 'row-entry';
        div.style.cursor = 'pointer';
        div.style.background = endRentalSelectedId === rental.id ? '#2a3040' : 'transparent';
        div.innerHTML = `
            <div>${rental.propertyName}</div>
            <div>${formatDate(rental.start)}</div>
            <div>${formatDate(rental.end)}</div>
            <div class="money-plus">${moneyWithCurrency(rental.total)}</div>
            <div></div>
        `;
        div.onclick = () => selectRentalToEnd(rental);
        list.appendChild(div);
    });
    
    document.getElementById('endRentalModal').style.display = 'flex';
}

function closeEndRentalModal(){
    endRentalSelectedId = null;
    document.getElementById('endRentalModal').style.display = 'none';
}

function selectRentalToEnd(rental){
    endRentalSelectedId = rental.id;
    
    // Подсветка выбранного
    const list = document.getElementById('activeRentalsList');
    if(list){
        Array.from(list.children).forEach((child, index) => {
            const rentals = rentOperations.filter(op => new Date(op.end) > new Date());
            child.style.background = rentals[index].id === rental.id ? '#2a3040' : 'transparent';
        });
    }
    
    // Заполнение деталей
    document.getElementById('endRentalCarName').textContent = rental.propertyName;
    document.getElementById('endRentalStart').textContent = formatDate(rental.start);
    document.getElementById('endRentalEnd').textContent = formatDate(rental.end);
    document.getElementById('endRentalTotal').textContent = moneyWithCurrency(rental.total);
    
    // Установка текущего времени как фактического окончания
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    document.getElementById('endRentalActualEnd').value = now.toISOString().slice(0,16);
    
    document.getElementById('endRentalDetails').style.display = 'block';
    document.getElementById('confirmEndRentalBtn').disabled = false;
}

function confirmEndRental(){
    if(!endRentalSelectedId) return;
    
    const rental = rentOperations.find(op => op.id === endRentalSelectedId);
    if(!rental) return;
    
    const actualEnd = document.getElementById('endRentalActualEnd').value;
    if(!actualEnd) return;
    
    // Обновляем аренду
    rental.end = actualEnd;
    rental.endedEarly = true;
    rental.endedAt = Date.now();
    
    // Пересчитываем сумму (пропорционально времени)
    const start = new Date(rental.start);
    const plannedEnd = new Date(rental.originalEnd || rental.end);
    const actualEndDateTime = new Date(actualEnd);
    
    const plannedHours = (plannedEnd - start) / (1000 * 60 * 60);
    const actualHours = (actualEndDateTime - start) / (1000 * 60 * 60);
    
    if(plannedHours > 0 && rental.pricePerHour){
        rental.total = Math.round(actualHours * rental.pricePerHour);
    }
    
    saveRentOperations();
    updateRentStats();
    updateRentHistoryTotal();
    
    // Отправляем уведомление в бота
    const { ipcRenderer } = require('electron');
    ipcRenderer.send('notify-rental-created', {
        ...rental,
        endedEarly: true,
        actualEnd: actualEnd
    });
    
    closeEndRentalModal();
    showSuccessModal('Аренда завершена досрочно!');
}

function showSuccessModal(message){
    document.getElementById('successMessage').textContent = message;
    document.getElementById('successModal').style.display = 'flex';
}

function closeSuccessModal(){
    document.getElementById('successModal').style.display = 'none';
}

// Закрытие по клику вне контента
document.addEventListener('click', (e) => {
    const modal = document.getElementById('endRentalModal');
    if(modal && e.target === modal){
        closeEndRentalModal();
    }
});

// ======== ПРОВЕРКА ПОДПИСКИ И АКТИВАЦИЯ КЛЮЧА ========

// Проверка подписки при запуске
async function checkSubscription() {
    try {
        const response = await fetch('https://resellcontrollbot-production.up.railway.app/checkkey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: localStorage.getItem('activationKey') || '' })
        });
        
        const result = await response.json();
        
        if (result.valid) {
            // Подписка активна
            localStorage.setItem('subscription', JSON.stringify({
                isActive: true,
                expiryDate: result.expiryDate
            }));
            hideActivationModal();
        } else {
            // Подписка истекла или нет ключа
            localStorage.removeItem('activationKey');
            showActivationModal();
        }
    } catch (error) {
        console.error('Ошибка проверки подписки:', error);
        showActivationModal();
    }
}

// Показать модалку активации
function showActivationModal() {
    const modal = document.getElementById('activationModal');
    if (modal) {
        modal.style.display = 'flex';
    }
}

// Скрыть модалку активации
function hideActivationModal() {
    const modal = document.getElementById('activationModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Активировать ключ
async function activateKey() {
    const keyInput = document.getElementById('activationKeyInput');
    const key = keyInput ? keyInput.value.trim() : '';
    
    if (!key) {
        alert('Введите ключ!');
        return;
    }
    
    try {
        const response = await fetch('https://resellcontrollbot-production-194e.up.railway.app/checkkey', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key })
        });
        
        const result = await response.json();
        
        if (result.valid) {
            localStorage.setItem('activationKey', key);
            localStorage.setItem('subscription', JSON.stringify({
                isActive: true,
                expiryDate: result.expiryDate
            }));
            hideActivationModal();
            alert('✅ Ключ активирован!');
        } else {
            alert('❌ ' + result.message);
        }
    } catch (error) {
        console.error('Ошибка активации:', error);
        alert('Ошибка подключения к серверу');
    }
}
