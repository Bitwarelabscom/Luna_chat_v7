import { pool } from '../db/index.js';
import logger from '../utils/logger.js';
import * as triggerService from '../triggers/trigger.service.js';
import * as newsfetcherService from '../autonomous/newsfetcher.service.js';
import * as n8nService from '../abilities/n8n.service.js';

export type CeoMode = 'pre_revenue' | 'normal';
export type CeoAlertSeverity = 'P1' | 'P2' | 'P3';
export type AutopostChannel = 'x' | 'linkedin' | 'telegram' | 'blog' | 'reddit';

export interface CeoConfig {
  userId: string;
  mode: CeoMode;
  timezone: string;
  noBuildDaysThreshold: number;
  noExperimentDaysThreshold: number;
  burnSpikeRatio: number;
  burnSpikeAbsoluteUsd: number;
  unexpectedNewVendorUsd: number;
  unexpectedVendorMultiplier: number;
  dailyMorningTime: string;
  dailyEveningTime: string;
  weeklyReportWeekday: number;
  weeklyReportTime: string;
  biweeklyAuditWeekday: number;
  biweeklyAuditTime: string;
  competitors: string[];
  autopostPriority: string[];
  autopostEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateCeoConfigInput {
  mode?: CeoMode;
  timezone?: string;
  noBuildDaysThreshold?: number;
  noExperimentDaysThreshold?: number;
  burnSpikeRatio?: number;
  burnSpikeAbsoluteUsd?: number;
  unexpectedNewVendorUsd?: number;
  unexpectedVendorMultiplier?: number;
  dailyMorningTime?: string;
  dailyEveningTime?: string;
  weeklyReportWeekday?: number;
  weeklyReportTime?: string;
  biweeklyAuditWeekday?: number;
  biweeklyAuditTime?: string;
  competitors?: string[];
  autopostPriority?: string[];
  autopostEnabled?: boolean;
}

export interface FinanceLogInput {
  date?: string;
  vendor: string;
  amountUsd: number;
  category?: string;
  cadence?: string;
  notes?: string;
  source?: string;
}

export interface BuildLogInput {
  projectKey: string;
  hours: number;
  item?: string;
  stage?: string;
  impact?: string;
  occurredAt?: string;
  source?: string;
}

export interface ExperimentLogInput {
  date?: string;
  channel: string;
  name: string;
  costUsd?: number;
  leads?: number;
  outcome?: string;
  status?: string;
  notes?: string;
  source?: string;
}

export interface LeadLogInput {
  date?: string;
  source: string;
  status?: string;
  valueEstimateUsd?: number;
  notes?: string;
}

export interface ProjectSnapshotInput {
  projectKey: string;
  stage?: string;
  revenuePotentialUsd?: number;
  estimatedHours?: number;
  strategicLeverage?: number;
  winProbability?: number;
  dependencyRisk?: number;
  confidenceScore?: number;
  notes?: string;
}

export interface CeoMonitoringRunResult {
  usersProcessed: number;
  dailyRuns: number;
  weeklyRuns: number;
  biweeklyRuns: number;
  alertsQueued: number;
}

export interface AutopostWorkerResult {
  attempted: number;
  posted: number;
  failed: number;
}

export interface CommandResult {
  handled: boolean;
  response?: string;
}

export interface CeoDashboard {
  config: CeoConfig;
  financial: {
    periodDays: number;
    expenseTotalUsd: number;
    incomeTotalUsd: number;
    burnNetUsd: number;
    projected30dBurnUsd: number;
  };
  activity: {
    buildHours: number;
    experiments: number;
    leads: number;
    lastBuildAt: Date | null;
    lastExperimentDate: string | null;
  };
  projectRankings: Array<{
    projectKey: string;
    stage: string;
    opportunityScore: number;
    riskScore: number;
    revenuePotentialUsd: number;
    estimatedHours: number;
    lastBuildAt: Date | null;
  }>;
  channelPerformance: Array<{
    channel: string;
    runs: number;
    leads: number;
    costUsd: number;
    costPerLeadUsd: number | null;
    score: number;
  }>;
  alerts: Array<{
    id: string;
    severity: CeoAlertSeverity;
    title: string;
    status: string;
    createdAt: Date;
  }>;
  autopostQueue: Array<{
    id: string;
    channel: string;
    status: string;
    scheduledAt: Date | null;
    createdAt: Date;
  }>;
}

interface CeoConfigRow {
  user_id: string;
  mode: CeoMode;
  timezone: string;
  no_build_days_threshold: number;
  no_experiment_days_threshold: number;
  burn_spike_ratio: string;
  burn_spike_absolute_usd: string;
  unexpected_new_vendor_usd: string;
  unexpected_vendor_multiplier: string;
  daily_morning_time: string;
  daily_evening_time: string;
  weekly_report_weekday: number;
  weekly_report_time: string;
  biweekly_audit_weekday: number;
  biweekly_audit_time: string;
  competitors: unknown;
  autopost_priority: unknown;
  autopost_enabled: boolean;
  created_at: Date;
  updated_at: Date;
}

interface TimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
  isoDate: string;
}

interface PendingAlert {
  severity: CeoAlertSeverity;
  alertType: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

interface WeeklyBuildTotalsRow {
  project_key: string;
  hours: string;
  last_build_at: Date;
}

const DEFAULT_COMPETITORS = [
  'openai',
  'anthropic',
  'google',
  'perplexity',
  'meta ai',
];

const DEFAULT_AUTOPOST_CHANNELS: Array<{
  channel: AutopostChannel;
  isEnabled: boolean;
  postingMode: 'auto' | 'approval';
}> = [
  { channel: 'x', isEnabled: true, postingMode: 'approval' },
  { channel: 'linkedin', isEnabled: true, postingMode: 'approval' },
  { channel: 'telegram', isEnabled: true, postingMode: 'approval' },
  { channel: 'blog', isEnabled: false, postingMode: 'approval' },
  { channel: 'reddit', isEnabled: false, postingMode: 'approval' },
];

const RADAR_KEYWORDS = [
  'openai',
  'anthropic',
  'google',
  'gemini',
  'claude',
  'chatgpt',
  'api',
  'pricing',
  'price',
  'policy',
  'terms',
  'monetization',
  'subscription',
  'assistant',
  'automation',
  'agent',
  'competitor',
];

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  return fallback;
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter((item) => item.length > 0);
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter((item) => item.length > 0);
      }
    } catch {
      return [];
    }
  }

  return [];
}

function normalizeTimeString(value: string): string {
  if (!value) return '00:00';
  const parts = value.split(':');
  const hour = Math.max(0, Math.min(23, parseInt(parts[0] || '0', 10) || 0));
  const minute = Math.max(0, Math.min(59, parseInt(parts[1] || '0', 10) || 0));
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
}

function normalizeCadence(value?: string): string {
  if (!value) return 'one_time';
  const normalized = value.trim().toLowerCase();
  if (['daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'one_time'].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'once' || normalized === 'onetime' || normalized === 'one-time') {
    return 'one_time';
  }
  return 'one_time';
}

function normalizeOutcome(value?: string): string {
  if (!value) return 'pending';
  const normalized = value.trim().toLowerCase();
  if (['pending', 'win', 'loss', 'mixed'].includes(normalized)) {
    return normalized;
  }
  return 'pending';
}

function normalizeExperimentStatus(value?: string): string {
  if (!value) return 'completed';
  const normalized = value.trim().toLowerCase();
  if (['planned', 'running', 'completed'].includes(normalized)) {
    return normalized;
  }
  if (normalized === 'pending') return 'running';
  return 'completed';
}

function normalizeLeadStatus(value?: string): string {
  if (!value) return 'new';
  const normalized = value.trim().toLowerCase();
  if (['new', 'contacted', 'qualified', 'won', 'lost'].includes(normalized)) {
    return normalized;
  }
  return 'new';
}

function normalizeImpact(value?: string): string {
  if (!value) return 'medium';
  const normalized = value.trim().toLowerCase();
  if (['low', 'medium', 'high'].includes(normalized)) {
    return normalized;
  }
  return 'medium';
}

function normalizeBuildStage(value?: string): string {
  if (!value) return 'building';
  const normalized = value.trim().toLowerCase();
  if (['planning', 'build', 'building', 'blocked', 'review', 'paused', 'done'].includes(normalized)) {
    return normalized;
  }
  return 'building';
}

function normalizeProjectStage(value?: string): string {
  if (!value) return 'build';
  const normalized = value.trim().toLowerCase();
  if (['idea', 'planning', 'build', 'blocked', 'distribution', 'monetizing', 'done'].includes(normalized)) {
    return normalized;
  }
  return 'build';
}

function normalizeTimezone(value?: string): string {
  if (!value) return 'Europe/Stockholm';
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return value;
  } catch {
    return 'Europe/Stockholm';
  }
}

function parseDateInput(value: string | undefined, fallbackIsoDate: string): string {
  if (!value) return fallbackIsoDate;
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  return fallbackIsoDate;
}

function formatMoney(value: number): string {
  return `$${value.toFixed(2)}`;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function daysBetween(startIsoDate: string, endIsoDate: string): number {
  const start = new Date(`${startIsoDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endIsoDate}T00:00:00.000Z`).getTime();
  return Math.floor((end - start) / (24 * 60 * 60 * 1000));
}

function isoWeekNumber(isoDate: string): number {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  const dayNumber = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - dayNumber + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
  return 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

function getLocalTimeParts(timeZone: string, date = new Date()): TimeParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    weekday: 'short',
  });

  const parts = formatter.formatToParts(date);
  const map = new Map(parts.map((part) => [part.type, part.value]));

  const weekdayLabel = map.get('weekday') || 'Sun';
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  const year = parseInt(map.get('year') || '1970', 10);
  const month = parseInt(map.get('month') || '1', 10);
  const day = parseInt(map.get('day') || '1', 10);
  const hour = parseInt(map.get('hour') || '0', 10);
  const minute = parseInt(map.get('minute') || '0', 10);

  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday: weekdayMap[weekdayLabel] ?? 0,
    isoDate: `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`,
  };
}

function isSameLocalTime(parts: TimeParts, hhmm: string): boolean {
  const normalized = normalizeTimeString(hhmm);
  const [hourText, minuteText] = normalized.split(':');
  const expectedHour = parseInt(hourText, 10);
  const expectedMinute = parseInt(minuteText, 10);
  return parts.hour === expectedHour && parts.minute === expectedMinute;
}

function isBusinessHours(parts: TimeParts): boolean {
  return parts.hour >= 8 && parts.hour < 20;
}

function splitKeyValueTokens(tokens: string[]): { values: Record<string, string>; freeTokens: string[] } {
  const values: Record<string, string> = {};
  const freeTokens: string[] = [];

  for (const token of tokens) {
    const match = token.match(/^([a-zA-Z_]+)=(.+)$/);
    if (match) {
      values[match[1].toLowerCase()] = match[2];
    } else {
      freeTokens.push(token);
    }
  }

  return { values, freeTokens };
}

