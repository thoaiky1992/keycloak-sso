import { createApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
createApp(config).listen(config.port, '127.0.0.1', () => {
  console.log(`Backend listening at http://localhost:${config.port}`);
});
