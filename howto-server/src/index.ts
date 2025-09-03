import http from 'http';
import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import { ApolloServer } from '@apollo/server';
import { expressMiddleware } from '@apollo/server/express4';
import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { WebSocketServer } from 'ws';
import { useServer } from 'graphql-ws/lib/use/ws';
import { schema } from './schema';
import path from 'path';
import { config } from './config';
import { getUserFromAuthHeader, verifyToken } from './auth';

async function start() {
  const app = express();
  app.use(cors());
  app.use(bodyParser.json({ limit: '2mb' }));

  // Authenticated file serving from storage root
  app.get('/files', async (req, res) => {
    try {
      let auth = await getUserFromAuthHeader(req.headers.authorization || null);
      // Fallback: accept token via query param (for media tags)
      if (!auth && typeof req.query.token === 'string') {
        const payload = verifyToken(String(req.query.token));
        if (payload) {
          auth = { accountId: payload.accountId, user: { id: payload.sub } as any } as any;
        }
      }
      if (!auth?.accountId) return res.status(401).json({ error: 'Unauthorized' });
      const p = String(req.query.path || '');
      if (!p) return res.status(400).json({ error: 'Missing path' });
      const resolved = path.normalize(p);
      const root = path.normalize(config.storageRoot);
      // Must be within storage root and the caller's account directory
      if (!resolved.startsWith(root + path.sep)) return res.status(403).json({ error: 'Forbidden' });
      if (!resolved.includes(path.sep + auth.accountId + path.sep)) return res.status(403).json({ error: 'Forbidden' });
      res.set('Cache-Control', 'no-store');
      return res.sendFile(resolved);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(e);
      return res.status(500).json({ error: 'Failed to serve file' });
    }
  });

  const httpServer = http.createServer(app);

  // WebSocket server for GraphQL subscriptions
  const wsServer = new WebSocketServer({ server: httpServer, path: '/graphql' });
  const serverCleanup = useServer({ schema }, wsServer);

  const server = new ApolloServer({ 
    schema,
    plugins: [
      ApolloServerPluginDrainHttpServer({ httpServer }),
      {
        async serverWillStart() {
          return {
            async drainServer() {
              await serverCleanup.dispose();
            },
          } as any;
        },
      },
    ],
  });
  await server.start();
  app.use('/graphql', expressMiddleware(server, {
    context: async ({ req }) => {
      const auth = await getUserFromAuthHeader(req.headers.authorization || null);
      return { auth };
    },
  }));

  await new Promise<void>((resolve) => httpServer.listen({ port: config.port }, resolve));
  // eslint-disable-next-line no-console
  console.log(`🚀 GraphQL ready at http://localhost:${config.port}/graphql`);
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
