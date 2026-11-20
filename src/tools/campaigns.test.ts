import assert from 'node:assert/strict';
import test from 'node:test';

import type { RecordedCall } from '../directory/mcp-tool-call.fixtures.js';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';
process.env.MCP_INTERNAL_AUTH_TOKEN = 'internal-token-placeholder';

const { buildAddOrderItemsToCampaignResult, buildCampaignArticlesResult, collectPendingBaseOrderItemIds } =
  await import('./campaigns.js');
const { callTool, getJsonBody } = await import('../directory/mcp-tool-call.fixtures.js');
const { jsonResponse, readTextContent } = await import('../directory/mcp-client.fixtures.js');

test('returns app and live article URLs without brief or draft document URLs', () => {
  const result = buildCampaignArticlesResult(
    {
      total_records: 1,
      records: [
        {
          id: 'article-id',
          name: 'UNTITLED for Digital Music News',
          live_url: 'https://publisher.example/live-article',
          brief_google_doc_url: 'https://docs.google.com/document/d/brief',
          draft_google_doc_url: 'https://docs.google.com/document/d/draft',
          google_doc_url: 'https://docs.google.com/document/d/source',
          status: [{ name: 'Published', prefix: 'published' }],
        },
      ],
    },
    {
      teamSlug: 'raintech',
      profileId: 'profile-id',
      campaignId: 'campaign-id',
    }
  );

  const expectedArticlePageUrl =
    'https://app.presscart.test/raintech/profiles/profile-id/campaigns/campaign-id/articles/article-id';
  const article = result.records?.[0];

  assert.ok(article);
  assert.equal(article.article_page_url, expectedArticlePageUrl);
  assert.equal(article.live_url, 'https://publisher.example/live-article');
  assert.equal('brief_google_doc_url' in article, false);
  assert.equal('draft_google_doc_url' in article, false);
  assert.equal('google_doc_url' in article, false);
  assert.equal(result.article_queue[0].article_page_url, expectedArticlePageUrl);
  assert.equal(result.article_queue[0].live_url, 'https://publisher.example/live-article');
});

test('summarizes a single campaign article after adding order items', () => {
  const result = buildAddOrderItemsToCampaignResult(
    { campaign_id: 'campaign-id' },
    {
      available: true,
      total_records: 1,
      records: [
        {
          id: 'article-id',
          name: 'UNTITLED for Digital Music News',
          status: [{ name: 'Action Required', prefix: 'action-required' }],
          order_item: {
            name: 'Digital Music News',
            outlet: { name: 'Digital Music News' },
          },
        },
      ],
    }
  );

  assert.equal(result.campaign_id, 'campaign-id');
  assert.equal(result.recommended_article_id, 'article-id');
  assert.match(result.message, /campaign now has 1 article/);
  assert.match(result.next_step, /Start working on UNTITLED for Digital Music News/);
  assert.deepEqual(result.status_counts, { 'action-required': 1 });
});

test('recommends the first actionable article when campaign has multiple articles', () => {
  const result = buildAddOrderItemsToCampaignResult(
    { campaign_id: 'campaign-id' },
    {
      available: true,
      total_records: 3,
      records: [
        {
          id: 'pending-id',
          name: 'UNTITLED for SPIN',
          status: [{ name: 'Pending Content Brief', prefix: 'pending-content-brief' }],
        },
        {
          id: 'brief-update-id',
          name: 'UNTITLED for Digital Music News',
          status: [{ name: 'Brief Update Requested', prefix: 'brief-update-requested' }],
        },
        {
          id: 'action-id',
          name: 'UNTITLED for Neon Music',
          status: [{ name: 'Action Required', prefix: 'action-required' }],
        },
      ],
    }
  );

  assert.equal(result.recommended_article_id, 'action-id');
  assert.match(result.next_step, /Start with UNTITLED for Neon Music/);
  assert.deepEqual(result.status_counts, {
    'pending-content-brief': 1,
    'brief-update-requested': 1,
    'action-required': 1,
  });
});

