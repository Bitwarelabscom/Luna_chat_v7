package com.bitwarelabs.luna.domain.repository

import com.bitwarelabs.luna.data.api.*
import com.bitwarelabs.luna.domain.model.*

interface TradingRepository {
    // Connection & Settings
    suspend fun connectExchange(apiKey: String, apiSecret: String, exchange: String, marginEnabled: Boolean, leverage: Int): Result<ConnectExchangeResponse>
    suspend fun disconnectExchange(): Result<Unit>
    suspend fun getExchangeType(): Result<String?>
    suspend fun getSettings(): Result<TradingSettings>
    suspend fun updateSettings(settings: TradingSettings): Result<TradingSettings>

    // Portfolio & Prices
    suspend fun getPortfolio(): Result<Portfolio>
    suspend fun getPrices(symbols: List<String>? = null): Result<List<PriceData>>
    suspend fun getKlines(symbol: String, interval: String, limit: Int): Result<List<Kline>>
    suspend fun getCombinedPortfolio(): Result<Portfolio>

    // Paper Trading
    suspend fun getPaperPortfolio(): Result<PaperPortfolio>
    suspend fun resetPaperPortfolio(): Result<PaperPortfolio>
    suspend fun getPaperTrades(limit: Int, source: String?): Result<List<Trade>>

    // Trading
    suspend fun getTrades(limit: Int): Result<List<Trade>>
    suspend fun placeOrder(order: OrderRequest): Result<Trade>
    suspend fun cancelOrder(tradeId: String): Result<Unit>
    suspend fun getTradingStats(days: Int): Result<TradingStats>

    // Active Trades
    suspend fun getActiveTrades(): Result<ActiveTradesResponse>
    suspend fun updateTradeSLTP(tradeId: String, request: UpdateSLTPRequest): Result<Trade>
    suspend fun partialClosePosition(tradeId: String, quantity: Double): Result<Trade>
    suspend fun stopTrade(tradeId: String, skipConfirmation: Boolean): Result<StopTradeResponse>

    // Bots
    suspend fun getBots(): Result<List<Bot>>
    suspend fun createBot(request: CreateBotRequest): Result<Bot>
    suspend fun updateBotStatus(botId: String, status: String): Result<Unit>
    suspend fun deleteBot(botId: String): Result<Unit>
    suspend fun getBotTemplates(): Result<List<BotTemplate>>
    suspend fun getBotTemplate(type: String): Result<BotTemplate>

    // Scalping
    suspend fun getScalpingSettings(): Result<ScalpingSettings>
    suspend fun updateScalpingSettings(settings: ScalpingSettings): Result<ScalpingSettings>
    suspend fun toggleScalping(enabled: Boolean): Result<Boolean>
    suspend fun setScalpingMode(mode: String): Result<String>
    suspend fun getScalpingStats(days: Int): Result<ScalpingStats>
    suspend fun getScalpingPositions(): Result<List<ScalpingPosition>>

    // Trading Chat
    suspend fun getOrCreateTradingSession(): Result<String>
    suspend fun getTradingChatMessages(sessionId: String): Result<List<TradingChatMessage>>
    suspend fun sendTradingChatMessage(sessionId: String, message: String): Result<TradingChatResponse>

    // Research
    suspend fun getResearchSettings(): Result<ResearchSettings>
    suspend fun updateResearchSettings(settings: ResearchSettings): Result<ResearchSettings>
    suspend fun getResearchSignals(limit: Int): Result<List<ResearchSignal>>
    suspend fun getResearchMetrics(days: Int): Result<ResearchMetrics>
    suspend fun getTopPairs(limit: Int): Result<List<String>>
    suspend fun executeSignal(signalId: String): Result<Trade?>
    suspend fun confirmSignal(signalId: String, action: String): Result<Trade?>

    // Indicator Settings
    suspend fun getIndicatorSettings(): Result<IndicatorSettings>
    suspend fun updateIndicatorSettings(settings: IndicatorSettings): Result<IndicatorSettings>
    suspend fun applyIndicatorPreset(preset: String): Result<IndicatorSettings>

    // Advanced Settings
    suspend fun getAdvancedSettings(): Result<AdvancedSignalSettings>
    suspend fun updateAdvancedSettings(settings: AdvancedSignalSettings): Result<AdvancedSignalSettings>
    suspend fun applyFeaturePreset(preset: String): Result<AdvancedSignalSettings>

    // Conditional Orders
    suspend fun getConditionalOrders(status: String?): Result<List<ConditionalOrder>>
    suspend fun createConditionalOrder(request: CreateConditionalOrderRequest): Result<ConditionalOrder>
    suspend fun cancelConditionalOrder(id: String): Result<Unit>

    // Margin Trading
    suspend fun getMarginLeverage(): Result<Int>
    suspend fun setMarginLeverage(leverage: Int): Result<Int>
    suspend fun getMarginBalance(): Result<MarginAccountInfo>
    suspend fun getMarginPositions(): Result<List<MarginPosition>>
    suspend fun placeMarginOrder(request: MarginOrderRequest): Result<Trade>
    suspend fun closeMarginPosition(symbol: String, side: String): Result<Trade>

    // Trading Rules
    suspend fun getTradingRules(): Result<List<TradingRule>>
    suspend fun createTradingRule(rule: TradingRule): Result<TradingRule>
    suspend fun updateTradingRule(rule: TradingRule): Result<TradingRule>
    suspend fun deleteTradingRule(id: String): Result<Unit>

    // Auto Trading
    suspend fun getAutoTradingSettings(): Result<AutoTradingSettings>
    suspend fun updateAutoTradingSettings(settings: AutoTradingSettings): Result<AutoTradingSettings>
    suspend fun startAutoTrading(): Result<AutoTradingState>
    suspend fun stopAutoTrading(): Result<AutoTradingState>
    suspend fun getAutoTradingState(): Result<AutoTradingState>
    suspend fun getAutoTradingHistory(): Result<List<AutoTradeHistory>>
    suspend fun getAutoSignalHistory(limit: Int): Result<List<ResearchSignal>>
    suspend fun getTopCandidates(): Result<List<SignalCandidate>>
    suspend fun getStrategies(): Result<List<TradingStrategy>>
    suspend fun getMarketRegime(): Result<MarketRegime>
    suspend fun getStrategyPerformance(): Result<Map<String, StrategyPerformance>>
}
