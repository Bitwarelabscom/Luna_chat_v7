import logger from '../utils/logger.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export async function resolveArtifactIdForSession(
  canvasService: { getLatestArtifactIdForSession: (userId: string, sessionId: string) => Promise<string | null> },
  userId: string,
  sessionId: string,
  requestedArtifactId: unknown
): Promise<string | null> {
  if (isUuid(requestedArtifactId)) {
    return requestedArtifactId;
  }

  const fallbackArtifactId = await canvasService.getLatestArtifactIdForSession(userId, sessionId);
  if (fallbackArtifactId) {
    logger.warn('Resolved non-UUID artifact ID to latest session artifact', {
      requestedArtifactId,
      resolvedArtifactId: fallbackArtifactId,
      sessionId,
      userId,
    });
    return fallbackArtifactId;
  }

  logger.warn('Unable to resolve artifact ID for session', {
    requestedArtifactId,
    sessionId,
    userId,
  });
  return null;
}

export interface ArtifactToolChunk {
  type: 'reasoning' | 'canvas_artifact';
  content?: unknown;
  artifactId?: string;
  [key: string]: unknown;
}

export interface ArtifactToolResult {
  toolResponse: string;
  chunks: ArtifactToolChunk[];
}

/**
 * Handle a single artifact-related tool call.
 * Returns the tool response string + any streaming chunks (reasoning, canvas_artifact).
 * Non-streaming callers can ignore chunks.
 */
