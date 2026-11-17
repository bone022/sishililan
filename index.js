import { getDayInfo, getMonthInfo, getRangeInfo, addDays, validateDate, clearCache } from './calendar.js';

const EXTENSION_KEY = 'SishiCalendar';
const PROMPT_KEY = 'sishi_calendar';
const DEFAULT_SETTINGS = Object.freeze({ enabled: true, autoInject: true });
const updateListeners = new Set();
let refreshId = 0;
let initialized = false;
let lastResult = null;
let lastInjectedPrompt = '';

function context() { return globalThis.SillyTavern?.getContext?.() || null; }

function settings() {
    const ctx = context();
    if (!ctx) return { ...DEFAULT_SETTINGS };
    ctx.extensionSettings[EXTENSION_KEY] ||= {};
    const current = ctx.extensionSettings[EXTENSION_KEY];
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
        if (current[key] === undefined) current[key] = value;
    }
    return current;
}

function chatConfig() {
    const ctx = context();
    if (!ctx?.chatMetadata) return { country: '', era: '', date: '' };
    ctx.chatMetadata.sishiCalendar ||= { country: '', era: '', date: '' };
    return ctx.chatMetadata.sishiCalendar;
}

function saveGeneral() { context()?.saveSettingsDebounced?.(); }
function saveChat() { context()?.saveMetadataDebounced?.(); }

function parseWorldFallback() {
    const chat = context()?.chat;
    if (!Array.isArray(chat)) return null;
    for (let i = chat.length - 1; i >= 0; i--) {
        if (chat[i]?.is_user) continue;
        const text = String(chat[i]?.mes || '');
        const matches = [...text.matchAll(/\[\[WORLD\]\]([\s\S]*?)\[\[\/WORLD\]\]/gi)];
        for (let j = matches.length - 1; j >= 0; j--) {
            const fragment = matches[j][1];
            const timePart = fragment.match(/(?:^|[|｜;；\n])\s*time\s*[:=：]\s*([^|｜;；\n]+)/i);
            if (!timePart) continue;
            const raw = timePart[1];
            const iso = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
            const cn = raw.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
            let date = iso ? iso[0] : '';
            if (!date && cn) {
                date = cn[1] + '-' + cn[2].padStart(2, '0') + '-' + cn[3].padStart(2, '0');
            }
            if (!validateDate(date)) continue;
            const location = fragment.match(/(?:^|[|｜;；\n])\s*location\s*[:=：]\s*([^|｜;；\n]+)/i);
            const time = raw.match(/(\d{1,2}):(\d{2})/);
            return {
                date,
                time: time ? time[1].padStart(2, '0') + ':' + time[2] : '',
                location: location ? location[1].trim() : '',
            };
        }
    }
    return null;
}

export function getWorldState() {
    const ctx = context();
    const wca = ctx?.chatMetadata?.worldEngine;
    const wcaSettings = ctx?.extensionSettings?.WorldEngine;
    const override = chatConfig();
    const parsed = wca?.currentTime && validateDate(String(wca.currentTime).slice(0, 10))
        ? {
            date: String(wca.currentTime).slice(0, 10),
            time: String(wca.currentTime).slice(11, 16),
            location: String(wca.currentLocation || ''),
        }
        : parseWorldFallback();
    const country = String(override.country || wcaSettings?.countryCode || 'CN').toUpperCase();
    const era = override.era || (wcaSettings?.worldEra === 'ancient' ? 'ancient' : 'modern');
    const date = validateDate(override.date) || parsed?.date || null;
    return {
        date,
        time: parsed?.time || '',
        location: parsed?.location || '',
        country,
        era,
        source: validateDate(override.date) ? '手动日期'
            : wca?.currentTime && validateDate(String(wca.currentTime).slice(0, 10))
                ? 'Weather-Calendar-Assistant'
                : parsed ? 'WORLD 正文' : '尚未识别',
        withWca: !!(wcaSettings?.enabled && wca?.currentTime),
        wcaCalendarInjected: !!(wcaSettings?.enabled && wcaSettings?.calendarEnabled),
    };
}

function effectiveOptions(input) {
    const world = getWorldState();
    return {
        country: input?.country || world.country,
        era: input?.era || world.era,
        ...input,
    };
}

