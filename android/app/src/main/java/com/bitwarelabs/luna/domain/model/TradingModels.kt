package com.bitwarelabs.luna.domain.model

import kotlinx.serialization.Serializable

// ============================================
// PORTFOLIO & PRICES
// ============================================

@Serializable
data class Portfolio(
    val totalValueUsdt: Double,
    val availableUsdt: Double,
    val holdings: List<PortfolioHolding>,
    val dailyPnl: Double? = null,
    val dailyPnlPct: Double? = null
)

@Serializable
data class PortfolioHolding(
    val symbol: String,
    val asset: String,
    val amount: Double,
    val valueUsdt: Double,
    val price: Double,
    val priceChange24h: Double? = null,
    val allocationPct: Double? = null,
    val wallet: String? = null
)

@Serializable
data class PriceData(
    val symbol: String,
    val price: Double,
    val change24h: Double? = null,
    val change24hPct: Double? = null,
    val volume24h: Double? = null
)

@Serializable
data class Kline(
    val openTime: Long,
    val open: Double,
    val high: Double,
    val low: Double,
    val close: Double,
    val volume: Double,
    val closeTime: Long
)

// ============================================
// TRADING SETTINGS
// ============================================

@Serializable
data class TradingSettings(
    val userId: String? = null,
    val binanceConnected: Boolean = false,
    val exchangeConnected: Boolean = false,
    val activeExchange: String? = null,
    val maxPositionPct: Double = 10.0,
    val dailyLossLimitPct: Double = 5.0,
    val requireStopLoss: Boolean = true,
    val defaultStopLossPct: Double = 2.0,
    val useAtrStopLoss: Boolean = false,
    val atrMultiplier: Double = 1.5,
    val allowedSymbols: List<String>? = null,
    val riskTolerance: String = "moderate",
    val paperMode: Boolean = true,
    val paperBalanceUsdc: Double = 10000.0,
    val stopConfirmationThresholdUsd: Double = 100.0,
    val marginEnabled: Boolean = false,
    val leverage: Int = 1
)

// ============================================
// TRADES & ORDERS
// ============================================

@Serializable
data class Trade(
    val id: String,
    val symbol: String,
    val side: String,
    val type: String,
    val status: String,
    val quantity: Double,
    val price: Double? = null,
    val entryPrice: Double? = null,
    val exitPrice: Double? = null,
    val stopLoss: Double? = null,
    val takeProfit: Double? = null,
    val trailingStopPct: Double? = null,
    val pnl: Double? = null,
    val pnlPct: Double? = null,
    val notes: String? = null,
    val source: String? = null,
    val isPaper: Boolean = false,
    val createdAt: String,
    val updatedAt: String? = null,
    val closedAt: String? = null
)

@Serializable
data class ActiveTrade(
    val id: String,
    val symbol: String,
    val side: String,
    val quantity: Double,
    val entryPrice: Double,
    val currentPrice: Double,
    val stopLossPrice: Double? = null,
    val takeProfitPrice: Double? = null,
    val trailingStopPct: Double? = null,
    val unrealizedPnl: Double,
    val unrealizedPnlPct: Double,
    val value: Double,
    val isPaper: Boolean = false,
    val source: String? = null,
    val createdAt: String,
    val pnlDollar: Double? = null,
    val pnlPercent: Double? = null
)

@Serializable
data class ActiveTradesResponse(
    val openPositions: List<ActiveTrade>,
    val pendingOrders: List<ActiveTrade>
)

@Serializable
data class OrderRequest(
    val symbol: String,
    val side: String,
    val type: String,
    val quantity: Double? = null,
    val quoteAmount: Double? = null,
    val price: Double? = null,
    val stopLoss: Double? = null,
    val takeProfit: Double? = null,
    val notes: String? = null
)

@Serializable
data class UpdateSLTPRequest(
    val stopLossPrice: Double? = null,
    val takeProfitPrice: Double? = null,
    val trailingStopPct: Double? = null
)

@Serializable
data class StopTradeRequest(
    val skipConfirmation: Boolean = false
)

@Serializable
data class StopTradeResponse(
    val success: Boolean,
    val requiresConfirmation: Boolean = false,
    val tradeValue: Double? = null,
    val message: String? = null,
    val error: String? = null
)

