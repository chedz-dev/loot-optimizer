import { Router } from 'express';
import { warcraftLogsService } from './warcraftlogs-popularity.js';

export function createWarcraftLogsRouter(service = warcraftLogsService) {
  const router = Router();
  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store');
    const isLoopback = (host) => ['localhost', '127.0.0.1', '::1', '[::1]', '::ffff:127.0.0.1'].includes(host);
    if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: 'Warcraft Logs está disponible solo en el servidor local.', code: 'LOCAL_ONLY' });
    const origin = req.get('origin');
    if (origin) {
      try {
        const url = new URL(origin);
        if (!isLoopback(url.hostname) || !['http:', 'https:'].includes(url.protocol)) throw new Error('Origin');
      } catch { return res.status(403).json({ error: 'Origen no permitido.', code: 'LOCAL_ONLY' }); }
    }
    next();
  });
  const handle = (operation, status = 200) => async (req, res) => {
    try { return res.status(status).json(await operation(req)); }
    catch (error) {
      return res.status(error.status || 502).json({ error: error.code ? error.message : 'No se pudo completar la consulta de Warcraft Logs.', code: error.code || 'UPSTREAM_ERROR' });
    }
  };
  router.get('/catalog', handle(() => service.getCatalog()));
  router.post('/catalog/refresh', handle((req) => service.refreshCatalog(req.body)));
  router.get('/cache', handle(() => service.getCacheStatus()));
  router.get('/popularity', handle((req) => service.getPopularity(req.query)));
  router.get('/items', handle((req) => service.getItems(req.query)));
  router.get('/item', handle((req) => service.getItemPopularity(req.query)));
  router.post('/sync', handle((req) => service.startSync(req.body), 202));
  router.get('/sync/plan', handle((req) => service.getSyncPlan(req.query)));
  router.post('/sync/resume', handle((req) => service.resumeSync(req.body.id), 202));
  router.post('/sync/:id/resume', handle((req) => service.resumeSync(req.params.id), 202));
  router.post('/rebuild', handle(() => service.rebuild(), 202));
  router.get('/sync', handle((req) => service.getJob(req.query.id)));
  return router;
}
