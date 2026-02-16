import { api } from './core';

// Abilities API
export const abilitiesApi = {
  // IRC
  getIRCStatus: () =>
    api<{ connected: boolean; server: string; port: number; nick: string; channels: string[]; tls: boolean }>('/api/abilities/irc/status'),

  connectIRC: (settings: { server: string; port: number; nick: string; channels: string[]; tls: boolean }) =>
    api<{ success: boolean }>('/api/abilities/irc/connect', { method: 'POST', body: settings }),

  disconnectIRC: () =>
    api<{ success: boolean }>('/api/abilities/irc/disconnect', { method: 'POST' }),

  sendIRCMessage: (target: string, message: string) =>
    api<{ success: boolean }>('/api/abilities/irc/send', { method: 'POST', body: { target, message } }),

  joinIRCChannel: (channel: string) =>
    api<{ success: boolean }>('/api/abilities/irc/join', { method: 'POST', body: { channel } }),

  leaveIRCChannel: (channel: string) =>
    api<{ success: boolean }>('/api/abilities/irc/leave', { method: 'POST', body: { channel } }),
};
