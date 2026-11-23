import { types, accountTypes, frequencies } from './catalog.js';
import { today, shiftMonth, uid, money, parseMoney, readBook, writeBook, applyRecurring, validate,
  validDate, validMonth, groupOf, accountOf, categoryOf } from './store.js';
import { firstAfter } from './schedule.js';
import { exportCSV, importCSV, csvTemplate, download } from './files.js';
import { pages, nav, esc, icon, option, optionMap, label, dateInput, amountInput, textInput,
  categoryOptions, accountOptions, groupOptions, filtered, recordsList, fmtMonth } from './views.js';

const $ = selector => document.querySelector(selector);
const content = $('#content');
const dialog = $('#dialog');
const dialogContent = $('#dialog-content');
const fileInput = $('#file-input');
const toast = $('#toast');
const appVersion = '1.2.0';
const ui = {
  month:today().slice(0,7), filter:{query:'',type:'',account:'',group:'',all:false}, limit:50,
  year:false, categoryKind:'expense', openGroups:new Set(), offlineReady:false,
  monthOverviewYear:Number(today().slice(0,4)),
};
const monthOrigins = new Set(['overview','records','reports','plan']);
let book, page, modal, fileMode, toastTimer, busy=false, storageError;
const channel = 'BroadcastChannel' in window ? new BroadcastChannel('daily-ledger-changes') : null;
const showError = error => error instanceof Error ? error.message : '操作失败，请重试。';

function tell(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden=true; }, 4200);
}

function route(resetScroll=false) {
  const hash = location.hash.slice(1);
  page = Object.hasOwn(pages,hash) ? hash : 'overview';
  render();
  if (resetScroll) scrollTo(0,0);
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
  }
  if (book || storageError) content.setAttribute('aria-busy','false');
}

async function refresh(runDue=false) {
  try {
    const data = await readBook();
    if (runDue && data.rules.some(rule => !rule.paused)) {
      const before = data.entries.length;
      const date=today();
      book = await writeBook(current => { applyRecurring(current,date); });
      const added = book.entries.length-before;
      if (added>0) tell(`已自动记入 ${added} 笔到期账单`);
    } else {
      book=data;
    }
    storageError=undefined;
    render();
  } catch (error) {
    storageError=showError(error);
    render();
  }
}

function modalFrame(state, title, inner, actions) {
  modal=state;
  dialog.classList.toggle('batch-dialog',state.kind==='batch');
  dialogContent.innerHTML = `<header class="modal-head"><h2 id="dialog-title">${title}</h2>
    <button type="button" class="icon-button" data-action="close" aria-label="关闭">${icon('close')}</button></header>
    <form id="modal-form"><div class="modal-body">${inner}<p class="error" id="modal-error" role="alert" hidden></p></div>
    <footer class="modal-foot">${actions}</footer></form>`;
  if (!dialog.open) dialog.showModal();
}
const cancel = '<button type="button" class="button neutral" data-action="close">取消</button>';
const submit = text => `<button class="button primary" type="submit">${text}</button>`;
const remove = text => `<button class="button danger" data-action="ask-delete" type="button">${text}</button>`;

function errorInModal(message) {
  const element = $('#modal-error');
  if (!element) { tell(message); return; }
  element.textContent=message;
  element.hidden=false;
  if (modal.kind==='batch') element.scrollIntoView({block:'nearest'});
}

