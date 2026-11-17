// 四时历览 - 独立历法引擎（不读取或修改任何人物日程）
const LIBRARIES = {
    global: {
        urls: [
            'https://cdn.jsdelivr.net/npm/date-holidays@3.39.2/dist/umd.min.js',
            'https://unpkg.com/date-holidays@3.39.2/dist/umd.min.js',
        ],
        ready: () => typeof window.Holidays?.default === 'function' || typeof window.Holidays === 'function',
    },
    lunar: {
        urls: [
            'https://cdn.jsdelivr.net/npm/lunar-javascript@1.7.8/lunar.js',
            'https://unpkg.com/lunar-javascript@1.7.8/lunar.js',
        ],
        ready: () => typeof window.Solar?.fromYmd === 'function',
    },
    china: {
        urls: [
            'https://cdn.jsdelivr.net/npm/chinese-days@1.5.10/dist/index.min.js',
            'https://unpkg.com/chinese-days@1.5.10/dist/index.min.js',
        ],
        ready: () => typeof window.chineseDays?.isHoliday === 'function',
    },
};

const loading = new Map();
const dayCache = new Map();
const yearCache = new Map();

function injectScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        let finished = false;
        const timer = setTimeout(() => finish(new Error('历法库加载超时')), 12000);
        function finish(error) {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            if (error) { script.remove(); reject(error); } else resolve();
        }
        script.src = url;
        script.async = true;
        script.onload = () => finish(null);
        script.onerror = () => finish(new Error('无法加载 ' + url));
        document.head.appendChild(script);
    });
}

async function ensureLibrary(name) {
    const config = LIBRARIES[name];
    if (!config) return false;
    if (config.ready()) return true;
    if (loading.has(name)) return loading.get(name);
    const task = (async () => {
        for (const url of config.urls) {
            try {
                await injectScript(url);
                if (config.ready()) return true;
            } catch (error) {
                console.warn('[四时历览] ' + name + ' 资源加载失败：', error);
            }
        }
        return false;
    })();
    loading.set(name, task);
    try { return await task; } finally { loading.delete(name); }
}

export function validateDate(value) {
    const raw = String(value || '');
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    if (!match) return null;
    const y = Number(match[1]), m = Number(match[2]), d = Number(match[3]);
    if (y < 100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
    const check = new Date(0);
    check.setFullYear(y, m - 1, d);
    check.setHours(12, 0, 0, 0);
    if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) return null;
    return raw;
}

export function addDays(date, number) {
    const valid = validateDate(date);
    if (!valid) throw new Error('无效日期：' + date);
    const [y, m, d] = valid.split('-').map(Number);
    const value = new Date(0);
    value.setFullYear(y, m - 1, d + number);
    const yy = String(value.getFullYear()).padStart(4, '0');
    return yy + '-' + String(value.getMonth() + 1).padStart(2, '0') + '-' + String(value.getDate()).padStart(2, '0');
}

function normalizeCountry(country) {
    return String(country || 'CN').trim().toUpperCase().slice(0, 2) || 'CN';
}

function addEvent(list, name, category, source, date, extra = {}) {
    const clean = String(name || '').trim();
    if (!clean || clean.length > 100) return;
    list.push({ date, name: clean, category, source, ...extra });
}

function normalizeName(name) {
    const str = String(name || '').toLowerCase().replace(/[\s（）()·.]/g, '').replace(/节假日$|假期$/g, '');
    const replacements = {
        'chinesenewyear': '春节', 'lunarnewyear': '春节', 'springfestival': '春节',
        'dragonboatfestival': '端午', 'midautumnfestival': '中秋', 'moonfestival': '中秋',
        'qingmingfestival': '清明', 'tombsweepingday': '清明',
        'labourday': '劳动', 'laborday': '劳动', 'christmasday': '圣诞',
    };
    return replacements[str] || str;
}

