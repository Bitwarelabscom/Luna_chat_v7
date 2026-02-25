import path from 'path';
import { promises as fs } from 'fs';
import { createChatCompletion } from '../llm/openai.client.js';
import { getUserModelConfig } from '../llm/model-config.service.js';
import type { ProviderId } from '../llm/types.js';
import logger from '../utils/logger.js';

// Persist RPG saves in workspace because /app/workspace is mounted writable in docker-compose.
const SAVE_ROOT = path.join(process.cwd(), 'workspace', 'rpg_saves');
const MAX_STAT = 100;
const MIN_STAT = 0;

const STARTING_PLAYER = {
  name: 'Runner',
  health: 100,
  hunger: 20,
  power: 75,
  credits: 60,
  inventory: {
    nutrient_bar: 2,
    battery_cell: 1,
  },
};

interface ShopItem {
  label: string;
  price: number;
  sellPrice: number;
  effects: Partial<Record<'health' | 'hunger' | 'power' | 'credits', number>>;
  description: string;
}

const SHOP_ITEMS: Record<string, ShopItem> = {
  nutrient_bar: {
    label: 'Nutrient Bar',
    price: 10,
    sellPrice: 6,
    effects: { hunger: -25, health: 3 },
    description: 'Cheap meal. Lowers hunger quickly.',
  },
  battery_cell: {
    label: 'Battery Cell',
    price: 14,
    sellPrice: 8,
    effects: { power: 24 },
    description: 'Portable power charge.',
  },
  medkit: {
    label: 'Medkit',
    price: 22,
    sellPrice: 13,
    effects: { health: 30 },
    description: 'Emergency healing pack.',
  },
  clean_water: {
    label: 'Clean Water',
    price: 8,
    sellPrice: 4,
    effects: { hunger: -12, power: 4 },
    description: 'Hydrates and slightly recharges focus.',
  },
  stim_patch: {
    label: 'Stim Patch',
    price: 18,
    sellPrice: 11,
    effects: { power: 18, health: 6, hunger: 10 },
    description: 'Fast boost with hunger drawback.',
  },
};

const EXPLORE_LOOT_TABLE = ['nutrient_bar', 'battery_cell', 'clean_water', 'medkit'];

const ENEMY_ARCHETYPES = [
  {
    name: 'Scrap Raider',
    baseHp: 44,
    attackMin: 7,
    attackMax: 13,
    creditsReward: 14,
    reputationReward: 1,
    lootChance: 0.32,
    lootTable: ['nutrient_bar', 'clean_water'],
  },
  {
    name: 'Corp Drone',
    baseHp: 52,
    attackMin: 9,
    attackMax: 15,
    creditsReward: 20,
    reputationReward: 2,
    lootChance: 0.28,
    lootTable: ['battery_cell', 'stim_patch'],
  },
  {
    name: 'Tunnel Stalker',
    baseHp: 60,
    attackMin: 10,
    attackMax: 17,
    creditsReward: 24,
    reputationReward: 2,
    lootChance: 0.3,
    lootTable: ['medkit', 'battery_cell'],
  },
  {
    name: 'Grid Enforcer',
    baseHp: 70,
    attackMin: 12,
    attackMax: 20,
    creditsReward: 30,
    reputationReward: 3,
    lootChance: 0.35,
    lootTable: ['medkit', 'stim_patch', 'battery_cell'],
  },
];

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

export interface RpgGamePayload {
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

export interface RpgActionRequest {
  action: RpgActionType;
  detail?: string;
  npcName?: string;
  itemId?: string;
  quantity?: number;
  style?: 'attack' | 'overcharge' | 'defend' | 'flee';
}

export interface RpgActionResult {
  action: RpgActionType;
  summary: string;
  lines: string[];
  game: RpgGamePayload;
}

interface LoadedGameData {
  gameId: string;
  world: RpgWorld;
  characters: RpgCharacter[];
  state: RpgState;
  journal: string[];
}

interface ActionOutcome {
  delta: Partial<Record<'health' | 'hunger' | 'power' | 'credits', number>>;
  reputationDelta: number;
  itemFound: string;
  summary: string;
}

interface Enemy {
  name: string;
  hp: number;
  maxHp: number;
  attackMin: number;
  attackMax: number;
  creditsReward: number;
  reputationReward: number;
  lootChance: number;
  lootTable: string[];
}

interface CreateGameInput {
  saveName: string;
  coreIdea: string;
  playerName?: string;
  castSize?: number;
  perk?: number;
}

const FALLBACK_MODELS = {
  architect: { provider: 'ollama' as ProviderId, model: 'qwen2.5:7b' },
  character_forge: { provider: 'ollama' as ProviderId, model: 'qwen2.5:7b' },
  narrator: { provider: 'ollama' as ProviderId, model: 'llama3.2:3b' },
  adjudicator: { provider: 'ollama' as ProviderId, model: 'qwen2.5:7b' },
};

function clamp(value: number, low = MIN_STAT, high = MAX_STAT): number {
  return Math.max(low, Math.min(high, Math.round(value)));
}

function slugify(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || 'game';
}

function clampDelta(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Math.round(value)));
}

function sanitizeItemId(itemId: string): string {
  return SHOP_ITEMS[itemId] ? itemId : 'none';
}

function getUserRoot(userId: string): string {
  return path.join(SAVE_ROOT, userId);
}

function getGameRoot(userId: string, gameId: string): string {
  return path.join(getUserRoot(userId), slugify(gameId));
}

function stableSeed(text: string): number {
  let total = 0;
  for (let i = 0; i < text.length; i += 1) {
    total += (i + 1) * text.charCodeAt(i);
  }
  return total;
}

