import assert from 'node:assert/strict';
import test from 'node:test';

process.env.PRESSCART_API_URL = 'https://api.presscart.test';

const { buildAddOrderItemsToCampaignResult } = await import('./campaigns.js');

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