// ============================================
// TRADING STATS
// ============================================

@Serializable
data class TradingStats(
    val totalTrades: Int,
    val winningTrades: Int,
    val losingTrades: Int,
    val winRate: Double,
    val totalPnl: Double,
    val totalPnlPct: Double,
    val averagePnl: Double,
    val averagePnlPct: Double,
    val bestTrade: Double? = null,
    val worstTrade: Double? = null,
    val profitFactor: Double? = null
)

// ============================================
// PAPER TRADING
// ============================================

@Serializable
data class PaperPortfolio(
    val balanceUsdc: Double,
    val positions: List<PaperPosition>,
    val totalValue: Double,
    val pnl: Double,
    val pnlPct: Double
)

@Serializable
data class PaperPosition(
    val symbol: String,
    val quantity: Double,
    val entryPrice: Double,
    val currentPrice: Double,
    val value: Double,
    val pnl: Double,
    val pnlPct: Double
)

// ============================================
// RESEARCH SIGNALS
// ============================================

@Serializable
data class ResearchSettings(
    val executionMode: String = "manual",
    val paperLiveMode: String = "paper",
    val enableAutoDiscovery: Boolean = true,
    val autoDiscoveryLimit: Int = 20,
    val customSymbols: List<String> = emptyList(),
    val minConfidence: Double = 0.6
)

@Serializable
data class ResearchSignal(
    val id: String,
    val symbol: String,
    val signalType: String,
    val confidence: Double,
    val entryPrice: Double,
    val stopLoss: Double? = null,
    val takeProfit: Double? = null,
    val indicators: SignalIndicators? = null,
    val status: String,
    val reason: String? = null,
    val createdAt: String,
    val executedAt: String? = null
)

@Serializable
data class SignalIndicators(
    val rsi: Double? = null,
    val macd: MacdData? = null,
    val ema: EmaData? = null,
    val volume: VolumeData? = null,
    val priceChange: Double? = null
)

@Serializable
data class MacdData(
    val macd: Double,
    val signal: Double,
    val histogram: Double
)

@Serializable
data class EmaData(
    val short: Double,
    val medium: Double,
    val long: Double
)

@Serializable
data class VolumeData(
    val current: Double,
    val average: Double,
    val ratio: Double
)

@Serializable
data class ResearchMetrics(
    val research: ResearchMetricsData,
    val scalping: ScalpingStats? = null
)

@Serializable
data class ResearchMetricsData(
    val totalSignals: Int,
    val executedSignals: Int,
    val winRate: Double,
    val avgPnl: Double
)

// ============================================
// SCALPING
// ============================================

@Serializable
data class ScalpingSettings(
    val enabled: Boolean = false,
    val mode: String = "paper",
    val maxPositionUsdt: Double = 100.0,
    val maxConcurrentPositions: Int = 3,
    val symbols: List<String> = listOf("BTCUSDC", "ETHUSDC", "SOLUSDC"),
    val minDropPct: Double = 2.0,
    val maxDropPct: Double = 10.0,
    val rsiOversoldThreshold: Double = 30.0,
    val volumeSpikeMultiplier: Double = 2.0,
    val minConfidence: Double = 0.6,
    val takeProfitPct: Double = 1.5,
    val stopLossPct: Double = 1.0,
    val maxHoldMinutes: Int = 60
)

@Serializable
data class ScalpingStats(
    val totalTrades: Int,
    val winRate: Double,
    val totalPnl: Double,
    val avgHoldTime: Double? = null
)

@Serializable
data class ScalpingPosition(
    val id: String,
    val symbol: String,
    val quantity: Double,
    val entryPrice: Double,
    val currentPrice: Double,
    val pnl: Double,
    val pnlPct: Double,
    val holdTimeMinutes: Int,
    val createdAt: String
)

// ============================================
// BOTS
// ============================================

@Serializable
data class Bot(
    val id: String,
    val userId: String? = null,
    val name: String,
    val type: String,
    val symbol: String,
    val status: String,
    val config: kotlinx.serialization.json.JsonObject? = null,
    val lastError: String? = null,
    val totalProfit: Double = 0.0,
    val totalTrades: Int = 0,
    val winRate: Double = 0.0,
    val createdAt: String,
    val updatedAt: String? = null,
    val startedAt: String? = null,
    val stoppedAt: String? = null
)

