import { types, accountTypes, frequencies, debtDirections } from './catalog.js';
import { today, shiftMonth, uid, money, parseMoney, readBook as readRoot, readBackup, writeBook as writeRoot, applyRecurring, hasDueRecurring, validate,
  validDate, validMonth, validTime, newestFirst, dateAndTime, groupOf, accountOf, categoryOf, debtOf, debtRepaid, debtRemaining, savingOf,
  initial, ledgerFor, ledgerStyles, ledgerIcons, wallpaperImages, wallpaperVideos, wallpaperFor, readAttachment, MAX_AMOUNT } from './store.js';
import { firstAfter } from './schedule.js';
import { exportCSV, importCSV, csvTemplate, download } from './files.js';
import { releases } from './releases.js';
import { buildBackup, restoreAttachmentFiles, attachmentFromFile } from './attachments.js';
import { noteFields, noteDraft, mountNote, readNote } from './note.js';
import { android, pendingPayments, acknowledgePayments } from './native.js';
import { pages, nav, esc, icon, option, optionMap, label, dateInput, amountInput, textInput,
  categoryOptions, accountOptions, groupOptions, filtered, recordsList, fmtMonth, wallpaperPageNames } from './views.js';

const $ = selector => document.querySelector(selector);
const content = $('#content');
const dialog = $('#dialog');
const dialogContent = $('#dialog-content');
const categoryDialog = $('#quick-category');
const fileInput = $('#file-input');
const toast = $('#toast');
const [currentRelease] = releases;
const appVersion = currentRelease.version;
const releaseSeenKey = 'daily-ledger-seen-release';
const updateViewKey = 'daily-ledger-update-view';
const ui = {
  month:today().slice(0,7), filter:{query:'',type:'',account:'',group:'',all:false}, limit:50,
  year:false, categoryKind:'expense', openGroups:new Set(), offlineReady:false,
  monthOverviewYear:Number(today().slice(0,4)),
  entrySelection:null,
  drillLimit:50, savingDays:14, depositLimit:30,
  ledgerId:'main',
};
const monthOrigins = new Set(['overview','records','reports','plan']);
let book, page, modal, fileMode, toastTimer, busy=false, storageError;
const ledgerKey='daily-ledger-active-book';
const backupReminderKey='daily-ledger-backup-timestamp';
let backupStart=Date.now();
try { ui.ledgerId=localStorage.getItem(ledgerKey) || 'main'; } catch {}
let debtLaunch=new URL(location.href).searchParams.get('debtLedger');
if (debtLaunch && android) history.replaceState(history.state,'',location.pathname+location.hash);
else debtLaunch=null;
try {
  const stored=Number(localStorage.getItem(backupReminderKey));
  if (stored>0 && stored<=Date.now()) backupStart=stored;
  else localStorage.setItem(backupReminderKey,String(backupStart));
} catch {}

function markBackup() {
  backupStart=Date.now();
  try { localStorage.setItem(backupReminderKey,String(backupStart)); } catch {}
  syncBackupReminder();
}

function syncBackupReminder() {
  $('#backup-reminder').hidden=!(book && page==='overview' && Date.now()-backupStart>=30*86_400_000);
}

function useRoot(root) {
  ui.root=root;
  if (ui.ledgerId!=='main' && !root.ledgers?.some(item=>item.id===ui.ledgerId)) ui.ledgerId='main';
  book=ledgerFor(root,ui.ledgerId);
  return book;
}

async function writeBook(change,files) {
  const ledgerId=ui.ledgerId;
  return useRoot(await writeRoot(root=>{
    if (ledgerId==='main') return change(root);
    const item=root.ledgers?.find(item=>item.id===ledgerId);
    must(item,'当前账本已移除，请重新选择。');
    item.data=change(item.data) ?? item.data;
  },files));
}
let pendingRefresh=0, refreshing=false;
let runningActions=0, pickingFile=false, updateScroll;
let lastSavingsDate;
try {
  const view=JSON.parse(sessionStorage.getItem(updateViewKey));
  sessionStorage.removeItem(updateViewKey);
  if (view && validMonth(view.month)) {
    ui.month=view.month;
    ui.filter=view.filter;
    ui.limit=view.limit;
    ui.year=view.year;
    ui.monthOverviewYear=view.monthOverviewYear;
    updateScroll=view.scroll;
  }
} catch {}
let installPrompt;
const isInstalled=()=>!!android || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
let requestedPersistence=false;
function requestPersistence() {
  if (android || requestedPersistence || !navigator.storage?.persist) return;
  requestedPersistence=true;
  navigator.storage.persist().catch(()=>{});
}
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('daily-ledger-changes') : null;
const showError = error => error instanceof Error ? error.message : '操作失败，请重试。';
const motion = matchMedia('(prefers-reduced-motion: no-preference)');
let pageAnimation, toastAnimation;
let wallKey,wallURL,wallTask=0;
const wallLayer=$('#page-wallpaper');

function syncWallpaper() {
  const wall=wallpaperFor(ui.root,page);
  const key=JSON.stringify([wall,motion.matches]);
  if (key===wallKey) return;
  wallKey=key;
  const task=++wallTask;
  wallLayer.replaceChildren();
  if (wallURL) URL.revokeObjectURL(wallURL);
  wallURL=undefined;
  const active=Boolean(wall?.color || wall?.media);
  document.body.classList.toggle('has-wallpaper',active);
  wallLayer.style.backgroundColor=wall?.color || '';
  wallLayer.style.setProperty('--wall-shade',String((wall?.shade ?? 0)/100));
  if (!wall?.media) return;
  const video=wallpaperVideos.includes(wall.media.type);
  if (!motion.matches && (video || /image\/(gif|webp|avif|png)/.test(wall.media.type))) return;
  readAttachment(wall.media).then(file=>{
    if (task!==wallTask) return;
    const media=document.createElement(video?'video':'img');
    if (video) {
      media.autoplay=media.loop=media.muted=media.playsInline=true;
      media.setAttribute('muted','');
    } else media.alt='';
    media.style.objectFit=wall.fit;
    media.style.objectPosition=wall.position;
    media.addEventListener('error',()=>{ if (task===wallTask) media.remove(); },{once:true});
    wallURL=URL.createObjectURL(file);
    media.src=wallURL;
    wallLayer.replaceChildren(media);
  }).catch(()=>{});
}
motion.addEventListener?.('change',syncWallpaper);

function enter(element, distance, duration) {
  if (!motion.matches || !element.animate) return;
  return element.animate([
    {opacity:.86,transform:`translateY(${distance}px) scale(.995)`},
    {opacity:1,transform:'translateY(0)'},
  ],{duration,easing:'cubic-bezier(.2,.75,.25,1)'});
}

function tell(message, success=false) {
  toast.innerHTML = `${success?icon('check'):''}<span>${esc(message)}</span>`;
  toast.hidden = false;
  toastAnimation?.cancel();
  toastAnimation=enter(toast,7,170);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden=true; }, 4200);
}

function route(resetScroll=false) {
  const hash = location.hash.slice(1);
  const previous=page;
  page = Object.hasOwn(pages,hash) ? hash : 'overview';
  if (page!=='records') ui.entrySelection=null;
  ui.reportDetail=page==='report-detail' ? history.state?.reportDetail : null;
  ui.savingDetailId=page==='saving-detail' ? history.state?.savingId : null;
  render();
  if (page==='updates') markReleaseSeen();
  if (resetScroll) scrollTo(0,previous==='report-detail' && page==='reports' ? history.state?.reportScroll ?? 0 : 0);
  if (book && previous && previous!==page) {
    pageAnimation?.cancel();
    pageAnimation=enter(content,5,150);
  }
}

function monthOrigin() {
  const origin=history.state?.monthOrigin;
  return monthOrigins.has(origin) ? origin : 'overview';
}

function finishMonthOverview(month) {
  if (month) {
    if (!validMonth(month)) return;
    ui.month=month;
    ui.filter.all=false;
    ui.limit=50;
  }
  if (monthOrigins.has(history.state?.monthOrigin)) history.back();
  else location.replace('#'+monthOrigin());
}

function render() {
  const navPage=page==='months' ? monthOrigin() : page;
  $('#side-nav').innerHTML = nav(navPage,false);
  $('#tabbar').innerHTML = nav(navPage,true);
  if (storageError) {
    content.innerHTML = `<section class="panel system-message"><h1>无法打开本机账本</h1><p>${esc(storageError)}</p><p>请退出无痕模式，并从添加到主屏幕的图标重新打开。</p><p><button class="button primary" data-action="reload" type="button">重试</button></p></section>`;
  } else if (book) {
    content.innerHTML = pages[page](book,ui);
    const name=ui.root.ledgers?.find(item=>item.id===ui.ledgerId)?.name;
    $('#active-ledger').textContent=name ?? '';
    $('#active-ledger').hidden=!name;
    syncWallpaper();
    syncBackupReminder();
    if (page==='savings' || page==='saving-detail') lastSavingsDate=today();
    if (updateScroll!==undefined) {
      const y=updateScroll;
      updateScroll=undefined;
      requestAnimationFrame(()=>scrollTo(0,y));
    }
  }
  if (book || storageError) content.setAttribute('aria-busy','false');
}

function refresh(runDue=false) {
  pendingRefresh=Math.max(pendingRefresh,runDue ? 2 : 1);
  return flushRefresh();
}

async function flushRefresh() {
  if (!pendingRefresh || refreshing || dialog.open || busy) return;
  const request=pendingRefresh;
  pendingRefresh=0;
  refreshing=true;
  try {
    const data = await readRoot();
    if (dialog.open || busy) {
      pendingRefresh=Math.max(pendingRefresh,request);
      return;
    }
    const date=today();
    const scopes=root=>[root,...(root.ledgers ?? []).map(item=>item.data)];
    if (request===2 && scopes(data).some(ledger=>hasDueRecurring(ledger,date))) {
      let added=0;
      useRoot(await writeRoot(current => {
        for (const ledger of scopes(current)) {
          const before=ledger.entries.length;
          applyRecurring(ledger,date);
          added+=ledger.entries.length-before;
        }
      }));
      if (added>0) tell(`已自动记入 ${added} 笔到期账单`);
    } else {
      useRoot(data);
    }
    storageError=undefined;
  } catch (error) {
    storageError=showError(error);
  } finally {
    refreshing=false;
    if (!dialog.open && !busy) render();
    openDebtFromReminder();
    flushRefresh();
    capturePayments();
  }
}

