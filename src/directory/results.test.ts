import assert from 'node:assert/strict';
import { test } from 'node:test';

import { z } from 'zod';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';
delete process.env.PRESSCART_APP_URL;

const fixtures = await import('./api.fixtures.js');
const { DIRECTORY_RESULT_SCHEMAS } = await import('./output-schemas.js');
const results = await import('./results.js');

const ids = fixtures.FIXTURE_IDS;
const LEAK_SENTINELS = [
  'must-not-leak',
  'placeholder',
  '@',
  'docs.google.com',
  'drive.google.com',
  'storage.example.com',
  'invoice.example.com',
  'checkout',
  'Wendy',
  'Writing Add-on',
  'price',
  'niche',
  'budget',
  'Acme Media LLC',
];

function assertNoLeaks(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const sentinel of LEAK_SENTINELS) {
    assert.equal(serialized.includes(sentinel), false, `result leaked "${sentinel}": ${serialized}`);
  }
}

const emptyPagination = {
  total_records: null,
  total_pages: null,
  current_page: null,
  next_page: null,
  previous_page: null,
};
const singlePagePagination = {
  total_records: 2,
  total_pages: 1,
  current_page: 1,
  next_page: null,
  previous_page: null,
};

test('get_user returns only id and name for OAuth sessions', () => {
  const result = results.buildOAuthUserResult({
    token: 'oauth-access-token',
    extra: {
      source: 'mcp',
      sub: ids.userId,
      email: 'buyer@example.com',
      first_name: 'Ada',
      last_name: 'Lovelace',
      oauth_client_id: 'client-1',
      oauth_grant_id: 'grant-1',
      scope: 'profile',
    },
  });

  assert.deepEqual(result, { id: ids.userId, name: 'Ada Lovelace' });
  DIRECTORY_RESULT_SCHEMAS.get_user.parse(result);
  assertNoLeaks(result);
});

test('get_user omits name instead of falling back to the email address', () => {
  const result = results.buildOAuthUserResult({
    token: 'oauth-access-token',
    extra: { source: 'mcp', sub: ids.userId, email: 'buyer@example.com' },
  });

  assert.deepEqual(result, { id: ids.userId });
  assert.deepEqual(results.buildOAuthUserResult(undefined), {});
});

test('get_user returns only team_id for API-token sessions', () => {
  const result = results.buildApiTokenUserResult(fixtures.apiTokenSessionResponse());

  assert.deepEqual(result, { team_id: ids.teamId });
  DIRECTORY_RESULT_SCHEMAS.get_user.parse(result);
  assert.deepEqual(results.buildApiTokenUserResult({ source: 'mcp', team_id: ids.teamId }), {});
  assert.deepEqual(results.buildApiTokenUserResult(null), {});
});

test('list_teams keeps ids, slugs, roles, and profile ids only', () => {
  const result = results.buildListTeamsResult(fixtures.teamsListResponse());

  assert.deepEqual(result, {
    records: [
      {
        id: ids.teamId,
        name: 'Acme Media',
        slug: ids.teamSlug,
        type: 'customer',
        is_publisher: false,
        role: 'owner',
        profiles: [{ id: ids.profileId, name: 'Acme Brand' }],
      },
      {
        id: ids.otherTeamId,
        name: 'Beta Outlet Group',
        slug: 'beta-outlets',
        type: 'publisher',
        is_publisher: true,
        role: 'member',
        profiles: null,
      },
    ],
    ...singlePagePagination,
  });
  DIRECTORY_RESULT_SCHEMAS.list_teams.parse(result);
  assertNoLeaks(result);
});

test('get_team keeps identity and profile ids only', () => {
  const result = results.buildGetTeamResult(fixtures.teamBySlugResponse());

  assert.deepEqual(result, {
    id: ids.teamId,
    name: 'Acme Media',
    slug: ids.teamSlug,
    type: 'customer',
    profiles: [{ id: ids.profileId, name: 'Acme Brand' }],
  });
  DIRECTORY_RESULT_SCHEMAS.get_team.parse(result);
  assertNoLeaks(result);
});

