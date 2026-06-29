const sharedPlugins = [
  '@semantic-release/commit-analyzer',
  '@semantic-release/release-notes-generator',
];

const stablePlugins = [
  ...sharedPlugins,
  ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
  ['@semantic-release/npm', { npmPublish: false }],
  ['@semantic-release/exec', { prepareCmd: 'npm run sync:version' }],
  [
    '@semantic-release/git',
    {
      assets: ['CHANGELOG.md', 'package.json', 'package-lock.json', 'src/version.ts'],
      message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}',
    },
  ],
  '@semantic-release/github',
];

const stagingPlugins = [
  ...sharedPlugins,
  '@semantic-release/github',
];

const isStagingRelease = process.env.PRESSCART_RELEASE_TARGET === 'staging';

export default {
  branches: ['main', { name: 'staging', prerelease: 'rc' }],
  tagFormat: 'v${version}',
  plugins: isStagingRelease ? stagingPlugins : stablePlugins,
};