function modalFrame(state, title, inner, actions) {
  modal=state;
  const batch=state.kind==='batch';
  dialog.classList.toggle('batch-dialog',batch);
  dialogContent.innerHTML = `<header class="modal-head"><h2 id="dialog-title">${title}</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="关闭">${icon('close')}</button></header>
    <form id="modal-form"><div class="modal-body">${inner}<p class="error" id="modal-error" role="alert" hidden></p></div>
    <footer class="modal-foot">${actions}</footer></form>`;
  if (!dialog.open) dialog.showModal();
  else if (!batch || matchMedia('(min-width:760px)').matches) enter(dialogContent.querySelector('.modal-body'),3,130);
}
const cancel = '<button type="button" class="button neutral" data-action="close">取消</button>';
const submit = text => `<button class="button primary" type="submit">${text}</button>`;
const remove = text => `<button class="button danger" data-action="ask-delete" type="button">${text}</button>`;

const ledgerStyleNames=['翡翠','海蓝','浅紫','暖沙','玫瑰','石墨'];
const ledgerIconNames=['钱包','统计','分类','手册','日历','存款'];
const styleOptions=Object.fromEntries(ledgerStyles.map((id,i)=>[id,ledgerStyleNames[i]]));
const iconOptions=Object.fromEntries(ledgerIcons.map((id,i)=>[id,ledgerIconNames[i]]));

function editLedger(id) {
  const item=ui.root.ledgers?.find(record=>record.id===id);
  modalFrame({kind:'ledger',id},item?'编辑账本':'新建独立账本',
    `${label('名称',textInput('name',item?.name,28,true,'例如 公司财务'))}
     ${label('说明（选填）',textInput('description',item?.description,100))}
     <div class="field-grid">
     ${label('卡片颜色',`<select name="style">${optionMap(styleOptions,item?.style)}</select>`)}
     ${label('图标',`<select name="icon">${optionMap(iconOptions,item?.icon)}</select>`)}
     </div><div class="ledger-look" aria-hidden="true"><span class="ledger-icon"></span></div>`,
    cancel+submit('保存'));
  updateLedgerLook();
}

function updateLedgerLook() {
  const form=$('#modal-form');
  const preview=form.querySelector('.ledger-look');
  preview.className=`ledger-look ledger-${form.elements.namedItem('style').value}`;
  preview.querySelector('.ledger-icon').innerHTML=icon(form.elements.namedItem('icon').value);
}

function selectLedger(id, target='overview') {
  if (id!=='main' && !ui.root.ledgers?.some(item=>item.id===id)) return;
  ui.ledgerId=id;
  try { localStorage.setItem(ledgerKey,id); } catch {}
  useRoot(ui.root);
  ui.filter={query:'',type:'',account:'',group:'',all:false};
  ui.entrySelection=null;
  ui.openGroups.clear();
  ui.limit=50;
  if (location.hash===`#${target}`) route(true);
  else location.hash=target;
}

function openDebtFromReminder() {
  if (!debtLaunch || !book || dialog.open || busy) return;
  const id=debtLaunch;
  debtLaunch=null;
  selectLedger(id,'debts');
}

function openWallpaper(id) {
  if (!Object.hasOwn(wallpaperPageNames,id)) return;
  const wall=ui.root.wallpapers?.[id];
  const types=[...wallpaperImages,...wallpaperVideos].join(',');
  modalFrame({kind:'wallpaper',id},`${wallpaperPageNames[id]}背景`,
    `<p class="muted">${id==='overview'?'总览背景也会用于未单独设置的页面。':'此页可以独立设置，也可以跟随总览。'}</p>
    <div class="field-grid">
      ${label('底色',`<input type="color" name="color" value="${wall?.color || '#e8efe9'}">`)}
      <label class="option-check"><input type="checkbox" name="use-color"${wall?.color?' checked':''}>使用自定义底色</label>
    </div>
    ${label('图片、动图或视频',`<input type="file" name="media" accept="${types},.mov,.mp4,.webm">`)}
    ${wall?.media?`<label class="option-check"><input type="checkbox" name="remove-media">移除 ${esc(wall.media.name)}</label>`:''}
    <div class="field-grid">
      ${label('显示方式',`<select name="fit">${optionMap({cover:'铺满屏幕',contain:'完整显示'},wall?.fit)}</select>`)}
      ${label('对齐',`<select name="position">${optionMap({center:'居中',top:'靠上',bottom:'靠下'},wall?.position)}</select>`)}
    </div>
    ${label('内容可读性 · 浅色遮罩',`<input type="range" name="shade" min="0" max="85" value="${wall?.shade ?? 32}">`)}
    <p class="muted">视频会静音循环播放。优先使用设备支持的 MP4 视频。</p>
    <div class="actions">
    ${id!=='overview' || wall?'<button type="submit" value="reset" class="button neutral">'+(id==='overview'?'恢复系统底色':'跟随总览')+'</button>':''}
    ${id==='overview'?'':'<button type="submit" value="system" class="button neutral">使用系统底色</button>'}
    </div>`,cancel+submit('保存'));
}

function configureAuto() {
  if (!android?.paymentSettings) return;
  const config=ui.root.autoCapture;
  const choices={main:'主账本',...Object.fromEntries((ui.root.ledgers ?? []).map(item=>[item.id,item.name]))};
  modalFrame({kind:'auto-capture'},'配置自动记账',
    `<label class="option-check"><input type="checkbox" name="enabled"${config?.enabled?' checked':''}>启用微信／支付宝付款识别</label>
    ${label('存入账本',`<select name="ledger">${optionMap(choices,config?.ledger ?? ui.ledgerId)}</select>`)}
    ${label('微信付款记到账户','<select name="wechat"></select>')}
    ${label('支付宝付款记到账户','<select name="alipay"></select>')}
    <p class="muted">只记录启用的平台，分类先记入其他支出。可以在明细里修改分类或账户。</p>`,
    cancel+submit('保存设置'));
  updateAutoAccounts(config);
}

function updateAutoAccounts(config) {
  const form=$('#modal-form');
  const ledger=ledgerFor(ui.root,form.elements.namedItem('ledger').value);
  for (const source of ['wechat','alipay']) {
    const chosen=config ? config[source] : ledger.accounts.find(item=>!item.archived &&
      item.name.includes(source==='wechat'?'微信':'支付宝'))?.id;
    form.elements.namedItem(source).innerHTML=accountOptions(ledger,chosen,'关闭该平台');
  }
}

let capturing=false;
async function capturePayments() {
  if (!android?.pendingPayments || capturing || !book || busy || refreshing || dialog.open ||
      document.visibilityState==='hidden') return;
  capturing=true;
  try {
    const events=pendingPayments();
    if (!events.length) return;
    const settled=[];
    let added=0;
    const root=await writeRoot(current=>{
      const config=current.autoCapture;
      const targets=new Map([['main',current],...(current.ledgers ?? []).map(item=>[item.id,item.data])]);
      const lookup=new Map();
      for (const item of events) {
        if (!config?.enabled || !targets.has(item.ledger)) { settled.push(item.id); continue; }
        const target=targets.get(item.ledger);
        let ids=lookup.get(target);
        if (!ids) { ids=new Set(target.entries.map(entry=>entry.id)); lookup.set(target,ids); }
        if (ids.has(item.id)) { settled.push(item.id); continue; }
        const active=id=>target.accounts.some(account=>account.id===id && !account.archived);
        const account=active(item.account) ? item.account
          : config.ledger===item.ledger && active(config[item.source]) ? config[item.source] : '';
        const expense=cat=>!cat.archived && groupOf(target,cat.group)?.type==='expense';
        const category=target.categories.find(cat=>expense(cat) && cat.name==='其他支出')
          ?? target.categories.find(cat=>expense(cat) && groupOf(target,cat.group)?.name==='其他支出');
        const when=new Date(item.at);
        const date=[when.getFullYear(),when.getMonth()+1,when.getDate()].map(n=>String(n).padStart(2,'0')).join('-');
        const time=[when.getHours(),when.getMinutes()].map(n=>String(n).padStart(2,'0')).join(':');
        if (!validDate(date) || !Number.isSafeInteger(item.amount) || item.amount<1 || item.amount>MAX_AMOUNT) {
          settled.push(item.id);
          continue;
        }
        if (!account || target.entries.length>=60000) continue;
        let cat=category;
        if (!cat) {
          let group=target.groups.find(group=>group.type==='expense');
          if (!group) {
            if (target.groups.length>=300) continue;
            group={id:uid(),type:'expense',name:'其他支出',icon:'🧾'};
            target.groups.push(group);
          }
          if (target.categories.length>=2000) continue;
          cat={id:uid(),name:'其他支出',group:group.id,archived:false};
          target.categories.push(cat);
        }
        target.entries.push({id:item.id,date,time,type:'expense',amount:item.amount,account,to:'',category:cat.id,
          note:`${item.source==='wechat'?'微信':'支付宝'}付款 · 自动记账`});
        settled.push(item.id);
        ids.add(item.id);
        added++;
      }
    });
    useRoot(root);
    if (settled.length) acknowledgePayments(settled);
    if (added) {
      if (!dialog.open && !busy) render();
      tell(`已自动记入 ${added} 笔付款`,true);
    }
  } catch (error) { console.warn('Payment queue could not be imported',error); }
  finally { capturing=false; }
}

function errorInModal(message) {
  const element = $('#modal-error');
  if (!element) { tell(message); return; }
  element.textContent=message;
  element.hidden=false;
  if (modal.kind==='batch') element.scrollIntoView({block:'nearest'});
}

function entryFields(type, fields={}, prefix='') {
  const category = type!=='transfer'
    ? `<div class="field entry-category">
        <div class="category-caption">
          <label for="${prefix}entry-category">分类</label>
          <button type="button" class="link-button" data-action="quick-category" data-id="${prefix}entry-category">＋ 添加分类</button>
        </div>
        <select id="${prefix}entry-category" name="${prefix}category" data-entry-category="${type}" required>${categoryOptions(book,type,fields.category,type==='refund'?'请选择原支出分类':'请选择分类')}</select>
      </div>`
    : '';
  return `<div class="field-row entry-accounts${category?' has-category':''}">${label(type==='transfer'?'转出账户':'账户',`<select name="${prefix}account" required>${accountOptions(book,fields.account,'请选择账户')}</select>`)}
  ${type==='transfer' ? label('转入账户',`<select name="${prefix}to" required>${accountOptions(book,fields.to,'请选择账户',fields.account)}</select>`) : category}</div>`;
}

