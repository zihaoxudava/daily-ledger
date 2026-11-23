import { types, accountTypes, frequencies } from './catalog.js';
import { today, shiftMonth, money, totals, balances, spending, groupOf, categoryOf, accountOf, categoryLabel, debtRemaining, newestFirst, dateAndTime } from './store.js';
import { occurrence } from './schedule.js';
import { releases } from './releases.js';
import { android } from './native.js';

const glyphs = {
  overview:'<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="8" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>',
  records:'<path d="M6 3h12a2 2 0 0 1 2 2v15l-4-2-4 2-4-2-4 2V5a2 2 0 0 1 2-2Z"/><path d="M8 8h8M8 12h6"/>',
  reports:'<path d="M4 20h16M7 16V9m5 7V4m5 12v-4"/>',
  plan:'<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4m8-4v4M8 15h3m2 0h3"/>',
  settings:'<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  expense:'<circle cx="12" cy="12" r="8"/><path d="M8.5 12h7"/>',
  income:'<circle cx="12" cy="12" r="8"/><path d="M8.5 12h7M12 8.5v7"/>',
  transfer:'<path d="M3 8h16m-4-4 4 4-4 4m6 4H5m4 4-4-4 4-4"/>',
  debts:'<path d="M12 4v16M5 7h14M7 7l-3 7h6L7 7Zm10 0-3 7h6l-3-7ZM8 20h8"/>',
  refund:'<path d="M9 5 4 10l5 5m-5-5h10a5 5 0 0 1 0 10h-3"/>',
  wallet:'<path d="M19 7V5H6a2 2 0 0 0 0 4h14v11H6a2 2 0 0 1-2-2V7m16 5h-5a2 2 0 0 0 0 4h5"/>',
  categories:'<path d="m3 8 5-5h6l7 7-11 11-7-7Z"/><circle cx="9" cy="8" r="1"/>',
  file:'<path d="M6 3h8l4 4v14H6Zm8 0v5h4M9 12h6m-6 4h6"/>',
  save:'<path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5"/>',
  upload:'<path d="M12 16V4m-4 4 4-4 4 4M4 15v5h16v-5"/>',
  guide:'<path d="M4 5h7l1 2 1-2h7v14h-7l-1 1-1-1H4Zm8 2v12"/>',
  phone:'<path d="M20 16.2v2.5a2 2 0 0 1-2.2 2c-7.5-.8-13.7-7-14.5-14.5a2 2 0 0 1 2-2.2h2.5a2 2 0 0 1 2 1.7l.5 2.7a2 2 0 0 1-.6 1.8l-1.1 1.1a13 13 0 0 0 4.1 4.1l1.1-1.1a2 2 0 0 1 1.8-.6l2.7.5a2 2 0 0 1 1.7 2Z"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>',
  photo:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m3 17 5-4 3 2 4-5 6 6"/>',
  left:'<path d="m14 7-5 5 5 5"/>',
  right:'<path d="m10 7 5 5-5 5"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>',
  check:'<circle cx="12" cy="12" r="9"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  down:'<path d="m6 9 6 6 6-6"/>',
};
export const icon = name => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${glyphs[name] ?? glyphs.file}</svg>`;
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
export const fmtMonth = month => month.replace(/-(0?)(\d+)$/, '年$2月');
const fmtDate = date => `${Number(date.slice(5,7))}月${Number(date.slice(8,10))}日`;
const value = amount => `<b class="number">${money(amount)}</b>`;

const titles = {overview:'总览',records:'明细',reports:'统计',plan:'预算',debts:'借出借入',settings:'更多',accounts:'账户',categories:'分类',files:'数据与备份'};
export const tabs = ['overview','records','reports','plan','debts','settings'];
const isSelected = (a,b) => a === b ? ' selected' : '';
const selected = (a,b) => `aria-pressed="${a===b}"`;
const button = (text, action, type='secondary', id='') =>
  `<button type="button" class="button ${type}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ''}>${text}</button>`;
