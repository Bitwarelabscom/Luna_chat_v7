import { IncomingMessage } from 'http';
import WebSocket from 'ws';
import { Duplex } from 'stream';
import { getHocuspocusServer } from './hocuspocus.server.js';
import logger from '../utils/logger.js';

// Create a WebSocket server for editor connections
const editorWss = new WebSocket.Server({ noServer: true });

/**
 * Handle editor WebSocket upgrade request
 * Upgrades the connection and passes to Hocuspocus
 */
export function handleEditorWsUpgrade(
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer
): void {
  editorWss.handleUpgrade(request, socket, head, (ws) => {
    const server = getHocuspocusServer();
    server.handleConnection(ws, request);
    logger.debug('Editor WebSocket connection established');
  });
}

export default {
  handleEditorWsUpgrade,
};
