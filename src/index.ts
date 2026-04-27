import { createApp } from './app';
import { localAuthMiddleware } from './middleware/auth-local';

const app = createApp({ authMiddleware: localAuthMiddleware });

export default app;