function inferChannelFromName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized.startsWith('x_') || normalized.startsWith('x-') || normalized === 'x') return 'x';
  if (normalized.startsWith('linkedin')) return 'linkedin';
  if (normalized.startsWith('telegram')) return 'telegram';
  if (normalized.startsWith('blog')) return 'blog';
  if (normalized.startsWith('reddit')) return 'reddit';
  return 'x';
}

function mapConfigRow(row: CeoConfigRow): CeoConfig {
  return {
    userId: row.user_id,
    mode: row.mode,
    timezone: row.timezone,
    noBuildDaysThreshold: row.no_build_days_threshold,
    noExperimentDaysThreshold: row.no_experiment_days_threshold,
    burnSpikeRatio: asNumber(row.burn_spike_ratio, 1.3),
    burnSpikeAbsoluteUsd: asNumber(row.burn_spike_absolute_usd, 150),
    unexpectedNewVendorUsd: asNumber(row.unexpected_new_vendor_usd, 100),
    unexpectedVendorMultiplier: asNumber(row.unexpected_vendor_multiplier, 2),
    dailyMorningTime: normalizeTimeString(row.daily_morning_time),
    dailyEveningTime: normalizeTimeString(row.daily_evening_time),
    weeklyReportWeekday: row.weekly_report_weekday,
    weeklyReportTime: normalizeTimeString(row.weekly_report_time),
    biweeklyAuditWeekday: row.biweekly_audit_weekday,
    biweeklyAuditTime: normalizeTimeString(row.biweekly_audit_time),
    competitors: asStringArray(row.competitors),
    autopostPriority: asStringArray(row.autopost_priority),
    autopostEnabled: row.autopost_enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ensureDefaultAutopostChannels(userId: string): Promise<void> {
  for (const channel of DEFAULT_AUTOPOST_CHANNELS) {
    await pool.query(
      `INSERT INTO ceo_autopost_channels (user_id, channel, is_enabled, posting_mode)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, channel) DO NOTHING`,
      [userId, channel.channel, channel.isEnabled, channel.postingMode]
    );
  }
}

async function getDeliveryMethod(userId: string): Promise<'chat' | 'push' | 'sse' | 'telegram'> {
  const prefs = await triggerService.getNotificationPreferences(userId);
  if (prefs.enableTelegram) return 'telegram';
  if (prefs.enablePushNotifications) return 'push';
  return 'chat';
}

async function createReport(
  userId: string,
  reportType: 'daily' | 'weekly' | 'biweekly',
  periodStart: string,
  periodEnd: string,
  headline: string,
  body: string,
  data: Record<string, unknown>,
  deliveredVia: string,
  deliveredAt: Date | null
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO ceo_reports
     (user_id, report_type, period_start, period_end, headline, body, data, delivered_via, delivered_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [userId, reportType, periodStart, periodEnd, headline, body, JSON.stringify(data), deliveredVia, deliveredAt]
  );

  return result.rows[0].id as string;
}

export async function enqueueCeoMessage(
  userId: string,
  triggerType: string,
  message: string,
  priority: number
): Promise<void> {
  const deliveryMethod = await getDeliveryMethod(userId);
  await triggerService.enqueueTrigger({
    userId,
    triggerSource: 'event',
    triggerType,
    payload: { source: 'ceo_monitoring' },
    message,
    deliveryMethod,
    priority,
  });
}

async function shouldSuppressDuplicateAlert(userId: string, alertType: string, severity: CeoAlertSeverity): Promise<boolean> {
  if (severity === 'P1') {
    return false;
  }

  const result = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM ceo_alerts
     WHERE user_id = $1
       AND alert_type = $2
       AND created_at > NOW() - INTERVAL '36 hours'
       AND status IN ('new', 'sent', 'suppressed')`,
    [userId, alertType]
  );

  return (result.rows[0]?.count || 0) > 0;
}

async function queueAlert(
  userId: string,
  localTime: TimeParts,
  alert: PendingAlert
): Promise<{ queued: boolean; sent: boolean }> {
  const suppressDuplicate = await shouldSuppressDuplicateAlert(userId, alert.alertType, alert.severity);
  if (suppressDuplicate) {
    return { queued: false, sent: false };
  }

  const shouldSendNow = alert.severity === 'P1' || (alert.severity === 'P2' && isBusinessHours(localTime));
  const status = shouldSendNow ? 'sent' : 'suppressed';
  const sentAt = shouldSendNow ? new Date() : null;

  await pool.query(
    `INSERT INTO ceo_alerts (user_id, severity, alert_type, title, message, payload, status, sent_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      userId,
      alert.severity,
      alert.alertType,
      alert.title,
      alert.message,
      JSON.stringify(alert.payload || {}),
      status,
      sentAt,
    ]
  );

  if (shouldSendNow) {
    const priority = alert.severity === 'P1' ? 10 : alert.severity === 'P2' ? 7 : 4;
    await enqueueCeoMessage(
      userId,
      `ceo_alert_${alert.alertType}`,
      `[CEO Luna ${alert.severity}] ${alert.title}\n\n${alert.message}`,
      priority
    );
  }

  return { queued: true, sent: shouldSendNow };
}

async function flushSuppressedAlerts(userId: string, localTime: TimeParts): Promise<number> {
  if (!isBusinessHours(localTime)) {
    return 0;
  }

  const result = await pool.query(
    `SELECT id, severity, title, message
     FROM ceo_alerts
     WHERE user_id = $1
       AND status = 'suppressed'
       AND created_at > NOW() - INTERVAL '3 days'
     ORDER BY created_at ASC
     LIMIT 8`,
    [userId]
  );

  if (result.rows.length === 0) {
    return 0;
  }

  const lines = result.rows.map((row: Record<string, unknown>, index: number) => {
    const severity = String(row.severity);
    const title = String(row.title);
    const message = String(row.message);
    return `${index + 1}. [${severity}] ${title} - ${message}`;
  });

  await enqueueCeoMessage(
    userId,
    'ceo_alert_digest',
    `CEO Luna queued alerts:\n\n${lines.join('\n')}`,
    6
  );

  const ids = result.rows.map((row: Record<string, unknown>) => row.id as string);
  await pool.query(
    `UPDATE ceo_alerts
     SET status = 'sent', sent_at = NOW()
     WHERE id = ANY($1)`,
    [ids]
  );

  return ids.length;
}

async function claimRunSlot(userId: string, jobKey: string, slotKey: string): Promise<boolean> {
  const result = await pool.query(
    `INSERT INTO ceo_job_state (user_id, job_key, last_run_slot, last_run_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, job_key)
     DO UPDATE SET last_run_slot = EXCLUDED.last_run_slot, last_run_at = NOW()
     WHERE ceo_job_state.last_run_slot IS DISTINCT FROM EXCLUDED.last_run_slot
     RETURNING user_id`,
    [userId, jobKey, slotKey]
  );

  return (result.rowCount || 0) > 0;
}

async function computeFinancialWindow(
  userId: string,
  endDateIso: string,
  windowDays: number
): Promise<{
  expenseTotalUsd: number;
  incomeTotalUsd: number;
  perDayExpense: Map<string, number>;
  perDayIncome: Map<string, number>;
}> {
  const startDateIso = addDays(endDateIso, -(windowDays - 1));

  const result = await pool.query(
    `SELECT occurred_on::text AS occurred_on, entry_type, SUM(amount_usd)::numeric AS total
     FROM ceo_finance_entries
     WHERE user_id = $1
       AND occurred_on BETWEEN $2::date AND $3::date
     GROUP BY occurred_on, entry_type`,
    [userId, startDateIso, endDateIso]
  );

  const perDayExpense = new Map<string, number>();
  const perDayIncome = new Map<string, number>();
  let expenseTotalUsd = 0;
  let incomeTotalUsd = 0;

  for (const row of result.rows as Array<{ occurred_on: string; entry_type: string; total: string }>) {
    const total = asNumber(row.total, 0);
    if (row.entry_type === 'expense') {
      expenseTotalUsd += total;
      perDayExpense.set(row.occurred_on, total);
    } else {
      incomeTotalUsd += total;
      perDayIncome.set(row.occurred_on, total);
    }
  }

  return {
    expenseTotalUsd,
    incomeTotalUsd,
    perDayExpense,
    perDayIncome,
  };
}

async function detectDailyAlerts(
  userId: string,
  config: CeoConfig,
  localDateIso: string
): Promise<PendingAlert[]> {
  const alerts: PendingAlert[] = [];

  const finance = await computeFinancialWindow(userId, localDateIso, 15);
  const todayExpense = finance.perDayExpense.get(localDateIso) || 0;

  const previous14: number[] = [];
  for (let i = 14; i >= 1; i--) {
    const day = addDays(localDateIso, -i);
    previous14.push(finance.perDayExpense.get(day) || 0);
  }

  const referenceMedian = median(previous14.filter((value) => value > 0));
  const burnDelta = todayExpense - referenceMedian;
  if (
    referenceMedian > 0 &&
    todayExpense > referenceMedian * config.burnSpikeRatio &&
    burnDelta >= config.burnSpikeAbsoluteUsd
  ) {
    alerts.push({
      severity: 'P1',
      alertType: 'burn_spike',
      title: 'Burn spike detected',
      message: `Today spend is ${formatMoney(todayExpense)}, up ${formatMoney(burnDelta)} vs 14-day median (${formatMoney(referenceMedian)}).`,
      payload: { todayExpense, referenceMedian, burnDelta },
    });
  }

  const vendorToday = await pool.query(
    `SELECT vendor, SUM(amount_usd)::numeric AS amount
     FROM ceo_finance_entries
     WHERE user_id = $1
       AND entry_type = 'expense'
       AND occurred_on = $2::date
     GROUP BY vendor`,
    [userId, localDateIso]
  );

  if (vendorToday.rows.length > 0) {
    const history = await pool.query(
      `SELECT vendor,
              COUNT(*)::int AS entries,
              AVG(amount_usd)::numeric AS avg_amount
       FROM ceo_finance_entries
       WHERE user_id = $1
         AND entry_type = 'expense'
         AND occurred_on < $2::date
         AND occurred_on >= $2::date - INTERVAL '90 days'
       GROUP BY vendor`,
      [userId, localDateIso]
    );

    const vendorHistory = new Map<string, { entries: number; avgAmount: number }>();
    for (const row of history.rows as Array<{ vendor: string; entries: number; avg_amount: string }>) {
      vendorHistory.set(row.vendor, {
        entries: row.entries,
        avgAmount: asNumber(row.avg_amount),
      });
    }

    for (const row of vendorToday.rows as Array<{ vendor: string; amount: string }>) {
      const todayAmount = asNumber(row.amount);
      const baseline = vendorHistory.get(row.vendor);

      if (!baseline || baseline.entries === 0) {
        if (todayAmount >= config.unexpectedNewVendorUsd) {
          alerts.push({
            severity: 'P1',
            alertType: 'unexpected_vendor_new',
            title: 'Unexpected new vendor cost',
            message: `${row.vendor} charged ${formatMoney(todayAmount)} today and has no prior baseline.`,
            payload: { vendor: row.vendor, amount: todayAmount },
          });
        }
        continue;
      }

      if (
        baseline.avgAmount > 0 &&
        todayAmount >= Math.max(config.unexpectedNewVendorUsd, baseline.avgAmount * config.unexpectedVendorMultiplier)
      ) {
        alerts.push({
          severity: 'P1',
          alertType: 'unexpected_vendor_spike',
          title: 'Unexpected vendor spike',
          message: `${row.vendor} charged ${formatMoney(todayAmount)} today vs average ${formatMoney(baseline.avgAmount)}.`,
          payload: {
            vendor: row.vendor,
            amount: todayAmount,
            average: baseline.avgAmount,
          },
        });
      }
    }
  }

  const lastBuildResult = await pool.query(
    `SELECT MAX(occurred_at) AS last_build_at
     FROM ceo_build_logs
     WHERE user_id = $1`,
    [userId]
  );

  const lastBuildAt = lastBuildResult.rows[0]?.last_build_at as Date | null;
  if (lastBuildAt) {
    const lastBuildIso = toIsoDate(lastBuildAt);
    const idleDays = daysBetween(lastBuildIso, localDateIso);
    if (idleDays >= config.noBuildDaysThreshold) {
      alerts.push({
        severity: 'P2',
        alertType: 'build_stall',
        title: 'Build momentum stalled',
        message: `No build logs for ${idleDays} days. Threshold is ${config.noBuildDaysThreshold} days.`,
        payload: { idleDays, threshold: config.noBuildDaysThreshold },
      });
    }
  } else {
    alerts.push({
      severity: 'P2',
      alertType: 'build_missing',
      title: 'No build activity logged',
      message: 'No build events are logged yet. Add build entries to keep execution tracking accurate.',
      payload: {},
    });
  }

  const lastExperimentResult = await pool.query(
    `SELECT MAX(occurred_on)::text AS last_experiment_date
     FROM ceo_growth_experiments
     WHERE user_id = $1`,
    [userId]
  );

  const lastExperimentDate = lastExperimentResult.rows[0]?.last_experiment_date as string | null;
  if (lastExperimentDate) {
    const idleDays = daysBetween(lastExperimentDate, localDateIso);
    if (idleDays >= config.noExperimentDaysThreshold) {
      alerts.push({
        severity: 'P2',
        alertType: 'growth_stall',
        title: 'Growth experimentation stalled',
        message: `No experiment launched for ${idleDays} days. Threshold is ${config.noExperimentDaysThreshold} days.`,
        payload: { idleDays, threshold: config.noExperimentDaysThreshold },
      });
    }
  } else {
    alerts.push({
      severity: 'P2',
      alertType: 'growth_missing',
      title: 'No growth experiments logged',
      message: 'No growth experiments are logged yet. Launch at least one experiment to feed the growth loop.',
      payload: {},
    });
  }

  const hasIncome = finance.incomeTotalUsd > 0;
  if (config.mode === 'normal' || hasIncome) {
    const incomeWindow = await computeFinancialWindow(userId, localDateIso, 14);
    let current7 = 0;
    let previous7 = 0;

    for (let i = 0; i < 7; i++) {
      current7 += incomeWindow.perDayIncome.get(addDays(localDateIso, -i)) || 0;
    }

    for (let i = 7; i < 14; i++) {
      previous7 += incomeWindow.perDayIncome.get(addDays(localDateIso, -i)) || 0;
    }

    if (previous7 > 0 && current7 < previous7 * 0.8) {
      const delta = previous7 - current7;
      alerts.push({
        severity: 'P1',
        alertType: 'revenue_drop',
        title: 'Revenue drop detected',
        message: `Last 7 days revenue is ${formatMoney(current7)} vs ${formatMoney(previous7)} in previous 7 days (drop ${formatMoney(delta)}).`,
        payload: { current7, previous7, delta },
      });
    }
  }

  return alerts;
}

async function getLatestProjectRankings(userId: string): Promise<CeoDashboard['projectRankings']> {
  const snapshotsResult = await pool.query(
    `SELECT DISTINCT ON (project_key)
        project_key,
        stage,
        revenue_potential_usd,
        estimated_hours,
        strategic_leverage,
        win_probability,
        dependency_risk,
        confidence_score,
        captured_at
     FROM ceo_project_snapshots
     WHERE user_id = $1
     ORDER BY project_key, captured_at DESC`,
    [userId]
  );

  const buildResult = await pool.query(
    `SELECT project_key, MAX(occurred_at) AS last_build_at
     FROM ceo_build_logs
     WHERE user_id = $1
     GROUP BY project_key`,
    [userId]
  );

  const lastBuildByProject = new Map<string, Date | null>();
  for (const row of buildResult.rows as Array<{ project_key: string; last_build_at: Date | null }>) {
    lastBuildByProject.set(row.project_key, row.last_build_at || null);
  }

  const nowIso = toIsoDate(new Date());

  return (snapshotsResult.rows as Array<Record<string, unknown>>)
    .map((row) => {
      const projectKey = String(row.project_key || 'unknown');
      const revenuePotentialUsd = asNumber(row.revenue_potential_usd);
      const estimatedHours = Math.max(1, asNumber(row.estimated_hours, 1));
      const strategicLeverage = Math.max(0.1, asNumber(row.strategic_leverage, 1));
      const winProbability = Math.max(0, Math.min(1, asNumber(row.win_probability, 0.5)));
      const dependencyRisk = Math.max(0, asNumber(row.dependency_risk, 0));
      const confidenceScore = Math.max(0, Math.min(1, asNumber(row.confidence_score, 0.5)));

      const lastBuildAt = lastBuildByProject.get(projectKey) || null;
      const stallDays = lastBuildAt ? daysBetween(toIsoDate(lastBuildAt), nowIso) : 14;

      const opportunityScore = (revenuePotentialUsd * winProbability * strategicLeverage) / estimatedHours;
      const riskScore = dependencyRisk + (1 - confidenceScore) * 5 + Math.min(stallDays, 30) * 0.2;

      return {
        projectKey,
        stage: String(row.stage || 'build'),
        opportunityScore,
        riskScore,
        revenuePotentialUsd,
        estimatedHours,
        lastBuildAt,
      };
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 8);
}

async function getChannelPerformance(userId: string, windowStartIso: string): Promise<CeoDashboard['channelPerformance']> {
  const result = await pool.query(
    `SELECT channel,
            COUNT(*)::int AS runs,
            COALESCE(SUM(leads), 0)::int AS leads,
            COALESCE(SUM(cost_usd), 0)::numeric AS cost
     FROM ceo_growth_experiments
     WHERE user_id = $1
       AND occurred_on >= $2::date
     GROUP BY channel`,
    [userId, windowStartIso]
  );

  return (result.rows as Array<{ channel: string; runs: number; leads: number; cost: string }>).map((row) => {
    const costUsd = asNumber(row.cost);
    const leads = row.leads;
    const runs = row.runs;
    const costPerLeadUsd = leads > 0 ? costUsd / leads : null;
    const score = leads * 2 + runs * 0.75 - costUsd * 0.05;

    return {
      channel: row.channel,
      runs,
      leads,
      costUsd,
      costPerLeadUsd,
      score,
    };
  }).sort((a, b) => b.score - a.score);
}

async function refreshMarketRadar(userId: string, config: CeoConfig): Promise<number> {
  try {
    await newsfetcherService.triggerIngestion();
  } catch (error) {
    logger.warn('CEO market radar ingestion failed', {
      userId,
      error: (error as Error).message,
    });
  }

  const articles = await newsfetcherService.getInterestingArticles(30);
  if (articles.length === 0) {
    return 0;
  }

  const keywordSet = new Set(
    [...RADAR_KEYWORDS, ...config.competitors.map((item) => item.toLowerCase())]
      .filter((item) => item.trim().length > 0)
  );

  const existingResult = await pool.query(
    `SELECT title, COALESCE(source_url, '') AS source_url
     FROM ceo_market_signals
     WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '21 days'`,
    [userId]
  );

  const existing = new Set(
    (existingResult.rows as Array<{ title: string; source_url: string }>).
      map((row) => `${row.title.toLowerCase()}::${row.source_url}`)
  );

  let inserted = 0;

  for (const article of articles) {
    const title = article.title.trim();
    const haystack = `${title} ${article.sourceName}`.toLowerCase();
    const match = [...keywordSet].some((keyword) => haystack.includes(keyword));
    if (!match) continue;

    const dedupeKey = `${title.toLowerCase()}::${article.url || ''}`;
    if (existing.has(dedupeKey)) continue;

    let signalType: 'opportunity' | 'threat' | 'pricing' | 'policy' | 'trend' = 'trend';

    if (/price|pricing|cost|subscription|rate limit/.test(haystack)) {
      signalType = 'pricing';
    } else if (/policy|terms|regulation|compliance|ban|restriction/.test(haystack)) {
      signalType = 'policy';
    } else if (/threat|attack|outage|shutdown|deprecate/.test(haystack)) {
      signalType = 'threat';
    } else if (/launch|new|growth|funding|demand|opportunity/.test(haystack)) {
      signalType = 'opportunity';
    }

    const summary = `${article.sourceName} | ${article.verificationStatus} (${article.confidenceScore})`;

    await pool.query(
      `INSERT INTO ceo_market_signals (user_id, signal_type, title, summary, source_url, confidence, actionable)
       VALUES ($1, $2, $3, $4, $5, $6, true)`,
      [userId, signalType, title, summary, article.url, Math.min(1, article.confidenceScore / 100)]
    );

    inserted++;
    existing.add(dedupeKey);

    if (inserted >= 10) {
      break;
    }
  }

  return inserted;
}

async function generateWeeklyActions(
  config: CeoConfig,
  projectRankings: CeoDashboard['projectRankings'],
  channelPerformance: CeoDashboard['channelPerformance'],
  buildHours7d: number,
  experiments7d: number,
  burn7d: number,
  income7d: number
): Promise<string[]> {
  const actions: string[] = [];

  if (buildHours7d === 0) {
    actions.push('Log at least one build block every day this week to restore execution visibility.');
  }

  if (experiments7d === 0) {
    actions.push('Launch one growth experiment immediately and one more within 72 hours.');
  }

  const topProject = projectRankings[0];
  if (topProject) {
    actions.push(`Prioritize ${topProject.projectKey}; it has the highest current opportunity score (${topProject.opportunityScore.toFixed(2)}).`);
  }

  const topChannel = channelPerformance[0];
  if (topChannel) {
    actions.push(`Double down on ${topChannel.channel}; current channel score is ${topChannel.score.toFixed(2)}.`);
  }

  if (config.mode === 'pre_revenue' && burn7d > 0 && income7d === 0) {
    actions.push(`Hold weekly spend below ${formatMoney(Math.max(75, burn7d * 0.9))} until first revenue is logged.`);
  }

  return actions.slice(0, 3);
}

async function createWeeklyAutopostDrafts(
  userId: string,
  config: CeoConfig,
  summary: {
    buildHours7d: number;
    experiments7d: number;
    leads7d: number;
    topProject: string | null;
  }
): Promise<number> {
  if (!config.autopostEnabled) {
    return 0;
  }

  const channelsResult = await pool.query(
    `SELECT channel, is_enabled, posting_mode
     FROM ceo_autopost_channels
     WHERE user_id = $1`,
    [userId]
  );

  const enabledChannels = (channelsResult.rows as Array<{ channel: string; is_enabled: boolean; posting_mode: string }>).
    filter((row) => row.is_enabled);

  if (enabledChannels.length === 0) {
    return 0;
  }

  const priorityOrder = config.autopostPriority.length > 0
    ? config.autopostPriority
    : ['x', 'linkedin', 'telegram', 'blog'];

  const sorted = enabledChannels.sort((a, b) => {
    const ai = priorityOrder.indexOf(a.channel);
    const bi = priorityOrder.indexOf(b.channel);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  }).slice(0, 3);

  let created = 0;

  for (const channelRow of sorted) {
    const alreadyExistsResult = await pool.query(
      `SELECT COUNT(*)::int AS count
       FROM ceo_autopost_queue
       WHERE user_id = $1
         AND channel = $2
         AND source = 'weekly_brief'
         AND created_at > NOW() - INTERVAL '7 days'`,
      [userId, channelRow.channel]
    );

    if ((alreadyExistsResult.rows[0]?.count || 0) > 0) {
      continue;
    }

    const headlineProject = summary.topProject || 'current priority build';
    const short = `Week update: ${summary.buildHours7d.toFixed(1)} build hours, ${summary.experiments7d} experiments, ${summary.leads7d} leads. Next focus: ${headlineProject}.`;

    let content = short;
    if (channelRow.channel === 'linkedin') {
      content = `Weekly operator update:\n- Build: ${summary.buildHours7d.toFixed(1)} hours\n- Experiments: ${summary.experiments7d}\n- Leads: ${summary.leads7d}\n- Next strategic focus: ${headlineProject}\n\nIf you are building in public, consistency compounds.`;
    } else if (channelRow.channel === 'telegram') {
      content = `CEO Luna weekly update\n\nBuild hours: ${summary.buildHours7d.toFixed(1)}\nExperiments run: ${summary.experiments7d}\nLeads captured: ${summary.leads7d}\nNext focus: ${headlineProject}`;
    } else if (channelRow.channel === 'blog') {
      content = `# Weekly Build and Growth Update\n\n- Build hours: ${summary.buildHours7d.toFixed(1)}\n- Experiments launched: ${summary.experiments7d}\n- Leads captured: ${summary.leads7d}\n\n## Next Focus\n${headlineProject}`;
    }

    const status = channelRow.posting_mode === 'auto' ? 'approved' : 'draft';
    const scheduledAt = channelRow.posting_mode === 'auto' ? new Date(Date.now() + 5 * 60 * 1000) : null;

    await pool.query(
      `INSERT INTO ceo_autopost_queue
       (user_id, channel, title, content, status, scheduled_at, source, payload)
       VALUES ($1, $2, $3, $4, $5, $6, 'weekly_brief', $7)`,
      [
        userId,
        channelRow.channel,
        `Weekly update - ${channelRow.channel}`,
        content,
        status,
        scheduledAt,
        JSON.stringify({ generatedBy: 'ceo_weekly_brief' }),
      ]
    );

    created++;
  }

  return created;
}

async function dispatchAutopost(
  userId: string,
  post: {
    id: string;
    channel: string;
    title: string | null;
    content: string;
    payload: unknown;
    webhook_path: string | null;
    channel_ref: string | null;
  }
): Promise<void> {
  const payload = (typeof post.payload === 'object' && post.payload !== null)
    ? post.payload as Record<string, unknown>
    : {};

  if (post.channel === 'telegram') {
    if (post.webhook_path && post.webhook_path.trim().length > 0) {
      const webhookResult = await n8nService.executeWebhook(post.webhook_path, {
        channel: post.channel,
        postId: post.id,
        title: post.title,
        content: post.content,
        payload,
      }, { userId });

      if (!webhookResult.success) {
        throw new Error(webhookResult.error || `n8n webhook failed (${webhookResult.status})`);
      }

      return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = post.channel_ref;

    if (!token || !chatId) {
      throw new Error('Telegram autopost requires either webhook_path or channel_ref + TELEGRAM_BOT_TOKEN');
    }

    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: post.content,
        disable_notification: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Telegram autopost failed: ${response.status} ${body}`);
    }

    return;
  }

  if (!post.webhook_path || post.webhook_path.trim().length === 0) {
    throw new Error(`Channel ${post.channel} requires webhook_path for autopost`);
  }

  const result = await n8nService.executeWebhook(post.webhook_path, {
    channel: post.channel,
    postId: post.id,
    title: post.title,
    content: post.content,
    payload,
  }, { userId });

  if (!result.success) {
    throw new Error(result.error || `n8n webhook failed (${result.status})`);
  }
}

export async function getOrCreateConfig(userId: string): Promise<CeoConfig> {
  await pool.query(
    `INSERT INTO ceo_configs (user_id, competitors)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, JSON.stringify(DEFAULT_COMPETITORS)]
  );

  await ensureDefaultAutopostChannels(userId);

  const result = await pool.query<CeoConfigRow>(
    `SELECT * FROM ceo_configs WHERE user_id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Unable to initialize CEO config');
  }

  return mapConfigRow(result.rows[0]);
}

export async function updateConfig(userId: string, updates: UpdateCeoConfigInput): Promise<CeoConfig> {
  await getOrCreateConfig(userId);

  const setClauses: string[] = [];
  const params: unknown[] = [userId];
  let index = 2;

  if (updates.mode !== undefined) {
    setClauses.push(`mode = $${index++}`);
    params.push(updates.mode);
  }
  if (updates.timezone !== undefined) {
    setClauses.push(`timezone = $${index++}`);
    params.push(normalizeTimezone(updates.timezone));
  }
  if (updates.noBuildDaysThreshold !== undefined) {
    setClauses.push(`no_build_days_threshold = $${index++}`);
    params.push(Math.max(1, Math.round(updates.noBuildDaysThreshold)));
  }
  if (updates.noExperimentDaysThreshold !== undefined) {
    setClauses.push(`no_experiment_days_threshold = $${index++}`);
    params.push(Math.max(1, Math.round(updates.noExperimentDaysThreshold)));
  }
  if (updates.burnSpikeRatio !== undefined) {
    setClauses.push(`burn_spike_ratio = $${index++}`);
    params.push(Math.max(1, updates.burnSpikeRatio));
  }
  if (updates.burnSpikeAbsoluteUsd !== undefined) {
    setClauses.push(`burn_spike_absolute_usd = $${index++}`);
    params.push(Math.max(0, updates.burnSpikeAbsoluteUsd));
  }
  if (updates.unexpectedNewVendorUsd !== undefined) {
    setClauses.push(`unexpected_new_vendor_usd = $${index++}`);
    params.push(Math.max(0, updates.unexpectedNewVendorUsd));
  }
  if (updates.unexpectedVendorMultiplier !== undefined) {
    setClauses.push(`unexpected_vendor_multiplier = $${index++}`);
    params.push(Math.max(1, updates.unexpectedVendorMultiplier));
  }
  if (updates.dailyMorningTime !== undefined) {
    setClauses.push(`daily_morning_time = $${index++}`);
    params.push(normalizeTimeString(updates.dailyMorningTime));
  }
  if (updates.dailyEveningTime !== undefined) {
    setClauses.push(`daily_evening_time = $${index++}`);
    params.push(normalizeTimeString(updates.dailyEveningTime));
  }
  if (updates.weeklyReportWeekday !== undefined) {
    setClauses.push(`weekly_report_weekday = $${index++}`);
    params.push(Math.max(0, Math.min(6, Math.round(updates.weeklyReportWeekday))));
  }
  if (updates.weeklyReportTime !== undefined) {
    setClauses.push(`weekly_report_time = $${index++}`);
    params.push(normalizeTimeString(updates.weeklyReportTime));
  }
  if (updates.biweeklyAuditWeekday !== undefined) {
    setClauses.push(`biweekly_audit_weekday = $${index++}`);
    params.push(Math.max(0, Math.min(6, Math.round(updates.biweeklyAuditWeekday))));
  }
  if (updates.biweeklyAuditTime !== undefined) {
    setClauses.push(`biweekly_audit_time = $${index++}`);
    params.push(normalizeTimeString(updates.biweeklyAuditTime));
  }
  if (updates.competitors !== undefined) {
    setClauses.push(`competitors = $${index++}`);
    params.push(JSON.stringify(updates.competitors));
  }
  if (updates.autopostPriority !== undefined) {
    setClauses.push(`autopost_priority = $${index++}`);
    params.push(JSON.stringify(updates.autopostPriority));
  }
  if (updates.autopostEnabled !== undefined) {
    setClauses.push(`autopost_enabled = $${index++}`);
    params.push(updates.autopostEnabled);
  }

  if (setClauses.length > 0) {
    await pool.query(
      `UPDATE ceo_configs
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE user_id = $1`,
      params
    );
  }

  return getOrCreateConfig(userId);
}

export async function logExpense(userId: string, input: FinanceLogInput): Promise<string> {
  const config = await getOrCreateConfig(userId);
  const localDate = getLocalTimeParts(config.timezone).isoDate;
  const occurredOn = parseDateInput(input.date, localDate);

  const result = await pool.query(
    `INSERT INTO ceo_finance_entries
     (user_id, occurred_on, entry_type, vendor, amount_usd, category, cadence, notes, source)
     VALUES ($1, $2::date, 'expense', $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      userId,
      occurredOn,
      input.vendor.trim(),
      Math.max(0, input.amountUsd),
      (input.category || 'other').trim().toLowerCase(),
      normalizeCadence(input.cadence),
      input.notes || null,
      input.source || 'telegram',
    ]
  );

  return result.rows[0].id as string;
}

export async function logIncome(userId: string, input: FinanceLogInput): Promise<string> {
  const config = await getOrCreateConfig(userId);
  const localDate = getLocalTimeParts(config.timezone).isoDate;
  const occurredOn = parseDateInput(input.date, localDate);

  const result = await pool.query(
    `INSERT INTO ceo_finance_entries
     (user_id, occurred_on, entry_type, vendor, amount_usd, category, cadence, notes, source)
     VALUES ($1, $2::date, 'income', $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      userId,
      occurredOn,
      input.vendor.trim(),
      Math.max(0, input.amountUsd),
      (input.category || 'revenue').trim().toLowerCase(),
      normalizeCadence(input.cadence),
      input.notes || null,
      input.source || 'telegram',
    ]
  );

  return result.rows[0].id as string;
}

export async function logBuild(userId: string, input: BuildLogInput): Promise<string> {
  await getOrCreateConfig(userId);

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  const validOccurredAt = Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt;

  const result = await pool.query(
    `INSERT INTO ceo_build_logs
     (user_id, project_key, occurred_at, hours, item, stage, impact, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      userId,
      input.projectKey.trim(),
      validOccurredAt,
      Math.max(0, input.hours),
      input.item || null,
      normalizeBuildStage(input.stage),
      normalizeImpact(input.impact),
      input.source || 'telegram',
    ]
  );

  return result.rows[0].id as string;
}

export async function logExperiment(userId: string, input: ExperimentLogInput): Promise<string> {
  const config = await getOrCreateConfig(userId);
  const localDate = getLocalTimeParts(config.timezone).isoDate;

  const result = await pool.query(
    `INSERT INTO ceo_growth_experiments
     (user_id, occurred_on, channel, name, cost_usd, leads, outcome, status, notes, source)
     VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      userId,
      parseDateInput(input.date, localDate),
      input.channel.trim().toLowerCase(),
      input.name.trim(),
      Math.max(0, input.costUsd || 0),
      Math.max(0, Math.round(input.leads || 0)),
      normalizeOutcome(input.outcome),
      normalizeExperimentStatus(input.status),
      input.notes || null,
      input.source || 'telegram',
    ]
  );

  return result.rows[0].id as string;
}

export async function logLead(userId: string, input: LeadLogInput): Promise<string> {
  const config = await getOrCreateConfig(userId);
  const localDate = getLocalTimeParts(config.timezone).isoDate;

  const result = await pool.query(
    `INSERT INTO ceo_leads
     (user_id, occurred_on, source, status, value_estimate_usd, notes)
     VALUES ($1, $2::date, $3, $4, $5, $6)
     RETURNING id`,
    [
      userId,
      parseDateInput(input.date, localDate),
      input.source.trim().toLowerCase(),
      normalizeLeadStatus(input.status),
      input.valueEstimateUsd === undefined ? null : Math.max(0, input.valueEstimateUsd),
      input.notes || null,
    ]
  );

  return result.rows[0].id as string;
}

export async function logProjectSnapshot(userId: string, input: ProjectSnapshotInput): Promise<string> {
  await getOrCreateConfig(userId);

  const result = await pool.query(
    `INSERT INTO ceo_project_snapshots
     (user_id, project_key, stage, revenue_potential_usd, estimated_hours, strategic_leverage, win_probability, dependency_risk, confidence_score, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      userId,
      input.projectKey.trim(),
      normalizeProjectStage(input.stage),
      Math.max(0, input.revenuePotentialUsd || 0),
      Math.max(1, input.estimatedHours || 1),
      Math.max(0.1, input.strategicLeverage || 1),
      Math.max(0, Math.min(1, input.winProbability || 0.5)),
      Math.max(0, Math.round(input.dependencyRisk || 0)),
      Math.max(0, Math.min(1, input.confidenceScore || 0.5)),
      input.notes || null,
    ]
  );

  return result.rows[0].id as string;
}

export async function listAutopostQueue(userId: string, limit = 10): Promise<Array<{
  id: string;
  channel: string;
  title: string | null;
  status: string;
  scheduledAt: Date | null;
  createdAt: Date;
}>> {
  const result = await pool.query(
    `SELECT id, channel, title, status, scheduled_at, created_at
     FROM ceo_autopost_queue
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );

  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    channel: row.channel as string,
    title: row.title as string | null,
    status: row.status as string,
    scheduledAt: row.scheduled_at as Date | null,
    createdAt: row.created_at as Date,
  }));
}

export async function listAutopostChannels(userId: string): Promise<Array<{
  channel: string;
  isEnabled: boolean;
  postingMode: string;
  webhookPath: string | null;
  channelRef: string | null;
}>> {
  await ensureDefaultAutopostChannels(userId);

  const result = await pool.query(
    `SELECT channel, is_enabled, posting_mode, webhook_path, channel_ref
     FROM ceo_autopost_channels
     WHERE user_id = $1
     ORDER BY channel`,
    [userId]
  );

  return result.rows.map((row: Record<string, unknown>) => ({
    channel: row.channel as string,
    isEnabled: row.is_enabled as boolean,
    postingMode: row.posting_mode as string,
    webhookPath: row.webhook_path as string | null,
    channelRef: row.channel_ref as string | null,
  }));
}

export async function updateAutopostChannel(
  userId: string,
  channel: string,
  updates: {
    isEnabled?: boolean;
    postingMode?: 'auto' | 'approval';
    webhookPath?: string | null;
    channelRef?: string | null;
  }
): Promise<void> {
  await ensureDefaultAutopostChannels(userId);

  const setClauses: string[] = [];
  const params: unknown[] = [userId, channel];
  let index = 3;

  if (updates.isEnabled !== undefined) {
    setClauses.push(`is_enabled = $${index++}`);
    params.push(updates.isEnabled);
  }
  if (updates.postingMode !== undefined) {
    setClauses.push(`posting_mode = $${index++}`);
    params.push(updates.postingMode);
  }
  if (updates.webhookPath !== undefined) {
    setClauses.push(`webhook_path = $${index++}`);
    params.push(updates.webhookPath);
  }
  if (updates.channelRef !== undefined) {
    setClauses.push(`channel_ref = $${index++}`);
    params.push(updates.channelRef);
  }

  if (setClauses.length === 0) {
    return;
  }

  await pool.query(
    `UPDATE ceo_autopost_channels
     SET ${setClauses.join(', ')}, updated_at = NOW()
     WHERE user_id = $1 AND channel = $2`,
    params
  );
}

export async function createAutopostDraft(
  userId: string,
  channel: AutopostChannel,
  content: string,
  title?: string
): Promise<string> {
  await ensureDefaultAutopostChannels(userId);

  const result = await pool.query(
    `INSERT INTO ceo_autopost_queue (user_id, channel, title, content, status, source)
     VALUES ($1, $2, $3, $4, 'draft', 'manual')
     RETURNING id`,
    [userId, channel, title || null, content]
  );

  return result.rows[0].id as string;
}

export async function approveAutopostItem(userId: string, postId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE ceo_autopost_queue
     SET status = 'approved', scheduled_at = COALESCE(scheduled_at, NOW()), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status IN ('draft', 'failed')
     RETURNING id`,
    [postId, userId]
  );

  return (result.rowCount || 0) > 0;
}

export async function cancelAutopostItem(userId: string, postId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE ceo_autopost_queue
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND status IN ('draft', 'approved', 'scheduled', 'failed')
     RETURNING id`,
    [postId, userId]
  );

  return (result.rowCount || 0) > 0;
}

export async function processAutopostQueue(limit = 20, userId?: string): Promise<AutopostWorkerResult> {
  const conditions: string[] = [
    `q.status IN ('approved', 'scheduled')`,
    `(q.scheduled_at IS NULL OR q.scheduled_at <= NOW())`,
    `c.is_enabled = true`,
  ];
  const params: unknown[] = [];

  if (userId) {
    conditions.push(`q.user_id = $1`);
    params.push(userId);
  }

  const limitParam = params.length + 1;
  params.push(limit);

  const result = await pool.query(
    `SELECT q.id,
            q.user_id,
            q.channel,
            q.title,
            q.content,
            q.payload,
            c.webhook_path,
            c.channel_ref
     FROM ceo_autopost_queue q
     JOIN ceo_autopost_channels c
       ON c.user_id = q.user_id
      AND c.channel = q.channel
     WHERE ${conditions.join(' AND ')}
     ORDER BY q.created_at ASC
     LIMIT $${limitParam}`,
    params
  );

  let attempted = 0;
  let posted = 0;
  let failed = 0;

  for (const row of result.rows as Array<{
    id: string;
    user_id: string;
    channel: string;
    title: string | null;
    content: string;
    payload: unknown;
    webhook_path: string | null;
    channel_ref: string | null;
  }>) {
    attempted++;

    await pool.query(
      `UPDATE ceo_autopost_queue
       SET status = 'posting', updated_at = NOW()
       WHERE id = $1`,
      [row.id]
    );

    try {
      await dispatchAutopost(row.user_id, {
        id: row.id,
        channel: row.channel,
        title: row.title,
        content: row.content,
        payload: row.payload,
        webhook_path: row.webhook_path,
        channel_ref: row.channel_ref,
      });

      await pool.query(
        `UPDATE ceo_autopost_queue
         SET status = 'posted', posted_at = NOW(), error_message = NULL, updated_at = NOW()
         WHERE id = $1`,
        [row.id]
      );

      posted++;
    } catch (error) {
      const message = (error as Error).message;
      await pool.query(
        `UPDATE ceo_autopost_queue
         SET status = 'failed', error_message = $2, updated_at = NOW()
         WHERE id = $1`,
        [row.id, message]
      );

      failed++;
      logger.warn('Autopost failed', {
        userId: row.user_id,
        postId: row.id,
        channel: row.channel,
        error: message,
      });
    }
  }

  return { attempted, posted, failed };
}

export async function runDailyCheckForUser(userId: string, slot: 'morning' | 'evening' | 'manual' = 'manual'): Promise<{ alertsQueued: number; reportId: string }> {
  const config = await getOrCreateConfig(userId);
  const localTime = getLocalTimeParts(config.timezone);

  const alerts = await detectDailyAlerts(userId, config, localTime.isoDate);
  let alertsQueued = 0;

  for (const alert of alerts) {
    const queued = await queueAlert(userId, localTime, alert);
    if (queued.queued) {
      alertsQueued++;
    }
  }

  const flushed = await flushSuppressedAlerts(userId, localTime);
  alertsQueued += flushed;

  const finance7d = await computeFinancialWindow(userId, localTime.isoDate, 7);
  const burn7d = finance7d.expenseTotalUsd - finance7d.incomeTotalUsd;

  const buildHoursResult = await pool.query(
    `SELECT COALESCE(SUM(hours), 0)::numeric AS total
     FROM ceo_build_logs
     WHERE user_id = $1
       AND occurred_at >= NOW() - INTERVAL '7 days'`,
    [userId]
  );

  const experimentsResult = await pool.query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(leads), 0)::int AS leads
     FROM ceo_growth_experiments
     WHERE user_id = $1
       AND occurred_on >= $2::date - INTERVAL '7 days'`,
    [userId, localTime.isoDate]
  );

  const headline = `Daily CEO pulse (${slot}) - ${alerts.length} raw signals, ${alertsQueued} queued`;
  const body = [
    `Mode: ${config.mode}`,
    `7d burn net: ${formatMoney(burn7d)} (expenses ${formatMoney(finance7d.expenseTotalUsd)}, income ${formatMoney(finance7d.incomeTotalUsd)})`,
    `7d build hours: ${asNumber(buildHoursResult.rows[0]?.total).toFixed(1)}`,
    `7d experiments: ${experimentsResult.rows[0]?.count || 0}, leads: ${experimentsResult.rows[0]?.leads || 0}`,
  ].join('\n');

  const reportId = await createReport(
    userId,
    'daily',
    localTime.isoDate,
    localTime.isoDate,
    headline,
    body,
    {
      slot,
      mode: config.mode,
      alertsDetected: alerts.length,
      alertsQueued,
      burn7d,
      expenses7d: finance7d.expenseTotalUsd,
      income7d: finance7d.incomeTotalUsd,
      buildHours7d: asNumber(buildHoursResult.rows[0]?.total),
      experiments7d: experimentsResult.rows[0]?.count || 0,
      leads7d: experimentsResult.rows[0]?.leads || 0,
    },
    'internal',
    null
  );

  return { alertsQueued, reportId };
}

export async function runWeeklyBriefForUser(userId: string): Promise<{ reportId: string; draftsCreated: number; radarSignalsInserted: number }> {
  const config = await getOrCreateConfig(userId);
  const localTime = getLocalTimeParts(config.timezone);
  const periodStart = addDays(localTime.isoDate, -6);

  const radarSignalsInserted = await refreshMarketRadar(userId, config);

  const finance7d = await computeFinancialWindow(userId, localTime.isoDate, 7);
  const finance30d = await computeFinancialWindow(userId, localTime.isoDate, 30);
  const burn7d = finance7d.expenseTotalUsd - finance7d.incomeTotalUsd;
  const burn30d = finance30d.expenseTotalUsd - finance30d.incomeTotalUsd;
  const projected30dBurnUsd = burn30d;

  const buildResult = await pool.query(
    `SELECT project_key,
            COALESCE(SUM(hours), 0)::numeric AS hours,
            MAX(occurred_at) AS last_build_at
     FROM ceo_build_logs
     WHERE user_id = $1
       AND occurred_at >= NOW() - INTERVAL '7 days'
     GROUP BY project_key`,
    [userId]
  );

  const buildRows = buildResult.rows as WeeklyBuildTotalsRow[];
  const buildHours7d = buildRows.reduce((sum, row) => sum + asNumber(row.hours), 0);

  const experimentsResult = await pool.query(
    `SELECT COUNT(*)::int AS experiments,
            COALESCE(SUM(leads), 0)::int AS leads,
            COALESCE(SUM(cost_usd), 0)::numeric AS cost
     FROM ceo_growth_experiments
     WHERE user_id = $1
       AND occurred_on >= $2::date`,
    [userId, periodStart]
  );

  const experiments7d = experimentsResult.rows[0]?.experiments || 0;
  const leads7d = experimentsResult.rows[0]?.leads || 0;
  const growthSpend7d = asNumber(experimentsResult.rows[0]?.cost);

  const projectRankings = await getLatestProjectRankings(userId);
  const channelPerformance = await getChannelPerformance(userId, addDays(localTime.isoDate, -30));

  const marketSignalsResult = await pool.query(
    `SELECT signal_type, title, source_url
     FROM ceo_market_signals
     WHERE user_id = $1
       AND created_at > NOW() - INTERVAL '7 days'
     ORDER BY created_at DESC
     LIMIT 5`,
    [userId]
  );

  const actions = await generateWeeklyActions(
    config,
    projectRankings,
    channelPerformance,
    buildHours7d,
    experiments7d,
    burn7d,
    finance7d.incomeTotalUsd
  );

  const topProject = projectRankings[0]?.projectKey || null;
  const topChannel = channelPerformance[0]?.channel || 'n/a';

  const briefLines = [
    `CEO Brief (${periodStart} to ${localTime.isoDate})`,
    '',
    `Mode: ${config.mode}`,
    `Burn: ${formatMoney(burn7d)} this week | ${formatMoney(projected30dBurnUsd)} 30d trend`,
    `Income: ${formatMoney(finance7d.incomeTotalUsd)} this week`,
    `Build: ${buildHours7d.toFixed(1)} hours`,
    `Growth: ${experiments7d} experiments, ${leads7d} leads, ${formatMoney(growthSpend7d)} spend`,
    `Top channel: ${topChannel}`,
    `Top project: ${topProject || 'none logged'}`,
    '',
    'Top actions:',
    ...actions.map((action, index) => `${index + 1}. ${action}`),
  ];

  const marketSignals = marketSignalsResult.rows as Array<{ signal_type: string; title: string; source_url: string | null }>;
  if (marketSignals.length > 0) {
    briefLines.push('', 'Market radar:');
    for (const signal of marketSignals) {
      briefLines.push(`- [${signal.signal_type}] ${signal.title}${signal.source_url ? ` (${signal.source_url})` : ''}`);
    }
  }

  const briefBody = briefLines.join('\n');

  const reportId = await createReport(
    userId,
    'weekly',
    periodStart,
    localTime.isoDate,
    `Weekly CEO Brief - ${localTime.isoDate}`,
    briefBody,
    {
      mode: config.mode,
      burn7d,
      burn30d,
      projected30dBurnUsd,
      income7d: finance7d.incomeTotalUsd,
      buildHours7d,
      experiments7d,
      leads7d,
      growthSpend7d,
      topProject,
      topChannel,
      actions,
      radarSignalsInserted,
    },
    'telegram',
    new Date()
  );

  await enqueueCeoMessage(userId, 'ceo_weekly_brief', briefBody, 6);

  const draftsCreated = await createWeeklyAutopostDrafts(userId, config, {
    buildHours7d,
    experiments7d,
    leads7d,
    topProject,
  });

  if (draftsCreated > 0) {
    await enqueueCeoMessage(
      userId,
      'ceo_autopost_drafts',
      `CEO Luna created ${draftsCreated} autopost draft(s). Use "autopost list" and "autopost approve <id>" to publish.`,
      5
    );
  }

  return { reportId, draftsCreated, radarSignalsInserted };
}

export async function runBiweeklyAuditForUser(userId: string): Promise<{ reportId: string }> {
  const config = await getOrCreateConfig(userId);
  const localTime = getLocalTimeParts(config.timezone);
  const periodStart = addDays(localTime.isoDate, -13);

  const finance14d = await computeFinancialWindow(userId, localTime.isoDate, 14);
  const burn14d = finance14d.expenseTotalUsd - finance14d.incomeTotalUsd;

  const buildHoursResult = await pool.query(
    `SELECT COALESCE(SUM(hours), 0)::numeric AS total
     FROM ceo_build_logs
     WHERE user_id = $1
       AND occurred_at >= NOW() - INTERVAL '14 days'`,
    [userId]
  );

  const experimentsResult = await pool.query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(SUM(leads), 0)::int AS leads
     FROM ceo_growth_experiments
     WHERE user_id = $1
       AND occurred_on >= $2::date`,
    [userId, periodStart]
  );

  const toolSpendResult = await pool.query(
    `SELECT COALESCE(SUM(amount_usd), 0)::numeric AS total
     FROM ceo_finance_entries
     WHERE user_id = $1
       AND entry_type = 'expense'
       AND category = 'tool'
       AND occurred_on >= $2::date`,
    [userId, periodStart]
  );

  const buildHours14d = asNumber(buildHoursResult.rows[0]?.total);
  const experiments14d = experimentsResult.rows[0]?.count || 0;
  const leads14d = experimentsResult.rows[0]?.leads || 0;
  const toolSpend14d = asNumber(toolSpendResult.rows[0]?.total);

  const findings: string[] = [];

  if (buildHours14d > 30 && leads14d === 0) {
    findings.push('High build time with no lead capture. Distribution is lagging execution.');
  }

  if (experiments14d < 2) {
    findings.push('Experiment frequency is too low. Minimum target is 2 tests per 14 days.');
  }

  if (toolSpend14d > 0 && buildHours14d < 4) {
    findings.push(`Tool spend is ${formatMoney(toolSpend14d)} with low build activity (${buildHours14d.toFixed(1)}h).`);
  }

  if (burn14d > 0 && config.mode === 'pre_revenue' && leads14d === 0) {
    findings.push('Pre-revenue burn is active without pipeline growth. Shift effort to distribution this cycle.');
  }

  if (findings.length === 0) {
    findings.push('No major efficiency red flags detected in this cycle.');
  }

  const auditBody = [
    `Bi-weekly efficiency audit (${periodStart} to ${localTime.isoDate})`,
    '',
    `Build hours: ${buildHours14d.toFixed(1)}`,
    `Experiments: ${experiments14d}`,
    `Leads: ${leads14d}`,
    `Tool spend: ${formatMoney(toolSpend14d)}`,
    `Burn net: ${formatMoney(burn14d)}`,
    '',
    'Findings:',
    ...findings.map((finding, index) => `${index + 1}. ${finding}`),
  ].join('\n');

  const reportId = await createReport(
    userId,
    'biweekly',
    periodStart,
    localTime.isoDate,
    `Bi-weekly efficiency audit - ${localTime.isoDate}`,
    auditBody,
    {
      mode: config.mode,
      buildHours14d,
      experiments14d,
      leads14d,
      toolSpend14d,
      burn14d,
      findings,
    },
    'telegram',
    new Date()
  );

  await enqueueCeoMessage(userId, 'ceo_biweekly_audit', auditBody, 6);

  return { reportId };
}

export async function getDashboard(userId: string, periodDays = 30): Promise<CeoDashboard> {
  const config = await getOrCreateConfig(userId);
  const localTime = getLocalTimeParts(config.timezone);

  const financial = await computeFinancialWindow(userId, localTime.isoDate, periodDays);

  const buildResult = await pool.query(
    `SELECT COALESCE(SUM(hours), 0)::numeric AS total,
            MAX(occurred_at) AS last_build_at
     FROM ceo_build_logs
     WHERE user_id = $1
       AND occurred_at >= NOW() - ($2::text || ' days')::interval`,
    [userId, periodDays]
  );

  const experimentsResult = await pool.query(
    `SELECT COUNT(*)::int AS experiments,
            COALESCE(SUM(leads), 0)::int AS leads,
            MAX(occurred_on)::text AS last_experiment_date
     FROM ceo_growth_experiments
     WHERE user_id = $1
       AND occurred_on >= $2::date`,
    [userId, addDays(localTime.isoDate, -(periodDays - 1))]
  );

  const projectRankings = await getLatestProjectRankings(userId);
  const channelPerformance = await getChannelPerformance(userId, addDays(localTime.isoDate, -(periodDays - 1)));

  const alertsResult = await pool.query(
    `SELECT id, severity, title, status, created_at
     FROM ceo_alerts
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [userId]
  );

  const autopostResult = await pool.query(
    `SELECT id, channel, status, scheduled_at, created_at
     FROM ceo_autopost_queue
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 10`,
    [userId]
  );

  const burnNet = financial.expenseTotalUsd - financial.incomeTotalUsd;
  const projected30dBurnUsd = periodDays > 0 ? burnNet * (30 / periodDays) : burnNet;

  return {
    config,
    financial: {
      periodDays,
      expenseTotalUsd: financial.expenseTotalUsd,
      incomeTotalUsd: financial.incomeTotalUsd,
      burnNetUsd: burnNet,
      projected30dBurnUsd,
    },
    activity: {
      buildHours: asNumber(buildResult.rows[0]?.total),
      experiments: experimentsResult.rows[0]?.experiments || 0,
      leads: experimentsResult.rows[0]?.leads || 0,
      lastBuildAt: (buildResult.rows[0]?.last_build_at as Date | null) || null,
      lastExperimentDate: (experimentsResult.rows[0]?.last_experiment_date as string | null) || null,
    },
    projectRankings,
    channelPerformance,
    alerts: alertsResult.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      severity: row.severity as CeoAlertSeverity,
      title: row.title as string,
      status: row.status as string,
      createdAt: row.created_at as Date,
    })),
    autopostQueue: autopostResult.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      channel: row.channel as string,
      status: row.status as string,
      scheduledAt: row.scheduled_at as Date | null,
      createdAt: row.created_at as Date,
    })),
  };
}