@Serializable
data class CreateBotRequest(
    val name: String,
    val type: String,
    val symbol: String,
    val config: Map<String, String>,
    val marketType: String = "spot"
)

@Serializable
data class BotTemplate(
    val type: String,
    val name: String,
    val icon: String,
    val shortDescription: String,
    val description: String,
    val howItWorks: List<String>,
    val bestFor: List<String>,
    val risks: List<String>,
    val parameters: List<BotParameter>,
    val examples: List<String>? = null,
    val tips: List<String>? = null,
    val warnings: List<String>? = null
)

@Serializable
data class BotParameter(
    val name: String,
    val type: String,
    val description: String,
    val default: String? = null,
    val min: Double? = null,
    val max: Double? = null
)

// ============================================
// CONDITIONAL ORDERS (Trade Rules)
// ============================================

@Serializable
data class ConditionalOrder(
    val id: String,
    val symbol: String,
    val condition: String,
    val triggerPrice: Double,
    val action: ConditionalAction,
    val status: String,
    val expiresAt: String? = null,
    val triggeredAt: String? = null,
    val createdAt: String
)

@Serializable
data class ConditionalAction(
    val side: String,
    val type: String = "market",
    val amountType: String,
    val amount: Double,
    val limitPrice: Double? = null,
    val stopLoss: Double? = null,
    val takeProfit: Double? = null,
    val trailingStopPct: Double? = null
)

@Serializable
data class CreateConditionalOrderRequest(
    val symbol: String,
    val condition: String,
    val triggerPrice: Double,
    val action: ConditionalAction,
    val expiresInHours: Int? = null
)

// ============================================
// AUTO TRADING
// ============================================

@Serializable
data class AutoTradingSettings(
    val enabled: Boolean = false,
    val maxPositions: Int = 3,
    val rsiThreshold: Double = 30.0,
    val volumeMultiplier: Double = 2.0,
    val minPositionPct: Double = 1.0,
    val maxPositionPct: Double = 5.0,
    val dailyLossLimitPct: Double = 5.0,
    val maxConsecutiveLosses: Int = 3,
    val symbolCooldownMinutes: Int = 30,
    val strategy: String = "rsi_oversold",
    val strategyMode: String = "manual",
    val excludedSymbols: List<String> = emptyList(),
    val excludeTop10: Boolean = false,
    val btcTrendFilter: Boolean = true,
    val btcMomentumBoost: Boolean = false,
    val btcCorrelationSkip: Boolean = false
)

@Serializable
data class AutoTradingState(
    val isRunning: Boolean,
    val activePositions: Int,
    val todayTrades: Int,
    val todayPnl: Double,
    val consecutiveLosses: Int,
    val lastTradeAt: String? = null,
    val currentStrategy: String? = null
)

@Serializable
data class AutoTradeHistory(
    val id: String,
    val symbol: String,
    val side: String,
    val quantity: Double,
    val entryPrice: Double,
    val exitPrice: Double? = null,
    val pnl: Double? = null,
    val pnlPct: Double? = null,
    val strategy: String,
    val status: String,
    val createdAt: String,
    val closedAt: String? = null
)

@Serializable
data class TradingStrategy(
    val id: String,
    val meta: StrategyMeta,
    val performance: StrategyPerformance
)

@Serializable
data class StrategyMeta(
    val id: String,
    val name: String,
    val description: String,
    val icon: String? = null,
    val riskLevel: String? = null
)

@Serializable
data class StrategyPerformance(
    val strategy: String,
    val wins: Int,
    val losses: Int,
    val breakeven: Int,
    val totalTrades: Int,
    val winRate: Double,
    val avgPnlPct: Double
)

@Serializable
data class MarketRegime(
    val regime: String,
    val btcTrend: String,
    val volatility: String,
    val confidence: Double
)

@Serializable
data class SignalCandidate(
    val symbol: String,
    val rsi: Double,
    val volumeRatio: Double,
    val priceChange: Double,
    val distanceToTrigger: Double,
    val estimatedConfidence: Double
)

