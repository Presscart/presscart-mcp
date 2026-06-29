import { z } from 'zod';

const envSchema = z.object({
  PRESSCART_API_URL: z.string().url(),
  PRESSCART_APP_URL: z.string().url().optional(),
  MCP_HOST: z.string().default('0.0.0.0'),
  MCP_PORT: z.coerce.number().int().positive().default(8080),
  MCP_SERVER_URL: z.string().url().optional(),
  MCP_ALLOWED_HOSTS: z.string().min(1).optional(),
  MCP_ALLOWED_ORIGINS: z.string().min(1).optional(),
  MCP_OAUTH_ENABLED: z.coerce.boolean().default(false),
  MCP_OAUTH_ISSUER_URL: z.string().url().optional(),
  MCP_OAUTH_AUDIENCE: z.string().url().default('https://mcp.presscart.com'),
  MCP_INTERNAL_AUTH_TOKEN: z.string().min(1).optional(),
  PRESSCART_API_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
});

export const env = envSchema.parse({
  PRESSCART_API_URL: process.env.PRESSCART_API_URL,
  PRESSCART_APP_URL: process.env.PRESSCART_APP_URL,
  MCP_HOST: process.env.MCP_HOST,
  // Railway injects PORT at runtime; keep MCP_PORT as an override for local/dev use.
  MCP_PORT: process.env.PORT ?? process.env.MCP_PORT,
  MCP_SERVER_URL: process.env.MCP_SERVER_URL,
  MCP_ALLOWED_HOSTS: process.env.MCP_ALLOWED_HOSTS,
  MCP_ALLOWED_ORIGINS: process.env.MCP_ALLOWED_ORIGINS,
  MCP_OAUTH_ENABLED: process.env.MCP_OAUTH_ENABLED,
  MCP_OAUTH_ISSUER_URL: process.env.MCP_OAUTH_ISSUER_URL,
  MCP_OAUTH_AUDIENCE: process.env.MCP_OAUTH_AUDIENCE,
  MCP_INTERNAL_AUTH_TOKEN: process.env.MCP_INTERNAL_AUTH_TOKEN,
  PRESSCART_API_TIMEOUT_MS: process.env.PRESSCART_API_TIMEOUT_MS,
});