function optionalTimeField(name,time='') {
  return `<div class="field optional-time">
    <div class="time-caption"><label for="${name}-input">时间</label><button type="button" class="link-button" data-action="clear-time"${time?'':' hidden'}>不填</button></div>
    <button type="button" class="time-placeholder" data-action="set-time"${time?' hidden':''}><span>不填</span><span>设置时间</span></button>
    <input id="${name}-input" type="time" name="${name}" value="${esc(time)}" required${time?'':' disabled hidden'}>
  </div>`;
}

function toggleTime(button,enabled) {
  const field=button.closest('.optional-time');
  const input=field.querySelector('input');
  const placeholder=field.querySelector('[data-action="set-time"]');
  field.querySelector('[data-action="clear-time"]').hidden=!enabled;
  placeholder.hidden=enabled;
  input.hidden=input.disabled=!enabled;
  if (enabled) input.focus();
  else {
    input.value='';
    placeholder.focus();
  }
}

function dateFields(date,time,labelText='日期') {
  return `<div class="field-row date-time-fields">${label(labelText,dateInput('date',date))}${optionalTimeField('time',time)}</div>`;
}

function openEntry(record, type='expense') {
  type = record?.type ?? (Object.hasOwn(types,type) ? type : 'expense');
  const state = {kind:'entry', id:record?.id, type};
  const choices = Object.entries(types).map(([key,text]) =>
    `<button type="button" data-action="entry-type" data-id="${key}" aria-pressed="${key===type}">${text}</button>`).join('');
  const defaults = { ...record, account:record?.account ?? book.accounts.find(a=>!a.archived)?.id ?? '' };
  const html = `
    ${record?'':'<div class="entry-tools"><button type="button" class="button secondary" data-action="batch">批量记账</button></div>'}
    <div class="segments" aria-label="账目类型">${choices}</div>
    ${label('金额（人民币）',amountInput(record?.amount),'form-amount')}
    <div id="entry-fields">${entryFields(type,defaults)}</div>
    ${dateFields(record?.date ?? today(),record?.time)}
    ${noteFields('note',record?.note)}`;
  modalFrame(state,record?'编辑账目':'记一笔',html,(record ? remove('删除') : cancel)+submit('保存账目'));
  mountNote(dialog,record?.attachments);
}

const batchRows = () => [...dialog.querySelectorAll('[data-batch-row]')];
const rowPrefix = row => `batch-${row.dataset.batchRow}-`;
const rowControl = (row,key) => row.querySelector(`[name="${rowPrefix(row)}${key}"]`);

let batchFrame=0;
function fitBatchSheet() {
  const viewport=window.visualViewport;
  if (!dialog.open || modal.kind!=='batch' || !viewport || batchFrame) return;
  batchFrame=requestAnimationFrame(()=>{
    batchFrame=0;
    if (!dialog.open || modal.kind!=='batch') return;
    const unscaled=viewport.scale===1;
    const height=unscaled?`${Math.round(viewport.height)}px`:'';
    const bottom=unscaled?`${Math.max(0,Math.round(window.innerHeight-viewport.height-viewport.offsetTop))}px`:'';
    if (dialog.style.getPropertyValue('--batch-height')!==height) dialog.style.setProperty('--batch-height',height);
    if (dialog.style.getPropertyValue('--batch-bottom')!==bottom) dialog.style.setProperty('--batch-bottom',bottom);
  });
}

function updateBatchCount() {
  const rows=batchRows();
  rows.forEach((row,index)=>{
    const title=row.querySelector('h3');
    const text=`第 ${index+1} 笔`;
    if (title.textContent!==text) title.textContent=text;
    const removeButton=row.querySelector('[data-action="remove-batch-row"]');
    if (removeButton.hidden!==(rows.length===1)) removeButton.hidden=rows.length===1;
  });
  const button=$('#batch-submit');
  const text=`保存 ${rows.length} 笔`;
  if (button.textContent!==text) button.textContent=text;
}

function appendBatchRow(fields={}, focus=false) {
  const id=modal.nextRow++;
  const prefix=`batch-${id}-`;
  const type=fields.type ?? 'expense';
  $('#batch-rows').insertAdjacentHTML('beforeend',`
    <section class="batch-row${focus?' batch-row-enter':''}" data-batch-row="${id}" aria-labelledby="batch-row-title-${id}">
      <div class="batch-row-tools"><h3 id="batch-row-title-${id}"></h3><button type="button" class="link-button" data-action="remove-batch-row" data-id="${id}">移除此笔</button></div>
      <div class="field-row">
        ${label('金额（元）',`<input name="${prefix}amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(fields.amount ?? '')}" required>`,'batch-amount')}
        ${label('账目类型',`<select name="${prefix}type">${optionMap(types,type)}</select>`)}
      </div>
      <div class="batch-fields">${entryFields(type,fields,prefix)}</div>
      ${optionalTimeField(prefix+'time',fields.time)}
      ${noteFields(prefix+'note',fields.note)}
    </section>`);
  const row=$(`[data-batch-row="${id}"]`);
  mountNote(row,undefined,fields.noteDraft);
  updateBatchCount();
  if (focus) rowControl(row,'amount').focus();
}

function openBatch() {
  const draft=dialog.open && modal.kind==='entry' && !modal.id ? new FormData($('#modal-form')) : null;
  const date=draft?.get('date') || today();
  const fields={
    type:draft ? modal.type : 'expense',
    account:draft?.get('account') ?? book.accounts.find(a=>!a.archived)?.id,
    amount:draft?.get('amount'),
    category:draft?.get('category'),
    to:draft?.get('to'),
    note:draft?.get('note'),
    time:draft?.get('time'),
    noteDraft:draft ? noteDraft(dialog) : undefined,
  };
  modalFrame({kind:'batch',nextRow:1},'批量记账',`
    <div class="batch-date">
      <div class="batch-date-heading">
        <label for="batch-date-input">统一日期</label>
        <div class="batch-date-actions">
          <button type="button" class="button neutral" data-action="batch-date" data-id="0">今天</button>
          <button type="button" class="button neutral" data-action="batch-date" data-id="-1">昨天</button>
        </div>
      </div>
      ${dateInput('date',date,true,'batch-date-input')}
    </div>
    <div id="batch-rows" class="batch-rows"></div>`,
  '<button type="button" class="button secondary" data-action="add-batch-row">＋ 再加一笔</button><button type="submit" class="button primary" id="batch-submit">保存</button>');
  appendBatchRow(fields);
  fitBatchSheet();
}

function openBulkDateTime() {
  const ids=[...ui.entrySelection];
  if (!ids.length) return;
  const dateModes={keep:'保留原日期',set:'改成同一天'};
  const timeModes={keep:'保留原时间',set:'设为同一时间',clear:'清除时间'};
  modalFrame({kind:'bulk-datetime',ids},'批量改时间',`
    <p>已选 ${ids.length} 笔账目。</p>
    ${label('日期',`<select name="date-mode">${optionMap(dateModes,'keep')}</select>`)}
    <fieldset class="bulk-field" data-bulk-field="date" disabled hidden>${label('新日期',dateInput('date',today()))}</fieldset>
    ${label('具体时间',`<select name="time-mode">${optionMap(timeModes,'keep')}</select>`)}
    <fieldset class="bulk-field" data-bulk-field="time" disabled hidden>${label('新时间','<input type="time" name="time" required>')}</fieldset>`,
    cancel+submit(`保存 ${ids.length} 笔`));
}

function batchDate(offset) {
  const date=new Date(`${today()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+Number(offset));
  const value=date.toISOString().slice(0,10);
  if (validDate(value)) $('#modal-form [name=date]').value=value;
}

function openDebt(debt,direction) {
  const initialDirection=debt?.direction ?? direction;
  const html=`
    ${label('借款方向',`<select name="direction">${optionMap(debtDirections,initialDirection)}</select>`)}
    ${label('对方姓名',textInput('person',debt?.person ?? '',40,true,'姓名或称呼'))}
    ${label('本金（元）',amountInput(debt?.amount),'form-amount')}
    ${dateFields(debt?.date ?? today(),debt?.time,'借款日期')}
    ${noteFields('note',debt?.note)}`;
  modalFrame({kind:'debt',id:debt?.id},debt?'编辑借款':initialDirection==='lent'?'新增借出':'新增借入',
    html,(debt?remove('删除'):cancel)+submit('保存借款'));
  mountNote(dialog,debt?.attachments);
}

function openDebtDetail(debt) {
  const lent=debt.direction==='lent';
  const remaining=debtRemaining(debt);
  const payLabel=lent?'记收款':'记还款';
  const repayments=[...debt.payments].reverse().sort(newestFirst).map(payment=>`
    <button type="button" class="debt-row" data-action="edit-debt-payment" data-id="${esc(payment.id)}">
      <span><strong>${esc(dateAndTime(payment))}</strong>${payment.note?`<small>${esc(payment.note)}</small>`:''}
      ${payment.attachments?.length?`<small>${payment.attachments.length} 个附件</small>`:''}</span>
      <span class="debt-row-amount"><strong class="number">${money(payment.amount)}</strong></span>
    </button>`).join('');
  const html=`<p>${debtDirections[debt.direction]} · ${esc(dateAndTime(debt))}</p>
    <dl class="debt-facts">
      <div><dt>本金</dt><dd class="number">${money(debt.amount)}</dd></div>
      <div><dt>${lent?'已收回':'已归还'}</dt><dd class="number">${money(debtRepaid(debt))}</dd></div>
      <div><dt>${remaining?(lent?'待收回':'待归还'):'已结清'}</dt><dd class="number">${money(remaining)}</dd></div>
    </dl>
    ${debt.note?`<p class="debt-note">${esc(debt.note)}</p>`:''}
    ${debt.attachments?.length?'<div class="note-field"><ul class="attachment-list"></ul><p class="error" role="alert" hidden></p></div>':''}
    ${remaining?`<div class="reminder-card"><div><h3>${lent?'收款提醒':'还款提醒'}</h3>
      <p>${debt.reminder?esc(dateAndTime(debt.reminder)):'尚未设置'}</p></div>
      <button type="button" class="button secondary" data-action="debt-reminder" data-id="${esc(debt.id)}">${debt.reminder?'管理提醒':'设置提醒'}</button></div>`:''}
    <div><h3>${lent?'收款记录':'还款记录'}</h3>${repayments||'<p class="debt-empty">暂无记录</p>'}</div>`;
  const edit=`<button type="button" class="button neutral" data-action="edit-debt" data-id="${esc(debt.id)}">编辑借款</button>`;
  const pay=`<button type="button" class="button primary" data-action="new-debt-payment" data-id="${esc(debt.id)}">${payLabel}</button>`;
  modalFrame({kind:'info',debtId:debt.id},esc(debt.person),html,edit+(remaining?pay:submit('完成')));
  if (debt.attachments?.length) mountNote(dialog,debt.attachments);
}

function updateReminderStatus() {
  const status=$('#reminder-status');
  if (!status || !android?.reminderState) return;
  const state=android.reminderState();
  status.textContent=!(state&1) ? '开启通知后，手机才能收到提醒。' :
    state&2 ? '系统通知已开启，可按设定时间提醒。' : '系统通知已开启。开启准时提醒可减少系统延迟。';
  $('#reminder-notifications').hidden=!!(state&1);
  $('#reminder-exact').hidden=!!(state&2);
}

function openDebtReminder(debt) {
  const reminder=debt.reminder;
  const tomorrow=new Date(`${today()}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate()+1);
  const title=debt.direction==='lent'?'收款提醒':'还款提醒';
  modalFrame({kind:'debt-reminder',id:debt.id},title,`
    <p>${esc(debt.person)} · 待${debt.direction==='lent'?'收回':'归还'} ${money(debtRemaining(debt))}</p>
    <div class="field-row date-time-fields">${label('提醒日期',dateInput('date',reminder?.date ?? tomorrow.toISOString().slice(0,10)))}
      ${label('提醒时间','<input name="time" type="time" value="'+esc(reminder?.time ?? '09:00')+'" required>')}</div>
    ${android?`<p id="reminder-status" aria-live="polite"></p>
      <div class="actions"><button type="button" id="reminder-notifications" class="button secondary" data-action="reminder-settings" data-id="notifications">开启通知</button>
      <button type="button" id="reminder-exact" class="button neutral" data-action="reminder-settings" data-id="exact">允许准时提醒</button></div>`:
      '<p>保存后可下载日历文件，添加到手机日历接收通知。改期或结清时可在日历里调整原事件。</p>'}`,cancel+submit('保存提醒'));
  const actions=$('#modal-form .modal-body');
  if (reminder) actions.insertAdjacentHTML('beforeend',`<div class="actions">
    ${android?'':'<button type="button" class="button secondary" data-action="reminder-calendar">下载日历提醒</button>'}
    <button type="button" class="button neutral" data-action="reminder-remove">取消提醒</button></div>`);
  updateReminderStatus();
}

