import { buildCampaignArticlePageUrl, getArticleLiveUrl } from '../utils/article-urls.js';
import type { AuthInfoLike } from '../utils/tool-context.js';
import type {
  GetCampaignArticleStatusResult,
  GetCampaignResult,
  GetOrderResult,
  GetTeamResult,
  GetUserResult,
  ListCampaignArticlesResult,
  ListCampaignsResult,
  ListProfileOrdersResult,
  ListProfilesResult,
  ListTeamsResult,
} from './output-schemas.js';

// Builders construct new objects from named fields only. They never spread, copy,
// or pass through API objects, so fields the API adds later cannot leak.
type ApiRecord = Record<string, unknown>;

type Pagination = {
  total_records: number | null;
  total_pages: number | null;
  current_page: number | null;
  next_page: number | null;
  previous_page: number | null;
};

export type CampaignArticleUrlContext = {
  teamSlug: string;
  campaignId: string;
  profileId?: string;
};

export function buildOAuthUserResult(authInfo: AuthInfoLike | undefined): GetUserResult {
  const claims = asRecord(authInfo?.extra);
  const id = readString(claims, 'sub');
  const fullName = [readString(claims, 'first_name'), readString(claims, 'last_name')]
    .filter((part): part is string => part !== null)
    .join(' ');

  return {
    ...(id === null ? {} : { id }),
    ...(fullName.length > 0 ? { name: fullName } : {}),
  };
}

export function buildApiTokenUserResult(response: unknown): GetUserResult {
  const session = asRecord(response);
  if (readString(session, 'source') !== 'api_token') return {};
  const teamId = readString(session, 'team_id');
  return teamId === null ? {} : { team_id: teamId };
}

export function buildListTeamsResult(response: unknown): ListTeamsResult {
  const envelope = asRecord(response);
  return {
    records: readRecords(envelope, 'records').map(team => ({
      id: readString(team, 'id'),
      name: readString(team, 'name'),
      slug: readString(team, 'slug'),
      type: readString(team, 'type'),
      is_publisher: readBoolean(team, 'is_publisher'),
      role: readString(team, 'role'),
      profiles: readProfileRefs(team),
    })),
    ...readPagination(envelope),
  };
}

export function buildGetTeamResult(response: unknown): GetTeamResult {
  const team = asRecord(response);
  return {
    id: readString(team, 'id'),
    name: readString(team, 'name'),
    slug: readString(team, 'slug'),
    type: readString(team, 'type'),
    profiles: readProfileRefs(team),
  };
}

export function buildListProfilesResult(response: unknown): ListProfilesResult {
  const envelope = asRecord(response);
  return {
    records: readRecords(envelope, 'records').map(profile => ({
      id: readString(profile, 'id'),
      name: readString(profile, 'name'),
      team_id: readString(profile, 'team_id'),
      type: readString(profile, 'type'),
      website_url: readString(profile, 'website_url'),
    })),
    ...readPagination(envelope),
  };
}

export function buildListProfileOrdersResult(response: unknown): ListProfileOrdersResult {
  const envelope = asRecord(response);
  return {
    records: readRecords(envelope, 'records').map(order => ({
      ...readOrderFields(order),
      line_items: readOptionalRecords(order, 'line_items')?.map(readOrderLineItem) ?? null,
    })),
    ...readPagination(envelope),
  };
}

export function buildGetOrderResult(response: unknown): GetOrderResult {
  const order = asRecord(response);
  return {
    ...readOrderFields(order),
    line_items:
      readOptionalRecords(order, 'line_items')?.map(lineItem => ({
        ...readOrderLineItem(lineItem),
        order_items:
          readOptionalRecords(lineItem, 'order_items')?.map(orderItem => ({
            id: readString(orderItem, 'id'),
            campaign_id: readString(orderItem, 'campaign_id'),
          })) ?? null,
      })) ?? null,
  };
}

export function buildListCampaignsResult(response: unknown): ListCampaignsResult {
  const envelope = asRecord(response);
  return {
    records: readRecords(envelope, 'records').map(campaign => {
      const articles = readOptionalRecords(campaign, 'articles');
      return {
        id: readString(campaign, 'id'),
        name: readString(campaign, 'name'),
        reference: readString(campaign, 'reference'),
        profile_id: readString(campaign, 'profile_id'),
        created_at: readString(campaign, 'created_at'),
        updated_at: readString(campaign, 'updated_at'),
        article_count: articles === null ? null : articles.length,
        published_count:
          articles === null
            ? null
            : articles.filter(article => getArticleLiveUrl(article) !== null).length,
      };
    }),
    ...readPagination(envelope),
  };
}

export function buildGetCampaignResult(response: unknown): GetCampaignResult {
  const campaign = asRecord(response);
  const profile = readRecord(campaign, 'profile');
  return {
    id: readString(campaign, 'id'),
    name: readString(campaign, 'name'),
    reference: readString(campaign, 'reference'),
    status: readString(campaign, 'status'),
    description: readString(campaign, 'description'),
    target_date: readString(campaign, 'target_date'),
    profile:
      profile === undefined
        ? null
        : { id: readString(profile, 'id'), name: readString(profile, 'name') },
    objectives: readString(campaign, 'objectives'),
    keywords: readString(campaign, 'keywords'),
    target_audience: readString(campaign, 'target_audience'),
    tone: readString(campaign, 'tone'),
    total_articles: readNumber(campaign, 'total_articles'),
  };
}

