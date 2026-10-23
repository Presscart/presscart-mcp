import { createHash } from 'node:crypto';

import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import type { Request, Response } from 'express';

import { PACKAGE_VERSION } from './version.js';

// MCP Server Card (SEP-2127, experimental-ext-server-card docs/discovery.md): public, pre-connection
// metadata served at `<streamable-http-url>/server-card`. It names the server, its endpoint and the
// protocol versions it speaks, and nothing else: tools are listed at runtime per user, never here.
export const SERVER_CARD_PATH_SUFFIX = '/server-card';
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json';
const SERVER_CARD_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';

export type ServerCard = {
  $schema: string;
  name: string;
  version: string;
  description: string;
  title: string;
  websiteUrl: string;
  repository: { url: string; source: string };
  remotes: Array<{ type: 'streamable-http'; url: string; supportedProtocolVersions: string[] }>;
};

/** The card for the canonical endpoint; identity matches server.json so registry and card agree. */
export function buildServerCard(mcpServerUrl: URL): ServerCard {
  return {
    $schema: SERVER_CARD_SCHEMA,
    name: 'com.presscart/presscart',
    version: PACKAGE_VERSION,
    // The schema caps this at 100 characters.
    description: 'Browse Presscart publications and manage media placement campaigns, orders and articles.',
    title: 'Presscart',
    websiteUrl: 'https://docs.presscart.com/ai/mcp-server',
    repository: { url: 'https://github.com/Presscart/presscart-mcp', source: 'github' },
    remotes: [
      {
        type: 'streamable-http',
        url: mcpServerUrl.href,
        supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
      },
    ],
  };
}

/**
 * GET handler with the discovery doc's headers: open CORS (the card is public and read-only), an
 * hour of caching, and an ETag that answers a matching `If-None-Match` with 304.
 */
export function createServerCardHandler(mcpServerUrl: URL) {
  const body = JSON.stringify(buildServerCard(mcpServerUrl));
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;

  return (req: Request, res: Response) => {
    res.set({
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type, If-None-Match',
      'Access-Control-Expose-Headers': 'ETag',
      'Cache-Control': 'public, max-age=3600',
      ETag: etag,
    });
    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }
    const ifNoneMatch = req.get('if-none-match');
    if (ifNoneMatch && ifNoneMatch.split(',').some(tag => tag.trim() === etag || tag.trim() === '*')) {
      res.status(304).end();
      return;
    }
    res.type(SERVER_CARD_MEDIA_TYPE).send(body);
  };
}