function reminderCalendar() {
  const debt=debtOf(book,modal.id);
  const stamp=date=>date.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const start=new Date(dateAndTime(debt.reminder).replace(' ','T'));
  const title=debt.direction==='lent'?'日常账本 收款提醒':'日常账本 还款提醒';
  const calendar=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Daily Ledger//Debt Reminder//ZH','BEGIN:VEVENT',
    `UID:${debt.id}@daily-ledger`,`DTSTAMP:${stamp(new Date())}`,`DTSTART:${stamp(start)}`,
    `DTEND:${stamp(new Date(start.getTime()+15*60_000))}`,`SUMMARY:${title}`,
    'BEGIN:VALARM','ACTION:DISPLAY','TRIGGER:PT0M',`DESCRIPTION:${title}`,'END:VALARM','END:VEVENT','END:VCALENDAR',''].join('\r\n');
  return download(title+'.ics',calendar,'text/calendar;charset=utf-8');
}

function openDebtPayment(debt,payment) {
  const available=debtRemaining(debt)+(payment?.amount ?? 0);
  const lent=debt.direction==='lent';
  const todayDate=today();
  const html=`<p>${esc(debt.person)} · ${lent?'本次最多可收回':'本次最多可归还'} ${money(available)}</p>
    ${label('金额（元）',amountInput(payment?.amount),'form-amount')}
    ${dateFields(payment?.date ?? (debt.date>todayDate?debt.date:todayDate),payment?.time)}
    ${noteFields('note',payment?.note)}`;
  modalFrame({kind:'debt-payment',debtId:debt.id,id:payment?.id},payment?'编辑还款记录':lent?'记收款':'记还款',
    html,(payment?remove('删除'):cancel)+submit('保存'));
  mountNote(dialog,payment?.attachments);
}

function openBudget(budget) {
  const html = `
    ${label('月份',`<input type="month" name="month" value="${budget?.month ?? ui.month}" min="2000-01" max="2099-12" required>`)}
    ${label('范围',`<select name="group">${option('','月度总预算',budget?.group ?? '')+groupOptions(book,budget?.group,'expense')}</select>`)}
    ${label('上限（人民币）',amountInput(budget?.amount),'form-amount')}`;
  modalFrame({kind:'budget',id:budget?.id},budget?'编辑预算':'设置预算',html,(budget?remove('删除'):cancel)+submit('保存预算'));
}

function openSaving(plan) {
  const html=`
    ${label('计划名称',textInput('name',plan?.name ?? '',40,true,'例如：每天存 20 元'))}
    ${label('每天应存（元）',amountInput(plan?.daily))}
    <div class="field-row">${label('开始日期',dateInput('start',plan?.start ?? today()))}
    ${label('结束日期（选填）',dateInput('end',plan?.end ?? '',false))}</div>
    <p>${plan?'调整每日金额或起止日期会重算这项计划的应存。':'每天按计划累计应存，实际存入后点「记存入」。'}</p>`;
  modalFrame({kind:'saving',id:plan?.id},plan?'编辑存款计划':'新增存款计划',html,(plan?remove('删除计划'):cancel)+submit('保存计划'));
}

function openSavingDeposit(plan,item) {
  const html=`<p>${esc(plan.name)}</p>
    ${label('实存金额（元）',amountInput(item?.amount ?? plan.daily))}
    ${label('存入日期',dateInput('date',item?.date ?? today()))}
    ${label('备注',textInput('note',item?.note ?? '',160,false,'选填'))}`;
  modalFrame({kind:'saving-deposit',id:item?.id,planId:plan.id},item?'编辑实存记录':'记存入',html,
    (item?remove('删除'):cancel)+submit('保存实存'));
}

function openAccount(account) {
  const html = `
    ${label('账户名称',textInput('name',account?.name ?? '',28,true))}
    ${label('账户类型',`<select name="type">${optionMap(accountTypes,account?.type ?? 'wallet')}</select>`)}
    ${label('期初余额（可填写负数）',amountInput(account?.opening ?? 0),'form-amount')}
    ${account?label('状态',`<select name="archived">${option('no','使用中',account.archived?'yes':'no')+option('yes','归档',account.archived?'yes':'no')}</select>`):''}
    <p>期初余额填写开始记账前的金额。信用卡已有欠款时填写负数。</p>`;
  modalFrame({kind:'account',id:account?.id},account?'编辑账户':'新增账户',html,cancel+submit('保存账户'));
}

function openCategory(category, groupId) {
  const group = groupOf(book,category?.group ?? groupId);
  const html = `<p>${esc(group.name)} · ${types[group.type]}</p>
    ${label('分类名称',textInput('name',category?.name ?? '',28,true))}
    ${category?label('状态',`<select name="archived">${option('no','使用中',category.archived?'yes':'no')+option('yes','归档',category.archived?'yes':'no')}</select>`):''}`;
  modalFrame({kind:'category',id:category?.id,group:group.id},category?'编辑分类':'新增二级分类',html,cancel+submit('保存分类'));
}

function openQuickCategory(selectId) {
  const select=document.getElementById(selectId);
  const type=select.dataset.entryCategory==='income'?'income':'expense';
  const group=categoryOf(book,select.value)?.group ?? '';
  const groups=groupOptions(book,group,type);
  must(groups,'请先在「更多 → 分类」中新建这个收支类型的分类组。');
  categoryDialog.dataset.select=selectId;
  categoryDialog.innerHTML=`
    <header class="modal-head"><h2 id="quick-category-title">添加分类</h2></header>
    <form id="quick-category-form">
      <div class="modal-body">
        ${label('分类名称',textInput('name','',28,true,'例如：打印、跑步'))}
        ${label('分类组',`<select name="group" required>${option('','请选择分类组',group)+groups}</select>`)}
        <p class="error" role="alert" hidden></p>
      </div>
      <footer class="modal-foot">
        <button type="button" class="button neutral" data-action="close-quick-category">取消</button>
        ${submit('保存并选用')}
      </footer>
    </form>`;
  categoryDialog.querySelector('[name=name]').autofocus=true;
  categoryDialog.showModal();
}

async function saveQuickCategory(event) {
  event.preventDefault();
  if (busy) return;
  const form=event.target;
  const data=new FormData(form);
  const get=name=>String(data.get(name) ?? '').trim();
  const target=document.getElementById(categoryDialog.dataset.select);
  const state={id:uid(),group:get('group'),type:target.dataset.entryCategory==='income'?'income':'expense'};
  const errorLine=form.querySelector('.error');
  errorLine.hidden=true;
  busy=true;
  if (event.submitter) event.submitter.disabled=true;
  try {
    book=await writeBook(current=>save.category(current,state,get));
    const options=new Map();
    for (const select of dialog.querySelectorAll('[data-entry-category]')) {
      const type=select.dataset.entryCategory==='income'?'income':'expense';
      if (type!==state.type) continue;
      const chosen=select===target ? state.id : select.value;
      if (!options.has(chosen)) options.set(chosen,categoryOptions(book,type,chosen));
      select.innerHTML=options.get(chosen);
    }
    channel?.postMessage('change');
    categoryDialog.close();
  } catch (error) {
    errorLine.textContent=showError(error);
    errorLine.hidden=false;
  } finally {
    if (event.submitter) event.submitter.disabled=false;
    busy=false;
  }
}

function openGroup(group) {
  const html = `${label('分类组名称',textInput('name',group?.name ?? '',28,true))}
    ${group?`<p>${types[group.type]}</p>`:label('收支类型',`<select name="type">${optionMap({expense:'支出与退款',income:'收入'},ui.categoryKind)}</select>`)}
    ${label('图标（可填一个表情）',textInput('icon',group?.icon ?? '📁',12,true))}`;
  modalFrame({kind:'group',id:group?.id},group?'编辑分类组':'新增分类组',html,cancel+submit('保存分类组'));
}