export async function runMonitoringCycle(): Promise<CeoMonitoringRunResult> {
  const usersResult = await pool.query(
    `SELECT DISTINCT user_id FROM ceo_configs
     UNION
     SELECT DISTINCT user_id FROM ceo_finance_entries
     UNION
     SELECT DISTINCT user_id FROM ceo_build_logs
     UNION
     SELECT DISTINCT user_id FROM ceo_growth_experiments
     UNION
     SELECT DISTINCT user_id FROM telegram_connections WHERE is_active = true`
  );

  let usersProcessed = 0;
  let dailyRuns = 0;
  let weeklyRuns = 0;
  let biweeklyRuns = 0;
  let alertsQueued = 0;

  for (const row of usersResult.rows as Array<{ user_id: string }>) {
    const userId = row.user_id;

    try {
      const config = await getOrCreateConfig(userId);
      const localTime = getLocalTimeParts(config.timezone);
      usersProcessed++;

      if (isSameLocalTime(localTime, config.dailyMorningTime)) {
        const slot = `${localTime.isoDate} ${config.dailyMorningTime}`;
        const claimed = await claimRunSlot(userId, 'ceo_daily_morning', slot);
        if (claimed) {
          const result = await runDailyCheckForUser(userId, 'morning');
          dailyRuns++;
          alertsQueued += result.alertsQueued;
        }
      }

      if (isSameLocalTime(localTime, config.dailyEveningTime)) {
        const slot = `${localTime.isoDate} ${config.dailyEveningTime}`;
        const claimed = await claimRunSlot(userId, 'ceo_daily_evening', slot);
        if (claimed) {
          const result = await runDailyCheckForUser(userId, 'evening');
          dailyRuns++;
          alertsQueued += result.alertsQueued;
        }
      }

      if (localTime.weekday === config.weeklyReportWeekday && isSameLocalTime(localTime, config.weeklyReportTime)) {
        const slot = `${localTime.isoDate} ${config.weeklyReportTime}`;
        const claimed = await claimRunSlot(userId, 'ceo_weekly', slot);
        if (claimed) {
          await runWeeklyBriefForUser(userId);
          weeklyRuns++;
        }
      }

      const weekNumber = isoWeekNumber(localTime.isoDate);
      const biweeklyDue = weekNumber % 2 === 0;
      if (
        biweeklyDue &&
        localTime.weekday === config.biweeklyAuditWeekday &&
        isSameLocalTime(localTime, config.biweeklyAuditTime)
      ) {
        const slot = `${localTime.isoDate} ${config.biweeklyAuditTime}`;
        const claimed = await claimRunSlot(userId, 'ceo_biweekly', slot);
        if (claimed) {
          await runBiweeklyAuditForUser(userId);
          biweeklyRuns++;
        }
      }
    } catch (error) {
      logger.error('CEO monitoring cycle failed for user', {
        userId,
        error: (error as Error).message,
      });
    }
  }

  return {
    usersProcessed,
    dailyRuns,
    weeklyRuns,
    biweeklyRuns,
    alertsQueued,
  };
}

