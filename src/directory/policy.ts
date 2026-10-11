export const DIRECTORY_PROFILE_IDS = Object.freeze(['openai', 'claude-directory'] as const);
export type DirectoryProfileId = (typeof DIRECTORY_PROFILE_IDS)[number];

export const STAGE_A_TOOLS = Object.freeze([
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
] as const);
export type DirectoryToolName = (typeof STAGE_A_TOOLS)[number];

export type DirectoryProfile = Readonly<{
  id: DirectoryProfileId;
  path: `/mcp/${DirectoryProfileId}`;
  tools: readonly DirectoryToolName[];
}>;

// Per-platform additions slot. Empty in Stage A; any entry here is a reviewed exposure change.
const PLATFORM_TOOL_ADDITIONS: Readonly<Record<DirectoryProfileId, readonly DirectoryToolName[]>> =
  Object.freeze({
    openai: Object.freeze([]),
    'claude-directory': Object.freeze([]),
  });

function createProfile(id: DirectoryProfileId): DirectoryProfile {
  return Object.freeze({
    id,
    path: `/mcp/${id}` as const,
    tools: Object.freeze([...STAGE_A_TOOLS, ...PLATFORM_TOOL_ADDITIONS[id]]),
  });
}

export const DIRECTORY_PROFILES: Readonly<Record<DirectoryProfileId, DirectoryProfile>> = Object.freeze({
  openai: createProfile('openai'),
  'claude-directory': createProfile('claude-directory'),
});

export function isDirectoryProfileId(value: string): value is DirectoryProfileId {
  return (DIRECTORY_PROFILE_IDS as readonly string[]).includes(value);
}

export function parseEnabledDirectoryProfiles(raw: string | undefined): readonly DirectoryProfile[] {
  const ids = (raw ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0);
  const seen = new Set<DirectoryProfileId>();
  const profiles: DirectoryProfile[] = [];

  for (const id of ids) {
    if (!isDirectoryProfileId(id)) {
      throw new Error(
        `Unknown directory profile "${id}" in MCP_DIRECTORY_PROFILES. Known profiles: ${DIRECTORY_PROFILE_IDS.join(', ')}.`
      );
    }
    if (seen.has(id)) {
      throw new Error(`Duplicate directory profile "${id}" in MCP_DIRECTORY_PROFILES.`);
    }
    seen.add(id);
    profiles.push(DIRECTORY_PROFILES[id]);
  }

  return Object.freeze(profiles);
}