function openRule(rule) {
  const type=rule?.type ?? 'expense';
  const started=!!rule?.next;
  const html = `${label('名称',textInput('name',rule?.name ?? '',60,true,'如房租、会员或工资'))}
    <div class="field-row">${label('类型',`<select name="type" required>${optionMap({expense:'支出',income:'收入'},type)}</select>`)}${label('金额（人民币）',amountInput(rule?.amount))}</div>
    <div class="field-row">${label('账户',`<select name="account" required>${accountOptions(book,rule?.account ?? book.accounts.find(a=>!a.archived)?.id,'请选择账户')}</select>`)}
    ${label('分类',`<select name="category" required>${categoryOptions(book,type,rule?.category)}</select>`)}</div>
    ${started?`<p>${frequencies[rule.frequency]} · 首次日期 ${rule.start}</p>`:
      `<div class="field-row">${label('重复频率',`<select name="frequency">${optionMap(frequencies,rule?.frequency ?? 'monthly')}</select>`)}
      ${label('首次日期',dateInput('start',rule?.start ?? today()))}</div>`}
    <div class="field-row">${label('结束日期（可选）',dateInput('end',rule?.end ?? '',false))}
    ${label('总次数（可选）',`<input name="count" type="number" min="1" max="600" step="1" value="${rule?.count ?? ''}" placeholder="持续重复">`)}</div>
    ${rule?label('状态',`<select name="paused">${option('no','启用',rule.paused?'yes':'no')+option('yes','暂停',rule.paused?'yes':'no')}</select>`):''}
    <p>到期后打开账本时入账。短月按当月最后一天处理。恢复规则时跳过暂停期间的日期。</p>`;
  modalFrame({kind:'rule',id:rule?.id},rule?'编辑周期规则':'新增周期规则',html,(rule?remove('删除'):cancel)+submit('保存规则'));
}

function openOffline() {
  const standalone = isInstalled();
  const status = ui.offlineReady ? '离线资源已就绪。' : '离线资源还在准备中。请保持联网，重新打开本页后查看状态。';
  modalFrame({kind:'info'},android?'应用信息':'安装到桌面',`<p>${status}${standalone?' 已在独立窗口打开。':''}</p>
    <button type="button" id="install-app" class="button primary" data-action="install-app"${installPrompt && !standalone?'':' hidden'}>安装日常账本</button>
    ${standalone?'':`<ul class="install-steps">
      <li><strong>iPhone / iPad</strong> 在 Safari 点「共享 → 添加到主屏幕」，开启「作为网页 App 打开」（如有）。</li>
      <li><strong>安卓 Chrome</strong> 打开右上角菜单，点「安装应用」或「添加到主屏幕」。</li>
      <li><strong>三星手机</strong> 也可在 Samsung Internet 点地址栏的安装图标，或从菜单添加到主屏幕。</li>
      <li><strong>Windows / Linux</strong> 用 Chrome 或 Edge 安装网页 App，可创建桌面快捷方式。</li>
      <li><strong>Mac</strong> 用 Chrome 安装，或在 macOS 14 及以上用 Safari「文件 → 添加到程序坞」。</li>
    </ul>`}
    <p>${android?'账目和附件存放在此 App 内，可以断网记账。':'安装后先从图标联网打开一次。显示「离线可用」后就能断网记账。'}跨设备可通过 JSON 备份迁移。</p>
    <p>当前版本 <strong>${appVersion}</strong></p>
    <p>${android?'联网时小更新会自动下载。安装时请按系统提示确认。':'联网时自动检查，小更新会在页面空闲时应用。'}</p>
    <button type="button" class="button secondary" data-action="check-update">检查更新</button>
    <p id="manual-update-status" aria-live="polite" hidden></p>
    <button type="button" class="button neutral" data-action="show-releases">版本更新</button>
    <a class="guide-link" href="./guide/">查看使用手册</a>`,submit('知道了'));
}

function openHuaweiInstall() {
  modalFrame({kind:'info'},'华为／鸿蒙',`
    <p><strong>HarmonyOS 5 及以上</strong>。用华为浏览器打开日常账本，点网页菜单「∷ → 添加至桌面」。以后点桌面图标即可打开网页版。</p>
    <a class="guide-link" href="./guide/#huawei">查看华为安装步骤</a>
    <p><strong>支持安装 APK 的华为设备</strong>。可下载现有 Android 安装包，按系统提示安装独立版。</p>
    <a class="button secondary" href="https://zihaoxudava.github.io/daily-ledger/downloads/daily-ledger-android.apk">下载 Android 安装包</a>`,submit('知道了'));
}

async function installApp() {
  if (!installPrompt) return;
  const prompt=installPrompt;
  installPrompt=undefined;
  $('#install-app').hidden=true;
  await prompt.prompt();
  if ((await prompt.userChoice).outcome==='accepted') {
    dialog.close();
    tell('已确认安装，请从桌面或主屏幕打开。');
  }
}

async function manualCheckUpdate() {
  const status=$('#manual-update-status');
  status.hidden=false;
  if (!navigator.onLine) {
    status.textContent='联网后可以检查更新。';
    return;
  }
  status.textContent='正在检查更新…';
  const checked=await checkUpdate(true);
  status.textContent=updateReady||nativeRelease?'新版已就绪，关闭窗口可查看。':
    checked?'已检查，检测到新版后会在页面顶部提示。':'暂时无法检查更新，请稍后再试。';
}

function showNativeUpdate() {
  const changes=nativeRelease.changes.map(change=>`<li>${esc(change)}</li>`).join('');
  modalFrame({kind:'info'},`新版 ${esc(nativeRelease.version)}`,`<ul class="install-steps">${changes}</ul>
    <p>下载后打开 APK，按系统提示覆盖安装。可以继续用原来的账本。</p>
    <button type="button" class="button primary" data-action="reload">下载更新</button>`,submit('关闭'));
}