const api = {
    version: '0.1.0',
    getWorldState,
    getCurrentInfo: () => {
        const world = getWorldState();
        return world.date ? getDayInfo(effectiveOptions({ date: world.date })) : Promise.resolve(null);
    },
    getDayInfo: (input = {}) => {
        const world = getWorldState();
        return getDayInfo(effectiveOptions({ date: input.date || world.date, ...input }));
    },
    getMonthInfo: (input = {}) => {
        const world = getWorldState();
        const year = input.year || (world.date ? Number(world.date.slice(0, 4)) : null);
        const month = input.month || (world.date ? Number(world.date.slice(5, 7)) : null);
        return getMonthInfo(effectiveOptions({ ...input, year, month }));
    },
    getRangeInfo: (input = {}) => {
        const world = getWorldState();
        return getRangeInfo(effectiveOptions({ date: input.date || world.date, ...input }));
    },
    onUpdate: (fn) => {
        if (typeof fn !== 'function') return () => {};
        updateListeners.add(fn);
        return () => updateListeners.delete(fn);
    },
    refresh: () => refresh(),
    clearCache,
};
window.SishiCalendar = Object.freeze(api);

function flattenEvents(list) {
    return list.flatMap(info => info.events.map(event => ({ ...event, date: info.date })));
}

function formatEvent(event) {
    return event.date.slice(5) + ' ' + event.name;
}

function buildInjection(days, world) {
    if (!days.length) return '';
    const withWcaCalendar = world.wcaCalendarInjected;
    const today = days[0];
    // 原插件已注入公休、当前农历与当日传统节令时，仅补充未覆盖的内容
    const todays = today.events.filter(event => {
        if (!withWcaCalendar) return true;
        if (world.era === 'ancient') return false;
        return !event.categories.includes('public');
    });

    const upcoming = flattenEvents(days.slice(1));
    // Weather-Calendar-Assistant 会提示下一个法定假期，避免再次注入相同项目
    if (withWcaCalendar && world.era === 'modern') {
        const firstPublic = upcoming.findIndex(event => event.categories.includes('public'));
        if (firstPublic >= 0) upcoming.splice(firstPublic, 1);
    }

    const lines = [];
    if (!withWcaCalendar) {
        lines.push('剧情日期：' + world.date + (today.lunar ? '；农历' + today.lunar : ''));
        if (today.solarTerm) lines.push('今日节气：' + today.solarTerm);
    }
    if (todays.length) lines.push('今日节庆：' + todays.map(event => event.name).slice(0, 10).join('、'));
    if (upcoming.length) {
        lines.push('未来7日已知节庆：' + upcoming.slice(0, 12).map(formatEvent).join('；')
            + (upcoming.length > 12 ? '（另有' + (upcoming.length - 12) + '项可查询）' : ''));
    }
    if (!lines.length) return '';
    return '[四时历览｜世界节庆补充]\n' + lines.join('\n')
        + '\n以上为历法事实，不代表人物已作出参加安排，也不要求推进剧情时间。\n[/四时历览]';
}

function setPrompt(value) {
    const ctx = context();
    if (typeof ctx?.setExtensionPrompt === 'function') {
        // 将每日变动的节庆数据置于聊天最末端的独立 System 深度，避免与深度 1 的 User 人设合并。
        ctx.setExtensionPrompt(PROMPT_KEY, value, 1, 0, false, 0);
        lastInjectedPrompt = String(value);
    } else {
        lastInjectedPrompt = '';
    }
    renderInjectionPreview();
}

function renderInjectionPreview() {
    const box = document.getElementById('ss-prompt-preview');
    if (!box) return;
    // 直接展示最近一次交给 setExtensionPrompt 的原文，不重新计算另一份预览。
    box.textContent = lastInjectedPrompt
        || (!settings().enabled ? '服务已关闭，当前没有注入内容。'
            : !settings().autoInject ? '自动注入已关闭，当前没有注入内容。'
                : !getWorldState().date ? '尚未识别剧情日期，当前没有注入内容。'
                    : '当前没有可注入的节庆内容，或本轮同步尚未完成。');
}

function emitUpdate(data) {
    for (const fn of updateListeners) {
        try { fn(data); } catch (error) { console.warn('[四时历览] 更新回调失败', error); }
    }
    try { window.dispatchEvent(new CustomEvent('sishicalendar:updated', { detail: data })); } catch (_) {}
}