test('does not fail the add result when campaign article queue cannot be loaded', () => {
  const result = buildAddOrderItemsToCampaignResult(
    { campaign_id: 'campaign-id' },
    {
      available: false,
      reason: 'Presscart API request failed: 403 Forbidden',
    }
  );

  assert.equal(result.campaign_id, 'campaign-id');
  assert.equal(result.article_queue_available, false);
  assert.match(result.next_step, /Open the campaign article list/);
});

test('points ready-for-review articles back to the application for approval', () => {
  const result = buildAddOrderItemsToCampaignResult(
    { campaign_id: 'campaign-id' },
    {
      available: true,
      total_records: 1,
      records: [
        {
          id: 'article-id',
          name: 'UNTITLED for SPIN',
          status: [{ name: 'Draft Ready for Review', prefix: 'draft-ready-for-review' }],
        },
      ],
    }
  );

  assert.equal(result.recommended_article_id, 'article-id');
  assert.match(result.next_step, /Approve it in the application/);
});

test('explains pending content brief as internal writing work', () => {
  const result = buildAddOrderItemsToCampaignResult(
    { campaign_id: 'campaign-id' },
    {
      available: true,
      total_records: 1,
      records: [
        {
          id: 'article-id',
          name: 'UNTITLED for SPIN',
          status: [{ name: 'Pending Content Brief', prefix: 'pending-content-brief' }],
        },
      ],
    }
  );

  assert.equal(result.recommended_article_id, 'article-id');
  assert.match(result.next_step, /queued for internal writing/);
  assert.match(result.next_step, /does not need to upload their own article/);
});

test('suggests request article writing when an article has add-ons', () => {
  const result = buildAddOrderItemsToCampaignResult(
    { campaign_id: 'campaign-id' },
    {
      available: true,
      total_records: 1,
      records: [
        {
          id: 'article-id',
          name: 'UNTITLED for SPIN',
          status: [{ name: 'Action Required', prefix: 'action-required' }],
          order_item: {
            name: 'SPIN',
            addons: [{ name: 'Writing' }],
            outlet: { name: 'SPIN' },
          },
        },
      ],
    }
  );

  assert.equal(result.recommended_article_id, 'article-id');
  assert.equal(result.article_queue[0].has_addons, true);
  assert.deepEqual(result.article_queue[0].addons, ['Writing']);
  assert.match(result.next_step, /request_article_writing/);
  assert.match(result.next_step, /instead of asking the user to upload their own article/);
});

test('prioritizes user review over pending internal writing', () => {
  const result = buildAddOrderItemsToCampaignResult(
    { campaign_id: 'campaign-id' },
    {
      available: true,
      total_records: 2,
      records: [
        {
          id: 'pending-id',
          name: 'UNTITLED for SPIN',
          status: [{ name: 'Pending Content Brief', prefix: 'pending-content-brief' }],
        },
        {
          id: 'review-id',
          name: 'UNTITLED for Digital Music News',
          status: [{ name: 'Brief Ready for Review', prefix: 'brief-ready-for-review' }],
        },
      ],
    }
  );

  assert.equal(result.recommended_article_id, 'review-id');
  assert.match(result.next_step, /Approve it in the application/);
});

test('describes revision and info statuses as needing user response', () => {
  for (const statusPrefix of [
    'brief-update-requested',
    'draft-update-requested',
    'request-revision',
    'needs-info',
    'rejected',
  ]) {
    const result = buildAddOrderItemsToCampaignResult(
      { campaign_id: 'campaign-id' },
      {
        available: true,
        total_records: 1,
        records: [
          {
            id: `${statusPrefix}-id`,
            name: `UNTITLED ${statusPrefix}`,
            status: [{ name: statusPrefix, prefix: statusPrefix }],
          },
        ],
      }
    );

    assert.equal(result.recommended_article_id, `${statusPrefix}-id`);
    assert.match(result.next_step, /needs a user response/);
  }
});

