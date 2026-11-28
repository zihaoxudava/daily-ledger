// 日常账本 · iPhone / iPad 主屏幕小组件
const files = FileManager.local();
const folder = files.joinPath(files.libraryDirectory(), 'daily-ledger-widget');
const headers = ['日期','类型','金额','账户','转入账户','分类组','分类','备注','记录编号','时间'];
const kinds = {
  expense: { type:'支出', group:'其他支出' },
  income: { type:'收入', group:'其他收入' },
};

function dateParts() {
  const now = new Date();
  const two = n => String(n).padStart(2, '0');
  return {
    date: [now.getFullYear(), two(now.getMonth() + 1), two(now.getDate())].join('-'),
    time: [two(now.getHours()), two(now.getMinutes())].join(':'),
  };
}

function quote(value) {
  const safe = /^[\s]*[=+\-@]|^[\t\r\n]|^'/.test(value) ? "'" + value : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}

async function notice(title, message) {
  const alert = new Alert();
  alert.title = title;
  alert.message = message;
  alert.addAction('好');
  await alert.presentAlert();
}

async function capture(kind) {
  const { type, group } = kinds[kind];
  const alert = new Alert();
  alert.title = '记' + type;
  alert.message = '记录此刻的日期和时间，之后可导入原账本。';
  alert.addTextField('金额（元）').setDecimalPadKeyboard();
  alert.addTextField('备注（可选）');
  alert.addTextField('账户', '微信钱包');
  alert.addAction('保存');
  alert.addCancelAction('取消');
  if (await alert.presentAlert() < 0) return;

  const amount = alert.textFieldValue(0).trim().replace('，', '.').replace(',', '.');
  const note = alert.textFieldValue(1);
  const account = alert.textFieldValue(2).trim();
  if (!/^\d{1,8}(\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || !account || account.length > 28 || note.length > 160) {
    await notice('请检查输入', '填写大于零、最多两位小数的金额，账户最多 28 字，备注最多 160 字。');
    return capture(kind);
  }
  const { date, time } = dateParts();
  const id = 'ios-widget-' + UUID.string();
  if (!files.fileExists(folder)) files.createDirectory(folder, true);
  const path = files.joinPath(folder, id + '.csv');
  const temp = path + '.tmp';
  files.writeString(temp, [date,type,amount,account,'',group,'其他',note,id,time].map(quote).join(','));
  files.move(temp, path);
  await notice('已保存' + type, '从小组件点「导出」，可以把记录批量导入原账本。');
}

async function exportRecords() {
  const names = files.fileExists(folder) ? files.listContents(folder).filter(name => name.endsWith('.csv')) : [];
  if (!names.length) {
    await notice('还没有快记', '先从桌面记一笔支出或收入。');
    return;
  }
  const rows = names.map(name => files.readString(files.joinPath(folder, name)));
  const csv = '\uFEFF' + [headers.join(','), ...rows].join('\r\n');
  await DocumentPicker.exportString(csv, '日常账本-桌面快记-' + dateParts().date + '.csv');
}

function buildWidget() {
  const widget = new ListWidget();
  const gradient = new LinearGradient();
  gradient.colors = [new Color('#112e24'), new Color('#216344')];
  gradient.locations = [0, 1];
  widget.backgroundGradient = gradient;
  widget.setPadding(15, 15, 15, 15);
  const runURL = URLScheme.forRunningScript();
  const action = name => runURL + (runURL.includes('?') ? '&' : '?') + 'ledgerAction=' + name;
  widget.url = action('menu');

  const title = widget.addText('日常账本');
  title.font = Font.boldSystemFont(17);
  title.textColor = Color.white();
  widget.addSpacer(5);
  const label = widget.addText('桌面快记');
  label.font = Font.mediumSystemFont(12);
  label.textColor = new Color('#dcf4df');
  widget.addSpacer();

  const row = widget.addStack();
  const small = config.widgetFamily === 'small';
  for (const [key, text] of small ? [['menu','＋ 记一笔']] : [['expense','− 支出'],['income','＋ 收入'],['export','导出']]) {
    if (key !== 'expense') row.addSpacer(6);
    const button = row.addStack();
    button.setPadding(8, 7, 8, 7);
    button.cornerRadius = 10;
    button.backgroundColor = new Color(key === 'export' ? '#dbf0dc' : '#caf478');
    button.url = action(key);
    const caption = button.addText(text);
    caption.font = Font.semiboldSystemFont(13);
    caption.textColor = new Color('#173d2d');
    caption.lineLimit = 1;
  }
  return widget;
}

async function run() {
  if (config.runsInWidget) {
    Script.setWidget(buildWidget());
    return;
  }
  let action = args.queryParameters.ledgerAction;
  if (!action || action === 'menu') {
    const menu = new Alert();
    menu.title = '日常账本 · 桌面快记';
    ['记支出','记收入','导出 CSV','预览小组件'].forEach(title => menu.addAction(title));
    menu.addCancelAction('关闭');
    action = ['expense','income','export','preview'][await menu.presentSheet()];
  }
  if (action === 'expense' || action === 'income') await capture(action);
  if (action === 'export') await exportRecords();
  if (action === 'preview') await buildWidget().presentMedium();
}

try {
  await run();
} catch (error) {
  if (config.runsInWidget) throw error;
  await notice('操作未完成', String(error.message || error));
} finally {
  Script.complete();
}
