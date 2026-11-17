import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {
    Holidays: {
        default: class Holidays {
            constructor(country) { this.country = country; }
            setLanguages() {}
            getHolidays(year) { return [{ date: year + '-02-17 00:00:00', name: 'Chinese New Year', type: 'public' }]; }
        },
    },
    Solar: {
        fromYmd(year, month, day) {
            return {
                getFestivals: () => [],
                getLunar: () => ({
                    getMonthInChinese: () => '正',
                    getDayInChinese: () => '初一',
                    getYearInGanZhi: () => '丙午',
                    getJieQi: () => '',
                    getFestivals: () => month === 2 && day === 17 ? ['春节'] : [],
                    getOtherFestivals: () => [],
                }),
            };
        },
    },
    chineseDays: {
        isHoliday: date => date.endsWith('02-17'),
        isInLieu: () => false,
        isWorkday: () => false,
        getDayDetail: () => ({ name: '春节' }),
    },
};

const { validateDate, addDays, getDayInfo, getMonthInfo } = await import('../calendar.js');

test('公历闰年与日期合法性', () => {
    assert.equal(validateDate('2024-02-29'), '2024-02-29');
    assert.equal(validateDate('2025-02-29'), null);
    assert.equal(validateDate('2026-13-01'), null);
});

test('跨年度日期加法', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2026-01-01', -1), '2025-12-31');
});

test('跨库节日合并且保留三来源', async () => {
    const day = await getDayInfo({ date: '2026-02-17', country: 'CN', era: 'modern' });
    assert.equal(day.events.length, 1);
    assert.equal(day.events[0].name, '春节');
    assert.deepEqual(new Set(day.events[0].sources), new Set(['date-holidays', 'lunar-javascript', 'chinese-days']));
});

test('现代中国数据不应包含在古代的官方放假查询里', async () => {
    const day = await getDayInfo({ date: '2026-02-17', country: 'CN', era: 'ancient' });
    assert.deepEqual(day.events[0].sources, ['lunar-javascript']);
    assert.equal(day.available.chinaHolidays, false);
});

test('30 天与闰年二月月历', async () => {
    assert.equal((await getMonthInfo({ year: 2026, month: 11, country: 'US' })).length, 30);
    assert.equal((await getMonthInfo({ year: 2024, month: 2, country: 'US' })).length, 29);
});