export const option = (id,label,chosen) => `<option value="${esc(id)}"${isSelected(id,chosen)}>${esc(label)}</option>`;
export const label = (text, content, cls='') => `<label class="field ${cls}"><span>${text}</span>${content}</label>`;
export const dateInput = (name, date, required = true, id='') =>
  `<input type="date" name="${name}"${id?` id="${id}"`:''} value="${esc(date)}" min="2000-01-01" max="2099-12-31"${required?' required':''}>`;
export const amountInput = (amount, required = true) =>
  `<input name="amount" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${amount == null ? '' : (amount/100).toFixed(2)}"${required?' required':''}>`;
export const textInput = (name, text, limit, required=false, placeholder='') =>
  `<input name="${name}" value="${esc(text)}" maxlength="${limit}" placeholder="${esc(placeholder)}"${required?' required':''}>`;
export const optionMap = (values, chosen) => Object.entries(values).map(([id,label]) => option(id,label,chosen)).join('');

function header(title, subtitle='', control='') {
  return `<div class="page-head"><div><h1>${title}</h1>${subtitle ? `<p>${subtitle}</p>` : ''}</div>${control}</div>`;
}
function panelHead(title, control='') {
  return `<header class="panel-head"><h2>${title}</h2>${control}</header>`;
}
export function empty(glyph, title, description='', control='') {
  return `<div class="empty"><div class="empty-mark">${icon(glyph)}</div><h3>${title}</h3>${description?`<p>${description}</p>`:''}${control}</div>`;
}
function setting(glyph,title,subtitle,action,target='') {
  const inner = `<span class="quick-icon">${icon(glyph)}</span><span><b>${title}</b><small>${subtitle}</small></span>`;
  return target ? `<a class="setting" href="${target}">${inner}</a>` : `<button type="button" class="setting" data-action="${action}">${inner}</button>`;
}

export function nav(page, mobile) {
  const current = ['accounts','categories','files','updates'].includes(page) ? 'settings' : page;
  const link = tab => `<a href="#${tab}"${current===tab?' aria-current="page"':''}>${icon(tab)}<span>${titles[tab]}</span></a>`;
  if (!mobile) return tabs.map(link).join('');
  return [link('overview'),link('records'),`<button data-action="new" type="button"><span class="tab-plus">${icon('plus')}</span><span>记一笔</span></button>`,link('reports'),link('debts'),link('settings')].join('');
}

function periodArrows(unit, previous, middle, next, action='period') {
  return `<div class="period"><button type="button" data-action="${action}" data-id="-1" aria-label="上一${unit}"${previous?'':' disabled'}>${icon('left')}</button>${middle}<button type="button" data-action="${action}" data-id="1" aria-label="下一${unit}"${next?'':' disabled'}>${icon('right')}</button></div>`;
}

function period(month, yearMode=false) {
  if (yearMode) {
    const year=month.slice(0,4);
    return periodArrows('年',year!=='2000',`<time datetime="${year}">${year}年</time>`,year!=='2099');
  }
  const trigger=`<button type="button" class="month-trigger" data-action="open-months" aria-label="${fmtMonth(month)}，打开月份总览"><time datetime="${month}">${fmtMonth(month)}</time>${icon('down')}</button>`;
  return periodArrows('月',month!=='2000-01',trigger,month!=='2099-12');
}
export function accountOptions(book, chosen, emptyLabel='', excluded='') {
  return (emptyLabel ? option('',emptyLabel,chosen) : '') + book.accounts
    .filter(a => a.id !== excluded && (!a.archived || a.id === chosen))
    .map(a => option(a.id,a.name + (a.archived ? '（已归档）' : ''),chosen)).join('');
}
export function categoryOptions(book, type, chosen='', emptyLabel='请选择分类') {
  const kind = type === 'income' ? 'income' : 'expense';
  const optionsByGroup = new Map();
  for (const category of book.categories) {
    if (category.archived && category.id !== chosen) continue;
    const markup = option(category.id,category.name + (category.archived ? '（已归档）' : ''),chosen);
    optionsByGroup.set(category.group,(optionsByGroup.get(category.group) ?? '') + markup);
  }
  return option('',emptyLabel,chosen) + book.groups.filter(group => group.type === kind).map(group => {
    const available = optionsByGroup.get(group.id);
    return available ? `<optgroup label="${esc(group.name)}">${available}</optgroup>` : '';
  }).join('');
}
export const groupOptions = (book,chosen,kind) => book.groups.filter(g => !kind || g.type===kind)
  .map(g => option(g.id,`${g.name}${kind ? '' : ' · ' + types[g.type]}`,chosen)).join('');