function entryFields(type, fields={}, prefix='') {
  const category = type!=='transfer'
    ? label(type==='refund' ? '原支出分类' : '分类',`<select name="${prefix}category" required>${categoryOptions(book,type,fields.category)}</select>`)
    : '';
  return `<div class="field-row">${label(type==='transfer'?'转出账户':'账户',`<select name="${prefix}account" required>${accountOptions(book,fields.account,'请选择账户')}</select>`)}
  ${type==='transfer' ? label('转入账户',`<select name="${prefix}to" required>${accountOptions(book,fields.to,'请选择账户',fields.account)}</select>`) : category}</div>`;
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
    ${label('日期',dateInput('date',record?.date ?? today()))}
    ${label('备注',textInput('note',record?.note ?? '',160,false,'商家、用途或其他说明'))}`;
  modalFrame(state,record?'编辑账目':'记一笔',html,(record ? remove('删除') : cancel)+submit('保存账目'));
}

const batchRows = () => [...dialog.querySelectorAll('[data-batch-row]')];
const rowPrefix = row => `batch-${row.dataset.batchRow}-`;
const rowControl = (row,key) => row.querySelector(`[name="${rowPrefix(row)}${key}"]`);

function fitBatchSheet() {
  const viewport=window.visualViewport;
  if (!dialog.open || modal.kind!=='batch' || !viewport) return;
  const unscaled=viewport.scale===1;
  dialog.style.setProperty('--batch-height',unscaled?`${viewport.height}px`:'');
  dialog.style.setProperty('--batch-bottom',unscaled?`${Math.max(0,window.innerHeight-viewport.height-viewport.offsetTop)}px`:'');
}

function updateBatchCount() {
  const rows=batchRows();
  rows.forEach((row,index)=>{
    row.querySelector('h3').textContent=`第 ${index+1} 笔`;
    row.querySelector('[data-action="remove-batch-row"]').hidden=rows.length===1;
  });
  $('#batch-submit').textContent=`保存 ${rows.length} 笔`;
}

function appendBatchRow(fields={}, focus=false) {
  const id=modal.nextRow++;
  const prefix=`batch-${id}-`;
  const type=fields.type ?? 'expense';
  $('#batch-rows').insertAdjacentHTML('beforeend',`
    <section class="batch-row" data-batch-row="${id}" aria-labelledby="batch-row-title-${id}">
      <div class="batch-row-tools"><h3 id="batch-row-title-${id}"></h3><button type="button" class="link-button" data-action="remove-batch-row" data-id="${id}">移除此笔</button></div>
      <div class="field-row">
        ${label('金额（元）',`<input name="${prefix}amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(fields.amount ?? '')}" required>`,'batch-amount')}
        ${label('账目类型',`<select name="${prefix}type">${optionMap(types,type)}</select>`)}
      </div>
      <div class="batch-fields">${entryFields(type,fields,prefix)}</div>
      ${label('备注',textInput(prefix+'note',fields.note ?? '',160,false,'选填'))}
    </section>`);
  updateBatchCount();
  if (focus) {
    const row=$(`[data-batch-row="${id}"]`);
    row.scrollIntoView({block:'nearest'});
    rowControl(row,'amount').focus({preventScroll:true});
  }
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
  };
  modalFrame({kind:'batch',nextRow:1},'批量记账',`
    <div class="batch-date">
      ${label('统一日期',dateInput('date',date))}
      <div class="batch-date-actions">
        <button type="button" class="button neutral" data-action="batch-date" data-id="0">今天</button>
        <button type="button" class="button neutral" data-action="batch-date" data-id="-1">昨天</button>
      </div>
    </div>
    <div id="batch-rows" class="batch-rows"></div>`,
  '<button type="button" class="button secondary" data-action="add-batch-row">＋ 再加一笔</button><button type="submit" class="button primary" id="batch-submit">保存</button>');
  appendBatchRow(fields);
  fitBatchSheet();
}

function batchDate(offset) {
  const date=new Date(`${today()}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate()+Number(offset));
  const value=date.toISOString().slice(0,10);
  if (validDate(value)) $('#modal-form [name=date]').value=value;
}