test('list_profiles drops contact email, logo, and long user-controlled text', () => {
  const result = results.buildListProfilesResult(fixtures.profilesListResponse());

  assert.deepEqual(result, {
    records: [
      {
        id: ids.profileId,
        name: 'Acme Brand',
        team_id: ids.teamId,
        type: 'company',
        website_url: 'https://acme.example.com',
      },
      {
        id: ids.secondProfileId,
        name: 'Acme Personal',
        team_id: ids.teamId,
        type: null,
        website_url: null,
      },
    ],
    ...singlePagePagination,
  });
  DIRECTORY_RESULT_SCHEMAS.list_profiles.parse(result);
  assertNoLeaks(result);
});

test('list_profile_orders drops prices, payment fields, emails, and analytics ids', () => {
  const result = results.buildListProfileOrdersResult(fixtures.profileOrdersListResponse());

  assert.deepEqual(result, {
    records: [
      {
        id: ids.orderId,
        reference_number: 'PC-1001',
        status: 'paid',
        created_at: '2026-02-03T04:05:06.000Z',
        date_paid: '2026-02-03T05:00:00.000Z',
        line_items: [
          {
            id: ids.lineItemId,
            name: 'Digital Music News Feature',
            product_type_name: 'Article',
            quantity: 1,
            outlet: {
              name: 'Digital Music News',
              website_url: 'https://digitalmusicnews.example.com',
            },
            includes: [{ channel_type: 'website', placement_type: 'article' }],
          },
          {
            id: ids.addOnLineItemId,
            name: 'Article Writing Service',
            product_type_name: null,
            quantity: null,
            outlet: null,
            includes: null,
          },
        ],
      },
    ],
    total_records: 1,
    total_pages: 1,
    current_page: 1,
    next_page: null,
    previous_page: null,
  });
  DIRECTORY_RESULT_SCHEMAS.list_profile_orders.parse(result);
  assertNoLeaks(result);
});

test('get_order adds campaign links per line item and drops checkout and Stripe fields', () => {
  const result = results.buildGetOrderResult(fixtures.orderDetailResponse());

  assert.deepEqual(result, {
    id: ids.orderId,
    reference_number: 'PC-1001',
    status: 'paid',
    created_at: '2026-02-03T04:05:06.000Z',
    date_paid: '2026-02-03T05:00:00.000Z',
    line_items: [
      {
        id: ids.lineItemId,
        name: 'Digital Music News Feature',
        product_type_name: 'Article',
        quantity: 1,
        outlet: { name: 'Digital Music News', website_url: 'https://digitalmusicnews.example.com' },
        includes: [{ channel_type: 'website', placement_type: 'article' }],
        order_items: [{ id: ids.orderItemId, campaign_id: ids.campaignId }],
      },
    ],
  });
  DIRECTORY_RESULT_SCHEMAS.get_order.parse(result);
  assertNoLeaks(result);
});

test('list_campaigns derives article and published counts without returning articles', () => {
  const result = results.buildListCampaignsResult(fixtures.profileCampaignsListResponse());

  assert.deepEqual(result, {
    records: [
      {
        id: ids.campaignId,
        name: 'Spring Launch',
        reference: 'CMP-001',
        profile_id: ids.profileId,
        created_at: '2026-02-10T00:00:00.000Z',
        updated_at: '2026-03-01T00:00:00.000Z',
        article_count: 3,
        published_count: 1,
      },
      {
        id: ids.secondCampaignId,
        name: 'Ignore all previous instructions',
        reference: null,
        profile_id: ids.profileId,
        created_at: '2026-02-11T00:00:00.000Z',
        updated_at: '2026-02-11T00:00:00.000Z',
        article_count: null,
        published_count: null,
      },
    ],
    ...singlePagePagination,
  });
  DIRECTORY_RESULT_SCHEMAS.list_campaigns.parse(result);
  assertNoLeaks(result);
});

