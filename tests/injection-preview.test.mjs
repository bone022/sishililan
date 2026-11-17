import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const source = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8')
    .replace(/^import .*;\s*$/gm, '')
    .replace(/^export /gm, '');

function createFixture() {
    const preview = { textContent: '', hidden: true };
    const calls = [];
    const context = {
        extensionSettings: { SishiCalendar: { enabled: true, autoInject: true } },
        chatMetadata: { sishiCalendar: { country: 'CN', era: 'modern', date: '2026-11-18' } },
        chat: [],
        setExtensionPrompt: (...args) => calls.push(args),
        eventSource: { on() {} },
        eventTypes: { APP_READY: 'APP_READY' },
    };
    const env = {
        document: {
            readyState: 'loading',
            addEventListener() {},
            getElementById: id => id === 'ss-prompt-preview' ? preview : null,
        },
        SillyTavern: { getContext: () => context },
    };
    env.window = env;
    vm.createContext(env);
    vm.runInContext(source, env, { timeout: 5000 });
    return { preview, context, calls, env };
}

test('预览显示交给酒馆的注入原文，且不重新生成额外文案', () => {
    const { preview, calls, env } = createFixture();
    const text = '[四时历览｜世界节庆补充]\n未来7日已知节庆：11-22 小雪\n[/四时历览]';
    env.actualPrompt = text;
    vm.runInContext('setPrompt(actualPrompt)', env);
    assert.equal(preview.textContent, text);
    assert.equal(calls.length, 1);
    assert.deepEqual(Array.from(calls[0]), ['sishi_calendar', text, 1, 0, false, 0]);
});

test('自动注入关闭时预览显示真实的空注入状态', () => {
    const { preview, context, calls, env } = createFixture();
    context.extensionSettings.SishiCalendar.autoInject = false;
    vm.runInContext("setPrompt('')", env);
    assert.equal(calls[0][1], '');
    assert.match(preview.textContent, /自动注入已关闭/);
});

test('设置面板存在同 World Engine 风格的展开预览入口', () => {
    assert.match(source, /id="ss-preview-prompt"/);
    assert.match(source, /id="ss-prompt-preview"/);
    assert.match(source, /box\.hidden = !opening/);
});
