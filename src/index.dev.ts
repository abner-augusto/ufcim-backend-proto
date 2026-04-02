import { createApp } from './app';
import { devAuthMiddleware } from './middleware/auth-dev';
import { devRoutes } from './routes/dev';

const app = createApp({
  authMiddleware: devAuthMiddleware,
  devRoutes,
});

export default app;