function uniqueEvents(events) {
    const grouped = new Map();
    for (const event of events) {
        const key = event.date + ':' + normalizeName(event.name);
        if (!grouped.has(key)) {
            grouped.set(key, { ...event, categories: [event.category], sources: [event.source] });
        } else {
            const existing = grouped.get(key);
            if (!existing.categories.includes(event.category)) existing.categories.push(event.category);
            if (!existing.sources.includes(event.source)) existing.sources.push(event.source);
            if (event.isDayOff === true) existing.isDayOff = true;
            if (event.isMakeupWorkday === true) existing.isMakeupWorkday = true;
            // 以中文名称优先，避免英文和中文别名重复显示
            if (/[\u4e00-\u9fff]/.test(event.name) && !/[\u4e00-\u9fff]/.test(existing.name)) existing.name = event.name;
        }
    }
    return [...grouped.values()];
}

async function getGlobalEvents(date, country) {
    if (!await ensureLibrary('global')) return { events: [], loaded: false };
    const ctor = window.Holidays?.default || window.Holidays;
    const year = Number(date.slice(0, 4));
    const key = country + ':' + year;
    if (!yearCache.has(key)) {
        try {
            const hd = new ctor(country);
            if (typeof hd.setLanguages === 'function') hd.setLanguages('zh', 'en');
            const list = hd.getHolidays(year) || [];
            yearCache.set(key, list);
        } catch (error) {
            console.warn('[四时历览] 国际节日查询失败：', error);
            return { events: [], loaded: false };
        }
    }
    const events = [];
    for (const entry of yearCache.get(key)) {
        if (String(entry.date || '').slice(0, 10) !== date) continue;
        addEvent(events, entry.name, entry.type === 'public' ? 'public' : 'observance', 'date-holidays', date, {
            kind: entry.type || 'observance',
            isDayOff: entry.type === 'public',
            isSubstitute: !!entry.substitute,
        });
    }
    return { events, loaded: true };
}

async function getChineseModern(date) {
    if (!await ensureLibrary('china')) return { events: [], loaded: false, workday: null };
    const year = Number(date.slice(0, 4));
    if (year < 2004 || year > 2026) return { events: [], loaded: false, workday: null, limited: true };
    const cd = window.chineseDays;
    const events = [];
    let workday = null;
    try {
        const holiday = !!cd.isHoliday(date);
        const makeup = typeof cd.isInLieu === 'function' ? !!cd.isInLieu(date) : false;
        workday = typeof cd.isWorkday === 'function' ? !!cd.isWorkday(date) : null;
        if (holiday) {
            const detail = typeof cd.getDayDetail === 'function' ? cd.getDayDetail(date) : null;
            const name = detail?.name && !/^(星期|周)/.test(detail.name) ? String(detail.name).split(',')[0] : '法定节假日';
            addEvent(events, name, 'public', 'chinese-days', date, { isDayOff: true });
        }
        if (makeup) addEvent(events, '调休补班', 'workday', 'chinese-days', date, { isMakeupWorkday: true });
    } catch (error) {
        console.warn('[四时历览] 中国假期查询失败：', error);
        return { events: [], loaded: false, workday: null };
    }
    return { events, loaded: true, workday };
}