async function refresh() {
    const id = ++refreshId;
    const world = getWorldState();
    renderWorldStatus(world);
    if (!settings().enabled || !world.date) {
        setPrompt('');
        lastResult = null;
        emitUpdate({ world, days: [], ready: false });
        return null;
    }
    try {
        const days = await getRangeInfo({ date: world.date, days: 8, country: world.country, era: world.era });
        if (id !== refreshId) return null;
        const current = getWorldState();
        if (world.date !== current.date || world.country !== current.country || world.era !== current.era) return refresh();
        const prompt = settings().autoInject ? buildInjection(days, world) : '';
        setPrompt(prompt);
        lastResult = { world, days };
        renderWorldStatus(world, days);
        emitUpdate({ world, days, ready: true });
        return lastResult;
    } catch (error) {
        if (id !== refreshId) return null;
        console.warn('[四时历览] 同步失败', error);
        setPrompt('');
        renderMessage('查询失败：' + (error?.message || String(error)));
        return null;
    }
}

async function waitForWeatherAssistant(messageId) {
    const ctx = context();
    const wcaSettings = ctx?.extensionSettings?.WorldEngine;
    if (!wcaSettings?.enabled || !Number.isInteger(messageId)) return;
    // WCA 的监听回调会异步执行；等它标记本轮消息已解析再读取
    for (let i = 0; i < 30; i++) {
        if (ctx.chatMetadata?.worldEngine?.lastParsedMessageId === messageId) return;
        await new Promise(resolve => setTimeout(resolve, 100));
    }
}

async function onMessage(messageId) {
    const ctx = context();
    if (!settings().enabled || ctx?.chat?.[messageId]?.is_user) return;
    await waitForWeatherAssistant(messageId);
    await refresh();
}

async function onRevised() {
    // 编辑/重抽/删除的世界状态可能由 WCA 异步恢复，延迟再读取
    await new Promise(resolve => setTimeout(resolve, 180));
    await refresh();
}

function inputField(parent, labelText, control) {
    const label = document.createElement('label');
    label.className = 'ss-field';
    const labelSpan = document.createElement('span');
    labelSpan.textContent = labelText;
    label.append(labelSpan, control);
    parent.appendChild(label);
    return control;
}

function renderMessage(message) {
    const el = document.getElementById('ss-test-result');
    if (el) el.textContent = message;
}

function renderWorldStatus(world, days) {
    const el = document.getElementById('ss-current-state');
    if (!el) return;
    if (!world.date) {
        el.textContent = '尚未取得剧情时间。等待 WORLD 输出，或填写本聊天手动日期。';
        return;
    }
    const count = days?.[0]?.events?.length;
    el.textContent = world.date + (world.time ? ' ' + world.time : '') + ' · ' + world.country
        + ' · ' + (world.era === 'ancient' ? '古代' : '现代')
        + ' · 来源：' + world.source + (count !== undefined ? ' · 当日' + count + '项节庆' : '');
}