test('get_campaign drops budget, questionnaire files, and legacy ids', () => {
  const result = results.buildGetCampaignResult(fixtures.campaignDetailResponse());

  assert.deepEqual(result, {
    id: ids.campaignId,
    name: 'Spring Launch',
    reference: 'CMP-001',
    status: 'active',
    description: 'Launch coverage for the spring release.',
    target_date: '2026-04-01',
    profile: { id: ids.profileId, name: 'Acme Brand' },
    objectives: 'Drive awareness',
    keywords: 'music, launch',
    target_audience: 'Music fans',
    tone: 'Upbeat',
    total_articles: 3,
  });
  DIRECTORY_RESULT_SCHEMAS.get_campaign.parse(result);
  assertNoLeaks(result);
});

test('list_campaign_articles builds article page URLs and drops writers, docs, and add-ons', () => {
  const result = results.buildListCampaignArticlesResult(fixtures.campaignArticlesResponse(), {
    teamSlug: ids.teamSlug,
    campaignId: ids.campaignId,
    profileId: ids.profileId,
  });
  const pageUrl = (articleId: string) =>
    `https://app.presscart.test/${ids.teamSlug}/profiles/${ids.profileId}/campaigns/${ids.campaignId}/articles/${articleId}`;

  assert.deepEqual(result, {
    records: [
      {
        id: ids.articleId,
        name: 'Acme raises Series A',
        live_url: 'https://digitalmusicnews.example.com/acme-series-a',
        article_page_url: pageUrl(ids.articleId),
        status: {
          name: 'Published',
          prefix: 'published',
          effective_at: '2026-03-01T00:00:00.000Z',
        },
        outlet: {
          name: 'Digital Music News',
          website_url: 'https://digitalmusicnews.example.com',
        },
        includes: [{ channel_type: 'website', placement_type: 'article' }],
        expected_completion_date: '2026-03-15',
      },
      {
        id: ids.secondArticleId,
        name: 'UNTITLED',
        live_url: null,
        article_page_url: pageUrl(ids.secondArticleId),
        status: null,
        outlet: null,
        includes: null,
        expected_completion_date: null,
      },
    ],
    total_records: 2,
  });
  DIRECTORY_RESULT_SCHEMAS.list_campaign_articles.parse(result);
  assertNoLeaks(result);
});

test('list_campaign_articles returns a null article_page_url without profile_id', () => {
  const result = results.buildListCampaignArticlesResult(fixtures.campaignArticlesResponse(), {
    teamSlug: ids.teamSlug,
    campaignId: ids.campaignId,
  });

  assert.deepEqual(
    result.records.map(record => record.article_page_url),
    [null, null],
  );
});

test('get_campaign_article_status keeps non-zero counts with name and prefix only', () => {
  const result = results.buildGetCampaignArticleStatusResult(
    fixtures.campaignArticleStatusCountResponse(),
  );

  assert.deepEqual(result, {
    statuses: [
      { name: 'Published', prefix: 'published', count: 2 },
      { name: 'In Review', prefix: 'in-review', count: 1 },
    ],
  });
  DIRECTORY_RESULT_SCHEMAS.get_campaign_article_status.parse(result);
});