const TEAM_SLUG = 'acme-media';
const PROFILE_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN_ID = '33333333-3333-4333-8333-333333333333';
const ADD_ON_ITEM = '24cc149c-ac2c-4559-b80c-8457bb7fe874';
const BASE_ITEM = '81f27c87-7d8f-4237-bb0d-502b24983940';
const BASE_ITEM_2 = '91f27c87-7d8f-4237-bb0d-502b24983941';
const ASSIGNED_ITEM = 'a1f27c87-7d8f-4237-bb0d-502b24983942';
const OTHER_CAMPAIGN_ID = '44444444-4444-4444-8444-444444444444';

const orderResponse = {
  line_items: [
    {
      name: 'Presscart Writing with Interview',
      is_add_on: true,
      order_items: [{ id: ADD_ON_ITEM, campaign_id: null }],
    },
    {
      name: 'Presscart Newswire Press Release',
      is_add_on: false,
      order_items: [
        { id: BASE_ITEM, campaign_id: null },
        { id: ASSIGNED_ITEM, campaign_id: OTHER_CAMPAIGN_ID },
        { id: BASE_ITEM_2 },
      ],
    },
  ],
};

function respondForUpload(call: { method: string; url: URL }, orderBody: unknown = orderResponse) {
  if (call.method === 'GET' && call.url.pathname === `/teams/${TEAM_SLUG}/orders/${ORDER_ID}`) {
    return jsonResponse(orderBody);
  }
  if (call.method === 'POST') {
    return jsonResponse({ campaign_ids: [CAMPAIGN_ID] });
  }
  // Campaign article list after upload; unavailable is fine, the tool tolerates it.
  return jsonResponse({ total_records: 0, records: [] });
}

function postCalls(calls: RecordedCall[]) {
  return calls.filter(call => call.method === 'POST');
}

test('collectPendingBaseOrderItemIds returns unassigned base items and skips add-ons and assigned items', () => {
  assert.deepEqual(collectPendingBaseOrderItemIds(orderResponse), [BASE_ITEM, BASE_ITEM_2]);
});

test('collectPendingBaseOrderItemIds tolerates missing arrays and junk', () => {
  assert.deepEqual(collectPendingBaseOrderItemIds({}), []);
  assert.deepEqual(collectPendingBaseOrderItemIds({ line_items: [{}, { order_items: null }] }), []);
  assert.deepEqual(
    collectPendingBaseOrderItemIds({ line_items: [{ order_items: [{ campaign_id: null }, {}] }] }),
    []
  );
});

test('collectPendingBaseOrderItemIds returns every item of a quantity > 1 line', () => {
  assert.deepEqual(
    collectPendingBaseOrderItemIds({
      line_items: [{ is_add_on: false, order_items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }],
    }),
    ['a', 'b', 'c']
  );
});

test('add_order_items_to_campaign creates a new campaign with a groups body of pending base items', async () => {
  const { result, calls } = await callTool(
    'add_order_items_to_campaign',
    {
      team_slug: TEAM_SLUG,
      profile_id: PROFILE_ID,
      order_id: ORDER_ID,
      campaign_name: 'Launch',
    },
    call => respondForUpload(call)
  );

  assert.notEqual(result.isError, true);
  assert.equal(calls[0]?.method, 'GET');
  assert.equal(calls[0]?.url.pathname, `/teams/${TEAM_SLUG}/orders/${ORDER_ID}`);
  assert.equal(calls[0]?.url.search, '');
  const posts = postCalls(calls);
  assert.equal(posts.length, 1);
  assert.equal(posts[0]?.url.pathname, `/teams/${TEAM_SLUG}/campaigns/upload-content`);
  assert.deepEqual(getJsonBody(posts[0]), {
    order_id: ORDER_ID,
    groups: [{ campaign_name: 'Launch', order_item_ids: [BASE_ITEM, BASE_ITEM_2] }],
  });
  assert.equal(result.structuredContent?.campaign_id, CAMPAIGN_ID);
});