function setEntryType(type) {
  const form=$('#modal-form');
  const old=new FormData(form);
  $('#entry-fields').innerHTML=entryFields(type,{account:old.get('account') ?? '',to:old.get('to') ?? '',category:old.get('category') ?? ''});
  form.querySelectorAll('[data-action="entry-type"]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.id===type)));
  modal.type=type;
}

function upsert(list,item) {
  const index=list.findIndex(value=>value.id===item.id);
  if (index===-1) list.push(item);
  else list[index]=item;
}

function must(condition,message) {
  if (!condition) throw new Error(message);
}

async function commit(change, message, afterWrite, files, global=false) {
  if (global) useRoot(await writeRoot(change,files));
  else await writeBook(change,files);
  afterWrite?.();
  channel?.postMessage('change');
  dialog.close();
  route();
  if (message) tell(message,true);
}

async function saveBulkDateTime(state,get) {
  const dateMode=get('date-mode'), timeMode=get('time-mode');
  const date=get('date'), time=get('time');
  must(['keep','set'].includes(dateMode) && ['keep','set','clear'].includes(timeMode),'请选择修改方式。');
  must(dateMode!=='keep' || timeMode!=='keep','请选择要修改的日期或时间。');
  if (dateMode==='set') must(validDate(date),'请选择有效日期。');
  if (timeMode==='set') must(time && validTime(time),'请填写有效时间。');
  const ids=new Set(state.ids);
  await commit(current=>{
    const entries=current.entries.filter(entry=>ids.has(entry.id));
    must(entries.length===ids.size,'有选中的账目已被移除，请返回明细重新选择。');
    for (const entry of entries) {
      if (dateMode==='set') entry.date=date;
      if (timeMode==='set') entry.time=time;
      if (timeMode==='clear') delete entry.time;
    }
  },`已更新 ${ids.size} 笔账目`,()=>{
    ui.entrySelection=null;
    if (dateMode==='set' && !ui.filter.all) ui.month=date.slice(0,7);
  });
}

function makeEntry(current, type, get, date, note, id=uid()) {
  must(validDate(date),'请填写有效日期。');
  must(Object.hasOwn(types,type),'请选择账目类型。');
  const transfer=type==='transfer';
  const item={id,type,amount:parseMoney(get('amount')),date,account:get('account'),
    to:transfer?get('to'):'',category:transfer?'':get('category'),...note,...optionalTime(get)};
  must(accountOf(current,item.account),'请选择账户。');
  if (transfer) must(accountOf(current,item.to) && item.account!==item.to,'请选择不同的转入和转出账户。');
  else must(categoryOf(current,item.category),'请选择分类。');
  return item;
}

function optionalTime(get) {
  const time=get('time');
  must(validTime(time),'请填写有效时间，或留空。');
  return time ? {time} : {};
}

const save = {
  entry(current,s,get,note) {
    const item=makeEntry(current,s.type,get,get('date'),note,s.id);
    if (s.id) must(current.entries.some(e=>e.id===s.id),'这笔账目已在其他窗口移除。');
    upsert(current.entries,item);
  },
  debt(current,s,get,note) {
    const existing=debtOf(current,s.id);
    if (s.id) must(existing,'这项借款已被移除。');
    const debt={id:s.id ?? uid(),direction:get('direction'),person:get('person'),amount:parseMoney(get('amount')),
      date:get('date'),payments:existing?.payments ?? [],...note,...optionalTime(get),
      ...(existing?.reminder?{reminder:existing.reminder}:{})};
    must(debt.person,'请填写对方姓名。');
    must(validDate(debt.date),'请填写有效日期。');
    must(debtRemaining(debt)>=0,'本金不能小于已记录的还款金额。');
    must(debt.payments.every(payment=>payment.date>=debt.date),'借款日期不能晚于已记录的还款日期。');
    upsert(current.debts,debt);
  },
  'debt-payment'(current,s,get,note) {
    const debt=debtOf(current,s.debtId);
    must(debt,'这项借款已被移除。');
    const previous=debt.payments.find(payment=>payment.id===s.id);
    if (s.id) must(previous,'这笔还款已被移除。');
    const payment={id:s.id ?? uid(),amount:parseMoney(get('amount')),date:get('date'),...note,...optionalTime(get)};
    must(validDate(payment.date) && payment.date>=debt.date,'请填写有效日期，且不早于借款日期。');
    must(payment.amount<=debtRemaining(debt)+(previous?.amount ?? 0),'金额不能超过这项借款的剩余金额。');
    upsert(debt.payments,payment);
  },
  'debt-reminder'(current,s,get) {
    const debt=debtOf(current,s.id);
    must(debt && debtRemaining(debt)>0,'这项借款已结清或移除。');
    const date=get('date'),time=get('time');
    must(validDate(date) && time && validTime(time) &&
      new Date(`${date}T${time}`).getTime()>Date.now(),'请选择未来的提醒日期和时间。');
    debt.reminder={date,time};
  },
  budget(current,s,get) {
    const item={id:s.id ?? uid(),month:get('month'),group:get('group'),amount:parseMoney(get('amount'))};
    must(validMonth(item.month),'请填写有效月份。');
    must(!current.budgets.some(b=>b.month===item.month && b.group===item.group && b.id!==item.id),
      '该月已有同范围预算，请在预算列表编辑原预算。');
    upsert(current.budgets,item);
  },
  saving(current,s,get) {
    const previous=savingOf(current,s.id);
    if (s.id) must(previous,'这项存款计划已移除。');
    const plan={id:s.id ?? uid(),name:get('name'),daily:parseMoney(get('amount')),start:get('start'),end:get('end')};
    must(plan.name,'请填写计划名称。');
    must(validDate(plan.start) && (!plan.end || validDate(plan.end) && plan.end>=plan.start),'请选择有效的开始和结束日期。');
    must(!current.savingDeposits.some(item=>item.plan===plan.id && item.date<plan.start),'开始日期不能晚于已有的实存记录。');
    upsert(current.savings,plan);
  },
  'saving-deposit'(current,s,get) {
    const plan=savingOf(current,s.planId);
    must(plan,'这项存款计划已移除。');
    if (s.id) must(current.savingDeposits.some(item=>item.id===s.id && item.plan===plan.id),'这笔实存记录已移除。');
    const item={id:s.id ?? uid(),plan:plan.id,date:get('date'),amount:parseMoney(get('amount')),note:get('note')};
    must(validDate(item.date) && item.date>=plan.start && item.date<=today(),'请选择从计划开始到今天之间的日期。');
    upsert(current.savingDeposits,item);
  },
  account(current,s,get) {
    const item={id:s.id ?? uid(),name:get('name'),type:get('type'),opening:parseMoney(get('amount'),true),archived:get('archived')==='yes'};
    must(item.name && !current.accounts.some(a=>a.name===item.name && a.id!==item.id),'请填写未被占用的账户名。');
    must(!item.archived || current.accounts.some(a=>a.id!==item.id && !a.archived),'至少保留一个使用中的账户。');
    upsert(current.accounts,item);
  },
  category(current,s,get) {
    const item={id:s.id ?? uid(),group:s.group,name:get('name'),archived:get('archived')==='yes'};
    const group=groupOf(current,item.group);
    must(group && (!s.type || s.type===group.type),'请选择有效的分类组。');
    must(item.name && !current.categories.some(c=>c.group===item.group && c.name===item.name && c.id!==item.id),
      '请填写该组内未被占用的分类名。');
    upsert(current.categories,item);
    ui.openGroups.add(s.group);
  },
  group(current,s,get) {
    const existing=groupOf(current,s.id);
    const item={id:s.id ?? uid(),name:get('name'),type:existing?.type ?? get('type'),icon:get('icon')};
    must(item.name && item.icon && !current.groups.some(g=>g.type===item.type && g.name===item.name && g.id!==item.id),
      '请填写图标和未被占用的分类组名称。');
    upsert(current.groups,item);
    ui.categoryKind=item.type;
    ui.openGroups.add(item.id);
  },
  rule(current,s,get) {
    const existing=current.rules.find(rule=>rule.id===s.id);
    const rule={
      id:s.id ?? uid(),name:get('name'),type:get('type'), amount:parseMoney(get('amount')),
      account:get('account'),category:get('category'),
      frequency:existing?.next ? existing.frequency : get('frequency'),
      start:existing?.next ? existing.start : get('start'),
      end:get('end'), count:get('count') ? Number(get('count')) : null,
      paused:get('paused')==='yes', next:existing?.next ?? 0,
    };
    must(rule.name && validDate(rule.start) && (!rule.end || validDate(rule.end) && rule.end>=rule.start),'请填写规则名称与有效的起止日期。');
    must(rule.account && rule.category,'请选择账户和分类。');
    const date=today();
    if (existing?.paused && !rule.paused) rule.next=Math.max(rule.next,firstAfter(rule,date));
    upsert(current.rules,rule);
    applyRecurring(current,date);
  },
};

function askDelete() {
  const state=modal;
  const labels={entry:'这笔账目',budget:'这项预算',rule:'这条周期规则',debt:'这项借款及其全部还款记录',
    'debt-payment':'这笔还款记录',saving:'这项存款计划及其全部实存记录','saving-deposit':'这笔实存记录'};
  const collection={entry:'entries',budget:'budgets',rule:'rules',debt:'debts','debt-payment':'payments',
    saving:'savings','saving-deposit':'savingDeposits'}[state.kind];
  modalFrame({kind:'delete',id:state.id,collection,debtId:state.debtId},'确认删除',
    `<p>删除${labels[state.kind]}后无法撤销。${state.kind==='rule'?'已经生成的账目仍会保留。':''}</p>`,cancel+'<button type="submit" class="button danger">确认删除</button>');
}

async function submitModal(event) {
  if (event.target.id !== 'modal-form') return;
  event.preventDefault();
  if (busy) return;
  if (modal.kind==='info') { dialog.close(); return; }
  requestPersistence();
  const data=new FormData(event.target);
  const get=name=>String(data.get(name) ?? '').trim();
  const state=modal;
  const submitter=event.submitter;
  busy=true;
  if (submitter) submitter.disabled=true;
  try {
    if (state.kind==='delete') {
      await commit(current=>{
        const owner=state.collection==='payments' ? debtOf(current,state.debtId) : current;
        must(owner,'这项借款已被移除。');
        owner[state.collection]=owner[state.collection].filter(item=>item.id!==state.id);
        if (state.collection==='savings') current.savingDeposits=current.savingDeposits.filter(item=>item.plan!==state.id);
      },'已删除');
    } else if (state.kind==='restore') {
      await commit(()=>state.data,'已恢复完整备份',()=>selectLedger('main'),state.files,true);
    } else if (state.kind==='ledger') {
      const name=get('name');
      must(name,'请填写账本名称。');
      await commit(current=>{
        const items=current.ledgers ??= [];
        const item=items.find(record=>record.id===state.id);
        if (state.id) must(item,'该账本已移除。');
        must(name!=='主账本' && !items.some(record=>record.name===name && record.id!==state.id),'该名称已存在。');
        upsert(items,{id:state.id ?? uid(),name,description:get('description'),style:get('style'),icon:get('icon'),data:item?.data ?? initial()});
      },'已保存账本',undefined,undefined,true);
    } else if (state.kind==='wallpaper') {
      const file=data.get('media');
      const action=submitter?.value;
      let media;
      const files=new Map();
      if (action!=='reset' && action!=='system' && file?.name) {
        const formats=[...wallpaperImages,...wallpaperVideos];
        const guessed={mov:'video/quicktime',mp4:'video/mp4',webm:'video/webm',gif:'image/gif',png:'image/png',
          jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',heic:'image/heic',heif:'image/heif'};
        const type=formats.includes(file.type)?file.type:guessed[file.name.split('.').pop().toLowerCase()];
        must(formats.includes(type),'请选择支持的图片、动图或视频文件。');
        media={...attachmentFromFile(file,`wall_${uid()}`),type};
        files.set(media.id,file);
      }
      await commit(current=>{
        const wallpapers=current.wallpapers ??= {};
        if (action==='reset') { delete wallpapers[state.id]; return; }
        if (action==='system' && state.id!=='overview') {
          wallpapers[state.id]={system:true,color:'',fit:'cover',position:'center',shade:32};
          return;
        }
        const currentMedia=media ?? (data.has('remove-media')?undefined:wallpapers[state.id]?.media);
        const color=data.has('use-color')?get('color'):'';
        if (!color && !currentMedia) { delete wallpapers[state.id]; return; }
        wallpapers[state.id]={color,fit:get('fit'),position:get('position'),shade:Number(get('shade')),
          ...(currentMedia?{media:currentMedia}:{})};
      },'已保存页面背景',()=>{ location.hash=state.id; },files,true);
    } else if (state.kind==='auto-capture') {
      const config={enabled:data.has('enabled'),ledger:get('ledger'),wechat:get('wechat'),alipay:get('alipay')};
      must(!config.enabled || config.wechat || config.alipay,'请为至少一个平台选择账户。');
      await commit(current=>{ current.autoCapture=config; },'已保存自动记账设置',undefined,undefined,true);
    } else if (state.kind==='csv') {
      let summary;
      await commit(current=>{ summary=importCSV(current,state.raw); });
      tell(`已导入 ${summary.added} 笔，跳过 ${summary.skipped} 笔重复编号`);
    } else if (state.kind==='batch') {
      const date=get('date');
      must(validDate(date),'请选择有效的统一日期。');
      const files=new Map();
      const rows=batchRows().map(row=>{
        const prefix=rowPrefix(row);
        const field=key=>get(prefix+key);
        return {field,note:readNote(row,field('note'),files)};
      });
      await commit(current=>{
        const entries=rows.map(({field,note},index)=>{
          try { return makeEntry(current,field('type'),field,date,note); }
          catch (error) { throw new Error(`第 ${index+1} 笔：${showError(error)}`); }
        });
        current.entries.push(...entries);
      },`已保存 ${rows.length} 笔`,()=>{
        ui.month=date.slice(0,7);
        ui.limit=50;
      },files);
    } else if (state.kind==='bulk-datetime') {
      await saveBulkDateTime(state,get);
    } else if (state.kind==='debt-reminder') {
      book=await writeBook(current=>save[state.kind](current,state,get));
      channel?.postMessage('change');
      render();
      openDebtReminder(debtOf(book,state.id));
      tell(android?'已保存提醒':'已保存，可下载日历提醒',true);
    } else {
      const files=new Map();
      const note=noteDraft(dialog) ? readNote(dialog,get('note'),files) : undefined;
      await commit(current=>save[state.kind](current,state,get,note),'已保存',undefined,files);
    }
  } catch (error) {
    errorInModal(showError(error));
  } finally {
    if (submitter) submitter.disabled=false;
    busy=false;
    flushRefresh();
  }
}

function chooseFile(mode) {
  pickingFile=true;
  fileMode=mode;
  fileInput.accept=mode==='csv'?'.csv,text/csv':'.json,application/json';
  fileInput.value='';
  fileInput.click();
}

async function inspectFile() {
  const file=fileInput.files[0];
  if (!file || !book) return;
  try {
    if (fileMode==='csv' && file.size>25_000_000) throw new Error('文件超过 25 MB，请分批导入 CSV。');
    const raw=await file.text();
    if (fileMode==='csv') {
      const preview=structuredClone(book);
      const {added,skipped}=importCSV(preview,raw);
      validate(preview);
      modalFrame({kind:'csv',raw},'确认导入 CSV',`<p>${esc(file.name)}</p><p>将新增 ${added} 笔，跳过 ${skipped} 笔已有编号的记录。文件中出现的新账户和分类会自动建立。</p>`,cancel+submit('导入'));
    } else {
      let parsed;
      try { parsed=JSON.parse(raw); }
      catch { throw new Error('文件不是有效的 JSON 备份。'); }
      const {attachmentFiles,...contents}=parsed ?? {};
      const data=validate(contents);
      const files=restoreAttachmentFiles(data,attachmentFiles);
      modalFrame({kind:'restore',data,files},'确认恢复备份',`<p>${esc(file.name)}</p>
        <p>备份含 ${data.entries.length} 笔账目、${data.debts.length} 项借出借入、${data.accounts.length} 个账户、${data.budgets.length} 项预算${data.savings.length?`、${data.savings.length} 项存款计划`:''}${files.size?`和 ${files.size} 个附件`:''}。</p>
        <p>恢复会替换本机所有账本、附件和背景。本文件含 ${data.ledgers?.length ?? 0} 个独立账本。请先备份现有账目。</p>`,cancel+submit('替换并恢复'));
    }
  } catch (error) {
    modalFrame({kind:'info'},'文件读取失败',`<p class="error">${esc(showError(error))}</p>`,submit('关闭'));
  }
}

function renderRecordResults() {
  const section=$('#records-list');
  if (section) section.innerHTML=recordsList(book,ui);
}

const visibleEntryChecks=()=>[...content.querySelectorAll('[data-select-entry]')];

function updateSelection() {
  const count=ui.entrySelection.size;
  $('#selection-summary').textContent=`已选 ${count} 笔`;
  $('[data-action="bulk-datetime"]').disabled=!count;
  const checks=visibleEntryChecks();
  $('[data-action="select-visible"]').textContent=checks.every(check=>check.checked)?'取消全选':'全选已显示';
}

function openReportDetail(kind,button,event) {
  const period=button.dataset.reportPeriod;
  let group=button.dataset.reportGroup;
  if (button.dataset.reportSectors && event.detail) {
    const bounds=button.getBoundingClientRect();
    const x=event.clientX-bounds.left-bounds.width/2;
    const y=event.clientY-bounds.top-bounds.height/2;
    if (Math.hypot(x,y)>bounds.width*.32) {
      const position=(Math.atan2(x,-y)*50/Math.PI+100)%100;
      group=JSON.parse(button.dataset.reportSectors).find(([end])=>position<end)?.[1] ?? '';
    }
  }
  history.replaceState({...history.state,reportScroll:scrollY},'');
  history.pushState({reportDetail:{period,kind,group}},'','#report-detail');
  ui.drillLimit=50;
  route(true);
}

const actions = {
  new:id=>openEntry(null,id),
  'edit-ledger':editLedger,
  'open-ledger':id=>selectLedger(id),
  wallpaper:openWallpaper,
  'configure-auto':configureAuto,
  'payment-settings':()=>android?.paymentSettings(),
  batch:openBatch,
  'new-debt':direction=>openDebt(null,direction),
  'debt-detail':id=>{ const debt=debtOf(book,id); if (debt) openDebtDetail(debt); },
  'debt-reminder':id=>{ const debt=debtOf(book,id); if (debt && debtRemaining(debt)>0) openDebtReminder(debt); },
  'reminder-calendar':reminderCalendar,
  'reminder-settings':id=>android?.reminderSettings(id),
  'reminder-remove':async()=>{
    const id=modal.id;
    busy=true;
    try {
      await commit(current=>{
        const debt=debtOf(current,id);
        if (debt) delete debt.reminder;
      },'提醒已取消');
    } finally {
      busy=false;
      flushRefresh();
    }
  },
  'edit-debt':id=>{ const debt=debtOf(book,id); if (debt) openDebt(debt); },
  'new-debt-payment':id=>{ const debt=debtOf(book,id); if (debt && debtRemaining(debt)>0) openDebtPayment(debt); },
  'edit-debt-payment':id=>{
    const debt=debtOf(book,modal.debtId);
    const payment=debt?.payments.find(item=>item.id===id);
    if (payment) openDebtPayment(debt,payment);
  },
  'batch-date':batchDate,
  'add-batch-row':()=>{
    const row=batchRows().at(-1);
    appendBatchRow({type:rowControl(row,'type').value,account:rowControl(row,'account').value},true);
  },
  'remove-batch-row':id=>{
    if (batchRows().length<2) return;
    $(`[data-batch-row="${id}"]`)?.remove();
    updateBatchCount();
  },
  entry:id=>{ const entry=book.entries.find(e=>e.id===id); if (entry) openEntry(entry); },
  'entry-type':setEntryType,
  'select-entries':()=>{
    ui.entrySelection=ui.entrySelection ? null : new Set();
    renderRecordResults();
  },
  'select-visible':()=>{
    const checks=visibleEntryChecks();
    const select=checks.some(check=>!check.checked);
    for (const check of checks) {
      check.checked=select;
      if (select) ui.entrySelection.add(check.dataset.selectEntry);
      else ui.entrySelection.delete(check.dataset.selectEntry);
    }
    updateSelection();
  },
  'bulk-datetime':openBulkDateTime,
  'report-detail':openReportDetail,
  'back-report':()=>{ if (ui.reportDetail) history.back(); else location.hash='reports'; },
  'more-report':()=>{ ui.drillLimit+=50; render(); },
  saving:id=>openSaving(savingOf(book,id)),
  'saving-detail':id=>{
    history.pushState({savingId:id},'','#saving-detail');
    ui.savingDays=14;
    ui.depositLimit=30;
    route(true);
  },
  'back-saving':()=>{ if (ui.savingDetailId) history.back(); else location.hash='savings'; },
  'more-saving-days':()=>{ ui.savingDays+=14; render(); },
  'more-saving-deposits':()=>{ ui.depositLimit+=30; render(); },
  'saving-deposit':id=>{ const plan=savingOf(book,id); if (plan) openSavingDeposit(plan); },
  'edit-saving-deposit':id=>{
    const item=book.savingDeposits.find(record=>record.id===id);
    const plan=item && savingOf(book,item.plan);
    if (plan) openSavingDeposit(plan,item);
  },
  budget:id=>openBudget(book.budgets.find(b=>b.id===id)),
  account:id=>openAccount(accountOf(book,id)),
  group:id=>openGroup(groupOf(book,id)),
  category:id=>{ const category=categoryOf(book,id); if (category) openCategory(category); },
  'quick-category':openQuickCategory,
  'close-quick-category':()=>categoryDialog.close(),
  'category-add':id=>openCategory(null,id),
  rule:id=>openRule(book.rules.find(rule=>rule.id===id)),
  'category-kind':id=>{ ui.categoryKind=id; render(); },
  period:id=>{
    const month=shiftMonth(ui.month,Number(id)*(page==='reports'&&ui.year?12:1));
    if (validMonth(month)) {
      ui.month=month;
      ui.entrySelection?.clear();
    }
    ui.limit=50;
    render();
  },
  'open-months':()=>{
    ui.monthOverviewYear=Number(ui.month.slice(0,4));
    history.pushState({monthOrigin:page},'', '#months');
    route(true);
  },
  'month-year':id=>{
    ui.monthOverviewYear=Math.max(2000,Math.min(2099,ui.monthOverviewYear+Number(id)));
    render();
  },
  'select-month':finishMonthOverview,
  'close-months':()=>finishMonthOverview(),
  'filter-scope':id=>{ ui.filter.all=id==='all'; ui.entrySelection?.clear(); ui.limit=50; render(); },
  'report-range':id=>{ ui.year=id==='year'; render(); },
  'load-more':()=>{ ui.limit+=50; renderRecordResults(); },
  close:()=>{ if (!busy) dialog.close(); },
  reload:()=>{ if (android && nativeRelease) android.openUpdate(nativeRelease.versionCode); else location.reload(); },
  'show-native-update':showNativeUpdate,
  'set-time':(_id,button)=>toggleTime(button,true),
  'clear-time':(_id,button)=>toggleTime(button,false),
  'show-releases':()=>{
    dialog.close();
    location.hash='updates';
  },
  'dismiss-release':markReleaseSeen,
  'ask-delete':askDelete,
  'offline-info':openOffline,
  'huawei-install':openHuaweiInstall,
  'check-update':manualCheckUpdate,
  'install-app':installApp,
  'pick-csv':()=>chooseFile('csv'),
  'pick-backup':()=>chooseFile('backup'),
  'csv-template':()=>download('日常账本-导入模板.csv',csvTemplate(),'text/csv;charset=utf-8'),
  backup:async(_id,button)=>{
    requestPersistence();
    button.disabled=true;
    try {
      const {book,files}=await readBackup();
      if (files.size) tell('正在打包账目与附件…');
      await download(`日常账本-备份-${today()}.json`,await buildBackup(book,files));
      if (!android) {
        markBackup();
        tell('备份下载已发起');
      }
    } finally { button.disabled=false; }
  },
  export:()=>download(`日常账本-全量-${today()}.csv`,exportCSV(book),'text/csv;charset=utf-8'),
  'export-filter':()=>download(`日常账本-筛选-${today()}.csv`,exportCSV(book,filtered(book,ui)),'text/csv;charset=utf-8'),
};

document.addEventListener('click',async event=>{
  const button=event.target.closest('[data-action]');
  if (!button || button.disabled || busy) return;
  const {action,id}=button.dataset;
  if (!book && !['reload','offline-info','close'].includes(action)) return;
  if (!Object.hasOwn(actions,action)) return;
  runningActions++;
  try { await actions[action](id,button,event); }
  catch (error) { if (dialog.open) errorInModal(showError(error)); else tell(showError(error)); }
  finally { runningActions--; }
});
document.addEventListener('submit',submitModal);
document.addEventListener('input',event=>{
  const {filter:key,selectEntry}=event.target.dataset;
  if (selectEntry && ui.entrySelection) {
    if (event.target.checked) ui.entrySelection.add(selectEntry);
    else ui.entrySelection.delete(selectEntry);
    updateSelection();
    return;
  }
  if (!key) return;
  ui.filter[key]=event.target.value;
  ui.entrySelection?.clear();
  ui.limit=50;
  renderRecordResults();
});
document.addEventListener('change',event=>{
  if (!dialog.open) return;
  const {name,value}=event.target;
  if (modal.kind==='ledger' && ['style','icon'].includes(name)) updateLedgerLook();
  if (modal.kind==='auto-capture' && name==='ledger') updateAutoAccounts();
  if (modal.kind==='wallpaper' && name==='color') $('#modal-form [name="use-color"]').checked=true;
  if (modal.kind==='bulk-datetime' && (name==='date-mode' || name==='time-mode')) {
    const field=dialog.querySelector(`[data-bulk-field="${name.split('-')[0]}"]`);
    field.hidden=field.disabled=value!=='set';
  }
  if (modal.kind==='rule' && name==='type') {
    $('#modal-form [name=category]').innerHTML=categoryOptions(book,value);
  }
  const row=event.target.closest('[data-batch-row]');
  if (row && event.target===rowControl(row,'type')) {
    const fields={account:rowControl(row,'account').value};
    row.querySelector('.batch-fields').innerHTML=entryFields(value,fields,rowPrefix(row));
  }
  const to=row && event.target===rowControl(row,'account') ? rowControl(row,'to')
    : modal.kind==='entry' && modal.type==='transfer' && name==='account' ? $('#modal-form [name=to]') : null;
  if (to) {
    const chosen=to.value===value?'':to.value;
    to.innerHTML=accountOptions(book,chosen,'请选择账户',value);
  }
});
document.addEventListener('toggle',event=>{
  const name=event.target.dataset?.group;
  if (!name) return;
  if (event.target.open) ui.openGroups.add(name);
  else ui.openGroups.delete(name);
},true);

// Earlier iOS WebKit releases could still zoom on quick taps with touch-action: manipulation.
if (/iP(?:ad|hone|od)/.test(navigator.userAgent) || (navigator.platform==='MacIntel' && navigator.maxTouchPoints>1)) {
  let touchStart, lastTap;
  const resetTaps=()=>{ touchStart=lastTap=undefined; };
  document.addEventListener('touchstart',event=>{
    if (event.touches.length!==1 || event.target.closest('dialog button, #records-list button, [data-action="report-detail"], [data-action="back-report"], input, select, textarea, label')) {
      resetTaps();
      return;
    }
    const {clientX:x,clientY:y}=event.touches[0];
    touchStart={x,y,time:event.timeStamp};
  },{passive:true});
  document.addEventListener('touchend',event=>{
    const touch=event.changedTouches[0];
    if (!touchStart || !touch || event.touches.length || event.timeStamp-touchStart.time>350 ||
      Math.hypot(touch.clientX-touchStart.x,touch.clientY-touchStart.y)>15) {
      resetTaps();
      return;
    }
    const tap={x:touch.clientX,y:touch.clientY,time:event.timeStamp};
    if (lastTap && tap.time-lastTap.time<=350 && Math.hypot(tap.x-lastTap.x,tap.y-lastTap.y)<=20) {
      lastTap=undefined;
      if (event.cancelable) event.preventDefault();
    } else {
      lastTap=tap;
    }
    touchStart=undefined;
  },{passive:false});
  document.addEventListener('touchcancel',resetTaps,{passive:true});
}
fileInput.addEventListener('change',async()=>{
  try { await inspectFile(); }
  finally { pickingFile=false; }
});
fileInput.addEventListener('cancel',()=>{ pickingFile=false; });
categoryDialog.addEventListener('submit',saveQuickCategory);
categoryDialog.addEventListener('cancel',event=>{ if (busy) event.preventDefault(); });
dialog.addEventListener('cancel',event=>{ if (busy) event.preventDefault(); });
dialog.addEventListener('click',event=>{ if (event.target===dialog && !busy && modal.kind!=='batch') dialog.close(); });
dialog.addEventListener('close',()=>{
  if (!dialog.open) {
    modal=undefined;
    dialogContent.replaceChildren();
  }
  flushRefresh();
  capturePayments();
  openDebtFromReminder();
  checkUpdate();
});
window.visualViewport?.addEventListener('resize',fitBatchSheet);
window.visualViewport?.addEventListener('scroll',fitBatchSheet);
window.addEventListener('hashchange',()=>route(true));
window.addEventListener('pageshow',event=>{
  if (!event.persisted) return;
  if (book) refresh(true);
  if (!dialog.open) checkUpdate();
});
document.addEventListener('visibilitychange',()=>{
  if (document.visibilityState!=='visible') return;
  if (book) refresh(true);
  if (!dialog.open) checkUpdate();
  queueAutomaticReload();
});
if (channel) channel.onmessage=()=>refresh();

function offlineStatus() {
  ui.offlineReady=!!android || !!navigator.serviceWorker?.controller;
  const status=$('#mobile-status');
  status.innerHTML=`<span class="status-dot"></span>${ui.offlineReady ? navigator.onLine?'离线可用':'离线中' : '本机账本'}`;
  if (page==='settings' && book && !dialog.open) render();
}
const workers = android ? null : navigator.serviceWorker;
const updateNotice = $('#update-notice');
const releaseNotice = $('#release-notice');
let seenRelease;
try { seenRelease=localStorage.getItem(releaseSeenKey); }
catch {}
let lastController = workers?.controller;
let registrationJob, updateJob, lastUpdateCheck=0, updateReady=false;
let nativeRelease;
let automaticReload=false, automaticTimer;

function isPatchUpdate(version) {
  if (typeof version!=='string' || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const [major,minor,patch]=appVersion.split('.').map(Number);
  const [nextMajor,nextMinor,nextPatch]=version.split('.').map(Number);
  return major===nextMajor && minor===nextMinor && nextPatch>patch;
}

function queueAutomaticReload() {
  clearTimeout(automaticTimer);
  if (!automaticReload || document.visibilityState!=='visible') return;
  automaticTimer=setTimeout(()=>{
    if (document.visibilityState!=='visible') return;
    if (!book || dialog.open || busy || refreshing || pickingFile || runningActions || ui.entrySelection ||
      document.activeElement?.matches('input,select,textarea,[contenteditable="true"]')) {
      queueAutomaticReload();
      return;
    }
    try {
      const {month,filter,limit,year,monthOverviewYear}=ui;
      sessionStorage.setItem(updateViewKey,JSON.stringify({month,filter,limit,year,monthOverviewYear,scroll:scrollY}));
    } catch {}
    location.reload();
  },1600);
}

function markReleaseSeen() {
  if (seenRelease===appVersion) return;
  seenRelease=appVersion;
  releaseNotice.hidden=true;
  try { localStorage.setItem(releaseSeenKey,appVersion); }
  catch {}
}

async function checkUpdate(manual=false) {
  if (updateJob) return updateJob;
  if (!navigator.onLine || (!manual && Date.now()-lastUpdateCheck<60000)) return false;
  if (android) {
    lastUpdateCheck=Date.now();
    updateJob=fetch('/native-update.json',{cache:'no-store'}).then(async response=>{
      if (!response.ok) return false;
      const release=await response.json();
      if (!Number.isSafeInteger(release.versionCode) || release.versionCode<=android.versionCode() ||
          typeof release.version!=='string' || !/^\d+\.\d+\.\d+$/.test(release.version) ||
          !Array.isArray(release.changes) || !release.changes.every(change=>typeof change==='string')) return true;
      nativeRelease=release;
      releaseNotice.hidden=true;
      updateNotice.hidden=false;
      $('#update-title').textContent=`可更新至 ${release.version}`;
      $('#update-changes').hidden=false;
      const auto=isPatchUpdate(release.version) && android.prepareUpdate;
      if (auto) android.prepareUpdate(release.versionCode);
      $('#update-notice [data-action="reload"]').textContent=auto?'安装更新':'下载更新';
      return true;
    }).catch(()=>false).finally(()=>{updateJob=undefined;});
    return updateJob;
  }
  if (!workers || updateReady) return updateReady;
  lastUpdateCheck=Date.now();
  registrationJob ??= workers.register('./sw.js',{updateViaCache:'none'}).catch(error=>{
    registrationJob=undefined;
    throw error;
  });
  updateJob=registrationJob.then(async registration=>{
    if (registration.active && !registration.installing && !registration.waiting) await registration.update();
    return true;
  }).catch(()=>false).finally(()=>{updateJob=undefined;});
  return updateJob;
}

workers?.addEventListener('controllerchange',()=>{
  const controller=workers.controller;
  if (lastController && controller && controller!==lastController) {
    updateReady=true;
    if (updateNotice) updateNotice.hidden=false;
    releaseNotice.hidden=true;
    automaticReload=false;
    const info=new MessageChannel();
    info.port1.onmessage=event=>{
      info.port1.close();
      if (workers.controller!==controller || !isPatchUpdate(event.data?.version)) return;
      automaticReload=true;
      $('#update-title').textContent='小更新已就绪，空闲后自动更新';
      queueAutomaticReload();
    };
    controller.postMessage('ledger-version',[info.port2]);
    setTimeout(()=>info.port1.close(),3000);
  }
  lastController=controller;
  offlineStatus();
});
for (const action of ['pointerdown','keydown','scroll']) {
  window.addEventListener(action,()=>{ if (automaticReload) queueAutomaticReload(); },{passive:true});
}
window.addEventListener('online',()=>{
  lastUpdateCheck=0;
  offlineStatus();
  checkUpdate();
});
window.addEventListener('offline',offlineStatus);
window.addEventListener('nativeforeground',()=>{
  if (!dialog.open) checkUpdate();
  updateReminderStatus();
  capturePayments();
  if (page==='auto' && book && !dialog.open) render();
});
window.addEventListener('nativebackupcomplete',markBackup);
window.addEventListener('nativedebtopen',event=>{
  debtLaunch=event.detail;
  openDebtFromReminder();
});
window.addEventListener('beforeinstallprompt',event=>{
  if (isInstalled() || typeof event.prompt!=='function') return;
  event.preventDefault();
  installPrompt=event;
  const button=$('#install-app');
  if (dialog.open && button) button.hidden=false;
});
window.addEventListener('appinstalled',()=>{
  installPrompt=undefined;
  const button=$('#install-app');
  if (button) button.hidden=true;
});
setInterval(()=>{
  if (document.visibilityState==='visible' && !dialog.open) checkUpdate();
},300_000);
setInterval(()=>{
  if (book && !dialog.open && (page==='savings' || page==='saving-detail') && lastSavingsDate!==today()) render();
  syncBackupReminder();
},60_000);
if (android?.pendingPayments) setInterval(capturePayments,5000);
$('#release-summary').textContent=`${appVersion} · ${currentRelease.title}`;
releaseNotice.hidden=seenRelease===appVersion;
offlineStatus();
route();
refresh(true);
checkUpdate();
