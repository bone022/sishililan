# 四时历览 · Sishi Calendar

**SillyTavern 独立历法与世界节庆服务扩展**。供 HUD、日历、时间状态栏及其他组件共享节日、节气、农历与放假数据；**不绑定排班日历，不生成 User/Char/NPC 日程**。

## 功能

- 优先读取 [Weather-Calendar-Assistant](https://github.com/Gu-gu-gu-gu-gu/Weather-Calendar-Assistant) 已解析的 \`WORLD\` 世界时间、地点、国家与时代模式，不修改它的源码或聊天数据。
- 原插件未安装或尚无有效状态时，直接从当前聊天的 \`[[WORLD]]...[[/WORLD]]\` 读取明确的日期（不自行推断或推进剧情时间）；亦可对当前聊天手动覆盖日期、国家和历法。
- 三个数据来源自动分工：国际节日、农历/节气/传统节日、中国官方假期及调休；重复节日合并，保留来源与类型属性。
- 默认将**当天及未来七天的节庆摘要**提供给模型；当 Weather-Calendar-Assistant 已启用自己的日历注入时，减少相同公休/节令重复。**不会自动替任何人物编排日程**。
- 默认开放全局异步查询接口，供任意前端组件调用；支持单日、整月、任意连续范围（最长 366 天）。
- 按聊天隔离手动覆盖设置；复用开源库计算结果；响应消息编辑、重抽、删除和切换聊天事件。

## 安装

把本仓库作为第三方前端扩展安装至：

\`\`\`
SillyTavern/public/scripts/extensions/third-party/sishililan/
\`\`\`

在 SillyTavern → 扩展 → 安装扩展中粘贴仓库 Git 克隆地址也可以，**但私有仓库需要已经配置好 GitHub 访问凭据**；否则请先取得仓库压缩包，在对应路径解压。刷新酒馆后，在扩展设置内找到「四时历览」。

运行时使用浏览器在线加载三个版本锁定的开源库（jsDelivr，失败时尝试 unpkg），之后计算发生在浏览器本地。**首次加载这些资源需要网络连接**；目前尚不是完全离线打包版。不会调用任何 AI API，也不会把聊天内容作为请求参数发给日历库/CDN。

## 数据来源与范围

| 来源 | 用途 | 注意 |
| --- | --- | --- |
| [date-holidays](https://github.com/commenthol/date-holidays) 3.39.2 | 世界各国公休、地方节庆、纪念日等 | 浏览器 UMD，国际规则可能无法正确描述历史旧制度 |
| [lunar-javascript](https://github.com/6tail/lunar-javascript) 1.7.8 | 中国农历、节气、传统节日 | 当前版本限制在 1900–2100 年作安全查询；**不能把当代农历直接视作古代历法史实** |
| [chinese-days](https://github.com/vsme/chinese-days) 1.5.10 | 中国法定放假、调休补班 | 已收录中国官方假期数据为 2004–2026 年 |

国际节日按国家代码查询；中国现代模式同时调用三库，中国古代模式只调用传统历法库；其他国家的古代模式不自动套用现代公休。虚构城市按照所属国家和历法处理。未来年份超出数据范围时如实返回不可用信息，不会伪造假期。

## 与 Weather-Calendar-Assistant 配合

建议先安装 Weather-Calendar-Assistant（其扩展加载顺序为 100），再安装四时历览（加载顺序为 150）。本插件优先读取：

- \`chatMetadata.worldEngine.currentTime\`
- \`chatMetadata.worldEngine.currentLocation\`
- \`extensionSettings.WorldEngine.countryCode\`
- \`extensionSettings.WorldEngine.worldEra\`

当 WCA 处理新消息时，本插件会等待其完成本轮时间解析标记，然后更新自身查询和注入。若 WCA 已开启日历注入，本插件默认仅补充其他节庆，减少重叠；**不会修改 WCA 的设置**。由于两套扩展不共享注入清单，节日异名等特殊情况仍可能出现重复，此时可在原插件里调整日历注入设置。

## 供其他组件调用

插件加载后使用 \`window.SishiCalendar\`。以下方法均返回 Promise（\`getWorldState\` 除外）：

\`\`\`js
// 当前剧情世界时间、地区、模式，以及来源
const state = window.SishiCalendar.getWorldState();

// 查询当前日期（自动继承 WCA 国家/历法）
const today = await window.SishiCalendar.getCurrentInfo();

// 查询指定日期
const day = await window.SishiCalendar.getDayInfo({
  date: '2026-11-17', country: 'CN', era: 'modern'
});

// 查询整个月，返回按日期排列的数组
const month = await window.SishiCalendar.getMonthInfo({
  year: 2026, month: 11, country: 'CN', era: 'modern'
});

// 查询连续 8 天（包括起始日）
const range = await window.SishiCalendar.getRangeInfo({
  date: '2026-11-17', days: 8
});

// 订阅插件数据更新；不需要时取消
const unsubscribe = window.SishiCalendar.onUpdate(({ world, days, ready }) => {
  if (ready) console.log(world.date, days);
});
\`\`\`

\`getDayInfo\` 返回数据包含 \`date\`、\`country\`、\`era\`、\`weekday\`、\`lunar\`、\`lunarYear\`、\`solarTerm\`、\`workday\`、\`events\`、\`available\`、\`warnings\`。每个 \`events\` 条目包含 \`date\`、\`name\`、\`category\`、\`source\`，并在合并重复节日后附带 \`categories\`、\`sources\`。

也支持监听浏览器事件 \`sishicalendar:updated\`，详情在 \`event.detail\`。普通纯文本正则本身无法直接调用 JavaScript：其渲染器或关联的前端脚本需要主动调用这个接口。

## 设置

- **启用服务**：默认开启。
- **自动补充今日及未来七天**：默认开启，支持关闭。
- **国家代码**：留空继承 WCA，例如 CN、US、JP、GB。
- **历法**：自动继承、现代、古代。
- **手动剧情日期**：仅当前聊天生效；留空则读取 WCA/WORLD。
- **重新同步、测试查询**：不必打开开发者控制台。

## 重要说明

- 它是查询服务，**不是**剧情时间推进器、角色排班器或自动日历面板。
- 日期没有明确来源时不使用电脑实时时钟假装剧情时间。
- 完整节日信息保存在接口返回值里；自动注入只发送当前日与未来 7 日的摘要，并限制行数，避免占用大量上下文。
- 不支持自创年月日规则的架空历法；历史年份与农历算法的适用范围应由使用者核对。
- 本版为初始集成版本，尚未在使用者自己的 SillyTavern 实例做端到端验证。

## 第三方许可

- lunar-javascript：MIT，© 2018 6tail
- chinese-days：MIT，© 2024 Yawei Sun
- date-holidays：代码 ISC，节日规则数据 CC BY-SA 4.0；须保留相应许可和归属信息。具体归属请参见原项目 \`LICENSE\` 和节日数据文件。

此项目仅调用上述开源库及参考 Weather-Calendar-Assistant 的接入模式；**未复制或修改原 Weather-Calendar-Assistant 插件**。
