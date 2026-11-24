import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildUrl } from '../src/index'

test('绝对 URL 直通', () => {
    assert.equal(
        buildUrl(undefined, 'https://de2.api.radio-browser.info/json/servers'),
        'https://de2.api.radio-browser.info/json/servers'
    )
})

test('两侧各一个斜杠', () => {
    assert.equal(buildUrl('https://a.com/', '/json/x'), 'https://a.com/json/x')
})

test('两侧都没有斜杠', () => {
    assert.equal(buildUrl('https://a.com', 'json/x'), 'https://a.com/json/x')
})

test('baseURL 自带路径', () => {
    assert.equal(buildUrl('https://a.com/api', '/json/x'), 'https://a.com/api/json/x')
})

test('多余斜杠全部清掉', () => {
    assert.equal(buildUrl('https://a.com///', '///json/x'), 'https://a.com/json/x')
})

test('相对路径且无 baseURL 抛错', () => {
    assert.throws(() => buildUrl(undefined, '/json/x'), /baseURL is required/)
})