export function entryRow(book, entry) {
  const category = categoryOf(book,entry.category);
  const title = entry.note || (entry.type === 'transfer' ? '账户转账' : category.name);
  const from = accountOf(book,entry.account).name;
  const account = entry.to ? `${from} → ${accountOf(book,entry.to).name}` : from;
  const details = [fmtDate(entry.date),entry.time,entry.type === 'refund' ? `退款 · ${category.name}` : category?.name,account,
    entry.attachments?.length ? `${entry.attachments.length} 个附件` : ''].filter(Boolean).join(' · ');
  const symbol = entry.type === 'expense' ? '−' : entry.type === 'transfer' ? '' : '+';
  const mark = entry.type === 'transfer' ? icon('transfer') : esc(groupOf(book,category.group).icon);
  return `<button class="transaction" type="button" data-action="entry" data-id="${entry.id}">
    <span class="tx-icon">${mark}</span><span><span class="entry-title">${esc(title)}</span><span class="entry-caption">${esc(details)}</span></span>
    <strong class="number ${symbol==='+'?'positive':''}">${symbol}${money(entry.amount)}</strong></button>`;
}

const colors = ['#3e7859','#90a94b','#5076a2','#ba845a','#846c9f','#c09b49','#5a928f','#bd727a'];
function breakdown(book, entries, chart=false) {
  const rows = [...spending(book,entries)].filter(([,amount]) => amount!==0).sort((a,b) => b[1]-a[1]);
  if (!rows.length) return empty('reports','暂无分类支出','记录支出后，这里会显示各分类组的金额。');
  const sum = rows.reduce((total,[,amount]) => total+Math.max(0,amount),0);
  let cursor=0;
  const stops=[];
  const items = rows.map(([group,amount],index) => {
    const percent = sum ? Math.max(0,amount)*100/sum : 0;
    const name=groupOf(book,group).name;
    const color=colors[index % colors.length];
    if (percent) {
      stops.push(`${color} ${cursor}% ${cursor+percent}%`);
      cursor+=percent;
    }
    return `<li><span><i class="category-dot" style="background:${color}"></i> ${esc(name)}</span><span>${amount<0?'净退款':Math.round(percent)+'%'}</span><strong class="number">${money(amount)}</strong></li>`;
  }).join('');
  const ring = chart && stops.length ? `<div aria-hidden="true" class="donut" style="background:conic-gradient(${stops.join(',')})"><b>支出占比</b></div>` : '';
  return ring+`<ul class="category-list">${items}</ul>`;
}

function budgetRow(book,budget,monthEntries,edit=false) {
  const spent = budget.group ? spending(book,monthEntries).get(budget.group) ?? 0 : totals(monthEntries).expense;
  const percent = spent / budget.amount * 100;
  const remaining = budget.amount - spent;
  const labelText = budget.group ? esc(groupOf(book,budget.group).name) : '月度总预算';
  return `<div class="budget-row"><div class="budget-top"><b>${labelText}</b><span class="number">${money(spent)} / ${money(budget.amount)}</span></div>
    <div class="progress${percent>100?' over':''}" role="meter" aria-label="${labelText}使用比例" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.max(0,Math.min(100,Math.round(percent)))}"><span style="width:${Math.max(0,Math.min(100,percent))}%"></span></div>
    <div class="budget-foot"><span class="${remaining<0?'negative':''} number">${remaining<0?'超出':'剩余'} ${money(Math.abs(remaining))}</span>${edit?button('编辑','budget','neutral',budget.id):`<span>${Math.round(percent)}%</span>`}</div></div>`;
}
const latest = entries => entries.sort(newestFirst);
const monthly = (book,month) => book.entries.filter(entry => entry.date.startsWith(month));

