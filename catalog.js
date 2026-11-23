const groups = [
  ['food','餐饮','🍜','三餐 外卖 水果零食 咖啡奶茶 聚餐'],
  ['ride','交通','🚇','公交地铁 打车 网约车 火车飞机 加油充电 停车过路 车辆维护'],
  ['shopping','购物','🛍️','日用百货 服饰鞋包 数码家电 美妆个护 家居家纺'],
  ['home','住房与账单','🏠','房租房贷 水电燃气 物业维修 手机网络'],
  ['school','学习与校园','📚','学杂费 教材文具 培训考试 打印复印 校园卡消费'],
  ['life','休闲与运动','🎮','影视游戏 运动健身 兴趣爱好 会员订阅'],
  ['health','健康与保险','🩺','看病挂号 药品 体检 商业保险'],
  ['social','人情与家庭','🎁','礼物红包 家庭支出 聚会活动 公益捐赠'],
  ['trip','旅行','🧳','住宿 门票签证 旅游购物'],
  ['pets','宠物','🐾','食品用品 宠物医疗 洗护寄养'],
  ['work','工作与项目','💼','工作餐 办公耗材 样品打样 商务差旅 快递物流 平台工具'],
  ['fee','金融与税费','🧾','利息手续费 税费 投资亏损'],
  ['other','其他支出','📦','其他'],
  ['employment','工作收入','💰','工资 奖金补贴 兼职劳务 提成'],
  ['support','生活与资助','🎓','生活费 奖助学金 红包礼金'],
  ['business','项目收入','🧰','营业收入 闲置转卖 稿酬 服务费'],
  ['financial','金融收益','📈','利息 分红 投资收益'],
  ['misc','其他收入','📥','报销 其他'],
];

export const types = { expense:'支出', income:'收入', transfer:'转账', refund:'退款' };
export const accountTypes = { wallet:'电子钱包', bank:'银行卡', cash:'现金', credit:'信用与负债', other:'其他' };
export const frequencies = { weekly:'每周', monthly:'每月', yearly:'每年' };

export const defaultGroups = groups.map(([id,name,icon], index) => ({
  id, name, icon, type:index < 13 ? 'expense' : 'income',
}));
export const defaultCategories = groups.flatMap(([id,,,names]) => names.split(' ').map((name, index) => ({
  id:`${id}-${index+1}`, group:id, name, archived:false,
})));
export const defaultAccounts = [
  {id:'wechat', name:'微信钱包', type:'wallet'},
  {id:'alipay', name:'支付宝', type:'wallet'},
  {id:'bank', name:'银行卡', type:'bank'},
  {id:'cash', name:'现金', type:'cash'},
  {id:'credit', name:'信用卡', type:'credit'},
].map(account => ({ ...account, opening:0, archived:false }));