function mountPanel() {
    if (document.getElementById('ss-settings-panel')) return;
    const holder = document.getElementById('extensions_settings');
    if (!holder) return;
    const outer = document.createElement('div');
    outer.id = 'ss-settings-panel';
    outer.className = 'extension_settings';
    outer.innerHTML = '<div class="inline-drawer">' +
        '<div class="inline-drawer-toggle inline-drawer-header"><b>四时历览</b><div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div></div>' +
        '<div class="inline-drawer-content ss-content">' +
        '<p class="ss-subtitle">独立历法与节庆服务 · 供状态栏、日历及其他组件调用</p>' +
        '<div class="ss-switches"><label><input id="ss-enabled" type="checkbox"> 启用服务</label><label><input id="ss-auto-inject" type="checkbox"> 自动补充今日与未来7天节庆</label></div>' +
        '<p id="ss-current-state" class="ss-status"></p>' +
        '<div class="ss-preview-controls"><button id="ss-preview-prompt" class="menu_button" type="button" aria-controls="ss-prompt-preview" aria-expanded="false">预览注入内容</button></div>' +
        '<div id="ss-prompt-preview" class="ss-result ss-prompt-preview" aria-live="polite" hidden></div>' +
        '<div class="ss-fields" id="ss-override-fields"></div>' +
        '<div class="ss-buttons"><button id="ss-refresh" class="menu_button" type="button">重新同步</button><button id="ss-test" class="menu_button" type="button">测试查询</button></div>' +
        '<div id="ss-test-result" class="ss-result" aria-live="polite">无需副模型或额外 AI API。</div>' +
        '<p class="ss-help">优先读取 Weather-Calendar-Assistant 的 WORLD 状态。国家、历法和日期覆盖仅作用于当前聊天；留空即继承原插件。</p>' +
        '</div></div>';
    holder.appendChild(outer);

    const opts = chatConfig();
    const base = document.getElementById('ss-override-fields');
    const country = document.createElement('input');
    country.id = 'ss-country';
    country.maxLength = 2;
    country.placeholder = '自动 / CN / US / JP';
    country.value = opts.country || '';
    inputField(base, '国家代码（留空继承原插件）', country);
    const era = document.createElement('select');
    era.id = 'ss-era';
    for (const [value, text] of [['', '自动继承'], ['modern', '现代'], ['ancient', '古代']]) {
        const item = document.createElement('option'); item.value = value; item.textContent = text; era.appendChild(item);
    }
    era.value = opts.era || '';
    inputField(base, '历法模式', era);
    const date = document.createElement('input');
    date.type = 'date'; date.id = 'ss-date'; date.value = opts.date || '';
    inputField(base, '手动剧情日期（留空自动读取）', date);

    document.getElementById('ss-enabled').addEventListener('change', event => {
        settings().enabled = event.target.checked;
        saveGeneral(); refresh();
    });
    document.getElementById('ss-auto-inject').addEventListener('change', event => {
        settings().autoInject = event.target.checked;
        saveGeneral(); refresh();
    });
    country.addEventListener('change', () => {
        const val = country.value.trim().toUpperCase();
        if (val && !/^[A-Z]{2}$/.test(val)) { renderMessage('请输入两位国家代码，例如 CN、GB、JP。'); return; }
        chatConfig().country = val; country.value = val; saveChat(); clearCache(); refresh();
    });
    era.addEventListener('change', () => { chatConfig().era = era.value; saveChat(); clearCache(); refresh(); });
    date.addEventListener('change', () => { chatConfig().date = date.value; saveChat(); refresh(); });
    document.getElementById('ss-preview-prompt').addEventListener('click', event => {
        const box = document.getElementById('ss-prompt-preview');
        const opening = box.hidden;
        box.hidden = !opening;
        event.currentTarget.setAttribute('aria-expanded', String(opening));
        if (opening) renderInjectionPreview();
    });
    document.getElementById('ss-refresh').addEventListener('click', async () => {
        renderMessage('正在读取世界状态并同步节日……');
        const result = await refresh();
        renderMessage(result ? '同步成功：' + result.world.date : '未能同步：请检查 WORLD 时间或手动日期。');
    });
    document.getElementById('ss-test').addEventListener('click', async () => {
        const world = getWorldState();
        if (!world.date) { renderMessage('尚无剧情日期，无法测试。'); return; }
        renderMessage('正在查询……');
        try {
            const info = await getDayInfo({ date: world.date, country: world.country, era: world.era });
            const lines = [
                info.date + ' · ' + info.country + ' · ' + info.era,
                info.lunar ? '农历：' + info.lunar : '农历：无',
                info.solarTerm ? '节气：' + info.solarTerm : '节气：无',
                '节日：' + (info.events.length ? info.events.map(e => e.name).join('、') : '无'),
                '数据源：' + Object.entries(info.available).map(([k, v]) => k + (v ? '✓' : '—')).join(' / '),
                ...info.warnings,
            ];
            renderMessage(lines.join('\n'));
        } catch (error) { renderMessage('查询失败：' + error.message); }
    });
    syncControls();
}

function syncControls() {
    const enabled = document.getElementById('ss-enabled');
    if (!enabled) return;
    enabled.checked = settings().enabled;
    document.getElementById('ss-auto-inject').checked = settings().autoInject;
    const opts = chatConfig();
    document.getElementById('ss-country').value = opts.country || '';
    document.getElementById('ss-era').value = opts.era || '';
    document.getElementById('ss-date').value = opts.date || '';
    renderWorldStatus(getWorldState(), lastResult?.days);
    renderInjectionPreview();
}

function init() {
    if (initialized) return;
    const ctx = context();
    if (!ctx) return;
    initialized = true;
    const types = ctx.eventTypes;
    const source = ctx.eventSource;
    if (types && source) {
        source.on(types.MESSAGE_RECEIVED, onMessage);
        source.on(types.MESSAGE_EDITED, onRevised);
        source.on(types.MESSAGE_DELETED, onRevised);
        source.on(types.MESSAGE_SWIPED, onRevised);
        source.on(types.CHAT_CHANGED, async () => {
            ++refreshId;
            lastResult = null;
            syncControls();
            await refresh();
        });
    }
    mountPanel();
    refresh();
}

function start() {
    const ctx = context();
    if (!ctx) return;
    if (ctx.eventTypes?.APP_READY && ctx.eventSource) {
        ctx.eventSource.on(ctx.eventTypes.APP_READY, init);
    }
    // 部分版本在扩展加载前已发出 APP_READY，保持兼容
    if (document.readyState === 'complete' || document.readyState === 'interactive') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    }
}

start();
