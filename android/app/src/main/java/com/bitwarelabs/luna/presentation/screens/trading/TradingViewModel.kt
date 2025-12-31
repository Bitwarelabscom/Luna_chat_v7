package com.bitwarelabs.luna.presentation.screens.trading

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bitwarelabs.luna.domain.model.*
import com.bitwarelabs.luna.domain.repository.TradingRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class TradingTab {
    PORTFOLIO, ACTIVE, RESEARCH, HISTORY, SETTINGS
}

data class TradingUiState(
    // Tab selection
    val selectedTab: TradingTab = TradingTab.PORTFOLIO,

    // Loading states
    val isLoadingPortfolio: Boolean = false,
    val isLoadingTrades: Boolean = false,
    val isLoadingSignals: Boolean = false,
    val isLoadingStats: Boolean = false,
    val isPlacingOrder: Boolean = false,

    // Connection status
    val isConnected: Boolean = false,
    val exchange: String? = null,
    val isPaperMode: Boolean = true,

    // Portfolio data
    val portfolio: Portfolio? = null,
    val paperPortfolio: PaperPortfolio? = null,
    val prices: List<PriceData> = emptyList(),

    // Active trades
    val activeTrades: List<ActiveTrade> = emptyList(),

    // Research signals
    val researchSignals: List<ResearchSignal> = emptyList(),
    val researchMetrics: ResearchMetrics? = null,

    // Trade history
    val trades: List<Trade> = emptyList(),
    val tradingStats: TradingStats? = null,

    // Settings
    val settings: TradingSettings? = null,
    val researchSettings: ResearchSettings? = null,
    val autoSettings: AutoTradingSettings? = null,
    val autoState: AutoTradingState? = null,

    // Order form
    val orderSymbol: String = "BTCUSDC",
    val orderSide: String = "buy",
    val orderType: String = "market",
    val orderAmount: String = "",
    val orderStopLoss: String = "",
    val orderTakeProfit: String = "",

    // Error handling
    val error: String? = null,
    val successMessage: String? = null,

    // Holdings trade modal
    val selectedHolding: PortfolioHolding? = null,
    val selectedPaperPosition: PaperPosition? = null,
    val showHoldingModal: Boolean = false
)