function monthOverview(book,ui) {
  const year=ui.monthOverviewYear;
  const current=today().slice(0,7);
  const groups=Array.from({length:12},()=>[]);
  for (const entry of book.entries) {
    if (entry.date.startsWith(String(year))) groups[Number(entry.date.slice(5,7))-1].push(entry);
  }
  const tiles=groups.map((entries,index)=>{
    const month=`${year}-${String(index+1).padStart(2,'0')}`;
    const {income,expense,net}=totals(entries);
    const selected=ui.month===month;
    const header=`<span class="month-tile-head"><strong>${index+1}月</strong>${month===current?'<span class="chip">本月</span>':''}</span>`;
    const figures=`<span class="month-net"><small>结余</small><b class="number">${money(net)}</b></span><span class="month-amounts"><span>收入 <b class="number">${money(income)}</b></span><span>净支出 <b class="number">${money(expense)}</b></span></span>`;
    return `<button type="button" class="panel month-tile" data-action="select-month" data-id="${month}"${selected?' aria-current="date"':''}>${header}${entries.length?figures:'<span class="muted">暂无账目</span>'}</button>`;
  }).join('');
  const yearControl=periodArrows('年',year>2000,`<time datetime="${year}">${year}年</time>`,year<2099,'month-year');
  return header('月份总览','查看全年收支，选择月份进入',yearControl) +
    `<div class="inline-actions">${button('返回','close-months','neutral')}${button('回到本月','select-month','secondary',current)}</div>
     <section class="month-grid" aria-label="${year}年各月收支">${tiles}</section>`;
}

function overview(book, ui) {
  const entries = monthly(book,ui.month);
  const {income,expense,net} = totals(entries);
  const quick = Object.entries(types).map(([key,title]) =>
    `<button type="button" data-action="new" data-id="${key}"><span class="quick-icon">${icon(key)}</span>${title}</button>`).join('');
  const assets = [...balances(book,today()).values()].reduce((sum,amount) => sum+amount,0);
  const shown = latest([...entries].reverse()).slice(0,5);
  const budgets = book.budgets.filter(b => b.month===ui.month).sort((a,b) => Number(!!a.group)-Number(!!b.group));
  return header('总览','查看当月收支、预算和账户余额',period(ui.month)) + `
    <div class="top-grid">
      <section class="balance-card" aria-label="当月收支">
        <div class="balance-title">本期结余</div><div class="balance-value number">${money(net)}</div>
        <div class="balance-row"><div><span>${icon('income')}收入</span><b class="number income">${money(income)}</b></div>
        <div><span>${icon('expense')}净支出</span>${value(expense)}</div></div>
      </section>
      <section class="panel quick-panel">
        <div class="quick-heading"><h2>快速记账</h2>${button('批量记账','batch','secondary')}</div>
        <div class="quick-actions">${quick}</div>
        <a class="asset-inline" href="#accounts"><span>当前账户净余额</span>${value(assets)}</a>
      </section>
    </div>
    <div class="lower-grid">
      <section class="panel">${panelHead('最近明细','<a href="#records">查看全部</a>')}
      ${shown.length ? `<div class="transactions">${shown.map(e=>entryRow(book,e)).join('')}</div>` : empty('records','这个月还没有记录','从一笔支出或收入开始。',button('记一笔','new','primary'))}</section>
      <div class="summary-stack">
        <section class="panel">${panelHead('预算进度','<a href="#plan">查看预算</a>')}${budgets.length ? budgets.slice(0,3).map(b=>budgetRow(book,b,entries)).join('') : empty('plan','本月还没有预算','可以设置总预算，也可以单独给餐饮、交通等分类组设上限。',button('设置预算','budget','secondary'))}</section>
        <section class="panel">${panelHead('支出分布','<a href="#reports">查看统计</a>')}${breakdown(book,entries)}</section>
      </div>
    </div>`;
}

export function filtered(book, ui) {
  const f = ui.filter;
  const query = f.query.trim().toLowerCase();
  return latest([...book.entries].reverse().filter(entry =>
    (f.all || entry.date.startsWith(ui.month)) &&
    (!f.type || entry.type===f.type) &&
    (!f.account || [entry.account,entry.to].includes(f.account)) &&
    (!f.group || categoryOf(book,entry.category)?.group===f.group) &&
    (!query || [entry.note,categoryLabel(book,entry.category),accountOf(book,entry.account)?.name,accountOf(book,entry.to)?.name,(entry.amount/100).toFixed(2), String(entry.amount/100),dateAndTime(entry)]
      .some(item => String(item ?? '').toLowerCase().includes(query)))));
}

