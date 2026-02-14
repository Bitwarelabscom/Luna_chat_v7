import IRC from 'irc-framework';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { logActivityAndBroadcast } from '../activity/activity.service.js';

export interface IRCSettings {
  server: string;
  port: number;
  nick: string;
  channels: string[];
  tls?: boolean;
}

/**
 * IRC Service handles Luna's connection to IRC
 */
export class IRCService {
  private client: any;
  private userId: string | null = null;
  private connected: boolean = false;
  private currentSettings: IRCSettings | null = null;

  constructor() {
    this.client = new IRC.Client();
    this.setupHandlers();
  }

  /**
   * Initialize and connect to IRC
   */
  public async connect(userId: string, settings?: IRCSettings): Promise<void> {
    this.userId = userId;
    this.currentSettings = settings || {
      server: config.irc.server,
      port: config.irc.port,
      nick: config.irc.nick,
      channels: config.irc.channels,
      tls: false,
    };
    
    if (this.connected) {
      logger.info('Already connected to IRC, disconnecting first...');
      this.client.quit();
    }

    logger.info('Connecting to IRC...', {
      server: this.currentSettings.server,
      port: this.currentSettings.port,
      nick: this.currentSettings.nick,
      tls: this.currentSettings.tls
    });

    try {
      this.client.connect({
        host: this.currentSettings.server,
        port: this.currentSettings.port,
        nick: this.currentSettings.nick,
        encoding: 'utf8',
        auto_reconnect: true,
        tls: this.currentSettings.tls || false,
        rejectUnauthorized: false, // Allow self-signed certs
      });
    } catch (error) {
      logger.error('IRC connect call failed', { error: (error as Error).message });
      throw error;
    }
  }

  /**
   * Disconnect from IRC
   */
  public disconnect(): void {
    if (this.connected) {
      this.client.quit();
      this.connected = false;
      logger.info('Disconnected from IRC');
    }
  }

  private setupHandlers(): void {
    this.client.on('registered', () => {
      this.connected = true;
      logger.info('Connected to IRC successfully');
      
      // Join default channels
      const channels = this.currentSettings?.channels || config.irc.channels;
      channels.forEach(channel => {
        logger.info(`Joining channel: ${channel}`);
        this.client.join(channel);
      });
    });

    this.client.on('close', () => {
      this.connected = false;
      logger.warn('IRC connection closed');
    });

    this.client.on('error', (err: any) => {
      logger.error('IRC Error', { error: err });
      if (this.userId) {
        logActivityAndBroadcast({
          userId: this.userId,
          category: 'irc',
          eventType: 'error',
          level: 'error',
          title: 'IRC Error',
          message: typeof err === 'string' ? err : err.message || 'Unknown IRC error',
          source: 'irc-service'
        }).catch(e => logger.error('Failed to log IRC error activity', { error: e.message }));
      }
    });

    this.client.on('socket close', () => {
      logger.warn('IRC socket closed');
    });

    this.client.on('socket error', (err: any) => {
      logger.error('IRC socket error', { error: err });
    });

    this.client.on('message', (event: any) => {
      this.handleIncomingMessage(event);
    });
  }

  private handleIncomingMessage(event: any): void {
    const { nick, target, message } = event;
    
    logger.debug('IRC Message received', { nick, target, message });

    if (!this.userId) return;

    // Log and Broadcast to UI
    logActivityAndBroadcast({
      userId: this.userId,
      category: 'irc',
      eventType: 'message',
      level: 'info',
      title: `IRC: ${target}`,
      message: `<${nick}> ${message}`,
      details: {
        nick,
        target,
        text: message
      },
      source: 'irc-service'
    }).catch(err => {
      logger.error('Failed to log IRC activity', { error: err.message });
    });
  }

  /**
   * Send a message to an IRC channel or user
   */
  public async sendMessage(target: string, message: string): Promise<void> {
    if (!this.connected) {
      throw new Error('IRC not connected');
    }

    logger.info(`Sending IRC message to ${target}`, { message });
    this.client.say(target, message);
    
    if (this.userId) {
      // Also log and broadcast our own message to the UI
      logActivityAndBroadcast({
        userId: this.userId,
        category: 'irc',
        eventType: 'message_sent',
        level: 'info',
        title: `IRC: ${target}`,
        message: `<${this.client.user.nick}> ${message}`,
        details: {
          nick: this.client.user.nick,
          target,
          text: message
        },
        source: 'irc-service'
      }).catch(err => {
        logger.error('Failed to log IRC activity', { error: err.message });
      });
    }
  }

  /**
   * Join a channel
   */
  public joinChannel(channel: string): void {
    if (this.connected) {
      this.client.join(channel);
      if (this.currentSettings && !this.currentSettings.channels.includes(channel)) {
        this.currentSettings.channels.push(channel);
      }
    }
  }

  /**
   * Leave a channel
   */
  public partChannel(channel: string): void {
    if (this.connected) {
      this.client.part(channel);
      if (this.currentSettings) {
        this.currentSettings.channels = this.currentSettings.channels.filter(c => c !== channel);
      }
    }
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public getStatus() {
    return {
      connected: this.connected,
      server: this.currentSettings?.server || config.irc.server,
      port: this.currentSettings?.port || config.irc.port,
      nick: this.connected ? this.client.user.nick : (this.currentSettings?.nick || config.irc.nick),
      channels: this.currentSettings?.channels || config.irc.channels,
      tls: this.currentSettings?.tls || false,
    };
  }
}

// Singleton instance
export const ircService = new IRCService();

/**
 * Format IRC activity for prompt
 */
export function formatIRCActivityForPrompt(messages: any[]): string {
  if (messages.length === 0) return '';
  
  return `[Recent IRC Messages]\n${messages.map(m => {
    const time = new Date(m.createdAt).toLocaleTimeString();
    return `[${time}] ${m.message}`;
  }).join('\n')}`;
}
