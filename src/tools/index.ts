import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ServerOptions } from '../utils/tool-context.js';
import { registerArticleTools } from './articles.js';
import { registerAuthTools } from './auth.js';
import { registerCampaignTools } from './campaigns.js';
import { registerCommentTools } from './comments.js';
import { registerFileTools } from './files.js';
import { registerOrderTools } from './orders.js';
import { registerProductTools } from './products.js';
import { registerQuestionnaireTools } from './questionnaires.js';
import { registerTeamTools } from './teams.js';

export function registerPresscartTools(server: McpServer, options: ServerOptions) {
  registerAuthTools(server, options);
  registerTeamTools(server, options);
  registerFileTools(server, options);
  registerProductTools(server, options);
  registerOrderTools(server, options);
  registerCampaignTools(server, options);
  registerCommentTools(server, options);
  registerQuestionnaireTools(server, options);
  registerArticleTools(server, options);
}