export async function runMaintenanceCleanup(): Promise<{ deletedRows: number }> {
  const deletions = await Promise.all([
    pool.query(
      `DELETE FROM ceo_finance_entries
       WHERE occurred_on < CURRENT_DATE - INTERVAL '90 days'`
    ),
    pool.query(
      `DELETE FROM ceo_build_logs
       WHERE occurred_at < NOW() - INTERVAL '90 days'`
    ),
    pool.query(
      `DELETE FROM ceo_growth_experiments
       WHERE occurred_on < CURRENT_DATE - INTERVAL '90 days'`
    ),
    pool.query(
      `DELETE FROM ceo_leads
       WHERE occurred_on < CURRENT_DATE - INTERVAL '90 days'`
    ),
    pool.query(
      `DELETE FROM ceo_alerts
       WHERE created_at < NOW() - INTERVAL '90 days'
         AND status IN ('sent', 'resolved', 'suppressed')`
    ),
    pool.query(
      `DELETE FROM ceo_autopost_queue
       WHERE created_at < NOW() - INTERVAL '90 days'
         AND status IN ('posted', 'failed', 'cancelled')`
    ),
    pool.query(
      `DELETE FROM ceo_reports
       WHERE created_at < NOW() - INTERVAL '365 days'`
    ),
  ]);

  const deletedRows = deletions.reduce((sum, result) => sum + (result.rowCount || 0), 0);
  return { deletedRows };
}