async function getLunarEvents(date, era) {
    if (!await ensureLibrary('lunar')) return { events: [], loaded: false, lunar: null, solarTerm: '' };
    const [year, month, day] = date.split('-').map(Number);
    if (year < 1900 || year > 2100) return { events: [], loaded: false, lunar: null, solarTerm: '', limited: true };
    const events = [];
    try {
        const solar = window.Solar.fromYmd(year, month, day);
        const lunar = solar.getLunar();
        const lunarText = String(lunar.getMonthInChinese ? lunar.getMonthInChinese() : '') + '月' + String(lunar.getDayInChinese ? lunar.getDayInChinese() : '');
        const term = typeof lunar.getJieQi === 'function' ? lunar.getJieQi() : '';
        if (term) addEvent(events, term, 'solar-term', 'lunar-javascript', date);
        const traditional = [
            ...(typeof lunar.getFestivals === 'function' ? lunar.getFestivals() : []),
            ...(typeof lunar.getOtherFestivals === 'function' ? lunar.getOtherFestivals() : []),
            ...(era === 'modern' && typeof solar.getFestivals === 'function' ? solar.getFestivals() : []),
        ];
        for (const name of new Set(traditional)) {
            addEvent(events, name, 'traditional', 'lunar-javascript', date);
        }
        return {
            events, loaded: true,
            lunar: lunarText,
            lunarYear: typeof lunar.getYearInGanZhi === 'function' ? lunar.getYearInGanZhi() : '',
            solarTerm: term || '',
        };
    } catch (error) {
        console.warn('[四时历览] 传统历法计算失败：', error);
        return { events: [], loaded: false, lunar: null, solarTerm: '' };
    }
}

export async function getDayInfo(input = {}) {
    const date = validateDate(input.date);
    if (!date) throw new Error('请提供 YYYY-MM-DD 格式的有效剧情日期');
    const country = normalizeCountry(input.country);
    const era = input.era === 'ancient' ? 'ancient' : 'modern';
    const key = date + '|' + country + '|' + era;
    if (dayCache.has(key)) return dayCache.get(key);
    const task = (async () => {
        const lunarTask = country === 'CN' ? getLunarEvents(date, era) : Promise.resolve({ events: [], loaded: false, lunar: null, solarTerm: '' });
        const globalTask = era === 'modern' ? getGlobalEvents(date, country) : Promise.resolve({ events: [], loaded: false });
        const chineseTask = era === 'modern' && country === 'CN'
            ? getChineseModern(date)
            : Promise.resolve({ events: [], loaded: false, workday: null });
        const [lunar, global, chinese] = await Promise.all([lunarTask, globalTask, chineseTask]);
        const events = uniqueEvents([...global.events, ...lunar.events, ...chinese.events]);
        const [year, month, day] = date.split('-').map(Number);
        const jsDate = new Date(0);
        jsDate.setFullYear(year, month - 1, day);
        return {
            date, country, era,
            weekday: jsDate.getDay(),
            lunar: lunar.lunar || null,
            lunarYear: lunar.lunarYear || '',
            solarTerm: lunar.solarTerm || '',
            workday: chinese.workday,
            events,
            available: { international: global.loaded, traditional: lunar.loaded, chinaHolidays: chinese.loaded },
            warnings: [
                ...(!global.loaded && era === 'modern' ? ['国际节日库暂不可用'] : []),
                ...(country === 'CN' && !lunar.loaded ? ['当前日期不在传统历法支持范围或历法库未加载'] : []),
                ...(country === 'CN' && era === 'modern' && !chinese.loaded ? ['中国官方放假数据暂不可用或超出已收录年份'] : []),
            ],
        };
    })();
    dayCache.set(key, task);
    const result = await task;
    // 资源加载失败时不缓存失败，允许网络恢复后重查
    if (result.warnings.length) dayCache.delete(key);
    return result;
}

export async function getRangeInfo(input = {}) {
    const date = validateDate(input.date);
    if (!date) throw new Error('无效起始日期');
    const days = Math.max(1, Math.min(366, Number(input.days) || 1));
    const results = [];
    for (let i = 0; i < days; i++) {
        results.push(await getDayInfo({ ...input, date: addDays(date, i) }));
    }
    return results;
}

export async function getMonthInfo(input = {}) {
    const year = Number(input.year), month = Number(input.month);
    const date = validateDate(String(year).padStart(4, '0') + '-' + String(month).padStart(2, '0') + '-01');
    if (!date) throw new Error('无效年月');
    const next = addDays(date, 32);
    const lastDate = addDays(next.slice(0, 8) + '01', -1);
    const count = Number(lastDate.slice(8));
    return getRangeInfo({ ...input, date, days: count });
}

export function clearCache() { dayCache.clear(); yearCache.clear(); }