export function recordsList(book,ui) {
  const list = filtered(book,ui);
  const groups=new Map();
  const visible = list.slice(0,ui.limit);
  for (const entry of visible) {
    if (!groups.has(entry.date)) groups.set(entry.date,[]);
    groups.get(entry.date).push(entry);
  }
  return `<div class="panel-head"><h2>账目 <span class="muted">· ${list.length} 笔</span></h2>${list.length?button('导出当前结果','export-filter','neutral'):''}</div>` + (list.length
    ? [...groups].map(([day,rows]) => `<section class="date-group"><h3 class="date-heading">${day}</h3><div class="transactions">${rows.map(e=>entryRow(book,e)).join('')}</div></section>`).join('')
    : empty('records','没有匹配的账目','可以换个筛选条件，或者记一笔。')) +
    (list.length>visible.length ? `<div class="section-gap">${button('显示更多','load-more','secondary')}</div>` : '');
}
function records(book,ui) {
  const {query,type,account,group,all} = ui.filter;
  return header('明细','搜索、筛选和编辑账目',period(ui.month)) +
    `<div class="inline-actions"><div class="segments"><button data-action="filter-scope" data-id="month" ${selected(all,false)}>所选月份</button><button data-action="filter-scope" data-id="all" ${selected(all,true)}>全部记录</button></div>${button('＋ 记一笔','new','primary')}${button('批量记账','batch','secondary')}${button('账户转账','new','secondary','transfer')}</div>
      <div class="filter">
        <input id="filter-query" data-filter="query" aria-label="搜索备注、金额或分类" placeholder="搜索备注、金额或分类" value="${esc(query)}" type="search">
        <select data-filter="type" aria-label="收支类型">${option('','全部类型',type)+optionMap(types,type)}</select>
        <select data-filter="account" aria-label="账户">${option('','全部账户',account)+book.accounts.map(a=>option(a.id,a.name,account)).join('')}</select>
        <select data-filter="group" aria-label="分类组">${option('','全部分类组',group)+groupOptions(book,group)}</select>
      </div>
      <section class="panel" id="records-list">${recordsList(book,ui)}</section>`;
}

function reportBars(book, month, yearly) {
  const end = yearly ? `${month.slice(0,4)}-12` : month;
  const count = yearly ? 12 : 6;
  const data=Array.from({length:count},(_,index)=>{
    const key=shiftMonth(end,index-count+1);
    return {key,...totals(monthly(book,key))};
  });
  const max = Math.max(1,...data.flatMap(row=>[row.income,row.expense]));
  const plot=data.map(({key,income,expense})=>
    `<div class="bar-cell" role="img" aria-label="${fmtMonth(key)} 收入 ${money(income)}，净支出 ${money(expense)}" title="${fmtMonth(key)} 收入 ${money(income)}，净支出 ${money(expense)}"><div class="bar-area"><i class="bar income" style="height:${income*100/max}%"></i><i class="bar" style="height:${Math.max(0,expense)*100/max}%"></i></div><span>${Number(key.slice(5))}月</span></div>`).join('');
  return `<div class="bars" style="grid-template-columns:repeat(${count},minmax(0,1fr))">${plot}</div><div class="legend"><span><i class="income"></i>收入</span><span><i></i>净支出</span></div>`;
}
function reports(book,ui) {
  const periodKey = ui.year ? ui.month.slice(0,4) : ui.month;
  const entries = book.entries.filter(entry => entry.date.startsWith(periodKey));
  const {income,expense,net} = totals(entries);
  return header('统计','查看收支趋势和分类支出',period(ui.month,ui.year)) +
    `<div class="inline-actions"><div class="segments"><button data-action="report-range" data-id="month" ${selected(ui.year,false)}>按月</button><button data-action="report-range" data-id="year" ${selected(ui.year,true)}>按年</button></div></div>
     <div class="metric-grid"><section class="panel metric"><span>收入</span>${value(income)}</section><section class="panel metric"><span>净支出</span>${value(expense)}</section><section class="panel metric"><span>结余</span>${value(net)}</section></div>
     <div class="lower-grid"><section class="panel">${panelHead(ui.year?'全年趋势':'近 6 个月趋势')}${reportBars(book,ui.month,ui.year)}</section><section class="panel">${panelHead('分类支出')}${breakdown(book,entries,true)}</section></div>`;
}

