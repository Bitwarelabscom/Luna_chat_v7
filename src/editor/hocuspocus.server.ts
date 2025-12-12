import { Hocuspocus, onAuthenticatePayload, onLoadDocumentPayload, onStoreDocumentPayload, onConnectPayload, onDisconnectPayload } from '@hocuspocus/server';
import * as Y from 'yjs';
import { verifyToken } from '../auth/jwt.js';
import { query } from '../db/postgres.js';
import logger from '../utils/logger.js';

interface UserRow {
  id: string;
  display_name: string | null;
  email: string;
}

interface DocumentRow {
  content: Buffer | null;
}

/**
 * Hocuspocus server for Y.js collaborative editing
 */
export function createHocuspocusServer(): Hocuspocus {
  const server = new Hocuspocus({
    name: 'luna-editor',
    quiet: true,

    async onAuthenticate(data: onAuthenticatePayload): Promise<{ user: { id: string; name: string; color: string } }> {
      // Token passed via WebSocket query parameter or cookies
      let token = data.token;

      // If token is 'cookie-auth', extract from cookie header
      if (token === 'cookie-auth' || !token) {
        const cookieHeader = data.requestHeaders?.cookie;
        if (cookieHeader) {
          const cookies = cookieHeader.split(';').reduce((acc: Record<string, string>, cookie: string) => {
            const [name, value] = cookie.split('=').map((s: string) => s.trim());
            if (name && value) acc[name] = value;
            return acc;
          }, {});
          token = cookies['accessToken'];
        }
      }

      if (!token) {
        throw new Error('Authentication required');
      }

      try {
        const payload = verifyToken(token);
        const userId = payload.userId;

        // Get user info
        const users = await query<UserRow>(
          'SELECT id, display_name, email FROM users WHERE id = $1',
          [userId]
        );

        if (users.length === 0) {
          throw new Error('User not found');
        }

        const user = users[0];

        // Generate a consistent color based on user ID
        const colors = [
          '#00ff9f', '#ff6b6b', '#4ecdc4', '#45b7d1',
          '#96ceb4', '#ffeaa7', '#dfe6e9', '#fd79a8',
        ];
        const colorIndex = parseInt(userId.substring(0, 8), 16) % colors.length;

        logger.info('Editor authentication successful', { userId, documentName: data.documentName });

        return {
          user: {
            id: userId,
            name: user.display_name || user.email.split('@')[0],
            color: colors[colorIndex],
          },
        };
      } catch (error) {
        logger.error('Editor authentication failed', { error });
        throw new Error('Invalid authentication token');
      }
    },

    async onLoadDocument(data: onLoadDocumentPayload): Promise<void> {
      const documentName = data.documentName;

      try {
        // Load document from database
        const documents = await query<DocumentRow>(
          'SELECT content FROM editor_documents WHERE name = $1',
          [documentName]
        );

        if (documents.length > 0 && documents[0].content) {
          // Apply the stored Y.js state
          const state = documents[0].content;
          const uint8Array = new Uint8Array(state);
          Y.applyUpdate(data.document, uint8Array);
          logger.debug('Loaded document from database', { documentName });
        } else {
          logger.debug('Created new document', { documentName });
        }
      } catch (error) {
        logger.error('Failed to load document', { documentName, error });
        // Continue with empty document
      }
    },

    async onStoreDocument(data: onStoreDocumentPayload): Promise<void> {
      const documentName = data.documentName;
      const state = Buffer.from(Y.encodeStateAsUpdate(data.document));

      try {
        // Upsert document state
        await query(
          `INSERT INTO editor_documents (name, content, updated_at)
           VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT (name) DO UPDATE SET
             content = EXCLUDED.content,
             updated_at = CURRENT_TIMESTAMP`,
          [documentName, state]
        );
        logger.debug('Stored document', { documentName, size: state.length });
      } catch (error) {
        logger.error('Failed to store document', { documentName, error });
      }
    },

    async onConnect(data: onConnectPayload): Promise<void> {
      logger.debug('Client connected to document', { documentName: data.documentName });
    },

    async onDisconnect(data: onDisconnectPayload): Promise<void> {
      logger.debug('Client disconnected from document', { documentName: data.documentName });
    },
  });

  return server;
}

// Singleton instance
let hocuspocusServer: Hocuspocus | null = null;

export function getHocuspocusServer(): Hocuspocus {
  if (!hocuspocusServer) {
    hocuspocusServer = createHocuspocusServer();
  }
  return hocuspocusServer;
}

export function shutdownHocuspocusServer(): void {
  if (hocuspocusServer) {
    hocuspocusServer.destroy();
    hocuspocusServer = null;
    logger.info('Hocuspocus server shutdown');
  }
}

export default {
  createHocuspocusServer,
  getHocuspocusServer,
  shutdownHocuspocusServer,
};