export function buildListCampaignArticlesResult(
  response: unknown,
  context: CampaignArticleUrlContext
): ListCampaignArticlesResult {
  const envelope = asRecord(response);
  return {
    records: readRecords(envelope, 'records').map(article => {
      const articleId = readString(article, 'id');
      const orderItem = readRecord(article, 'order_item');
      const outlet = readRecord(orderItem, 'outlet');
      const firstStatus = readOptionalRecords(article, 'status')?.[0];
      return {
        id: articleId,
        name: readString(article, 'name'),
        live_url: getArticleLiveUrl(article),
        article_page_url:
          context.profileId !== undefined && articleId !== null
            ? buildCampaignArticlePageUrl({
                teamSlug: context.teamSlug,
                profileId: context.profileId,
                campaignId: context.campaignId,
                articleId,
              })
            : null,
        status:
          firstStatus === undefined
            ? null
            : {
                name: readString(firstStatus, 'name'),
                prefix: readString(firstStatus, 'prefix'),
                effective_at: readString(firstStatus, 'effective_at'),
              },
        outlet:
          outlet === undefined
            ? null
            : { name: readString(outlet, 'name'), website_url: readString(outlet, 'website_url') },
        includes: readIncludes(orderItem),
        expected_completion_date: readString(article, 'expected_completion_date'),
      };
    }),
    total_records: readNumber(envelope, 'total_records'),
  };
}

export function buildGetCampaignArticleStatusResult(
  response: unknown
): GetCampaignArticleStatusResult {
  const envelope = asRecord(response);
  const statuses: GetCampaignArticleStatusResult['statuses'] = [];
  for (const status of readRecords(envelope, 'records')) {
    const count = readCount(status, 'count');
    if (count === null || count === 0) continue;
    statuses.push({
      name: readString(status, 'name'),
      prefix: readString(status, 'prefix'),
      count,
    });
  }
  return { statuses };
}

function readOrderFields(order: ApiRecord | undefined) {
  return {
    id: readString(order, 'id'),
    reference_number: readString(order, 'reference_number'),
    status: readString(order, 'status'),
    created_at: readString(order, 'created_at'),
    date_paid: readString(order, 'date_paid'),
  };
}

function readOrderLineItem(lineItem: ApiRecord) {
  const outlet = readRecord(lineItem, 'outlet');
  return {
    id: readString(lineItem, 'id'),
    name: readString(lineItem, 'name'),
    product_type_name: readString(lineItem, 'product_type_name'),
    quantity: readNumber(lineItem, 'quantity'),
    outlet:
      outlet === undefined
        ? null
        : { name: readString(outlet, 'name'), website_url: readString(outlet, 'website_url') },
    includes: readIncludes(lineItem),
  };
}

function readIncludes(owner: ApiRecord | undefined) {
  return (
    readOptionalRecords(owner, 'includes')?.map(include => ({
      channel_type: readString(include, 'channel_type'),
      placement_type: readString(include, 'placement_type'),
    })) ?? null
  );
}

function readProfileRefs(owner: ApiRecord | undefined) {
  return (
    readOptionalRecords(owner, 'profiles')?.map(profile => ({
      id: readString(profile, 'id'),
      name: readString(profile, 'name'),
    })) ?? null
  );
}

function readPagination(envelope: ApiRecord | undefined): Pagination {
  return {
    total_records: readNumber(envelope, 'total_records'),
    total_pages: readNumber(envelope, 'total_pages'),
    current_page: readNumber(envelope, 'current_page'),
    next_page: readNumber(envelope, 'next_page'),
    previous_page: readNumber(envelope, 'previous_page'),
  };
}

function asRecord(value: unknown): ApiRecord | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as ApiRecord;
}

function readRecord(owner: ApiRecord | undefined, key: string) {
  return asRecord(owner?.[key]);
}

function readRecords(owner: ApiRecord | undefined, key: string): ApiRecord[] {
  return readOptionalRecords(owner, key) ?? [];
}

function readOptionalRecords(owner: ApiRecord | undefined, key: string): ApiRecord[] | null {
  const value = owner?.[key];
  if (!Array.isArray(value)) return null;
  return value.flatMap(entry => {
    const record = asRecord(entry);
    return record === undefined ? [] : [record];
  });
}

function readString(owner: ApiRecord | undefined, key: string) {
  const value = owner?.[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(owner: ApiRecord | undefined, key: string) {
  const value = owner?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(owner: ApiRecord | undefined, key: string) {
  const value = owner?.[key];
  return typeof value === 'boolean' ? value : null;
}

// Aggregate counts may arrive as numeric strings (Postgres bigint); accept only
// non-negative integers in either form.
function readCount(owner: ApiRecord | undefined, key: string) {
  const value = owner?.[key];
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}