function plan(book,ui) {
  const budgets=book.budgets.filter(b=>b.month===ui.month).sort((a,b)=>Number(!!a.group)-Number(!!b.group));
  const entries=monthly(book,ui.month);
  const rules=book.rules.map(rule=>{
    const date=occurrence(rule,rule.next);
    const finished=rule.count!==null && rule.next>=rule.count || rule.end && date>rule.end;
    const next=finished?'已结束':rule.paused?'已暂停':`下一笔 ${date}`;
    return `<div class="manage-row"><div><h3>${esc(rule.name)}</h3><p>${frequencies[rule.frequency]} · ${types[rule.type]} ${money(rule.amount)} · ${next}</p></div><div class="actions">${button('编辑','rule','neutral',rule.id)}</div></div>`;
  }).join('');
  return header('预算与周期','管理本期预算、订阅和固定收支',period(ui.month)) +
    `<div class="top-grid">
    <section class="panel">${panelHead('本期预算',button('新增','budget','secondary'))}
    ${budgets.length?budgets.map(b=>budgetRow(book,b,entries,true)).join(''):empty('plan','本月还没有预算','可设置总预算，也可单独限制某个分类组。')}
    </section>
    <section class="panel">${panelHead('周期账单',button('新增','rule','secondary'))}
    ${rules || empty('plan','暂无周期账单','适用于房租、会员、工资和分期。到期后打开账本时入账。')}</section></div>`;
}

function settings() {
  return header('更多','管理账户、分类与本机数据')+`
    <section class="panel">${panelHead('账本管理')}<div class="setting-grid">
    ${setting('wallet','账户','余额、期初金额和账户归档','','#accounts')}
    ${setting('transfer','借出借入','分别查看待收回和待归还的钱','','#debts')}
    ${setting('categories','分类','自定义分类组和二级分类','','#categories')}
    ${setting('plan','预算与周期','分类预算、订阅、分期和固定收支','','#plan')}
    ${setting('file','数据与备份','完整备份、CSV 和恢复','','#files')}
    </div></section>
    <section class="panel section-gap">${panelHead('安装与帮助')}<div class="setting-grid">
    ${android?setting('save','应用信息','版本、更新和离线状态','offline-info'):setting('save','安装到桌面','手机、平板和电脑 · 支持离线','offline-info')}
    ${android?'':setting('save','下载 Android 安装包','三星及安卓 · 从桌面独立打开','', './downloads/daily-ledger-android.apk')}
    ${setting('records','版本更新','查看本次及历次改动','','#updates')}
    ${setting('guide','使用手册','安装、记账、预算和换机','', './guide/')}
    </div></section>
    <section class="panel section-gap">${panelHead('联系开发者')}<div class="setting-grid">
    ${setting('phone','手机号','17630276688','','tel:17630276688')}
    ${setting('mail','QQ 邮箱','xzh8868927@qq.com','','mailto:xzh8868927@qq.com')}
    </div></section>`;
}
function updates() {
  const items=releases.map(release=>`
    <section class="panel release-entry">
      <h2>${esc(release.version)} · ${esc(release.title)}</h2>
      <ul>${release.changes.map(change=>`<li>${esc(change)}</li>`).join('')}</ul>
    </section>`).join('');
  return header('版本更新')+`<div class="summary-stack">${items}</div>`;
}
function accounts(book) {
  const result=balances(book,today());
  const rows=book.accounts.map(account=>`<div class="manage-row"><div><h3>${esc(account.name)} ${account.archived?'<span class="chip">已归档</span>':''}</h3>
    <p>${accountTypes[account.type]} · 期初 ${money(account.opening)}</p></div><div class="actions">${value(result.get(account.id))}${button('编辑','account','neutral',account.id)}</div></div>`).join('');
  return header('账户','余额按今天及以前的账目累计',button('新增账户','account','primary'))+
    `<section class="panel">${panelHead('账户净余额',value([...result.values()].reduce((sum,amount)=>sum+amount,0)))}${rows}</section>`;
}
function categories(book,ui) {
  const kind=ui.categoryKind;
  const groups=book.groups.filter(group=>group.type===kind).map(group=>{
    const children=book.categories.filter(cat=>cat.group===group.id);
    return `<details class="group" data-group="${group.id}"${ui.openGroups.has(group.id)?' open':''}><summary>${esc(group.icon)} ${esc(group.name)} <span class="muted">· ${children.filter(c=>!c.archived).length}</span></summary><section>
      <div class="actions">${button('新增二级分类','category-add','secondary',group.id)}${button('编辑分类组','group','neutral',group.id)}</div>
      ${children.map(cat=>`<div class="manage-row"><h3>${esc(cat.name)} ${cat.archived?'<span class="chip">已归档</span>':''}</h3>${button('编辑','category','neutral',cat.id)}</div>`).join('')}</section></details>`;
  }).join('');
  return header('分类','分类组用于预算，二级分类用于记账',button('新增分类组','group','primary'))+
    `<div class="inline-actions"><div class="segments"><button data-action="category-kind" data-id="expense" ${selected(kind,'expense')}>支出与退款</button><button data-action="category-kind" data-id="income" ${selected(kind,'income')}>收入</button></div></div><section class="panel">${groups}</section>`;
}
function files(book) {
  return header('数据与备份','换机前请先保存一份完整备份')+`
    <section class="panel">${panelHead('完整备份 · JSON')}
    <p class="muted">包含 ${book.entries.length} 笔账目、${book.debts.length} 项借出借入，以及账户、分类、预算和周期规则。</p>
    <div class="actions section-gap">${button('导出完整备份','backup','primary')}${button('恢复备份','pick-backup','neutral')}</div></section>
    <section class="panel section-gap">${panelHead('流水表格 · CSV')}
    <div class="actions">${button('导出全部流水','export','secondary')}${button('下载导入模板','csv-template','neutral')}${button('导入 CSV','pick-csv','neutral')}</div></section>
    <section class="panel section-gap"><h2>存储位置</h2><p class="muted section-gap">账目保存在当前设备的网页 App 中。换机、清理网站数据或删除主屏幕 App 前，请先导出完整备份到「文件」。</p></section>`;
}