function formatDashboardSummary(dashboard: CeoDashboard): string {
  const lines: string[] = [];
  lines.push(`CEO status (${dashboard.config.mode}, ${dashboard.config.timezone})`);
  lines.push(`Burn ${dashboard.financial.periodDays}d: ${formatMoney(dashboard.financial.burnNetUsd)} (expenses ${formatMoney(dashboard.financial.expenseTotalUsd)}, income ${formatMoney(dashboard.financial.incomeTotalUsd)})`);
  lines.push(`Projected 30d cash need: ${formatMoney(dashboard.financial.projected30dBurnUsd)}`);
  lines.push(`Build hours: ${dashboard.activity.buildHours.toFixed(1)} | Experiments: ${dashboard.activity.experiments} | Leads: ${dashboard.activity.leads}`);

  if (dashboard.projectRankings.length > 0) {
    const top = dashboard.projectRankings[0];
    lines.push(`Top project: ${top.projectKey} (opp ${top.opportunityScore.toFixed(2)}, risk ${top.riskScore.toFixed(2)})`);
  }

  if (dashboard.channelPerformance.length > 0) {
    const channel = dashboard.channelPerformance[0];
    lines.push(`Top channel: ${channel.channel} (score ${channel.score.toFixed(2)}, leads ${channel.leads})`);
  }

  return lines.join('\n');
}

