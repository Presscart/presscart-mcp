import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PRESSCART_API_URL = 'https://api.example.com';

const { booleanEnvSchema } = await import('./env.js');

test('parses explicit true environment values', () => {
  for (const value of [true, 'true', '1']) {
    assert.equal(booleanEnvSchema.parse(value), true);
  }
});

test('parses explicit false environment values', () => {
  for (const value of [false, 'false', '0']) {
    assert.equal(booleanEnvSchema.parse(value), false);
  }
});

test('rejects other string environment values', () => {
  for (const value of ['', 'TRUE', 'FALSE', 'yes', 'no', '2']) {
    assert.throws(() => booleanEnvSchema.parse(value));
  }
});
