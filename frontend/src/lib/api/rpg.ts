import { api } from './core';

export interface RpgCharacter {
  name: string;
  role: string;
  core_wound: string;
  wants: string;
  needs: string;
  voice_markers: string[];
  contradiction: string;
}

export interface RpgWorld {
  genre: string;
  setting: {
    time_period: string;
    primary_location: string;
    atmosphere: string;
  };
  rules: {
    magic_system: string;
    technology_level: string;
    social_structures: string;
  };
  themes: string[];
  tone: string;
}

export interface RpgPlayer {
  name: string;
  health: number;
  hunger: number;
  power: number;
  credits: number;
  inventory: Record<string, number>;
}

export interface RpgState {
  game_id: string;
  turn: number;
  day: number;
  reputation: number;
  alive: boolean;
  game_over_reason: string;
  location: string;
  last_event: string;
  player: RpgPlayer;
}

export interface RpgGame {
  gameId: string;
  world: RpgWorld;
  characters: RpgCharacter[];
  state: RpgState;
  suggestions: string[];
  inventorySummary: string;
  shopPrices: Record<string, { buy: number; sell: number }>;
  journal: string[];
}

export interface RpgGameSummary {
  gameId: string;
  alive: boolean;
  day: number;
  turn: number;
  location: string;
  updatedAt: string;
}

export type RpgActionType =
  | 'refresh_intents'
  | 'explore'
  | 'work'
  | 'rest'
  | 'talk'
  | 'combat'
  | 'custom'
  | 'use_item'
  | 'shop_buy'
  | 'shop_sell';

export interface RpgActionResult {
  action: RpgActionType;
  summary: string;
  lines: string[];
  game: RpgGame;
}

export const rpgApi = {
  listGames: () => api<{ games: RpgGameSummary[] }>('/api/rpg/games'),

  createGame: (data: {
    saveName: string;
    coreIdea: string;
    playerName?: string;
    castSize?: number;
    perk?: number;
  }) => api<{ game: RpgGame }>('/api/rpg/games', { method: 'POST', body: data }),

  loadGame: (gameId: string) =>
    api<{ game: RpgGame }>(`/api/rpg/games/${encodeURIComponent(gameId)}`),

  action: (
    gameId: string,
    payload: {
      action: RpgActionType;
      detail?: string;
      npcName?: string;
      itemId?: string;
      quantity?: number;
      style?: 'attack' | 'overcharge' | 'defend' | 'flee';
    }
  ) => api<RpgActionResult>(`/api/rpg/games/${encodeURIComponent(gameId)}/actions`, {
    method: 'POST',
    body: payload,
  }),
};
