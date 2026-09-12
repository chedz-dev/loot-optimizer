import 'dotenv/config';
import { warcraftLogsService } from '../server/warcraftlogs-popularity.js';

const options = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
try {
  if ('status' in options) {
    console.log(JSON.stringify(warcraftLogsService.getCacheStatus(), null, 2));
  } else if ('catalog' in options) {
    console.log(JSON.stringify(await warcraftLogsService.refreshCatalog({ force: options.mode === 'force' }), null, 2));
  } else if ('plan' in options) {
    console.log(JSON.stringify(warcraftLogsService.getSyncPlan(options), null, 2));
  } else {
    const job = 'rebuild' in options ? await warcraftLogsService.rebuild()
      : options.resume ? await warcraftLogsService.resumeSync(options.resume)
        : await warcraftLogsService.startSync(options);
    console.log(`Warcraft Logs: ${job.kind}, ${job.scope}, ${job.mode}, ${job.total} capturas`);
    const current = await warcraftLogsService.waitForJob(job.id);
    console.log(JSON.stringify(current, null, 2));
    if (current.status !== 'complete') process.exitCode = 1;
  }
} catch (error) {
  console.error(error.code || 'WCL_ERROR', error.message);
  process.exitCode = 1;
}
