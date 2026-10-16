// 整合測試（Integration tests）：真的執行「build 出來的」dist/index.js
// 驗證 config 解析 + 主程式 + GitHub API 串在一起是否正常
//
// 參數化環境：TEST_ENV=staging 或 TEST_ENV=prod
//   staging：沒有 token 時，連 GitHub API 的那個測試會被 skip
//   prod   ：更嚴格，沒有 token 直接算失敗，而且要求真的抓到活動紀錄
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TEST_ENV = process.env.TEST_ENV || 'staging';
const PROFILES = {
    staging: { EVENT_LIMIT: '5', requireToken: false, requireActivity: false },
    prod: { EVENT_LIMIT: '10', requireToken: true, requireActivity: true },
};
const profile = PROFILES[TEST_ENV];
const DIST = path.resolve(process.env.DIST_DIR || 'dist', 'index.js');
const TOKEN = process.env.TEST_GITHUB_TOKEN || '';
const USERNAME = process.env.TEST_GITHUB_USERNAME || 'octocat';

const README = `# Test\n<!--START_SECTION:activity-->\nold\n<!--END_SECTION:activity-->\n`;
let workdir;

// 用 INPUT_xxx 環境變數模擬 GitHub Actions 傳進來的 inputs
function runAction(overrides = {}) {
    const env = {
        PATH: process.env.PATH,
        INPUT_GITHUB_USERNAME: USERNAME,
        INPUT_GITHUB_TOKEN: TOKEN || 'dummy-token',
        INPUT_EVENT_LIMIT: profile.EVENT_LIMIT,
        INPUT_OUTPUT_STYLE: 'MARKDOWN',
        INPUT_IGNORE_EVENTS: '[]',
        INPUT_HIDE_DETAILS_ON_PRIVATE_REPOS: 'false',
        INPUT_README_PATH: 'README.md',
        INPUT_COMMIT_MESSAGE: 'test',
        INPUT_EVENT_TEMPLATE: '{emoji} {action} {subject} {ref} {number} {verb} [{repo}]({url})',
        INPUT_DRY_RUN: 'true',            // 一定開 dry run：只印出結果，絕不 push
        ...overrides,
    };
    const res = spawnSync(process.execPath, [DIST], { cwd: workdir, env, encoding: 'utf8', timeout: 60_000 });
    return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
}

describe(`integration (TEST_ENV=${TEST_ENV})`, () => {
    before(() => {
        assert.ok(profile, `Unknown TEST_ENV "${TEST_ENV}" (use staging or prod)`);
        assert.ok(fs.existsSync(DIST), `Built action not found at ${DIST} — did the build artifact download?`);
        workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'activity-log-'));
        fs.writeFileSync(path.join(workdir, 'README.md'), README);
    });
    after(() => fs.rmSync(workdir, { recursive: true, force: true }));

    test('rejects EVENT_LIMIT above 250', () => {
        const { code, out } = runAction({ INPUT_EVENT_LIMIT: '999' });
        assert.equal(code, 1);
        assert.match(out, /EVENT_LIMIT cannot be greater than 250/);
    });

    test('rejects a non-numeric EVENT_LIMIT', () => {
        const { code, out } = runAction({ INPUT_EVENT_LIMIT: 'abc' });
        assert.equal(code, 1);
        assert.match(out, /EVENT_LIMIT is not a number/);
    });

    test('rejects an unknown OUTPUT_STYLE', () => {
        const { code, out } = runAction({ INPUT_OUTPUT_STYLE: 'PDF' });
        assert.equal(code, 1);
        assert.match(out, /OUTPUT_STYLE is not MARKDOWN or HTML/);
    });

    test('rejects a non-boolean DRY_RUN', () => {
        const { code, out } = runAction({ INPUT_DRY_RUN: 'maybe' });
        assert.equal(code, 1);
        assert.match(out, /DRY_RUN must be "true" or "false"/);
    });

    test('dry run against the real GitHub API leaves README untouched', { skip: !TOKEN && !profile.requireToken && 'no TEST_GITHUB_TOKEN (allowed in staging)' }, () => {
        assert.ok(TOKEN, `TEST_ENV=${TEST_ENV} requires TEST_GITHUB_TOKEN`);
        const { code, out } = runAction();
        console.log(out);
        assert.doesNotMatch(out, /::error::/, 'action reported an error');
        assert.equal(code ?? 0, 0);
        assert.equal(fs.readFileSync(path.join(workdir, 'README.md'), 'utf8'), README, 'dry run must not modify README');
        if (profile.requireActivity) {
            assert.match(out, /Dry run mode enabled|No changes in README/, 'expected the action to render activity');
        }
    });
});
