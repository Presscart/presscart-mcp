import { z } from 'zod';

const envSchema = z.object({
  PRESSCART_API_URL: z.string().url(),
  PRESSCART_API_TOKEN: z.string().min(1).optional(),
  PRESSCART_PROFILE_ID: z.string().uuid().optional(),
  MCP_HOST: z.string().default('0.0.0.0'),
  MCP_PORT: z.coerce.number().int().positive().default(8787),
});

export const env = envSchema.parse({
  PRESSCART_API_URL: process.env.PRESSCART_API_URL,
  PRESSCART_API_TOKEN: process.env.PRESSCART_API_TOKEN,
  PRESSCART_PROFILE_ID: process.env.PRESSCART_PROFILE_ID,
  MCP_HOST: process.env.MCP_HOST,
  MCP_PORT: process.env.MCP_PORT,
});