function makeSeededRng(seed: number): () => number {
  let state = seed % 2147483647;
  if (state <= 0) {
    state += 2147483646;
  }
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomChoice<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function ensureInventory(player: RpgPlayer): void {
  if (!player.inventory || typeof player.inventory !== 'object') {
    player.inventory = {};
  }
}

function inventorySummary(player: RpgPlayer): string {
  ensureInventory(player);
  const parts: string[] = [];
  for (const [itemId, qtyRaw] of Object.entries(player.inventory).sort((a, b) => a[0].localeCompare(b[0]))) {
    const qty = Number(qtyRaw);
    if (!Number.isFinite(qty) || qty <= 0) {
      continue;
    }
    const label = SHOP_ITEMS[itemId]?.label || itemId;
    parts.push(`${label} x${qty}`);
  }
  return parts.length ? parts.join(', ') : 'empty';
}

function applyPlayerDelta(player: RpgPlayer, delta: Partial<Record<'health' | 'hunger' | 'power' | 'credits', number>>): void {
  if (typeof delta.health === 'number') {
    player.health = clamp(player.health + delta.health);
  }
  if (typeof delta.hunger === 'number') {
    player.hunger = clamp(player.hunger + delta.hunger);
  }
  if (typeof delta.power === 'number') {
    player.power = clamp(player.power + delta.power);
  }
  if (typeof delta.credits === 'number') {
    player.credits = Math.max(0, Math.round(player.credits + delta.credits));
  }
}

function addItem(player: RpgPlayer, itemId: string, qty = 1): void {
  ensureInventory(player);
  if (!SHOP_ITEMS[itemId] || qty <= 0) {
    return;
  }
  player.inventory[itemId] = Math.max(0, Math.round(player.inventory[itemId] || 0) + qty);
}

function removeItem(player: RpgPlayer, itemId: string, qty = 1): boolean {
  ensureInventory(player);
  const current = Math.round(player.inventory[itemId] || 0);
  if (qty <= 0 || current < qty) {
    return false;
  }
  const next = current - qty;
  if (next <= 0) {
    delete player.inventory[itemId];
  } else {
    player.inventory[itemId] = next;
  }
  return true;
}

function useItem(player: RpgPlayer, itemId: string): { ok: boolean; message: string } {
  const item = SHOP_ITEMS[itemId];
  if (!item) {
    return { ok: false, message: 'Unknown item.' };
  }
  if (!removeItem(player, itemId, 1)) {
    return { ok: false, message: 'You do not have that item.' };
  }
  applyPlayerDelta(player, item.effects);
  return { ok: true, message: `Used ${item.label}.` };
}

function gameOverReason(player: RpgPlayer): string {
  if (player.health <= 0) {
    return 'Your health dropped to zero.';
  }
  return '';
}

function applyPassiveDecay(player: RpgPlayer): string[] {
  const notes: string[] = [];
  applyPlayerDelta(player, { hunger: 4, power: -2 });

  if (player.hunger >= 80) {
    const penalty = Math.max(2, Math.floor((player.hunger - 75) / 4));
    applyPlayerDelta(player, { health: -penalty });
    notes.push(`Starvation pressure: -${penalty} health.`);
  }

  if (player.power <= 12) {
    applyPlayerDelta(player, { health: -2 });
    notes.push('Low power strain: -2 health.');
  }

  return notes;
}

function resolveExplore(detail = ''): ActionOutcome {
  const effect: ActionOutcome['delta'] = { health: 0, hunger: 8, power: -10, credits: 0 };
  let itemFound = 'none';
  const roll = randomInt(1, 100);
  let summary = '';

  if (roll <= 35) {
    const gain = randomInt(8, 22);
    effect.credits = (effect.credits || 0) + gain;
    summary = `You scavenged a stash and found ${gain} credits.`;
  } else if (roll <= 60) {
    itemFound = randomChoice(EXPLORE_LOOT_TABLE);
    summary = `You uncovered useful supplies: ${SHOP_ITEMS[itemFound].label}.`;
  } else if (roll <= 82) {
    const damage = randomInt(6, 16);
    const bonus = randomInt(5, 12);
    effect.health = (effect.health || 0) - damage;
    effect.credits = (effect.credits || 0) + bonus;
    summary = `A risky encounter cost ${damage} health, but you escaped with ${bonus} credits.`;
  } else {
    effect.power = (effect.power || 0) + 7;
    summary = 'You mapped a safer route and recovered tactical momentum.';
  }

  if (detail.trim()) {
    summary = `${summary} Intent: ${detail.trim().slice(0, 80)}`;
  }

  return { delta: effect, reputationDelta: 0, itemFound, summary };
}

function resolveWork(player: RpgPlayer, detail = ''): ActionOutcome {
  const effect: ActionOutcome['delta'] = { health: 0, hunger: 10, power: -14, credits: 0 };
  let pay = randomInt(16, 30);

  if (player.power >= 70) {
    pay += 8;
  }
  if (player.power <= 25) {
    pay -= 6;
    effect.health = (effect.health || 0) - 4;
  }

  pay = Math.max(6, pay);
  effect.credits = (effect.credits || 0) + pay;

  let summary = `You took a contract and earned ${pay} credits.`;
  if (detail.trim()) {
    summary = `${summary} Job focus: ${detail.trim().slice(0, 80)}`;
  }

  return { delta: effect, reputationDelta: 0, itemFound: 'none', summary };
}

function resolveRest(detail = ''): ActionOutcome {
  const effect: ActionOutcome['delta'] = { health: 18, hunger: 9, power: 24, credits: 0 };
  let summary = 'You rested in a secure corner and reset your body.';
  if (detail.trim()) {
    summary = `${summary} You focused on: ${detail.trim().slice(0, 80)}`;
  }
  return { delta: effect, reputationDelta: 0, itemFound: 'none', summary };
}

function resolveTalk(npcName: string, detail = ''): ActionOutcome {
  const effect: ActionOutcome['delta'] = { health: 0, hunger: 4, power: -4, credits: 0 };
  const roll = randomInt(1, 100);
  let bonus = '';

  if (roll <= 40) {
    const credits = randomInt(4, 12);
    effect.credits = (effect.credits || 0) + credits;
    bonus = ` They slipped you ${credits} credits for a favor.`;
  } else if (roll <= 60) {
    effect.power = (effect.power || 0) + 6;
    bonus = ' You left the conversation with renewed focus.';
  }

  let summary = `You met ${npcName} and traded intel.${bonus}`;
  if (detail.trim()) {
    summary = `${summary} Topic: ${detail.trim().slice(0, 80)}`;
  }

  return { delta: effect, reputationDelta: 0, itemFound: 'none', summary };
}

function dynamicShopPrices(state: RpgState): Record<string, { buy: number; sell: number }> {
  const day = Math.max(1, Number(state.day || 1));
  const reputation = Number(state.reputation || 0);
  const location = String(state.location || 'unknown');

  const inflation = 1 + Math.min(0.35, (day - 1) * 0.015);
  const repBuyFactor = Math.max(0.85, Math.min(1.15, 1 - reputation * 0.01));
  const repSellFactor = Math.max(0.88, Math.min(1.18, 1 + reputation * 0.006));

  const prices: Record<string, { buy: number; sell: number }> = {};

  for (const [itemId, item] of Object.entries(SHOP_ITEMS)) {
    const baseBuy = item.price;
    const rng = makeSeededRng(stableSeed(`${day}:${location}:${reputation}:${itemId}`));
    const variance = 0.9 + rng() * 0.28;

    let scarcity = 1;
    if (itemId === 'medkit') {
      scarcity = 1.08;
    } else if (itemId === 'stim_patch') {
      scarcity = 1.05;
    }

    const buy = Math.max(1, Math.round(baseBuy * inflation * repBuyFactor * variance * scarcity));

    const sellVariance = 0.5 + rng() * 0.22;
    let sell = Math.max(1, Math.round(buy * sellVariance * repSellFactor));
    if (sell >= buy) {
      sell = Math.max(1, buy - 1);
    }

    prices[itemId] = { buy, sell };
  }

  return prices;
}

function generateEnemy(state: RpgState): Enemy {
  const day = Math.max(1, Number(state.day || 1));
  const tierBonus = Math.min(12, Math.floor((day - 1) / 2));
  const arch = randomChoice(ENEMY_ARCHETYPES);

  const hp = Math.round(arch.baseHp + (day - 1) * 3 + randomInt(0, 8));
  const attackMin = Math.round(arch.attackMin + Math.floor((day - 1) / 3));
  const attackMax = Math.round(arch.attackMax + tierBonus);

  return {
    name: arch.name,
    hp,
    maxHp: hp,
    attackMin,
    attackMax,
    creditsReward: Math.round(arch.creditsReward + (day - 1) * 2 + randomInt(0, 6)),
    reputationReward: Math.round(arch.reputationReward + (day >= 8 ? 1 : 0)),
    lootChance: arch.lootChance,
    lootTable: [...arch.lootTable],
  };
}

function rollPlayerAttack(player: RpgPlayer, style: 'attack' | 'overcharge'): { damage: number; deltas: ActionOutcome['delta']; note: string } {
  const base = randomInt(8, 14);
  const powerBonus = Math.floor(player.power / 16);
  const hungerPenalty = Math.max(0, Math.floor((player.hunger - 55) / 15));

  const deltas: ActionOutcome['delta'] = { power: -4, hunger: 2 };
  let note = 'You strike cleanly.';
  let value = base;

  if (style === 'overcharge') {
    value += randomInt(7, 14);
    deltas.power = -14;
    deltas.hunger = 4;
    note = 'You overcharge your gear for a brutal hit.';
    if (randomInt(1, 100) <= 18) {
      deltas.health = -4;
      note = 'Your overcharge lands hard but burns you for 4 health.';
    }
  }

  const damage = Math.max(2, value + powerBonus - hungerPenalty);
  return { damage, deltas, note };
}

function rollEnemyAttack(enemy: Enemy, defending: boolean): number {
  let damage = randomInt(enemy.attackMin, enemy.attackMax);
  if (defending) {
    damage = Math.max(1, Math.floor(damage / 2));
  }
  return damage;
}

function attemptFlee(player: RpgPlayer, enemy: Enemy): { success: boolean; message: string } {
  const chance = Math.max(
    15,
    Math.min(80, 45 + Math.floor(player.power / 5) - Math.floor(player.hunger / 6) - Math.floor(enemy.attackMax / 2))
  );
  const roll = randomInt(1, 100);
  if (roll <= chance) {
    return { success: true, message: `You escaped (${roll}/${chance}).` };
  }
  return { success: false, message: `Escape failed (${roll}/${chance}).` };
}

function combatDrop(enemy: Enemy): string {
  if (Math.random() > enemy.lootChance) {
    return 'none';
  }
  const valid = enemy.lootTable.filter((itemId) => Boolean(SHOP_ITEMS[itemId]));
  if (!valid.length) {
    return 'none';
  }
  return randomChoice(valid);
}

function suggestNextIntents(player: RpgPlayer): string[] {
  const suggestions: string[] = [];

  if (player.hunger >= 60) {
    suggestions.push('Prioritize food: buy or consume supplies before exploring again.');
  }
  if (player.power <= 35) {
    suggestions.push('Recover power now: rest or use a battery to avoid risky failures.');
  }
  if (player.credits <= 20) {
    suggestions.push('Take a paid gig to stabilize your credits for shop purchases.');
  }
  if (player.health <= 45) {
    suggestions.push('Play safe this turn: heal first, then push story progress.');
  }

  if (suggestions.length < 3) {
    suggestions.push('Talk to an NPC to gather leads and unlock a better next move.');
  }
  if (suggestions.length < 3) {
    suggestions.push('Explore with a concrete goal and watch resource costs closely.');
  }

  return suggestions.slice(0, 3);
}

function buildWorldBrief(world: RpgWorld): string {
  return [
    `Genre: ${world.genre || 'unknown'}`,
    `Time: ${world.setting?.time_period || 'unknown'}`,
    `Location: ${world.setting?.primary_location || 'unknown'}`,
    `Atmosphere: ${world.setting?.atmosphere || 'unknown'}`,
    `Tech: ${world.rules?.technology_level || 'unknown'}`,
    `Society: ${world.rules?.social_structures || 'unknown'}`,
    `Themes: ${(Array.isArray(world.themes) ? world.themes.join(', ') : 'none') || 'none'}`,
    `Tone: ${world.tone || 'unknown'}`,
  ].join('\n');
}

function parseJsonPayload<T>(raw: string): T | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const cleaned = trimmed
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/```json/gi, '```')
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .trim();

  const candidates: string[] = [cleaned];

  const fenced = cleaned.match(/```([\s\S]*?)```/g);
  if (fenced) {
    for (const block of fenced) {
      const body = block.replace(/```/g, '').trim();
      if (body) {
        candidates.push(body);
      }
    }
  }

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const value of candidates) {
    try {
      return JSON.parse(value) as T;
    } catch {
      // ignore
    }
    try {
      return JSON.parse(value.replace(/,\s*([}\]])/g, '$1')) as T;
    } catch {
      // ignore
    }
  }

  return null;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function ensureGameDirs(userId: string, gameId: string): Promise<string> {
  const root = getGameRoot(userId, gameId);
  await ensureDir(path.join(root, 'world'));
  await ensureDir(path.join(root, 'characters'));
  await ensureDir(path.join(root, 'logs'));
  return root;
}

async function readJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    return JSON.parse(content) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(filePath: string, payload: unknown): Promise<void> {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

async function appendJournalLine(gameRoot: string, line: string): Promise<void> {
  const logPath = path.join(gameRoot, 'logs', 'journal.md');
  await fs.appendFile(logPath, `${line.trim()}\n`, 'utf8');
}

async function readJournal(gameRoot: string): Promise<string[]> {
  const logPath = path.join(gameRoot, 'logs', 'journal.md');
  try {
    const raw = await fs.readFile(logPath, 'utf8');
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(-220);
  } catch {
    return [];
  }
}

async function saveCharacters(gameRoot: string, characters: RpgCharacter[]): Promise<void> {
  const charsDir = path.join(gameRoot, 'characters');
  await ensureDir(charsDir);

  const existing = await fs.readdir(charsDir).catch(() => []);
  await Promise.all(
    existing
      .filter((name) => name.endsWith('.json'))
      .map((name) => fs.unlink(path.join(charsDir, name)).catch(e => logger.debug('RPG save file cleanup failed', { err: (e as Error).message })))
  );

  await Promise.all(
    characters.map((character, idx) => {
      const name = slugify(character.name || `character_${idx + 1}`);
      return writeJson(path.join(charsDir, `${name}.json`), character);
    })
  );
}

async function loadCharacters(gameRoot: string): Promise<RpgCharacter[]> {
  const charsDir = path.join(gameRoot, 'characters');
  const files = (await fs.readdir(charsDir).catch(() => []))
    .filter((name) => name.endsWith('.json'))
    .sort((a, b) => a.localeCompare(b));

  const loaded = await Promise.all(files.map((name) => readJson<RpgCharacter | null>(path.join(charsDir, name), null)));
  return loaded.filter((value): value is RpgCharacter => Boolean(value));
}

async function saveGameData(userId: string, gameId: string, world: RpgWorld, characters: RpgCharacter[], state: RpgState): Promise<void> {
  const gameRoot = await ensureGameDirs(userId, gameId);
  await Promise.all([
    writeJson(path.join(gameRoot, 'world', 'world_state.json'), world),
    saveCharacters(gameRoot, characters),
    writeJson(path.join(gameRoot, 'game_state.json'), state),
  ]);
}

async function loadGameData(userId: string, rawGameId: string): Promise<LoadedGameData> {
  const gameId = slugify(rawGameId);
  const gameRoot = getGameRoot(userId, gameId);
  const [world, characters, state, journal] = await Promise.all([
    readJson<RpgWorld>(path.join(gameRoot, 'world', 'world_state.json'), {} as RpgWorld),
    loadCharacters(gameRoot),
    readJson<RpgState>(path.join(gameRoot, 'game_state.json'), {} as RpgState),
    readJournal(gameRoot),
  ]);

  if (!state || !state.game_id) {
    throw new Error('Game not found');
  }

  return { gameId, world, characters, state, journal };
}

async function getModelForTask(
  userId: string,
  taskType: string,
  fallback: { provider: ProviderId; model: string }
): Promise<{ provider: ProviderId; model: string }> {
  try {
    const config = await getUserModelConfig(userId, taskType);
    return {
      provider: config.provider,
      model: config.model,
    };
  } catch {
    return fallback;
  }
}

async function callJsonModel<T>(
  userId: string,
  taskType: string,
  fallback: { provider: ProviderId; model: string },
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 1400
): Promise<T | null> {
  const selected = await getModelForTask(userId, taskType, fallback);
  const options = [selected];
  if (selected.provider !== fallback.provider || selected.model !== fallback.model) {
    options.push(fallback);
  }

  for (const choice of options) {
    try {
      const response = await createChatCompletion({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        provider: choice.provider,
        model: choice.model,
        temperature: 0.25,
        maxTokens,
        response_format: { type: 'json_object' },
        loggingContext: {
          userId,
          source: 'rpg',
          nodeName: taskType,
        },
      });
      const parsed = parseJsonPayload<T>(response.content);
      if (parsed) {
        return parsed;
      }
    } catch (error) {
      logger.warn('RPG model JSON call failed', {
        taskType,
        provider: choice.provider,
        model: choice.model,
        error: (error as Error).message,
      });
    }
  }

  return null;
}

async function callNarrationModel(
  userId: string,
  actionName: string,
  detail: string,
  outcomeSummary: string,
  world: RpgWorld,
  player: RpgPlayer
): Promise<string> {
  const payload = await callJsonModel<{ text?: string }>(
    userId,
    'rpg_narrator',
    FALLBACK_MODELS.narrator,
    'You are an RPG narrator. Output ONLY valid JSON.',
    [
      `WORLD:\n${buildWorldBrief(world)}`,
      `PLAYER STATE:\n${JSON.stringify(player)}`,
      `ACTION: ${actionName}`,
      `DETAIL: ${detail || 'none'}`,
      `OUTCOME SUMMARY: ${outcomeSummary}`,
      'Write a vivid short scene in 2-4 sentences, max 80 words.',
      'Return JSON: {"text":"string"}',
    ].join('\n\n'),
    380
  );

  if (payload?.text && payload.text.trim()) {
    return payload.text.trim();
  }

  return `You ${actionName.toLowerCase()} and the city answers with friction: ${outcomeSummary.toLowerCase()}.`;
}

async function getWorldSuggestions(userId: string, coreIdea: string): Promise<{
  genre_options: string[];
  setting_options: string[];
  theme_options: string[];
  tone_options: string[];
}> {
  const fallback = {
    genre_options: ['cyberpunk', 'urban fantasy', 'post-collapse sci-fi'],
    setting_options: ['future city districts', 'floating city ruins', 'industrial moon colony'],
    theme_options: ['trust vs control', 'human + AI partnership', 'memory and identity'],
    tone_options: ['humorous', 'gritty', 'hopeful'],
  };

  if (!coreIdea.trim()) {
    return fallback;
  }

  const payload = await callJsonModel<{
    genre_options?: string[];
    setting_options?: string[];
    theme_options?: string[];
    tone_options?: string[];
  }>(
    userId,
    'rpg_architect',
    FALLBACK_MODELS.architect,
    'You are a game design assistant. Output ONLY valid JSON.',
    [
      `Player idea:\n${coreIdea}`,
      'Suggest concise world setup options for a text RPG.',
      'Return JSON with keys: genre_options, setting_options, theme_options, tone_options.',
      'Each key should contain 3 short strings.',
    ].join('\n\n'),
    420
  );

  if (!payload) {
    return fallback;
  }

  const normalize = (values: unknown, fallbackValues: string[]): string[] => {
    if (!Array.isArray(values)) {
      return fallbackValues;
    }
    const cleaned = values
      .map((v) => String(v || '').trim())
      .filter(Boolean);
    return cleaned.length ? cleaned.slice(0, 5) : fallbackValues;
  };

  return {
    genre_options: normalize(payload.genre_options, fallback.genre_options),
    setting_options: normalize(payload.setting_options, fallback.setting_options),
    theme_options: normalize(payload.theme_options, fallback.theme_options),
    tone_options: normalize(payload.tone_options, fallback.tone_options),
  };
}

async function generateWorldState(userId: string, visionPrompt: string): Promise<RpgWorld> {
  const payload = await callJsonModel<Partial<RpgWorld>>(
    userId,
    'rpg_architect',
    FALLBACK_MODELS.architect,
    'You are the World Architect for an RPG campaign. Output ONLY valid JSON.',
    [
      `Build a compact world state from this brief:\n${visionPrompt}`,
      'Return JSON with keys: genre, setting, rules, themes, tone.',
      'setting needs: time_period, primary_location, atmosphere.',
      'rules needs: magic_system, technology_level, social_structures.',
    ].join('\n\n'),
    650
  );

  return {
    genre: String(payload?.genre || 'cyberpunk'),
    setting: {
      time_period: String(payload?.setting?.time_period || 'near future'),
      primary_location: String(payload?.setting?.primary_location || 'Malmö'),
      atmosphere: String(payload?.setting?.atmosphere || 'neon-lit and unstable'),
    },
    rules: {
      magic_system: String(payload?.rules?.magic_system || 'none'),
      technology_level: String(payload?.rules?.technology_level || 'advanced AI and robotics'),
      social_structures: String(payload?.rules?.social_structures || 'class-divided city sectors'),
    },
    themes: Array.isArray(payload?.themes) && payload?.themes.length
      ? payload.themes.map((value) => String(value))
      : ['survival', 'human + AI trust'],
    tone: String(payload?.tone || 'humorous'),
  };
}

async function generateCharacters(
  userId: string,
  world: RpgWorld,
  castSize: number,
  guidance: string
): Promise<RpgCharacter[]> {
  const payload = await callJsonModel<{ characters?: Partial<RpgCharacter>[] }>(
    userId,
    'rpg_character_forge',
    FALLBACK_MODELS.character_forge,
    'You create compact RPG NPC casts. Output ONLY valid JSON.',
    [
      `WORLD:\n${buildWorldBrief(world)}`,
      `Cast size: ${castSize}`,
      `Guidance: ${guidance || 'none'}`,
      'Return JSON: {"characters":[...]}',
      `Exactly ${castSize} characters.`,
      'Each character must include: name, role, core_wound, wants, needs, voice_markers, contradiction.',
      'voice_markers must contain exactly 3 short strings.',
    ].join('\n\n'),
    1100
  );

  const incoming = Array.isArray(payload?.characters) ? payload.characters : [];
  const normalized: RpgCharacter[] = [];

  for (const [idx, raw] of incoming.slice(0, castSize).entries()) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }

    const voiceRaw = Array.isArray(raw.voice_markers) ? raw.voice_markers : [];

    const voice = voiceRaw
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .slice(0, 3);

    while (voice.length < 3) {
      voice.push('short reply');
    }

    normalized.push({
      name: String(raw.name || `NPC ${idx + 1}`).trim() || `NPC ${idx + 1}`,
      role: String(raw.role || 'survivor').trim(),
      core_wound: String(raw.core_wound || 'unknown').trim(),
      wants: String(raw.wants || 'stability').trim(),
      needs: String(raw.needs || 'allies').trim(),
      voice_markers: voice,
      contradiction: String(raw.contradiction || 'appears calm but fears collapse').trim(),
    });
  }

  while (normalized.length < castSize) {
    const i = normalized.length + 1;
    normalized.push({
      name: `NPC ${i}`,
      role: 'survivor',
      core_wound: 'unknown',
      wants: 'stability',
      needs: 'support',
      voice_markers: ['short', 'quiet', 'careful'],
      contradiction: 'looks calm but panics under pressure',
    });
  }

  return normalized;
}

async function adjudicateCustomAction(
  userId: string,
  world: RpgWorld,
  player: RpgPlayer,
  detail: string
): Promise<ActionOutcome> {
  const payload = await callJsonModel<{
    summary?: string;
    health_delta?: number;
    hunger_delta?: number;
    power_delta?: number;
    credits_delta?: number;
    reputation_delta?: number;
    item_found?: string;
  }>(
    userId,
    'rpg_adjudicator',
    FALLBACK_MODELS.adjudicator,
    'You are a strict RPG game master. Output ONLY valid JSON.',
    [
      `WORLD:\n${buildWorldBrief(world)}`,
      `PLAYER:\n${JSON.stringify(player)}`,
      `PLAYER ACTION:\n${detail}`,
      'Bound deltas: health [-18,18], hunger [-20,20], power [-20,20], credits [-30,30].',
      'reputation_delta bounds: [-4,4].',
      'item_found must be one of: nutrient_bar, battery_cell, medkit, clean_water, stim_patch, none.',
      'summary must be <= 30 words.',
    ].join('\n\n'),
    420
  );

  if (!payload) {
    return {
      summary: 'The move partially works; you gain information but spend effort.',
      delta: { health: 0, hunger: 6, power: -8, credits: 0 },
      reputationDelta: 0,
      itemFound: 'none',
    };
  }

  return {
    summary: String(payload.summary || 'Your action changes the situation.'),
    delta: {
      health: clampDelta(Number(payload.health_delta || 0), -18, 18),
      hunger: clampDelta(Number(payload.hunger_delta || 0), -20, 20),
      power: clampDelta(Number(payload.power_delta || 0), -20, 20),
      credits: clampDelta(Number(payload.credits_delta || 0), -30, 30),
    },
    reputationDelta: clampDelta(Number(payload.reputation_delta || 0), -4, 4),
    itemFound: sanitizeItemId(String(payload.item_found || 'none')),
  };
}

function createNewGameId(existing: Set<string>, raw: string): string {
  const base = slugify(raw);
  let current = base;
  let counter = 2;
  while (existing.has(current)) {
    current = `${base}_${counter}`;
    counter += 1;
  }
  return current;
}

async function buildPayload(data: LoadedGameData): Promise<RpgGamePayload> {
  return {
    gameId: data.gameId,
    world: data.world,
    characters: data.characters,
    state: data.state,
    suggestions: suggestNextIntents(data.state.player),
    inventorySummary: inventorySummary(data.state.player),
    shopPrices: dynamicShopPrices(data.state),
    journal: data.journal,
  };
}

export async function listGames(userId: string): Promise<RpgGameSummary[]> {
  const root = getUserRoot(userId);
  await ensureDir(root);

  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

  const summaries = await Promise.all(
    dirs.map(async (gameId) => {
      const state = await readJson<RpgState>(path.join(root, gameId, 'game_state.json'), {} as RpgState);
      const stat = await fs.stat(path.join(root, gameId, 'game_state.json')).catch(() => null);

      return {
        gameId,
        alive: Boolean(state.alive),
        day: Number(state.day || 1),
        turn: Number(state.turn || 1),
        location: String(state.location || 'unknown'),
        updatedAt: (stat?.mtime || new Date()).toISOString(),
      } as RpgGameSummary;
    })
  );

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createGame(userId: string, input: CreateGameInput): Promise<RpgGamePayload> {
  const root = getUserRoot(userId);
  await ensureDir(root);

  const existing = new Set(
    (await fs.readdir(root, { withFileTypes: true }).catch(() => []))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );

  const gameId = createNewGameId(existing, input.saveName || 'game');
  const gameRoot = await ensureGameDirs(userId, gameId);

  const suggestions = await getWorldSuggestions(userId, input.coreIdea);

  const genre = suggestions.genre_options[0] || 'cyberpunk';
  const setting = suggestions.setting_options[0] || 'future city';
  const tone = suggestions.tone_options[0] || 'humorous';
  const themes = suggestions.theme_options.length ? suggestions.theme_options : ['survival', 'trust'];

  const visionPrompt = [
    `Core idea: ${input.coreIdea}`,
    `Genre: ${genre}`,
    `Setting: ${setting}`,
    'Atmosphere: neon-lit and unstable',
    'Technology level: advanced AI and robotics',
    'Social structures: fragmented districts',
    `Tone: ${tone}`,
    `Themes: ${themes.join(', ')}`,
    'Magic system: none',
    'Must include: none',
    'Avoid: none',
  ].join('\n');

  const world = await generateWorldState(userId, visionPrompt);
  const castSize = Math.max(3, Math.min(8, Number(input.castSize || 4)));
  const guidance = `Core idea: ${input.coreIdea}\nProtagonist focus: resourceful survivor\nMust-have roles: hacker, fixer, enforcer\nRelationship focus: uneasy allies`;
  const characters = await generateCharacters(userId, world, castSize, guidance);

  const player: RpgPlayer = JSON.parse(JSON.stringify(STARTING_PLAYER)) as RpgPlayer;
  player.name = (input.playerName || '').trim() || player.name;

  const perk = Number(input.perk || 1);
  if (perk === 2) {
    player.credits += 30;
    addItem(player, 'nutrient_bar', 1);
  } else if (perk === 3) {
    player.health = Math.min(100, player.health + 20);
  } else if (perk === 4) {
    player.power = Math.min(100, player.power + 20);
    addItem(player, 'battery_cell', 1);
  }

  const state: RpgState = {
    game_id: gameId,
    turn: 1,
    day: 1,
    reputation: 0,
    alive: true,
    game_over_reason: '',
    location: world.setting.primary_location || 'unknown district',
    last_event: 'You just entered the city grid.',
    player,
  };

  await saveGameData(userId, gameId, world, characters, state);
  await appendJournalLine(gameRoot, `# Session start for ${gameId}`);
  await appendJournalLine(gameRoot, `- Day 1 Turn 1: New game created.`);

  const loaded = await loadGameData(userId, gameId);
  return buildPayload(loaded);
}

export async function loadGame(userId: string, gameId: string): Promise<RpgGamePayload> {
  const loaded = await loadGameData(userId, gameId);
  return buildPayload(loaded);
}

async function finalizeTurn(
  userId: string,
  loaded: LoadedGameData,
  actionKey: RpgActionType,
  actionLabel: string,
  summary: string,
  lines: string[]
): Promise<RpgActionResult> {
  const { state, gameId, world, characters } = loaded;
  const gameRoot = getGameRoot(userId, gameId);

  const decayNotes = applyPassiveDecay(state.player);
  for (const note of decayNotes) {
    lines.push(`Passive: ${note}`);
  }

  state.last_event = summary;
  await appendJournalLine(
    gameRoot,
    `- Day ${state.day} Turn ${state.turn}: ${actionLabel} | ${summary} | HP ${state.player.health} Hunger ${state.player.hunger} Power ${state.player.power} Credits ${state.player.credits} Rep ${state.reputation}`
  );

  state.turn += 1;
  if (state.turn % 6 === 0) {
    state.day += 1;
  }

  const reason = gameOverReason(state.player);
  if (reason) {
    state.alive = false;
    state.game_over_reason = reason;
    lines.push(`Permadeath triggered: ${reason}`);
  }

  await saveGameData(userId, gameId, world, characters, state);

  const updated = await loadGameData(userId, gameId);
  return {
    action: actionKey,
    summary,
    lines,
    game: await buildPayload(updated),
  };
}

async function applyOutcome(
  userId: string,
  loaded: LoadedGameData,
  actionKey: RpgActionType,
  actionLabel: string,
  detail: string,
  outcome: ActionOutcome
): Promise<RpgActionResult> {
  const { state } = loaded;
  applyPlayerDelta(state.player, outcome.delta);
  state.reputation += Number(outcome.reputationDelta || 0);

  const itemFound = sanitizeItemId(outcome.itemFound);
  if (itemFound !== 'none') {
    addItem(state.player, itemFound, 1);
    outcome.summary = `${outcome.summary} You also found ${SHOP_ITEMS[itemFound].label}.`;
  }

  const narration = await callNarrationModel(userId, actionLabel, detail, outcome.summary, loaded.world, state.player);
  const lines = [narration, `Outcome: ${outcome.summary}`];

  return finalizeTurn(userId, loaded, actionKey, actionLabel, outcome.summary, lines);
}

function resolveCombat(state: RpgState, style: 'attack' | 'overcharge' | 'defend' | 'flee'): {
  summary: string;
  lines: string[];
  reputationDelta: number;
} {
  const player = state.player;
  const enemy = generateEnemy(state);
  const lines: string[] = [`Encounter: ${enemy.name} (HP ${enemy.hp}).`];
  let reputationDelta = 0;

  if (style === 'flee') {
    applyPlayerDelta(player, { power: -5, hunger: 3 });
    const flee = attemptFlee(player, enemy);
    lines.push(flee.message);
    if (flee.success) {
      reputationDelta -= 1;
      return {
        summary: `You escaped from ${enemy.name}.`,
        lines,
        reputationDelta,
      };
    }

    const incoming = rollEnemyAttack(enemy, false);
    applyPlayerDelta(player, { health: -incoming });
    lines.push(`${enemy.name} hits you for ${incoming} damage.`);
    return {
      summary: `You failed to flee from ${enemy.name} and took ${incoming} damage.`,
      lines,
      reputationDelta,
    };
  }

  if (style === 'defend') {
    applyPlayerDelta(player, { power: -2, hunger: 2 });
    lines.push('You brace for impact.');
    const incoming = rollEnemyAttack(enemy, true);
    applyPlayerDelta(player, { health: -incoming });
    lines.push(`${enemy.name} hits you for ${incoming} damage.`);
    return {
      summary: `You defended against ${enemy.name} and took ${incoming} damage.`,
      lines,
      reputationDelta,
    };
  }

  const attack = rollPlayerAttack(player, style === 'overcharge' ? 'overcharge' : 'attack');
  applyPlayerDelta(player, attack.deltas);
  enemy.hp = Math.max(0, enemy.hp - attack.damage);
  lines.push(`You deal ${attack.damage} damage. ${attack.note}`);

  if (enemy.hp <= 0) {
    const credits = enemy.creditsReward;
    const repGain = enemy.reputationReward;
    applyPlayerDelta(player, { credits, power: -4, hunger: 5 });
    reputationDelta += repGain;

    const drop = combatDrop(enemy);
    if (drop !== 'none') {
      addItem(player, drop, 1);
      lines.push(`Looted ${SHOP_ITEMS[drop].label}.`);
    }

    return {
      summary: `You defeated ${enemy.name}, earned ${credits} credits, and gained ${repGain} reputation.`,
      lines,
      reputationDelta,
    };
  }

  const incoming = rollEnemyAttack(enemy, false);
  applyPlayerDelta(player, { health: -incoming });
  lines.push(`${enemy.name} hits you for ${incoming} damage.`);

  return {
    summary: `You wounded ${enemy.name} but took ${incoming} damage in return.`,
    lines,
    reputationDelta,
  };
}

export async function takeAction(userId: string, gameId: string, request: RpgActionRequest): Promise<RpgActionResult> {
  const loaded = await loadGameData(userId, gameId);
  const { state } = loaded;

  if (!state.alive || state.player.health <= 0) {
    throw new Error(`Save is in permadeath state: ${state.game_over_reason || 'Health reached zero'}`);
  }

  const detail = String(request.detail || '').trim();

  if (request.action === 'refresh_intents') {
    return {
      action: 'refresh_intents',
      summary: 'Refreshed suggestions.',
      lines: ['Intent suggestions refreshed.'],
      game: await buildPayload(loaded),
    };
  }

  if (request.action === 'use_item') {
    const itemId = sanitizeItemId(String(request.itemId || ''));
    if (itemId === 'none') {
      throw new Error('Invalid itemId.');
    }

    const result = useItem(state.player, itemId);
    await saveGameData(userId, loaded.gameId, loaded.world, loaded.characters, state);
    const game = await loadGame(userId, loaded.gameId);

    return {
      action: 'use_item',
      summary: result.message,
      lines: [result.message],
      game,
    };
  }

  if (request.action === 'shop_buy') {
    const itemId = sanitizeItemId(String(request.itemId || ''));
    const qty = Math.max(1, Number(request.quantity || 1));
    if (itemId === 'none') {
      throw new Error('Invalid itemId.');
    }

    const prices = dynamicShopPrices(state);
    const price = prices[itemId].buy * qty;
    if (state.player.credits < price) {
      throw new Error('Not enough credits.');
    }

    state.player.credits -= price;
    addItem(state.player, itemId, qty);
    await saveGameData(userId, loaded.gameId, loaded.world, loaded.characters, state);

    const game = await loadGame(userId, loaded.gameId);
    return {
      action: 'shop_buy',
      summary: `Bought ${qty}x ${SHOP_ITEMS[itemId].label} for ${price} credits.`,
      lines: [`Bought ${qty}x ${SHOP_ITEMS[itemId].label} for ${price} credits.`],
      game,
    };
  }

  if (request.action === 'shop_sell') {
    const itemId = sanitizeItemId(String(request.itemId || ''));
    const qty = Math.max(1, Number(request.quantity || 1));
    if (itemId === 'none') {
      throw new Error('Invalid itemId.');
    }

    if (!removeItem(state.player, itemId, qty)) {
      throw new Error('You do not own enough of that item.');
    }

    const prices = dynamicShopPrices(state);
    const earnings = prices[itemId].sell * qty;
    state.player.credits += earnings;
    await saveGameData(userId, loaded.gameId, loaded.world, loaded.characters, state);

    const game = await loadGame(userId, loaded.gameId);
    return {
      action: 'shop_sell',
      summary: `Sold ${qty}x ${SHOP_ITEMS[itemId].label} for ${earnings} credits.`,
      lines: [`Sold ${qty}x ${SHOP_ITEMS[itemId].label} for ${earnings} credits.`],
      game,
    };
  }

  if (request.action === 'explore') {
    return applyOutcome(userId, loaded, 'explore', 'Explore', detail, resolveExplore(detail));
  }

  if (request.action === 'work') {
    return applyOutcome(userId, loaded, 'work', 'Work gig', detail, resolveWork(state.player, detail));
  }

  if (request.action === 'rest') {
    return applyOutcome(userId, loaded, 'rest', 'Rest', detail, resolveRest(detail));
  }

  if (request.action === 'talk') {
    const npcName = (request.npcName || loaded.characters[0]?.name || 'Local contact').trim();
    return applyOutcome(userId, loaded, 'talk', `Talk with ${npcName}`, detail, resolveTalk(npcName, detail));
  }

  if (request.action === 'custom') {
    if (!detail) {
      throw new Error('Custom action detail is required.');
    }

    const outcome = await adjudicateCustomAction(userId, loaded.world, state.player, detail);
    return applyOutcome(userId, loaded, 'custom', 'Custom action', detail, outcome);
  }

  if (request.action === 'combat') {
    const style = request.style || 'attack';
    const combat = resolveCombat(state, style);
    state.reputation += combat.reputationDelta;

    const narration = await callNarrationModel(userId, 'Combat', detail, combat.summary, loaded.world, state.player);
    const lines = [narration, ...combat.lines, `Combat outcome: ${combat.summary}`];

    return finalizeTurn(userId, loaded, 'combat', 'Combat', combat.summary, lines);
  }

  throw new Error(`Unknown action: ${request.action}`);
}
