import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const adminStatePath = path.resolve(process.cwd(), '.mock-admin-state.json');

function readAdminState() {
  if (!fs.existsSync(adminStatePath)) {
    return { applications: null, eventOverrides: [] };
  }

  try {
    return JSON.parse(fs.readFileSync(adminStatePath, 'utf-8'));
  } catch {
    return { applications: null, eventOverrides: [] };
  }
}

function writeAdminState(nextState) {
  fs.writeFileSync(adminStatePath, JSON.stringify(nextState, null, 2));
}

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'time2meet-admin-state',
      configureServer(server) {
        server.middlewares.use('/api/admin-state', (request, response) => {
          response.setHeader('Content-Type', 'application/json');

          if (request.method === 'GET') {
            response.end(JSON.stringify(readAdminState()));
            return;
          }

          if (request.method !== 'POST') {
            response.statusCode = 405;
            response.end(JSON.stringify({ error: 'Method not allowed' }));
            return;
          }

          let body = '';
          request.on('data', (chunk) => {
            body += chunk;
          });
          request.on('end', () => {
            const currentState = readAdminState();
            try {
              const patch = JSON.parse(body);
              const nextState = { ...currentState, ...patch };
              writeAdminState(nextState);
              response.end(JSON.stringify(nextState));
            } catch {
              response.statusCode = 400;
              response.end(JSON.stringify({ error: 'Invalid JSON' }));
            }
          });
        });
      },
    },
  ],
});