test('add_order_items_to_campaign sends campaign_id for an existing campaign', async () => {
  const { result, calls } = await callTool(
    'add_order_items_to_campaign',
    { team_slug: TEAM_SLUG, order_id: ORDER_ID, campaign_id: CAMPAIGN_ID, profile_id: PROFILE_ID },
    call => respondForUpload(call)
  );

  assert.notEqual(result.isError, true);
  const posts = postCalls(calls);
  assert.deepEqual(getJsonBody(posts[0]), {
    order_id: ORDER_ID,
    groups: [{ campaign_id: CAMPAIGN_ID, order_item_ids: [BASE_ITEM, BASE_ITEM_2] }],
  });
});

test('add_order_items_to_campaign errors without calling the API when nothing is pending', async () => {
  const { result, calls } = await callTool(
    'add_order_items_to_campaign',
    { team_slug: TEAM_SLUG, profile_id: PROFILE_ID, order_id: ORDER_ID, campaign_name: 'Launch' },
    call =>
      respondForUpload(call, {
        line_items: [{ is_add_on: false, order_items: [{ id: BASE_ITEM, campaign_id: CAMPAIGN_ID }] }],
      })
  );

  assert.equal(result.isError, true);
  assert.match(readTextContent(result), /no paid placements waiting to be added/);
  assert.equal(postCalls(calls).length, 0);
});

test('add_order_items_to_campaign requires exactly one of campaign_id or campaign_name', async () => {
  for (const extra of [
    {},
    { campaign_id: CAMPAIGN_ID, campaign_name: 'Launch' },
  ]) {
    const { result, calls } = await callTool(
      'add_order_items_to_campaign',
      { team_slug: TEAM_SLUG, profile_id: PROFILE_ID, order_id: ORDER_ID, ...extra },
      call => respondForUpload(call)
    );
    assert.equal(result.isError, true);
    assert.match(readTextContent(result), /exactly one of campaign_id or campaign_name/i);
    assert.equal(calls.length, 0);
  }
});

const NO_CAMPAIGN_ID_ERROR = /did not return a campaign id.*list_campaigns to check whether the items were added before retrying/;

for (const [label, body] of [
  ['null', null],
  ['an empty object', {}],
  ['an empty campaign_ids array', { campaign_ids: [] }],
  ['a non-uuid campaign id', { campaign_ids: ['invalid'] }],
  ['more than one campaign id', { campaign_ids: [CAMPAIGN_ID, OTHER_CAMPAIGN_ID] }],
] as const) {
  test(`add_order_items_to_campaign keeps recovery guidance when the API returns ${label}`, async () => {
    const { result, calls } = await callTool(
      'add_order_items_to_campaign',
      { team_slug: TEAM_SLUG, profile_id: PROFILE_ID, order_id: ORDER_ID, campaign_name: 'Launch' },
      call => (call.method === 'POST' ? jsonResponse(body) : respondForUpload(call))
    );

    assert.equal(result.isError, true);
    assert.match(readTextContent(result), NO_CAMPAIGN_ID_ERROR);
    // The POST is the last request: no campaign-articles lookup follows a malformed response.
    assert.equal(calls.at(-1)?.method, 'POST');
    assert.equal(calls.length, 2);
  });
}

test('add_order_items_to_campaign returns a backend 400 on the upload as a tool error', async () => {
  const { result } = await callTool(
    'add_order_items_to_campaign',
    { team_slug: TEAM_SLUG, profile_id: PROFILE_ID, order_id: ORDER_ID, campaign_name: 'Launch' },
    call =>
      call.method === 'POST'
        ? jsonResponse({ message: 'Order items must be covered exactly once' }, 400)
        : respondForUpload(call)
  );

  assert.equal(result.isError, true);
  assert.match(readTextContent(result), /Presscart API request failed: 400/);
});