export async function handleArtifactToolCall(
  toolName: string,
  args: Record<string, unknown>,
  userId: string,
  sessionId: string,
  streaming: boolean
): Promise<ArtifactToolResult> {
  const canvasService = await import('../canvas/canvas.service.js');
  const chunks: ArtifactToolChunk[] = [];

  function emitReasoning(text: string): void {
    if (streaming) {
      chunks.push({ type: 'reasoning', content: text });
    }
  }

  function emitArtifact(artifactId: string, content: unknown): void {
    if (streaming) {
      chunks.push({ type: 'canvas_artifact', artifactId, content });
    }
  }

  switch (toolName) {
    case 'generate_artifact': {
      emitReasoning(`> Generating ${args.type} artifact: "${args.title}"\n`);
      logger.info('Generating artifact', { type: args.type, title: args.title, language: args.language });

      const result = await canvasService.generateArtifact(
        userId,
        sessionId,
        args.type as 'code' | 'text',
        args.title as string,
        args.content as string,
        args.language as string | undefined
      );

      emitArtifact(result.artifactId, result.content);
      return {
        toolResponse: `Artifact created: "${args.title}" (ID: ${result.artifactId})`,
        chunks,
      };
    }

    case 'rewrite_artifact': {
      emitReasoning(`> Updating artifact...\n`);
      logger.info('Rewriting artifact', { artifactId: args.artifactId });

      const artifactId = await resolveArtifactIdForSession(canvasService, userId, sessionId, args.artifactId);
      if (!artifactId) {
        throw new Error('No editable artifact found in this session');
      }
      const result = await canvasService.rewriteArtifact(
        userId,
        artifactId,
        args.title as string | undefined,
        args.content as string
      );

      emitArtifact(artifactId, result.content);
      return {
        toolResponse: `Artifact updated to version ${result.content.index}`,
        chunks,
      };
    }

    case 'update_highlighted': {
      emitReasoning(`> Updating selected text...\n`);
      logger.info('Updating highlighted text', { artifactId: args.artifactId, range: [args.startIndex, args.endIndex] });

      const artifactId = await resolveArtifactIdForSession(canvasService, userId, sessionId, args.artifactId);
      if (!artifactId) {
        throw new Error('No editable artifact found in this session');
      }
      const result = await canvasService.updateHighlighted(
        userId,
        artifactId,
        args.startIndex as number,
        args.endIndex as number,
        args.newContent as string
      );

      emitArtifact(artifactId, result.content);
      return {
        toolResponse: `Highlighted text updated, created version ${result.content.index}`,
        chunks,
      };
    }

    case 'save_artifact_file': {
      emitReasoning(`> Saving file ${args.path || ''}...\n`);
      logger.info('Saving artifact file', { artifactId: args.artifactId, path: args.path });

      const artifactId = await resolveArtifactIdForSession(canvasService, userId, sessionId, args.artifactId);
      if (!artifactId) {
        throw new Error('No editable artifact found in this session');
      }
      if (typeof args.path !== 'string' || typeof args.content !== 'string') {
        throw new Error('path and content are required');
      }

      const saved = await canvasService.saveArtifactFile(
        userId,
        artifactId,
        args.path,
        args.content,
        typeof args.language === 'string' ? args.language : undefined
      );

      if (streaming) {
        const version = await canvasService.getArtifactVersion(userId, artifactId, saved.versionIndex);
        emitArtifact(artifactId, version);
      }

      return {
        toolResponse: `Saved file "${args.path}" and created version ${saved.versionIndex}.`,
        chunks,
      };
    }

    case 'list_artifacts': {
      emitReasoning(`> Listing recent artifacts...\n`);
      logger.info('Listing artifacts', { requestedSessionId: args.sessionId, limit: args.limit });

      const artifacts = await canvasService.listArtifacts(userId, {
        sessionId: typeof args.sessionId === 'string' ? args.sessionId : sessionId,
        limit: typeof args.limit === 'number' ? args.limit : 15,
      });

      const listText = artifacts.length === 0
        ? 'No artifacts found.'
        : artifacts.map((a: any) => `- ${a.title} (id: ${a.id}, v${a.currentIndex}, ${a.type}${a.language ? `/${a.language}` : ''})`).join('\n');

      return {
        toolResponse: `Recent artifacts:\n${listText}`,
        chunks,
      };
    }

    case 'load_artifact': {
      emitReasoning(`> Loading artifact...\n`);
      logger.info('Loading artifact', { artifactId: args.artifactId, index: args.index });

      const artifactId = await resolveArtifactIdForSession(canvasService, userId, sessionId, args.artifactId);
      if (!artifactId) {
        throw new Error('No artifact found to load');
      }
      const artifact = await canvasService.getArtifact(userId, artifactId);
      const targetIndex = typeof args.index === 'number' ? args.index : artifact.currentIndex;
      const version = artifact.contents.find((c: any) => c.index === targetIndex);
      if (!version) {
        throw new Error(`Version ${targetIndex} not found`);
      }
      await canvasService.navigateToVersion(userId, artifactId, targetIndex);

      emitArtifact(artifactId, version);
      return {
        toolResponse: `Loaded artifact "${version.title}" (id: ${artifactId}) at version ${targetIndex}.`,
        chunks,
      };
    }

    case 'get_artifact_download_link': {
      emitReasoning(`> Preparing artifact download link...\n`);
      logger.info('Generating artifact download link', { artifactId: args.artifactId, index: args.index });

      const artifactId = await resolveArtifactIdForSession(canvasService, userId, sessionId, args.artifactId);
      if (!artifactId) {
        throw new Error('No artifact found to download');
      }
      const qs = typeof args.index === 'number' ? `?index=${args.index}` : '';
      const link = `/api/canvas/artifacts/${artifactId}/download${qs}`;

      return {
        toolResponse: `Download link: ${link}`,
        chunks,
      };
    }

    default:
      throw new Error(`Unknown artifact tool: ${toolName}`);
  }
}

const ARTIFACT_TOOL_NAMES = new Set([
  'generate_artifact',
  'rewrite_artifact',
  'update_highlighted',
  'save_artifact_file',
  'list_artifacts',
  'load_artifact',
  'get_artifact_download_link',
]);

export function isArtifactTool(toolName: string): boolean {
  return ARTIFACT_TOOL_NAMES.has(toolName);
}
