import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PRESSCART_API_URL = 'https://api.example.com';
delete process.env.MCP_DIRECTORY_PROFILES;
delete process.env.MCP_DIRECTORY_ACCEPT_CANONICAL_AUDIENCE;
delete process.env.OPENAI_APPS_CHALLENGE_TOKEN;

const { booleanEnvSchema, env, optionalTrimmedEnvSchema } = await import('./env.js');

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

test('defaults to no directory profiles and canonical audience acceptance', () => {
  assert.equal(env.MCP_DIRECTORY_PROFILES, '');
  assert.equal(env.MCP_DIRECTORY_ACCEPT_CANONICAL_AUDIENCE, true);
});

test('defaults to no OpenAI apps challenge token', () => {
  assert.equal(env.OPENAI_APPS_CHALLENGE_TOKEN, undefined);
});

test('treats blank optional values as unset and trims surrounding whitespace', () => {
  for (const value of [undefined, '', '   ', '\n']) {
    assert.equal(optionalTrimmedEnvSchema.parse(value), undefined);
  }
  assert.equal(optionalTrimmedEnvSchema.parse('  token-placeholder\n'), 'token-placeholder');
});
