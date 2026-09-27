import 'dotenv/config';
import { warcraftLogsService as service } from '../server/warcraftlogs-popularity.js';
import { releaseContexts } from './warcraftlogs-release.js';

// Cada contexto usa la cola existente y conserva las capturas que siguen vigentes.
try {
  for (const context of releaseContexts) {
    const input = { ...context, scope: 'context' };
    const plan = service.getSyncPlan(input);
    console.log(JSON.stringify({ context, plan }));

    if (plan.catalogRefreshRequired && !process.argv.includes('--plan')) {
      throw new Error('Primero descarga el catálogo con node scripts/sync-warcraftlogs.js --catalog.');
    }

    if (process.argv.includes('--plan') || !plan.willFetch) {
      continue;
    }

    const job = await service.startSync(input);
    const result = await service.waitForJob(job.id);
    console.log(JSON.stringify(result));

    if (result.status !== 'complete') {
      process.exitCode = 1;
      break;
    }
  }
} catch (error) {
  console.error(error.code || 'WCL_ERROR', error.message);
  process.exitCode = 1;
}
