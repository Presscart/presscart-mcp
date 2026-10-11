import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DIRECTORY_PROFILES,
  DIRECTORY_PROFILE_IDS,
  STAGE_A_TOOLS,
  parseEnabledDirectoryProfiles,
} from './policy.js';

const expectedStageATools = [
  'get_user',
  'list_teams',
  'get_team',
  'list_profiles',
  'list_profile_orders',
  'get_order',
  'list_campaigns',
  'get_campaign',
  'list_campaign_articles',
  'get_campaign_article_status',
];

test('defines exactly the openai and claude-directory profiles', () => {
  assert.deepEqual([...DIRECTORY_PROFILE_IDS], ['openai', 'claude-directory']);
  assert.deepEqual(Object.keys(DIRECTORY_PROFILES), ['openai', 'claude-directory']);
});

test('pins the Stage A allowlist to the ten approved read tools', () => {
  assert.deepEqual([...STAGE_A_TOOLS], expectedStageATools);
});

test('mounts each profile at its own path and exposes exactly the Stage A tools', () => {
  assert.equal(DIRECTORY_PROFILES.openai.path, '/mcp/openai');
  assert.equal(DIRECTORY_PROFILES['claude-directory'].path, '/mcp/claude-directory');
  for (const id of DIRECTORY_PROFILE_IDS) {
    const profile = DIRECTORY_PROFILES[id];
    assert.equal(profile.id, id);
    assert.deepEqual([...profile.tools], expectedStageATools);
  }
});

test('freezes profiles, their tool lists, and the profile map', () => {
  assert.equal(Object.isFrozen(DIRECTORY_PROFILES), true);
  for (const id of DIRECTORY_PROFILE_IDS) {
    assert.equal(Object.isFrozen(DIRECTORY_PROFILES[id]), true);
    assert.equal(Object.isFrozen(DIRECTORY_PROFILES[id].tools), true);
  }
  assert.equal(Object.isFrozen(STAGE_A_TOOLS), true);
});

test('treats an unset or blank value as no directory profiles', () => {
  assert.deepEqual(parseEnabledDirectoryProfiles(undefined), []);
  assert.deepEqual(parseEnabledDirectoryProfiles(''), []);
  assert.deepEqual(parseEnabledDirectoryProfiles('  ,  '), []);
});

test('returns the shared frozen profile objects in configured order', () => {
  const enabled = parseEnabledDirectoryProfiles(' claude-directory , openai ');
  assert.equal(enabled.length, 2);
  assert.equal(enabled[0], DIRECTORY_PROFILES['claude-directory']);
  assert.equal(enabled[1], DIRECTORY_PROFILES.openai);
  assert.equal(Object.isFrozen(enabled), true);
});

test('fails closed on an unknown profile id', () => {
  for (const raw of ['chatgpt', 'openai,legacy', 'OpenAI', 'mcp']) {
    assert.throws(
      () => parseEnabledDirectoryProfiles(raw),
      /Unknown directory profile ".+" in MCP_DIRECTORY_PROFILES\. Known profiles: openai, claude-directory\./,
      raw,
    );
  }
});

test('fails closed on a duplicate profile id', () => {
  assert.throws(
    () => parseEnabledDirectoryProfiles('openai,claude-directory,openai'),
    /Duplicate directory profile "openai" in MCP_DIRECTORY_PROFILES\./,
  );
});