function parseAmountToken(token: string): number {
  const cleaned = token.toLowerCase().replace(/usd/g, '').replace(/\$/g, '');
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function parseHoursToken(token: string): number {
  const cleaned = token.toLowerCase().endsWith('h') ? token.slice(0, -1) : token;
  const parsed = parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : NaN;
}

async function handleExpenseCommand(userId: string, text: string): Promise<CommandResult> {
  const config = await getOrCreateConfig(userId);
  const localDate = getLocalTimeParts(config.timezone).isoDate;

  const tokens = text.trim().split(/\s+/).slice(1);
  if (tokens.length < 3) {
    return { handled: false };
  }

  let index = 0;
  let date = localDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(tokens[0])) {
    date = tokens[0];
    index++;
  }

  const vendor = (tokens[index] || '').replace(/_/g, ' ');
  index++;
  const amount = parseAmountToken(tokens[index] || '');
  index++;

  if (!vendor || !Number.isFinite(amount)) {
    return { handled: false };
  }

  if (tokens[index] && tokens[index].toLowerCase() === 'usd') {
    index++;
  }

  const category = (tokens[index] || 'other').toLowerCase();
  if (tokens[index]) index++;
  const cadence = tokens[index] ? tokens[index].toLowerCase() : 'one_time';
  if (tokens[index]) index++;
  const notes = tokens.slice(index).join(' ') || undefined;

  await logExpense(userId, {
    date,
    vendor,
    amountUsd: amount,
    category,
    cadence,
    notes,
    source: 'telegram',
  });

  return {
    handled: true,
    response: `Logged expense: ${formatMoney(amount)} to ${vendor} on ${date} (${category}/${normalizeCadence(cadence)}).`,
  };
}

