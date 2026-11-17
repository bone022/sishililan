import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const base = new URL('../vendor/', import.meta.url);
const sandbox = {
    Date, Intl, console,
    setTimeout, clearTimeout,
    TextEncoder, TextDecoder,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

for (const name of ['lunar.js', 'chinese-days.umd.min.js', 'date-holidays.umd.min.js']) {
    const source = readFileSync(fileURLToPath(new URL(name, base)), 'utf8');
    vm.runInContext(source, sandbox, { filename: name, timeout: 15000 });
}

test('本地离线库均可加载并暴露预期接口', () => {
    assert.equal(typeof sandbox.Solar?.fromYmd, 'function');
    assert.equal(typeof sandbox.chineseDays?.isHoliday, 'function');
    assert.equal(typeof (sandbox.Holidays?.default || sandbox.Holidays), 'function');
});

test('真实离线数据：2026 年中国春节', () => {
    const lunar = sandbox.Solar.fromYmd(2026, 2, 17).getLunar();
    assert.ok(lunar.getFestivals().includes('春节'));
    assert.equal(sandbox.chineseDays.isHoliday('2026-02-17'), true);
});

test('真实离线数据：美国 2026 年圣诞节', () => {
    const Holidays = sandbox.Holidays.default || sandbox.Holidays;
    const holiday = new Holidays('US');
    assert.ok(holiday.getHolidays(2026).some(event => String(event.name).includes('Christmas')));
});
