'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, Plus, Briefcase, Bed, MessageSquare, Shield, Sparkles } from 'lucide-react';
import { rpgApi, type RpgActionType, type RpgGame, type RpgGameSummary } from '@/lib/api';

const ITEM_LABELS: Record<string, string> = {
  nutrient_bar: 'Nutrient Bar',
  battery_cell: 'Battery Cell',
  medkit: 'Medkit',
  clean_water: 'Clean Water',
  stim_patch: 'Stim Patch',
};

function labelForItem(itemId: string): string {
  return ITEM_LABELS[itemId] || itemId.replace(/_/g, ' ');
}

function safeErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: string }).message);
  }
  return 'Request failed';
}

export default function RpgWindow() {
  const [games, setGames] = useState<RpgGameSummary[]>([]);
  const [activeGame, setActiveGame] = useState<RpgGame | null>(null);

  const [saveName, setSaveName] = useState('neon_run');
  const [coreIdea, setCoreIdea] = useState('A scavenger crew survives in a collapsing neon megacity run by unstable AI districts.');
  const [playerName, setPlayerName] = useState('Runner');
  const [castSize, setCastSize] = useState(4);
  const [perk, setPerk] = useState(1);

  const [actionDetail, setActionDetail] = useState('');
  const [talkNpc, setTalkNpc] = useState('');
  const [combatStyle, setCombatStyle] = useState<'attack' | 'overcharge' | 'defend' | 'flee'>('attack');
  const [shopQty, setShopQty] = useState(1);

  const [isLoading, setIsLoading] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [isActing, setIsActing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void refreshGames();
  }, []);

  useEffect(() => {
    if (activeGame?.characters?.length && !talkNpc) {
      setTalkNpc(activeGame.characters[0].name);
    }
  }, [activeGame, talkNpc]);

  useEffect(() => {
    if (!logRef.current) {
      return;
    }
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activeGame?.journal?.length]);

  const inventoryEntries = useMemo(() => {
    if (!activeGame) {
      return [] as Array<[string, number]>;
    }
    return Object.entries(activeGame.state.player.inventory || {})
      .map(([itemId, qty]) => [itemId, Number(qty)] as [string, number])
      .filter(([, qty]) => qty > 0)
      .sort((a, b) => a[0].localeCompare(b[0]));
  }, [activeGame]);

  async function refreshGames() {
    setIsLoading(true);
    setError(null);
    try {
      const result = await rpgApi.listGames();
      setGames(result.games || []);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }

  async function handleLoad(gameId: string) {
    setError(null);
    setSuccess(null);
    setIsRefreshing(true);
    try {
      const result = await rpgApi.loadGame(gameId);
      setActiveGame(result.game);
      setActionDetail(result.game.suggestions[0] || '');
      setSuccess(`Loaded ${result.game.gameId}`);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handleCreate() {
    if (!saveName.trim() || !coreIdea.trim()) {
      setError('Save name and core idea are required.');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsCreating(true);

    try {
      const result = await rpgApi.createGame({
        saveName: saveName.trim(),
        coreIdea: coreIdea.trim(),
        playerName: playerName.trim() || undefined,
        castSize,
        perk,
      });
      setActiveGame(result.game);
      setActionDetail(result.game.suggestions[0] || '');
      setSuccess(`Created ${result.game.gameId}`);
      const list = await rpgApi.listGames();
      setGames(list.games || []);
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setIsCreating(false);
    }
  }

  async function runAction(action: RpgActionType, extras: Record<string, unknown> = {}) {
    if (!activeGame) {
      setError('Load or create a game first.');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsActing(true);

    try {
      const result = await rpgApi.action(activeGame.gameId, {
        action,
        detail: actionDetail,
        ...extras,
      });

      setActiveGame(result.game);
      if (result.game.suggestions.length > 0 && (!actionDetail.trim() || action === 'refresh_intents')) {
        setActionDetail(result.game.suggestions[0]);
      }
      setSuccess(result.summary || `${action} completed.`);

      if (action !== 'refresh_intents') {
        const list = await rpgApi.listGames();
        setGames(list.games || []);
      }
    } catch (err) {
      setError(safeErrorMessage(err));
    } finally {
      setIsActing(false);
    }
  }

  const player = activeGame?.state.player;
  const dead = activeGame ? (!activeGame.state.alive || activeGame.state.player.health <= 0) : false;

  return (
    <div className="h-full flex" style={{ background: 'var(--theme-bg-primary)' }}>
      <aside
        className="w-80 shrink-0 border-r p-4 space-y-4 overflow-y-auto"
        style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)' }}
      >
        <div>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--theme-text-primary)' }}>RPG Forge</h2>
          <p className="text-xs mt-1" style={{ color: 'var(--theme-text-muted)' }}>
            Native Luna window for AI-driven RPG sessions.
          </p>
        </div>

        {error && (
          <div className="p-2 rounded border text-xs" style={{ borderColor: '#b91c1c', color: '#fca5a5', background: 'rgba(185,28,28,0.12)' }}>
            {error}
          </div>
        )}

        {success && (
          <div className="p-2 rounded border text-xs" style={{ borderColor: '#166534', color: '#86efac', background: 'rgba(22,101,52,0.12)' }}>
            {success}
          </div>
        )}

        <section className="space-y-2">
          <h3 className="text-xs uppercase tracking-wide" style={{ color: 'var(--theme-text-muted)' }}>New Game</h3>
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Save name"
            className="w-full px-2 py-1.5 rounded text-sm border bg-transparent"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
          />
          <textarea
            value={coreIdea}
            onChange={(e) => setCoreIdea(e.target.value)}
            placeholder="Core idea"
            rows={4}
            className="w-full px-2 py-1.5 rounded text-sm border bg-transparent resize-y"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
          />
          <input
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Player name"
            className="w-full px-2 py-1.5 rounded text-sm border bg-transparent"
            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              Cast Size
              <input
                type="number"
                min={3}
                max={8}
                value={castSize}
                onChange={(e) => setCastSize(Math.max(3, Math.min(8, Number(e.target.value) || 4)))}
                className="mt-1 w-full px-2 py-1.5 rounded text-sm border bg-transparent"
                style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
              />
            </label>
            <label className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
              Perk
              <select
                value={perk}
                onChange={(e) => setPerk(Number(e.target.value) || 1)}
                className="mt-1 w-full px-2 py-1.5 rounded text-sm border bg-transparent"
                style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
              >
                <option value={1}>Balanced</option>
                <option value={2}>Scavenger</option>
                <option value={3}>Fighter</option>
                <option value={4}>Techie</option>
              </select>
            </label>
          </div>

          <button
            onClick={handleCreate}
            disabled={isCreating}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded text-sm font-medium"
            style={{ background: 'var(--theme-accent-primary)', color: '#fff', opacity: isCreating ? 0.7 : 1 }}
          >
            {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Game
          </button>
        </section>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide" style={{ color: 'var(--theme-text-muted)' }}>Saves</h3>
            <button
              onClick={() => void refreshGames()}
              disabled={isLoading}
              className="p-1 rounded hover:bg-white/5"
              title="Refresh saves"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} style={{ color: 'var(--theme-text-secondary)' }} />
            </button>
          </div>

          <div className="space-y-1 max-h-56 overflow-y-auto pr-1">
            {games.map((game) => (
              <button
                key={game.gameId}
                onClick={() => void handleLoad(game.gameId)}
                disabled={isRefreshing}
                className="w-full text-left px-2 py-1.5 rounded border text-xs"
                style={{
                  borderColor: activeGame?.gameId === game.gameId ? 'var(--theme-accent-primary)' : 'var(--theme-border)',
                  color: 'var(--theme-text-primary)',
                  background: activeGame?.gameId === game.gameId ? 'rgba(255,255,255,0.06)' : 'transparent',
                }}
              >
                <div className="font-medium">{game.gameId}</div>
                <div style={{ color: 'var(--theme-text-muted)' }}>
                  Day {game.day} Turn {game.turn} | {game.location}
                </div>
              </button>
            ))}
            {!games.length && !isLoading && (
              <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                No saves yet.
              </div>
            )}
          </div>
        </section>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        {!activeGame && (
          <div className="h-full flex items-center justify-center text-sm" style={{ color: 'var(--theme-text-muted)' }}>
            Create or load an RPG save to begin.
          </div>
        )}

        {activeGame && player && (
          <>
            <div className="p-3 border-b" style={{ borderColor: 'var(--theme-border)' }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <div className="font-medium text-sm" style={{ color: 'var(--theme-text-primary)' }}>
                    {activeGame.gameId} {dead ? '(Permadeath)' : ''}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>
                    Day {activeGame.state.day} | Turn {activeGame.state.turn} | {activeGame.state.location}
                  </div>
                </div>
                <div className="text-xs" style={{ color: 'var(--theme-text-secondary)' }}>
                  Credits {player.credits} | Reputation {activeGame.state.reputation}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                {[
                  { label: 'Health', value: player.health },
                  { label: 'Hunger', value: player.hunger },
                  { label: 'Power', value: player.power },
                ].map((stat) => (
                  <div key={stat.label}>
                    <div className="flex justify-between mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                      <span>{stat.label}</span>
                      <span>{stat.value}/100</span>
                    </div>
                    <div className="h-2 rounded" style={{ background: 'var(--theme-bg-tertiary)' }}>
                      <div
                        className="h-2 rounded"
                        style={{ width: `${Math.max(0, Math.min(100, stat.value))}%`, background: 'var(--theme-accent-primary)' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex-1 grid grid-cols-[360px_1fr] min-h-0">
              <div className="border-r p-3 space-y-3 overflow-y-auto" style={{ borderColor: 'var(--theme-border)' }}>
                <div>
                  <h4 className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                    Suggested Intents
                  </h4>
                  <div className="space-y-1">
                    {activeGame.suggestions.map((suggestion, index) => (
                      <button
                        key={`${suggestion}-${index}`}
                        onClick={() => setActionDetail(suggestion)}
                        className="w-full text-left px-2 py-1.5 rounded text-xs border"
                        style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-secondary)' }}
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                    Action Detail
                  </h4>
                  <textarea
                    value={actionDetail}
                    onChange={(e) => setActionDetail(e.target.value)}
                    rows={3}
                    className="w-full px-2 py-1.5 rounded text-sm border bg-transparent resize-y"
                    style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => void runAction('refresh_intents')}
                      disabled={isActing || dead}
                      className="px-2 py-1 rounded text-xs border"
                      style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-secondary)' }}
                    >
                      Refresh Intents
                    </button>
                    <select
                      value={talkNpc}
                      onChange={(e) => setTalkNpc(e.target.value)}
                      className="flex-1 px-2 py-1 rounded text-xs border bg-transparent"
                      style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                    >
                      {activeGame.characters.map((character) => (
                        <option key={character.name} value={character.name}>{character.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => void runAction('explore')}
                    disabled={isActing || dead}
                    className="px-2 py-2 rounded text-xs border flex items-center justify-center gap-1"
                    style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Explore
                  </button>
                  <button
                    onClick={() => void runAction('work')}
                    disabled={isActing || dead}
                    className="px-2 py-2 rounded text-xs border flex items-center justify-center gap-1"
                    style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                  >
                    <Briefcase className="w-3.5 h-3.5" /> Work
                  </button>
                  <button
                    onClick={() => void runAction('rest')}
                    disabled={isActing || dead}
                    className="px-2 py-2 rounded text-xs border flex items-center justify-center gap-1"
                    style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                  >
                    <Bed className="w-3.5 h-3.5" /> Rest
                  </button>
                  <button
                    onClick={() => void runAction('talk', { npcName: talkNpc })}
                    disabled={isActing || dead}
                    className="px-2 py-2 rounded text-xs border flex items-center justify-center gap-1"
                    style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Talk
                  </button>
                  <button
                    onClick={() => void runAction('custom')}
                    disabled={isActing || dead}
                    className="px-2 py-2 rounded text-xs border flex items-center justify-center gap-1"
                    style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                  >
                    <Sparkles className="w-3.5 h-3.5" /> Custom
                  </button>
                  <div className="flex gap-1">
                    <select
                      value={combatStyle}
                      onChange={(e) => setCombatStyle(e.target.value as 'attack' | 'overcharge' | 'defend' | 'flee')}
                      className="flex-1 px-2 py-2 rounded text-xs border bg-transparent"
                      style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                    >
                      <option value="attack">Attack</option>
                      <option value="overcharge">Overcharge</option>
                      <option value="defend">Defend</option>
                      <option value="flee">Flee</option>
                    </select>
                    <button
                      onClick={() => void runAction('combat', { style: combatStyle })}
                      disabled={isActing || dead}
                      className="px-2 py-2 rounded text-xs border flex items-center justify-center"
                      style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                      title="Combat"
                    >
                      <Shield className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs uppercase tracking-wide mb-1" style={{ color: 'var(--theme-text-muted)' }}>
                    Inventory
                  </h4>
                  <div className="space-y-1">
                    {inventoryEntries.map(([itemId, qty]) => (
                      <div
                        key={itemId}
                        className="flex items-center justify-between px-2 py-1 rounded border text-xs"
                        style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-secondary)' }}
                      >
                        <span>{labelForItem(itemId)} x{qty}</span>
                        <button
                          onClick={() => void runAction('use_item', { itemId })}
                          disabled={isActing || dead}
                          className="px-2 py-0.5 rounded border"
                          style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                        >
                          Use
                        </button>
                      </div>
                    ))}
                    {!inventoryEntries.length && (
                      <div className="text-xs" style={{ color: 'var(--theme-text-muted)' }}>Inventory empty.</div>
                    )}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-xs uppercase tracking-wide" style={{ color: 'var(--theme-text-muted)' }}>
                      Shop
                    </h4>
                    <input
                      type="number"
                      min={1}
                      max={99}
                      value={shopQty}
                      onChange={(e) => setShopQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
                      className="w-16 px-1 py-0.5 rounded text-xs border bg-transparent"
                      style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                    />
                  </div>
                  <div className="space-y-1">
                    {Object.entries(activeGame.shopPrices).map(([itemId, price]) => (
                      <div
                        key={itemId}
                        className="px-2 py-1 rounded border text-xs"
                        style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-secondary)' }}
                      >
                        <div className="flex justify-between">
                          <span>{labelForItem(itemId)}</span>
                          <span>B {price.buy} / S {price.sell}</span>
                        </div>
                        <div className="flex gap-1 mt-1">
                          <button
                            onClick={() => void runAction('shop_buy', { itemId, quantity: shopQty })}
                            disabled={isActing || dead}
                            className="flex-1 px-1 py-0.5 rounded border"
                            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                          >
                            Buy
                          </button>
                          <button
                            onClick={() => void runAction('shop_sell', { itemId, quantity: shopQty })}
                            disabled={isActing || dead}
                            className="flex-1 px-1 py-0.5 rounded border"
                            style={{ borderColor: 'var(--theme-border)', color: 'var(--theme-text-primary)' }}
                          >
                            Sell
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="p-3 min-h-0 flex flex-col">
                <div className="text-xs mb-2" style={{ color: 'var(--theme-text-muted)' }}>
                  {activeGame.world.genre} | {activeGame.world.setting.primary_location} | {activeGame.world.tone}
                </div>
                <div
                  ref={logRef}
                  className="flex-1 rounded border p-2 overflow-y-auto font-mono text-xs whitespace-pre-wrap"
                  style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)', color: 'var(--theme-text-secondary)' }}
                >
                  {activeGame.journal.length ? activeGame.journal.join('\n') : 'No journal entries yet.'}
                </div>
              </div>
            </div>

            {isActing && (
              <div
                className="absolute bottom-4 right-4 px-3 py-2 rounded border text-xs flex items-center gap-2"
                style={{ borderColor: 'var(--theme-border)', background: 'var(--theme-bg-secondary)', color: 'var(--theme-text-primary)' }}
              >
                <Loader2 className="w-4 h-4 animate-spin" />
                Processing action...
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