@HiltViewModel
class TradingViewModel @Inject constructor(
    private val tradingRepository: TradingRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(TradingUiState())
    val uiState: StateFlow<TradingUiState> = _uiState.asStateFlow()

    init {
        loadInitialData()
    }

    fun selectTab(tab: TradingTab) {
        _uiState.value = _uiState.value.copy(selectedTab = tab)
        when (tab) {
            TradingTab.PORTFOLIO -> loadPortfolio()
            TradingTab.ACTIVE -> loadActiveTrades()
            TradingTab.RESEARCH -> loadResearch()
            TradingTab.HISTORY -> loadHistory()
            TradingTab.SETTINGS -> loadSettings()
        }
    }

    private fun loadInitialData() {
        viewModelScope.launch {
            // Load settings first to determine connection status
            tradingRepository.getSettings().onSuccess { settings ->
                _uiState.value = _uiState.value.copy(
                    settings = settings,
                    isConnected = settings.exchangeConnected,
                    isPaperMode = settings.paperMode
                )
            }

            // Load exchange type
            tradingRepository.getExchangeType().onSuccess { exchange ->
                _uiState.value = _uiState.value.copy(exchange = exchange)
            }

            // Load portfolio based on paper mode
            loadPortfolio()
        }
    }

    fun loadPortfolio() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingPortfolio = true)

            if (_uiState.value.isPaperMode) {
                tradingRepository.getPaperPortfolio().fold(
                    onSuccess = { portfolio ->
                        _uiState.value = _uiState.value.copy(
                            paperPortfolio = portfolio,
                            isLoadingPortfolio = false
                        )
                    },
                    onFailure = { e ->
                        _uiState.value = _uiState.value.copy(
                            error = e.message,
                            isLoadingPortfolio = false
                        )
                    }
                )
            } else {
                tradingRepository.getPortfolio().fold(
                    onSuccess = { portfolio ->
                        _uiState.value = _uiState.value.copy(
                            portfolio = portfolio,
                            isLoadingPortfolio = false
                        )
                    },
                    onFailure = { e ->
                        _uiState.value = _uiState.value.copy(
                            error = e.message,
                            isLoadingPortfolio = false
                        )
                    }
                )
            }
        }
    }

    fun loadActiveTrades() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingTrades = true)

            tradingRepository.getActiveTrades().fold(
                onSuccess = { response ->
                    _uiState.value = _uiState.value.copy(
                        activeTrades = response.openPositions + response.pendingOrders,
                        isLoadingTrades = false
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        error = e.message,
                        isLoadingTrades = false
                    )
                }
            )
        }
    }

    fun loadResearch() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingSignals = true)

            // Load signals and metrics in parallel
            val signalsResult = tradingRepository.getResearchSignals(50)
            val metricsResult = tradingRepository.getResearchMetrics(30)
            val settingsResult = tradingRepository.getResearchSettings()

            signalsResult.onSuccess { signals ->
                _uiState.value = _uiState.value.copy(researchSignals = signals)
            }

            metricsResult.onSuccess { metrics ->
                _uiState.value = _uiState.value.copy(researchMetrics = metrics)
            }

            settingsResult.onSuccess { settings ->
                _uiState.value = _uiState.value.copy(researchSettings = settings)
            }

            _uiState.value = _uiState.value.copy(isLoadingSignals = false)
        }
    }

    fun loadHistory() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingTrades = true)

            val tradesResult = tradingRepository.getTrades(50)
            val statsResult = tradingRepository.getTradingStats(30)

            tradesResult.onSuccess { trades ->
                _uiState.value = _uiState.value.copy(trades = trades)
            }

            statsResult.onSuccess { stats ->
                _uiState.value = _uiState.value.copy(tradingStats = stats)
            }

            _uiState.value = _uiState.value.copy(isLoadingTrades = false)
        }
    }

    fun loadSettings() {
        viewModelScope.launch {
            tradingRepository.getSettings().onSuccess { settings ->
                _uiState.value = _uiState.value.copy(settings = settings)
            }

            tradingRepository.getAutoTradingSettings().onSuccess { autoSettings ->
                _uiState.value = _uiState.value.copy(autoSettings = autoSettings)
            }

            tradingRepository.getAutoTradingState().onSuccess { autoState ->
                _uiState.value = _uiState.value.copy(autoState = autoState)
            }
        }
    }

    // Order form updates
    fun updateOrderSymbol(symbol: String) {
        _uiState.value = _uiState.value.copy(orderSymbol = symbol)
    }

    fun updateOrderSide(side: String) {
        _uiState.value = _uiState.value.copy(orderSide = side)
    }

    fun updateOrderType(type: String) {
        _uiState.value = _uiState.value.copy(orderType = type)
    }

    fun updateOrderAmount(amount: String) {
        _uiState.value = _uiState.value.copy(orderAmount = amount)
    }

    fun updateOrderStopLoss(stopLoss: String) {
        _uiState.value = _uiState.value.copy(orderStopLoss = stopLoss)
    }

    fun updateOrderTakeProfit(takeProfit: String) {
        _uiState.value = _uiState.value.copy(orderTakeProfit = takeProfit)
    }

    fun placeOrder() {
        val state = _uiState.value
        val amount = state.orderAmount.toDoubleOrNull() ?: return

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isPlacingOrder = true)

            val order = OrderRequest(
                symbol = state.orderSymbol,
                side = state.orderSide,
                type = state.orderType,
                quoteAmount = amount,
                stopLoss = state.orderStopLoss.toDoubleOrNull(),
                takeProfit = state.orderTakeProfit.toDoubleOrNull()
            )

            tradingRepository.placeOrder(order).fold(
                onSuccess = { trade ->
                    _uiState.value = _uiState.value.copy(
                        isPlacingOrder = false,
                        successMessage = "Order placed: ${trade.symbol} ${trade.side}",
                        orderAmount = "",
                        orderStopLoss = "",
                        orderTakeProfit = ""
                    )
                    loadPortfolio()
                    loadActiveTrades()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isPlacingOrder = false,
                        error = e.message
                    )
                }
            )
        }
    }

    fun executeSignal(signalId: String) {
        viewModelScope.launch {
            tradingRepository.executeSignal(signalId).fold(
                onSuccess = { trade ->
                    _uiState.value = _uiState.value.copy(
                        successMessage = if (trade != null) "Signal executed: ${trade.symbol}" else "Signal executed"
                    )
                    loadResearch()
                    loadActiveTrades()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun stopTrade(tradeId: String, skipConfirmation: Boolean = false) {
        viewModelScope.launch {
            tradingRepository.stopTrade(tradeId, skipConfirmation).fold(
                onSuccess = { response ->
                    if (response.requiresConfirmation) {
                        _uiState.value = _uiState.value.copy(
                            error = "Trade value ($${response.tradeValue}) exceeds threshold. Confirm to close."
                        )
                    } else if (response.success) {
                        _uiState.value = _uiState.value.copy(
                            successMessage = "Trade closed"
                        )
                        loadActiveTrades()
                        loadPortfolio()
                    }
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun updateTradeSLTP(tradeId: String, stopLoss: Double?, takeProfit: Double?) {
        viewModelScope.launch {
            val request = UpdateSLTPRequest(
                stopLossPrice = stopLoss,
                takeProfitPrice = takeProfit
            )

            tradingRepository.updateTradeSLTP(tradeId, request).fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        successMessage = "SL/TP updated"
                    )
                    loadActiveTrades()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun togglePaperMode(enabled: Boolean) {
        viewModelScope.launch {
            val currentSettings = _uiState.value.settings ?: return@launch
            val updatedSettings = currentSettings.copy(paperMode = enabled)

            tradingRepository.updateSettings(updatedSettings).fold(
                onSuccess = { settings ->
                    _uiState.value = _uiState.value.copy(
                        settings = settings,
                        isPaperMode = settings.paperMode
                    )
                    loadPortfolio()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun toggleAutoTrading() {
        viewModelScope.launch {
            val isRunning = _uiState.value.autoState?.isRunning ?: false

            if (isRunning) {
                tradingRepository.stopAutoTrading().fold(
                    onSuccess = { state ->
                        _uiState.value = _uiState.value.copy(
                            autoState = state,
                            successMessage = "Auto trading stopped"
                        )
                    },
                    onFailure = { e ->
                        _uiState.value = _uiState.value.copy(error = e.message)
                    }
                )
            } else {
                tradingRepository.startAutoTrading().fold(
                    onSuccess = { state ->
                        _uiState.value = _uiState.value.copy(
                            autoState = state,
                            successMessage = "Auto trading started"
                        )
                    },
                    onFailure = { e ->
                        _uiState.value = _uiState.value.copy(error = e.message)
                    }
                )
            }
        }
    }

    fun connectExchange(apiKey: String, apiSecret: String) {
        viewModelScope.launch {
            tradingRepository.connectExchange(
                apiKey = apiKey,
                apiSecret = apiSecret,
                exchange = "crypto_com",
                marginEnabled = false,
                leverage = 1
            ).fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isConnected = true,
                        successMessage = "Exchange connected"
                    )
                    loadInitialData()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun disconnectExchange() {
        viewModelScope.launch {
            tradingRepository.disconnectExchange().fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        isConnected = false,
                        exchange = null,
                        successMessage = "Exchange disconnected"
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun resetPaperPortfolio() {
        viewModelScope.launch {
            tradingRepository.resetPaperPortfolio().fold(
                onSuccess = { portfolio ->
                    _uiState.value = _uiState.value.copy(
                        paperPortfolio = portfolio,
                        successMessage = "Paper portfolio reset"
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun clearSuccessMessage() {
        _uiState.value = _uiState.value.copy(successMessage = null)
    }

    // Holdings modal functions
    fun selectHolding(holding: PortfolioHolding) {
        _uiState.value = _uiState.value.copy(
            selectedHolding = holding,
            selectedPaperPosition = null,
            showHoldingModal = true
        )
    }

    fun selectPaperPosition(position: PaperPosition) {
        _uiState.value = _uiState.value.copy(
            selectedHolding = null,
            selectedPaperPosition = position,
            showHoldingModal = true
        )
    }

    fun dismissHoldingModal() {
        _uiState.value = _uiState.value.copy(
            selectedHolding = null,
            selectedPaperPosition = null,
            showHoldingModal = false
        )
    }

    fun buyHolding(symbol: String, amountUsd: Double) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isPlacingOrder = true)

            val order = OrderRequest(
                symbol = symbol,
                side = "buy",
                type = "market",
                quoteAmount = amountUsd
            )

            tradingRepository.placeOrder(order).fold(
                onSuccess = { trade ->
                    _uiState.value = _uiState.value.copy(
                        isPlacingOrder = false,
                        successMessage = "Bought $${amountUsd.toInt()} of $symbol"
                    )
                    dismissHoldingModal()
                    loadPortfolio()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isPlacingOrder = false,
                        error = e.message
                    )
                }
            )
        }
    }

    fun sellHolding(symbol: String, amountUsd: Double) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isPlacingOrder = true)

            val order = OrderRequest(
                symbol = symbol,
                side = "sell",
                type = "market",
                quoteAmount = amountUsd
            )

            tradingRepository.placeOrder(order).fold(
                onSuccess = { trade ->
                    _uiState.value = _uiState.value.copy(
                        isPlacingOrder = false,
                        successMessage = "Sold $${amountUsd.toInt()} of $symbol"
                    )
                    dismissHoldingModal()
                    loadPortfolio()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        isPlacingOrder = false,
                        error = e.message
                    )
                }
            )
        }
    }

    fun closeHolding(symbol: String) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isPlacingOrder = true)

            // For live mode, we need to sell all of the holding
            val holding = _uiState.value.selectedHolding
            if (holding != null) {
                val order = OrderRequest(
                    symbol = symbol,
                    side = "sell",
                    type = "market",
                    quantity = holding.amount
                )

                tradingRepository.placeOrder(order).fold(
                    onSuccess = {
                        _uiState.value = _uiState.value.copy(
                            isPlacingOrder = false,
                            successMessage = "Closed position in $symbol"
                        )
                        dismissHoldingModal()
                        loadPortfolio()
                    },
                    onFailure = { e ->
                        _uiState.value = _uiState.value.copy(
                            isPlacingOrder = false,
                            error = e.message
                        )
                    }
                )
            } else {
                // For paper mode positions, find the position and close it
                val position = _uiState.value.selectedPaperPosition
                if (position != null) {
                    val order = OrderRequest(
                        symbol = symbol,
                        side = "sell",
                        type = "market",
                        quantity = position.quantity
                    )

                    tradingRepository.placeOrder(order).fold(
                        onSuccess = {
                            _uiState.value = _uiState.value.copy(
                                isPlacingOrder = false,
                                successMessage = "Closed paper position in $symbol"
                            )
                            dismissHoldingModal()
                            loadPortfolio()
                        },
                        onFailure = { e ->
                            _uiState.value = _uiState.value.copy(
                                isPlacingOrder = false,
                                error = e.message
                            )
                        }
                    )
                }
            }
        }
    }
}
