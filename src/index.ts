import { logger, type IAgentRuntime, type Project, type ProjectAgent } from '@elizaos/core';
import { character } from './character';
import sqlPlugin from '@elizaos/plugin-sql';
import bootstrapPlugin from './plugins/plugin-bootstrap/src/index.ts';
import openaiPlugin from '@elizaos/plugin-openai';
import anthropicPlugin from '@elizaos/plugin-anthropic';
import cdpPlugin from './plugins/plugin-cdp/index.ts';
import coingeckoPlugin from './plugins/plugin-coingecko/src/index.ts';

const initCharacter = ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing character');
  logger.info({ name: character.name }, 'Character loaded:');
};

export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => await initCharacter({ runtime }),
  // Import actual plugin modules instead of using string names
  plugins: [sqlPlugin, bootstrapPlugin, anthropicPlugin, openaiPlugin, cdpPlugin, coingeckoPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

export { character } from './character';

export default project;

