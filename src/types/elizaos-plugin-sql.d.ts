declare module '@elizaos/plugin-sql' {
  import type { Plugin, IAgentRuntime, DatabaseAdapter } from '@elizaos/core';
  
  export interface DatabaseAdapterOptions {
    dataDir?: string;
    postgresUrl?: string;
  }
  
  export function createDatabaseAdapter(options: DatabaseAdapterOptions, agentId: string): DatabaseAdapter;
  
  export class DatabaseMigrationService {
    static start(runtime: IAgentRuntime): Promise<DatabaseMigrationService>;
    initializeWithDatabase(db: unknown): Promise<void>;
    discoverAndRegisterPluginSchemas(plugins: Plugin[]): void;
    runAllPluginMigrations(): Promise<void>;
  }
  
  const sqlPlugin: Plugin;
  export default sqlPlugin;
}