function openBudget(budget) {
  const html = `
    ${label('月份',`<input type="month" name="month" value="${budget?.month ?? ui.month}" min="2000-01" max="2099-12" required>`)}
    ${label('范围',`<select name="group">${option('','月度总预算',budget?.group ?? '')+groupOptions(book,budget?.group,'expense')}</select>`)}
    ${label('上限（人民币）',amountInput(budget?.amount),'form-amount')}`;
  modalFrame({kind:'budget',id:budget?.id},budget?'编辑预算':'设置预算',html,(budget?remove('删除'):cancel)+submit('保存预算'));
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
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const status = ui.offlineReady ? '离线资源已就绪。' : '离线资源还在准备中。请保持联网，重新打开本页后查看状态。';
  modalFrame({kind:'info'},'iPhone 安装与离线',`<p>${status}</p>
    <p>${standalone?'你已从主屏幕打开账本。':'在 Safari 打开账本，轻点「共享」→「添加到主屏幕」，打开「作为网页 App 打开」（如有），然后轻点「添加」。'}</p>
    <p>安装后先从图标联网打开一次，再开启飞行模式试记一笔。换机前请到「更多」→「数据与备份」导出 JSON。</p>
    <p>当前版本 <strong>${appVersion}</strong></p>
    <button type="button" class="button secondary" data-action="check-update">检查更新</button>
    <p id="update-status" aria-live="polite" hidden></p>
    <a class="guide-link" href="./guide/">查看使用手册</a>`,submit('知道了'));
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

async function commit(change, message, afterWrite) {
  book=await writeBook(change);
  afterWrite?.();
  channel?.postMessage('change');
  dialog.close();
  route();
  if (message) tell(message);
}

function makeEntry(current, type, get, date, id=uid()) {
  must(validDate(date),'请填写有效日期。');
  must(Object.hasOwn(types,type),'请选择账目类型。');
  const transfer=type==='transfer';
  const item={id,type,amount:parseMoney(get('amount')),date,account:get('account'),
    to:transfer?get('to'):'',category:transfer?'':get('category'),note:get('note')};
  must(accountOf(current,item.account),'请选择账户。');
  if (transfer) must(accountOf(current,item.to) && item.account!==item.to,'请选择不同的转入和转出账户。');
  else must(categoryOf(current,item.category),'请选择分类。');
  return item;
}

const save = {
  entry(current,s,get) {
    const item=makeEntry(current,s.type,get,get('date'),s.id);
    if (s.id) must(current.entries.some(e=>e.id===s.id),'这笔账目已在其他窗口移除。');
    upsert(current.entries,item);
  },
  budget(current,s,get) {
    const item={id:s.id ?? uid(),month:get('month'),group:get('group'),amount:parseMoney(get('amount'))};
    must(validMonth(item.month),'请填写有效月份。');
    must(!current.budgets.some(b=>b.month===item.month && b.group===item.group && b.id!==item.id),
      '该月已有同范围预算，请在预算列表编辑原预算。');
    upsert(current.budgets,item);
  },
  account(current,s,get) {
    const item={id:s.id ?? uid(),name:get('name'),type:get('type'),opening:parseMoney(get('amount'),true),archived:get('archived')==='yes'};
    must(item.name && !current.accounts.some(a=>a.name===item.name && a.id!==item.id),'请填写未被占用的账户名。');
    must(!item.archived || current.accounts.some(a=>a.id!==item.id && !a.archived),'至少保留一个使用中的账户。');
    upsert(current.accounts,item);
  },
  category(current,s,get) {
    const item={id:s.id ?? uid(),group:s.group,name:get('name'),archived:get('archived')==='yes'};
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
  const labels={entry:'这笔账目',budget:'这项预算',rule:'这条周期规则'};
  modalFrame({kind:'delete',id:state.id,collection:{entry:'entries',budget:'budgets',rule:'rules'}[state.kind]},'确认删除',
    `<p>删除${labels[state.kind]}后无法撤销。${state.kind==='rule'?'已经生成的账目仍会保留。':''}</p>`,cancel+'<button type="submit" class="button danger">确认删除</button>');
}

async function submitModal(event) {
  if (event.target.id !== 'modal-form') return;
  event.preventDefault();
  if (busy) return;
  if (modal.kind==='info') { dialog.close(); return; }
  const data=new FormData(event.target);
  const get=name=>String(data.get(name) ?? '').trim();
  const state=modal;
  const submitter=event.submitter;
  busy=true;
  if (submitter) submitter.disabled=true;
  try {
    if (state.kind==='delete') {
      await commit(current=>{ current[state.collection]=current[state.collection].filter(item=>item.id!==state.id); },'已删除');
    } else if (state.kind==='restore') {
      await commit(() => validate(state.data),'已恢复完整备份');
    } else if (state.kind==='csv') {
      let summary;
      await commit(current=>{ summary=importCSV(current,state.raw); });
      tell(`已导入 ${summary.added} 笔，跳过 ${summary.skipped} 笔重复编号`);
    } else if (state.kind==='batch') {
      const date=get('date');
      must(validDate(date),'请选择有效的统一日期。');
      const rows=batchRows().map(rowPrefix);
      await commit(current=>{
        const entries=rows.map((prefix,index)=>{
          const field=key=>get(prefix+key);
          try { return makeEntry(current,field('type'),field,date); }
          catch (error) { throw new Error(`第 ${index+1} 笔：${showError(error)}`); }
        });
        current.entries.push(...entries);
      },`已保存 ${rows.length} 笔`,()=>{
        ui.month=date.slice(0,7);
        ui.limit=50;
      });
    } else {
      await commit(current=>save[state.kind](current,state,get),'已保存');
    }
  } catch (error) {
    errorInModal(showError(error));
  } finally {
    if (submitter) submitter.disabled=false;
    busy=false;
  }
}

function chooseFile(mode) {
  fileMode=mode;
  fileInput.accept=mode==='csv'?'.csv,text/csv':'.json,application/json';
  fileInput.value='';
  fileInput.click();
}

async function inspectFile() {
  const file=fileInput.files[0];
  if (!file || !book) return;
  try {
    if (file.size>25_000_000) throw new Error('文件超过 25 MB，请分批导入 CSV。');
    const raw=await file.text();
    if (fileMode==='csv') {
      const preview=structuredClone(book);
      const {added,skipped}=importCSV(preview,raw);
      validate(preview);
      modalFrame({kind:'csv',raw},'确认导入 CSV',`<p>${esc(file.name)}</p><p>将新增 ${added} 笔，跳过 ${skipped} 笔已有编号的记录。文件中出现的新账户和分类会自动建立。</p>`,cancel+submit('导入'));
    } else {
      let data;
      try { data=validate(JSON.parse(raw)); }
      catch (error) { throw new Error(error instanceof SyntaxError?'文件不是有效的 JSON 备份。':showError(error)); }
      modalFrame({kind:'restore',data},'确认恢复备份',`<p>${esc(file.name)}</p>
        <p>备份含 ${data.entries.length} 笔账目、${data.accounts.length} 个账户和 ${data.budgets.length} 项预算。</p>
        <p>恢复会替换当前账本的全部内容。需要保留当前账目时，请先取消并导出本机备份。</p>`,cancel+submit('替换并恢复'));
    }
  } catch (error) {
    modalFrame({kind:'info'},'文件读取失败',`<p class="error">${esc(showError(error))}</p>`,submit('关闭'));
  }
}

function renderRecordResults() {
  const section=$('#records-list');
  if (section) section.innerHTML=recordsList(book,ui);
}

const actions = {
  new:id=>openEntry(null,id),
  batch:openBatch,
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
  budget:id=>openBudget(book.budgets.find(b=>b.id===id)),
  account:id=>openAccount(accountOf(book,id)),
  group:id=>openGroup(groupOf(book,id)),
  category:id=>{ const category=categoryOf(book,id); if (category) openCategory(category); },
  'category-add':id=>openCategory(null,id),
  rule:id=>openRule(book.rules.find(rule=>rule.id===id)),
  'category-kind':id=>{ ui.categoryKind=id; render(); },
  period:id=>{
    const month=shiftMonth(ui.month,Number(id)*(page==='reports'&&ui.year?12:1));
    if (validMonth(month)) ui.month=month;
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
  'filter-scope':id=>{ ui.filter.all=id==='all'; ui.limit=50; render(); },
  'report-range':id=>{ ui.year=id==='year'; render(); },
  'load-more':()=>{ ui.limit+=50; renderRecordResults(); },
  close:()=>{ if (!busy) dialog.close(); },
  reload:()=>location.reload(),
  'check-update':()=>checkUpdate(true),
  'ask-delete':askDelete,
  'offline-info':openOffline,
  'pick-csv':()=>chooseFile('csv'),
  'pick-backup':()=>chooseFile('backup'),
  'csv-template':()=>download('日常账本-导入模板.csv',csvTemplate(),'text/csv;charset=utf-8'),
  backup:async()=>{
    const fresh=await readBook();
    download(`日常账本-备份-${today()}.json`,JSON.stringify(fresh,null,2),'application/json');
    tell('备份下载已发起');
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
  try { await actions[action](id); }
  catch (error) { if (dialog.open) errorInModal(showError(error)); else tell(showError(error)); }
});
document.addEventListener('submit',submitModal);
document.addEventListener('input',event=>{
  const key=event.target.dataset.filter;
  if (!key) return;
  ui.filter[key]=event.target.value;
  ui.limit=50;
  renderRecordResults();
});
document.addEventListener('change',event=>{
  if (!dialog.open) return;
  const {name,value}=event.target;
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
    if (event.touches.length!==1) { resetTaps(); return; }
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
fileInput.addEventListener('change',inspectFile);
dialog.addEventListener('cancel',event=>{ if (busy) event.preventDefault(); });
dialog.addEventListener('click',event=>{ if (event.target===dialog && !busy && modal.kind!=='batch') dialog.close(); });
window.visualViewport?.addEventListener('resize',fitBatchSheet);
window.visualViewport?.addEventListener('scroll',fitBatchSheet);
window.addEventListener('hashchange',()=>route(true));
window.addEventListener('pageshow',event=>{
  if (!event.persisted) return;
  if (book) refresh(true);
  checkUpdate();
});
document.addEventListener('visibilitychange',()=>{
  if (document.visibilityState!=='visible') return;
  if (book) refresh(true);
  checkUpdate();
});
if (channel) channel.onmessage=()=>{ if (!busy) refresh(); };

function offlineStatus() {
  ui.offlineReady=!!navigator.serviceWorker?.controller;
  const status=$('#mobile-status');
  status.innerHTML=`<span class="status-dot"></span>${ui.offlineReady ? navigator.onLine?'离线可用':'离线中' : '本机账本'}`;
  if (page==='settings' && book && !dialog.open) render();
}
const workers = navigator.serviceWorker;
const updateNotice = $('#update-notice');
let lastController = workers?.controller;
let registrationJob, updateJob, lastUpdateCheck=0, updateReady=false;

function updateStatus(message) {
  const messageLine=$('#update-status');
  if (!messageLine) return;
  messageLine.textContent=message;
  messageLine.hidden=false;
}

async function checkUpdate(manual=false) {
  if (!workers || !navigator.onLine) {
    if (manual) updateStatus(workers?'联网后可检查更新。':'当前浏览器无法检查网页 App 更新。');
    return;
  }
  if (updateReady) {
    if (manual) updateStatus('新版已就绪。关闭此窗口后点页面上的「立即更新」。');
    return;
  }
  if (!manual && (updateJob || Date.now()-lastUpdateCheck<60000)) return;
  if (manual) updateStatus('正在检查更新…');
  if (!updateJob) {
    lastUpdateCheck=Date.now();
    registrationJob ??= workers.register('./sw.js',{updateViaCache:'none'}).catch(error=>{
      registrationJob=undefined;
      throw error;
    });
    updateJob=registrationJob.then(async registration=>{
      if (registration.active && !registration.installing && !registration.waiting) await registration.update();
      return registration;
    }).finally(()=>{updateJob=undefined;});
  }
  try {
    const registration=await updateJob;
    if (manual) {
      if (updateReady) updateStatus('新版已就绪。关闭此窗口后点页面上的「立即更新」。');
      else if (registration.installing || registration.waiting) updateStatus('正在准备离线资源。');
      else updateStatus('当前已是最新版本。');
    }
  } catch {
    if (manual) updateStatus('暂时无法检查更新，请联网后再试。');
  }
}

workers?.addEventListener('controllerchange',()=>{
  if (lastController && workers.controller && workers.controller!==lastController) {
    updateReady=true;
    if (updateNotice) updateNotice.hidden=false;
    updateStatus('新版已就绪。关闭此窗口后点页面上的「立即更新」。');
  }
  lastController=workers.controller;
  offlineStatus();
});
window.addEventListener('online',()=>{
  lastUpdateCheck=0;
  offlineStatus();
  checkUpdate();
});
window.addEventListener('offline',offlineStatus);
offlineStatus();
route();
refresh(true);
checkUpdate();
