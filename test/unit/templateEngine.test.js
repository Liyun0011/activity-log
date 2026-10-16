// 單元測試（Unit tests）：只測 src/utils/templateEngine.js 裡的純函式
// 不連網路、不需要 token，所以很快，每次 push 都會跑
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { applyTemplate, extractEventData, getEventAction } from '../../src/utils/templateEngine.js';

const DEFAULT_TEMPLATE = '{emoji} {action} {subject} {ref} {number} {verb} [{repo}]({url})';
const EMOJI = {
    PushEvent: '⬆️',
    IssuesEvent: { opened: '❗', closed: '✔️' },
    ReleaseEvent: { published: '🚀', draft: '📝' },
};

// 產生一個假的 GitHub event（mock data）
function makeEvent(type, payload, { isPublic = true, repo = 'alice/demo' } = {}) {
    return { type, public: isPublic, repo: { name: repo }, created_at: '2026-10-16T01:00:00Z', payload };
}

describe('applyTemplate', () => {
    test('replaces placeholders with values', () => {
        assert.equal(applyTemplate('{emoji} {repo}', { emoji: '⭐', repo: 'a/b' }), '⭐ a/b');
    });

    test('returns null for an empty or non-string template', () => {
        assert.equal(applyTemplate('', {}), null);
        assert.equal(applyTemplate(null, {}), null);
    });

    test('removes empty placeholders and empty brackets without double spaces', () => {
        assert.equal(applyTemplate('x {ref} y ({number})', {}), 'x y');
    });

    test('turns a markdown link with empty URL into plain text', () => {
        assert.equal(applyTemplate('[{repo}]({url})', { repo: 'a private repository' }), 'a private repository');
    });
});

describe('getEventAction', () => {
    test('PushEvent is "committed"', () => {
        assert.equal(getEventAction('PushEvent', {}), 'committed');
    });

    test('IssuesEvent uses payload.action', () => {
        assert.equal(getEventAction('IssuesEvent', { action: 'opened' }), 'opened');
    });
});

describe('extractEventData + default template', () => {
    test('public push links to the commit', () => {
        const ev = makeEvent('PushEvent', { head: 'abc123', ref: 'refs/heads/master' });
        const out = applyTemplate(DEFAULT_TEMPLATE, extractEventData(ev, EMOJI));
        assert.equal(out, '⬆️ Committed to master in [alice/demo](https://github.com/alice/demo/commit/abc123)');
    });

    test('public issue shows number and issue URL', () => {
        const ev = makeEvent('IssuesEvent', { action: 'opened', issue: { number: 7 } });
        const out = applyTemplate(DEFAULT_TEMPLATE, extractEventData(ev, EMOJI));
        assert.equal(out, '❗ Opened issue #7 in [alice/demo](https://github.com/alice/demo/issues/7)');
    });

    test('private repo hides name, number and URL', () => {
        const ev = makeEvent('IssuesEvent', { action: 'closed', issue: { number: 7 } }, { isPublic: false, repo: 'alice/secret' });
        const data = extractEventData(ev, EMOJI, true);
        assert.equal(data.repo, 'a private repository');
        assert.equal(data.url, '');
        assert.equal(data.number, '');
        assert.ok(!applyTemplate(DEFAULT_TEMPLATE, data).includes('secret'), 'private repo name must not leak');
    });

    test('draft release uses the draft emoji and no release URL', () => {
        const ev = makeEvent('ReleaseEvent', { action: 'created', release: { draft: true, tag_name: 'v1' } });
        const data = extractEventData(ev, EMOJI);
        assert.equal(data.emoji, '📝');
        assert.equal(data.ref, 'v1');
        assert.equal(data.url, 'https://github.com/alice/demo');
    });

    test('new branch links to the branch tree', () => {
        const ev = makeEvent('CreateEvent', { ref_type: 'branch', ref: 'feat' });
        const data = extractEventData(ev, EMOJI);
        assert.equal(data.url, 'https://github.com/alice/demo/tree/feat');
        assert.equal(data.ref_type, 'branch');
    });

    test('date is formatted in UTC', () => {
        const data = extractEventData(makeEvent('PushEvent', { head: 'x' }), EMOJI);
        assert.equal(data.date, 'Oct 16, 2026');
    });
});


// 表格式測試（table-driven）：每種事件類型對應正確的連結
describe('event URL for each event type', () => {
    const cases = [
        ['IssueCommentEvent', { action: 'created', issue: { number: 3 }, comment: { id: 99 } }, 'https://github.com/alice/demo/issues/3#issuecomment-99'],
        ['PullRequestEvent', { action: 'opened', pull_request: { number: 5 } }, 'https://github.com/alice/demo/pull/5'],
        ['PullRequestReviewCommentEvent', { action: 'created', pull_request: { number: 5 }, comment: { id: 8 } }, 'https://github.com/alice/demo/pull/5#pullrequestreviewcomment-8'],
        ['CommitCommentEvent', { comment: { commit_id: 'c0ffee', id: 4 } }, 'https://github.com/alice/demo/commit/c0ffee#commitcomment-4'],
        ['CreateEvent', { ref_type: 'tag', ref: 'v2.0.0' }, 'https://github.com/alice/demo/releases/tag/v2.0.0'],
        ['CreateEvent', { ref_type: 'repository' }, 'https://github.com/alice/demo'],
        ['ReleaseEvent', { action: 'published', release: { tag_name: 'v3', html_url: 'https://example.test/r/v3' } }, 'https://example.test/r/v3'],
        ['ReleaseEvent', { action: 'published', release: { tag_name: 'v4' } }, 'https://github.com/alice/demo/releases/tag/v4'],
        ['WatchEvent', { action: 'started' }, 'https://github.com/alice/demo'],
    ];
    for (const [type, payload, expected] of cases) {
        test(`${type} → ${expected}`, () => {
            assert.equal(extractEventData(makeEvent(type, payload), EMOJI).url, expected);
        });
    }
});

// 示範用：手動觸發 workflow 時勾選 force_fail，這個測試就會故意失敗
// 用來截「測試失敗 → release 被跳過」的圖，平常會被 skip
test('pipeline gate demo (FORCE_FAIL)', { skip: process.env.FORCE_FAIL !== 'true' }, () => {
    assert.fail('FORCE_FAIL=true: this test fails on purpose to prove the release is skipped');
});
