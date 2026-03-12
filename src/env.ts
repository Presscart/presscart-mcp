import { z } from 'zod';

const envSchema = z.object({
  PRESSCART_API_URL: z.string().url(),
  PRESSCART_API_TOKEN: z.string().min(1).optional(),
  PRESSCART_PROFILE_ID: z.string().uuid().optional(),
  MCP_HOST: z.string().default('0.0.0.0'),
  MCP_PORT: z.coerce.number().int().positive().default(8787),
  MCP_SERVER_URL: z.string().url().optional(),
  MCP_ALLOWED_HOSTS: z.string().min(1).optional(),
  MCP_ALLOWED_ORIGINS: z.string().min(1).optional(),
  MCP_OAUTH_ENABLED: z.coerce.boolean().default(false),
  MCP_OAUTH_ISSUER_URL: z.string().url().optional(),
  MCP_OAUTH_SIGNING_SECRET: z.string().min(32).optional(),
});

export const env = envSchema.parse({
  PRESSCART_API_URL: process.env.PRESSCART_API_URL,
  PRESSCART_API_TOKEN: process.env.PRESSCART_API_TOKEN,
  PRESSCART_PROFILE_ID: process.env.PRESSCART_PROFILE_ID,
  MCP_HOST: process.env.MCP_HOST,
  // Railway injects PORT at runtime; keep MCP_PORT as an override for local/dev use.
  MCP_PORT: process.env.PORT ?? process.env.MCP_PORT,
  MCP_SERVER_URL: process.env.MCP_SERVER_URL,
  MCP_ALLOWED_HOSTS: process.env.MCP_ALLOWED_HOSTS,
  MCP_ALLOWED_ORIGINS: process.env.MCP_ALLOWED_ORIGINS,
  MCP_OAUTH_ENABLED: process.env.MCP_OAUTH_ENABLED,
  MCP_OAUTH_ISSUER_URL: process.env.MCP_OAUTH_ISSUER_URL,
  MCP_OAUTH_SIGNING_SECRET: process.env.MCP_OAUTH_SIGNING_SECRET,
});