async function handleIncomeCommand(userId: string, text: string): Promise<CommandResult> {
  const config = await getOrCreateConfig(userId);
  const localDate = getLocalTimeParts(config.timezone).isoDate;

  const tokens = text.trim().split(/\s+/).slice(1);
  if (tokens.length < 3) {
    return { handled: false };
  }

  let index = 0;
  let date = localDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(tokens[0])) {
    date = tokens[0];
    index++;
  }

  const source = (tokens[index] || '').replace(/_/g, ' ');
  index++;
  const amount = parseAmountToken(tokens[index] || '');
  index++;

  if (!source || !Number.isFinite(amount)) {
    return { handled: false };
  }

  if (tokens[index] && tokens[index].toLowerCase() === 'usd') {
    index++;
  }

  const category = (tokens[index] || 'revenue').toLowerCase();
  if (tokens[index]) index++;
  const cadence = tokens[index] ? tokens[index].toLowerCase() : 'one_time';
  if (tokens[index]) index++;
  const notes = tokens.slice(index).join(' ') || undefined;

  await logIncome(userId, {
    date,
    vendor: source,
    amountUsd: amount,
    category,
    cadence,
    notes,
    source: 'telegram',
  });

  return {
    handled: true,
    response: `Logged income: ${formatMoney(amount)} from ${source} on ${date}.`,
  };
}

async function handleBuildCommand(userId: string, text: string): Promise<CommandResult> {
  const tokens = text.trim().split(/\s+/).slice(1);
  if (tokens.length < 2) {
    return { handled: false };
  }

  const projectKey = tokens[0];
  const hours = parseHoursToken(tokens[1]);

  if (!Number.isFinite(hours)) {
    return { handled: false };
  }

  const { values, freeTokens } = splitKeyValueTokens(tokens.slice(2));
  const item = freeTokens.join(' ').trim() || values.item;

  await logBuild(userId, {
    projectKey,
    hours,
    item,
    stage: values.stage,
    impact: values.impact,
    occurredAt: values.date,
    source: 'telegram',
  });

  return {
    handled: true,
    response: `Logged build: ${projectKey}, ${hours.toFixed(1)}h${item ? `, ${item}` : ''}.`,
  };
}

async function handleExperimentCommand(userId: string, text: string): Promise<CommandResult> {
  const tokens = text.trim().split(/\s+/).slice(1);
  if (tokens.length < 1) {
    return { handled: false };
  }

  if (!text.includes('=') && tokens.length < 3) {
    return { handled: false };
  }

  const name = tokens[0];
  const { values, freeTokens } = splitKeyValueTokens(tokens.slice(1));

  const channel = (values.channel || values.source || inferChannelFromName(name)).toLowerCase();
  const costUsd = Number.isFinite(parseFloat(values.cost || '')) ? parseFloat(values.cost || '0') : 0;
  const leads = Number.isFinite(parseInt(values.leads || '', 10)) ? parseInt(values.leads || '0', 10) : 0;
  const outcome = values.outcome || 'pending';
  const status = values.status || (outcome === 'pending' ? 'running' : 'completed');

  const notesParts: string[] = [];
  if (values.angle) notesParts.push(`angle=${values.angle}`);
  if (values.note) notesParts.push(values.note);
  if (freeTokens.length > 0) notesParts.push(freeTokens.join(' '));
  const notes = notesParts.join(' ').trim() || undefined;

  await logExperiment(userId, {
    date: values.date,
    channel,
    name,
    costUsd,
    leads,
    outcome,
    status,
    notes,
    source: 'telegram',
  });

  return {
    handled: true,
    response: `Logged experiment: ${name} on ${channel} (cost ${formatMoney(costUsd)}, leads ${leads}, outcome ${normalizeOutcome(outcome)}).`,
  };
}