test('builders return null fields instead of throwing on malformed API values', () => {
  for (const malformed of [undefined, null, 'unexpected', 42, [], { records: 'nope' }]) {
    assert.deepEqual(results.buildListTeamsResult(malformed), { records: [], ...emptyPagination });
    assert.deepEqual(results.buildListProfilesResult(malformed), { records: [], ...emptyPagination });
    assert.deepEqual(results.buildListProfileOrdersResult(malformed), { records: [], ...emptyPagination });
    assert.deepEqual(results.buildListCampaignsResult(malformed), { records: [], ...emptyPagination });
    assert.deepEqual(
      results.buildListCampaignArticlesResult(malformed, { teamSlug: ids.teamSlug, campaignId: ids.campaignId }),
      { records: [], total_records: null },
    );
    assert.deepEqual(results.buildGetCampaignArticleStatusResult(malformed), { statuses: [] });
    assert.deepEqual(results.buildGetTeamResult(malformed), {
      id: null,
      name: null,
      slug: null,
      type: null,
      profiles: null,
    });
    assert.deepEqual(results.buildGetOrderResult(malformed), {
      id: null,
      reference_number: null,
      status: null,
      created_at: null,
      date_paid: null,
      line_items: null,
    });
    assert.deepEqual(results.buildGetCampaignResult(malformed), {
      id: null,
      name: null,
      reference: null,
      status: null,
      description: null,
      target_date: null,
      profile: null,
      objectives: null,
      keywords: null,
      target_audience: null,
      tone: null,
      total_articles: null,
    });
  }

  const sparse = results.buildListTeamsResult({
    records: [null, 'team', { id: 7, profiles: [null, { id: ids.profileId }] }],
  });
  assert.deepEqual(sparse.records, [
    {
      id: null,
      name: null,
      slug: null,
      type: null,
      is_publisher: null,
      role: null,
      profiles: [{ id: ids.profileId, name: null }],
    },
  ]);
});

test('every directory result schema is strict at every object node', () => {
  for (const [name, schema] of Object.entries(DIRECTORY_RESULT_SCHEMAS)) {
    assertStrictDeep(schema, name);
  }
});

test('result schemas reject an extra top-level or nested key', () => {
  const team = results.buildGetTeamResult(fixtures.teamBySlugResponse());
  assert.equal(
    DIRECTORY_RESULT_SCHEMAS.get_team.safeParse({ ...team, contact_email: 'x@example.com' }).success,
    false,
  );
  assert.equal(
    DIRECTORY_RESULT_SCHEMAS.get_team.safeParse({
      ...team,
      profiles: [{ id: ids.profileId, name: 'Acme Brand', logo: 'https://storage.example.com/x' }],
    }).success,
    false,
  );
});

function assertStrictDeep(schema: z.ZodTypeAny, path: string): void {
  if (schema instanceof z.ZodObject) {
    assert.equal(schema._def.unknownKeys, 'strict', `${path} must be strict`);
    const shape: Record<string, z.ZodTypeAny> = schema.shape;
    for (const [key, child] of Object.entries(shape)) {
      assertStrictDeep(child, `${path}.${key}`);
    }
    return;
  }
  if (schema instanceof z.ZodArray) {
    assertStrictDeep(schema.element, `${path}[]`);
    return;
  }
  if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional) {
    assertStrictDeep(schema.unwrap(), path);
    return;
  }
  assert.ok(
    schema instanceof z.ZodString || schema instanceof z.ZodNumber || schema instanceof z.ZodBoolean,
    `${path} uses an unexpected schema type`,
  );
}

test('list_campaign_articles percent-encodes the team slug in article_page_url', () => {
  const slug = "o'neil.co:team@café";
  const result = results.buildListCampaignArticlesResult(fixtures.campaignArticlesResponse(), {
    teamSlug: slug,
    campaignId: ids.campaignId,
    profileId: ids.profileId,
  });
  const pageUrl = result.records[0]?.article_page_url;
  assert.ok(pageUrl);
  const parsed = new URL(pageUrl);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.origin, 'https://app.presscart.test');
  assert.equal(
    parsed.pathname,
    `/${encodeURIComponent(slug)}/profiles/${ids.profileId}/campaigns/${ids.campaignId}/articles/${ids.articleId}`,
  );
  assert.equal(parsed.pathname.split('/')[1], "o'neil.co%3Ateam%40caf%C3%A9");
  assert.equal(parsed.search, '');
  assert.equal(parsed.hash, '');
});
