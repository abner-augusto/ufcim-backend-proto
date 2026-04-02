import { createApp } from './app';
import { authMiddleware } from './middleware/auth';

const app = createApp({ authMiddleware });

export default app;