async function handleLeadCommand(userId: string, text: string): Promise<CommandResult> {
  const tokens = text.trim().split(/\s+/).slice(1);
  if (tokens.length < 1) {
    return { handled: false };
  }

  if (!text.includes('=') && tokens.length < 2) {
    return { handled: false };
  }

  const { values, freeTokens } = splitKeyValueTokens(tokens);
  const source = (values.source || freeTokens[0] || 'unknown').toLowerCase();
  const status = values.status || 'new';
  const valueEstimateUsd = Number.isFinite(parseFloat(values.value || ''))
    ? parseFloat(values.value || '0')
    : undefined;

  const noteTokens = freeTokens.slice(values.source ? 0 : 1);
  if (values.note) noteTokens.push(values.note);
  const notes = noteTokens.join(' ').trim() || undefined;

  await logLead(userId, {
    date: values.date,
    source,
    status,
    valueEstimateUsd,
    notes,
  });

  return {
    handled: true,
    response: `Logged lead: source=${source}, status=${normalizeLeadStatus(status)}${valueEstimateUsd !== undefined ? `, value=${formatMoney(valueEstimateUsd)}` : ''}.`,
  };
}

async function handleProjectCommand(userId: string, text: string): Promise<CommandResult> {
  const tokens = text.trim().split(/\s+/).slice(1);
  if (tokens.length < 1) {
    return { handled: false };
  }

  if (!text.includes('=') && tokens.length < 2) {
    return { handled: false };
  }

  const projectKey = tokens[0];
  const { values, freeTokens } = splitKeyValueTokens(tokens.slice(1));

  await logProjectSnapshot(userId, {
    projectKey,
    stage: values.stage,
    revenuePotentialUsd: asNumber(values.revenue ?? values.potential, 0),
    estimatedHours: Math.max(1, asNumber(values.hours, 1)),
    strategicLeverage: Math.max(0.1, asNumber(values.leverage, 1)),
    winProbability: Math.max(0, Math.min(1, asNumber(values.win ?? values.prob, 0.5))),
    dependencyRisk: Math.max(0, Math.round(asNumber(values.risk, 0))),
    confidenceScore: Math.max(0, Math.min(1, asNumber(values.confidence, 0.5))),
    notes: freeTokens.join(' ') || values.notes,
  });

  return {
    handled: true,
    response: `Logged project snapshot for ${projectKey}.`,
  };
}

async function handleAutopostCommand(userId: string, text: string): Promise<CommandResult> {
  const tokens = text.trim().split(/\s+/);
  const action = (tokens[1] || 'help').toLowerCase();

  if (action === 'list') {
    const posts = await listAutopostQueue(userId, 10);
    if (posts.length === 0) {
      return { handled: true, response: 'No autopost items yet.' };
    }

    const lines = posts.map((post, index) => (
      `${index + 1}. ${post.id} | ${post.channel} | ${post.status}${post.scheduledAt ? ` | ${post.scheduledAt.toISOString()}` : ''}`
    ));

    return {
      handled: true,
      response: `Autopost queue:\n${lines.join('\n')}`,
    };
  }

  if (action === 'channels') {
    const channels = await listAutopostChannels(userId);
    const lines = channels.map((channel, index) => (
      `${index + 1}. ${channel.channel} | enabled=${channel.isEnabled} | mode=${channel.postingMode} | webhook=${channel.webhookPath || '-'} | ref=${channel.channelRef || '-'}`
    ));

    return {
      handled: true,
      response: `Autopost channels:\n${lines.join('\n')}`,
    };
  }

  if (action === 'approve') {
    const id = tokens[2];
    if (!id) {
      return { handled: true, response: 'Usage: autopost approve <id>' };
    }
    const ok = await approveAutopostItem(userId, id);
    return {
      handled: true,
      response: ok ? `Approved autopost ${id}.` : `Could not approve ${id}. Check ID/status.`,
    };
  }

  if (action === 'cancel') {
    const id = tokens[2];
    if (!id) {
      return { handled: true, response: 'Usage: autopost cancel <id>' };
    }
    const ok = await cancelAutopostItem(userId, id);
    return {
      handled: true,
      response: ok ? `Cancelled autopost ${id}.` : `Could not cancel ${id}.`,
    };
  }

  if (action === 'show') {
    const id = tokens[2];
    if (!id) {
      return { handled: true, response: 'Usage: autopost show <id>' };
    }

    const result = await pool.query(
      `SELECT id, channel, title, status, content, created_at, scheduled_at
       FROM ceo_autopost_queue
       WHERE user_id = $1 AND id = $2
       LIMIT 1`,
      [userId, id]
    );

    if (result.rows.length === 0) {
      return { handled: true, response: `Autopost item not found: ${id}` };
    }

    const row = result.rows[0] as Record<string, unknown>;
    const title = row.title ? String(row.title) : '(no title)';
    const scheduledAt = row.scheduled_at ? new Date(String(row.scheduled_at)).toISOString() : 'not scheduled';

    return {
      handled: true,
      response: [
        `Autopost ${row.id}`,
        `channel: ${row.channel}`,
        `status: ${row.status}`,
        `title: ${title}`,
        `created: ${new Date(String(row.created_at)).toISOString()}`,
        `scheduled: ${scheduledAt}`,
        '',
        'content:',
        String(row.content || ''),
      ].join('\n'),
    };
  }

  if (action === 'draft') {
    const channel = (tokens[2] || '').toLowerCase() as AutopostChannel;
    if (!['x', 'linkedin', 'telegram', 'blog', 'reddit'].includes(channel)) {
      return { handled: true, response: 'Usage: autopost draft <x|linkedin|telegram|blog|reddit> <content>' };
    }
    const content = tokens.slice(3).join(' ').trim();
    if (!content) {
      return { handled: true, response: 'Usage: autopost draft <channel> <content>' };
    }
    const id = await createAutopostDraft(userId, channel, content);
    return { handled: true, response: `Created autopost draft ${id} for ${channel}.` };
  }

  if (action === 'run') {
    const result = await processAutopostQueue(20, userId);
    return {
      handled: true,
      response: `Autopost worker: attempted ${result.attempted}, posted ${result.posted}, failed ${result.failed}.`,
    };
  }

  return {
    handled: true,
    response: [
      'Autopost commands:',
      'autopost list',
      'autopost channels',
      'autopost show <id>',
      'autopost draft <channel> <content>',
      'autopost approve <id>',
      'autopost cancel <id>',
      'autopost run',
    ].join('\n'),
  };
}

async function handleCeoCommand(userId: string, text: string): Promise<CommandResult> {
  const tokens = text.trim().split(/\s+/);
  const action = (tokens[1] || 'help').toLowerCase();

  if (action === 'status') {
    const dashboard = await getDashboard(userId, 30);
    return {
      handled: true,
      response: formatDashboardSummary(dashboard),
    };
  }

  if (action === 'daily') {
    const result = await runDailyCheckForUser(userId, 'manual');
    return {
      handled: true,
      response: `Daily check complete. Alerts queued: ${result.alertsQueued}. Report: ${result.reportId}.`,
    };
  }

  if (action === 'brief') {
    const result = await runWeeklyBriefForUser(userId);
    return {
      handled: true,
      response: `Weekly brief delivered. Report: ${result.reportId}. Radar signals: ${result.radarSignalsInserted}. Drafts: ${result.draftsCreated}.`,
    };
  }

  if (action === 'audit') {
    const result = await runBiweeklyAuditForUser(userId);
    return {
      handled: true,
      response: `Bi-weekly audit delivered. Report: ${result.reportId}.`,
    };
  }

  if (action === 'config') {
    const { values } = splitKeyValueTokens(tokens.slice(2));

    const updates: UpdateCeoConfigInput = {};

    if (values.mode) {
      const mode = values.mode.toLowerCase();
      if (mode === 'pre_revenue' || mode === 'normal') {
        updates.mode = mode;
      }
    }
    if (values.timezone) {
      updates.timezone = values.timezone;
    }
    if (values.no_build_days) {
      updates.noBuildDaysThreshold = Math.max(1, Math.round(asNumber(values.no_build_days, 2)));
    }
    if (values.no_experiment_days) {
      updates.noExperimentDaysThreshold = Math.max(1, Math.round(asNumber(values.no_experiment_days, 3)));
    }
    if (values.daily_morning) {
      updates.dailyMorningTime = values.daily_morning;
    }
    if (values.daily_evening) {
      updates.dailyEveningTime = values.daily_evening;
    }
    if (values.weekly_time) {
      updates.weeklyReportTime = values.weekly_time;
    }
    if (values.autopost_enabled) {
      updates.autopostEnabled = values.autopost_enabled === 'true' || values.autopost_enabled === '1';
    }

    const updated = await updateConfig(userId, updates);

    return {
      handled: true,
      response: [
        'Updated CEO config:',
        `mode=${updated.mode}`,
        `timezone=${updated.timezone}`,
        `no_build_days=${updated.noBuildDaysThreshold}`,
        `no_experiment_days=${updated.noExperimentDaysThreshold}`,
        `daily=${updated.dailyMorningTime}/${updated.dailyEveningTime}`,
        `weekly=${updated.weeklyReportTime} (weekday ${updated.weeklyReportWeekday})`,
        `autopost_enabled=${updated.autopostEnabled}`,
      ].join('\n'),
    };
  }

  return {
    handled: true,
    response: [
      'CEO commands:',
      'ceo status',
      'ceo daily',
      'ceo brief',
      'ceo audit',
      'ceo config mode=pre_revenue timezone=Europe/Stockholm no_build_days=2 no_experiment_days=3',
      '',
      'Logging commands:',
      'expense 2026-02-22 google_pro_ai 20 usd tool monthly',
      'income 2026-02-22 stripe 120 usd subscription monthly',
      'build luna-chat 4h auth refactor stage=build impact=high',
      'experiment x_thread channel=x cost=0 leads=3 outcome=pending',
      'lead inbound source=x status=new',
      'project luna-chat stage=build revenue=2500 hours=40 win=0.4 leverage=1.2 risk=2 confidence=0.7',
      '',
      'Autopost commands:',
      'autopost list | autopost draft <channel> <content> | autopost approve <id> | autopost run',
    ].join('\n'),
  };
}

export async function handleTelegramCommand(userId: string, text: string): Promise<CommandResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { handled: false };
  }

  try {
    if (/^expense\s+/i.test(trimmed)) return handleExpenseCommand(userId, trimmed);
    if (/^income\s+/i.test(trimmed)) return handleIncomeCommand(userId, trimmed);
    if (/^build\s+/i.test(trimmed)) return handleBuildCommand(userId, trimmed);
    if (/^experiment\s+/i.test(trimmed)) return handleExperimentCommand(userId, trimmed);
    if (/^lead\s+/i.test(trimmed)) return handleLeadCommand(userId, trimmed);
    if (/^project\s+/i.test(trimmed)) return handleProjectCommand(userId, trimmed);
    if (/^autopost(\s|$)/i.test(trimmed)) return handleAutopostCommand(userId, trimmed);
    if (/^ceo(\s|$)/i.test(trimmed)) return handleCeoCommand(userId, trimmed);
  } catch (error) {
    logger.error('Failed to handle CEO Telegram command', {
      userId,
      text: trimmed,
      error: (error as Error).message,
    });

    return {
      handled: true,
      response: `Command failed: ${(error as Error).message}`,
    };
  }

  return { handled: false };
}
