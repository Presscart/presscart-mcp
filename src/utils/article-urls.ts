import { env } from '../env.js';

const OMITTED_ARTICLE_URL_FIELDS = new Set([
  'brief_google_doc_url',
  'draft_google_doc_url',
  'google_doc_url',
]);

export function buildPublisherArticlePageUrl(articleId: string) {
  return new URL(`/publisher/articles/${articleId}`, getPresscartAppUrl()).toString();
}

export function buildCampaignArticlePageUrl(params: {
  teamSlug: string;
  profileId: string;
  campaignId: string;
  articleId: string;
}) {
  return new URL(
    `/${params.teamSlug}/profiles/${params.profileId}/campaigns/${params.campaignId}/articles/${params.articleId}`,
    getPresscartAppUrl()
  ).toString();
}

export function getArticleLiveUrl(article: Record<string, unknown>) {
  const liveUrl = article.live_url;
  return typeof liveUrl === 'string' && liveUrl.trim() ? liveUrl : null;
}

export function omitInternalArticleUrls<T extends Record<string, unknown>>(article: T) {
  return Object.fromEntries(
    Object.entries(article).filter(([key]) => !OMITTED_ARTICLE_URL_FIELDS.has(key))
  ) as Omit<T, 'brief_google_doc_url' | 'draft_google_doc_url' | 'google_doc_url'>;
}

function getPresscartAppUrl() {
  if (env.PRESSCART_APP_URL) return env.PRESSCART_APP_URL;

  const apiUrl = new URL(env.PRESSCART_API_URL);

  if (apiUrl.hostname === 'api.presscart.com') return 'https://app.presscart.com';
  if (apiUrl.hostname.startsWith('api.')) {
    apiUrl.hostname = apiUrl.hostname.replace(/^api\./, 'app.');
    return apiUrl.origin;
  }
  if (apiUrl.hostname.startsWith('staging-api.')) {
    apiUrl.hostname = apiUrl.hostname.replace(/^staging-api\./, 'staging.');
    return apiUrl.origin;
  }

  return 'https://app.presscart.com';
}
