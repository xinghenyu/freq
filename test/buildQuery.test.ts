import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildQuery } from '../src/index'

test('空 query 不添加问号', () => {
  assert.equal(buildQuery('https://a.com/x', {}), 'https://a.com/x')
})

test('无问号时用 ? 拼接', () => {
  assert.equal(buildQuery('https://a.com/x', { a: '1' }), 'https://a.com/x?a=1')
})

test('已有问号时用 & 拼接', () => {
  assert.equal(buildQuery('https://a.com/x?a=1', { b: '2' }), 'https://a.com/x?a=1&b=2')
})

test('多个参数按顺序拼接', () => {
  assert.equal(
    buildQuery('https://a.com/x', { name: 'xmas', limit: '10' }),
    'https://a.com/x?name=xmas&limit=10'
  )
})

test('特殊字符被编码', () => {
  assert.equal(buildQuery('https://a.com/x', { name: 'a b' }), 'https://a.com/x?name=a+b')
})