function debts(book) {
  const sections=[
    ['lent','借给别人','待收回','新增借出'],
    ['borrowed','向别人借','待归还','新增借入'],
  ].map(([direction,title,remainingLabel,add])=>{
    const items=book.debts.filter(debt=>debt.direction===direction)
      .map(debt=>({debt,remaining:debtRemaining(debt)}))
      .sort((a,b)=>Number(!a.remaining)-Number(!b.remaining) || newestFirst(a.debt,b.debt));
    const total=items.reduce((sum,item)=>sum+item.remaining,0);
    const rows=items.map(({debt,remaining})=>`
      <button type="button" class="debt-row" data-action="debt-detail" data-id="${esc(debt.id)}">
        <span><strong>${esc(debt.person)}</strong><small>${esc(dateAndTime(debt))} · 本金 ${money(debt.amount)}</small>
          ${remaining&&debt.reminder?`<small>提醒 · ${esc(dateAndTime(debt.reminder))}</small>`:''}</span>
        <span class="debt-row-amount"><strong class="number">${money(remaining)}</strong><small>${remaining?remainingLabel:'已结清'}</small></span>
      </button>`).join('');
    return `<section class="panel">
      ${panelHead(title,button(add,'new-debt','secondary',direction))}
      <div class="debt-total" data-debt-total="${direction}"><span>${remainingLabel}</span>${value(total)}</div>
      <div>${rows||'<p class="muted debt-empty">暂无记录</p>'}</div>
    </section>`;
  }).join('');
  return header('借出借入','')+
    '<p class="muted debt-description">此处的本金和还款仅用于核对借款进度，总账、预算及账户余额单独计算。</p>'+
    `<div class="top-grid debt-grid">${sections}</div>`;
}

export const pages = {overview,records,reports,plan,settings,accounts,categories,files,debts,updates,months:monthOverview};