// ============================================
// MARGIN TRADING
// ============================================

@Serializable
data class MarginAccountInfo(
    val equity: Double,
    val balance: Double,
    val availableMargin: Double,
    val usedMargin: Double,
    val marginRatio: Double,
    val leverage: Int
)

@Serializable
data class MarginPosition(
    val symbol: String,
    val side: String,
    val quantity: Double,
    val entryPrice: Double,
    val markPrice: Double,
    val liquidationPrice: Double? = null,
    val unrealizedPnl: Double,
    val leverage: Int
)

@Serializable
data class MarginOrderRequest(
    val symbol: String,
    val side: String,
    val type: String,
    val quantity: Double? = null,
    val quoteAmount: Double? = null,
    val price: Double? = null,
    val leverage: Int? = null,
    val stopLoss: Double? = null,
    val takeProfit: Double? = null
)

// ============================================
// INDICATOR SETTINGS
// ============================================

@Serializable
data class IndicatorSettings(
    val preset: String = "balanced",
    val enableRsi: Boolean = true,
    val enableMacd: Boolean = true,
    val enableBollinger: Boolean = true,
    val enableEma: Boolean = true,
    val enableVolume: Boolean = true,
    val enablePriceAction: Boolean = true,
    val weights: IndicatorWeights = IndicatorWeights(),
    val minConfidence: Double = 0.6,
    val macdFast: Int = 12,
    val macdSlow: Int = 26,
    val macdSignal: Int = 9,
    val bollingerPeriod: Int = 20,
    val bollingerStddev: Double = 2.0,
    val emaShort: Int = 9,
    val emaMedium: Int = 21,
    val emaLong: Int = 50,
    val volumeAvgPeriod: Int = 20,
    val volumeSpikeThreshold: Double = 2.0
)

@Serializable
data class IndicatorWeights(
    val rsi: Double = 0.2,
    val macd: Double = 0.2,
    val bollinger: Double = 0.15,
    val ema: Double = 0.15,
    val volume: Double = 0.15,
    val priceAction: Double = 0.15
)

@Serializable
data class AdvancedSignalSettings(
    val enableMtfConfluence: Boolean = false,
    val mtfHigherTimeframe: String = "4h",
    val enableVwapEntry: Boolean = false,
    val vwapAnchorType: String = "session",
    val enableAtrStops: Boolean = false,
    val atrPeriod: Int = 14,
    val atrSlMultiplier: Double = 2.0,
    val atrTpMultiplier: Double = 3.0,
    val enableBtcFilter: Boolean = false,
    val btcDumpThreshold: Double = 2.0,
    val btcLookbackMinutes: Int = 30,
    val enableLiquiditySweep: Boolean = false,
    val sweepWickRatio: Double = 2.0,
    val sweepVolumeMultiplier: Double = 1.5
)

// ============================================
// TRADING RULES (Visual Builder)
// ============================================

@Serializable
data class TradingRule(
    val id: String,
    val name: String,
    val description: String,
    val enabled: Boolean,
    val conditionLogic: String,
    val conditions: List<RuleCondition>,
    val actions: List<RuleAction>,
    val maxExecutions: Int? = null,
    val cooldownMinutes: Int? = null,
    val executionCount: Int = 0,
    val lastExecutedAt: String? = null,
    val createdAt: String
)

@Serializable
data class RuleCondition(
    val id: String,
    val type: String,
    val symbol: String? = null,
    val indicator: String? = null,
    val timeframe: String? = null,
    val operator: String,
    val value: Double
)

@Serializable
data class RuleAction(
    val id: String,
    val type: String,
    val symbol: String? = null,
    val amountType: String,
    val amount: Double,
    val orderType: String,
    val limitPrice: Double? = null,
    val stopLoss: Double? = null,
    val takeProfit: Double? = null
)

// ============================================
// TRADING CHAT
// ============================================

@Serializable
data class TradingChatMessage(
    val id: String,
    val role: String,
    val content: String,
    val createdAt: String
)

@Serializable
data class TradingChatResponse(
    val message: TradingChatMessage,
    val action: TradingChatAction? = null
)

@Serializable
data class TradingChatAction(
    val type: String,
    val data: Map<String, String>? = null
)
