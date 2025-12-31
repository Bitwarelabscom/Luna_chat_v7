package com.bitwarelabs.luna.presentation.screens.trading

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.domain.model.*
import com.bitwarelabs.luna.presentation.theme.LunaTheme

// Smart price formatting - shows more decimals for low-priced coins
private fun formatPrice(price: Double): String {
    return when {
        price > 0 && price < 0.0001 -> String.format("%.8f", price)
        price > 0 && price < 0.01 -> String.format("%.6f", price)
        price > 0 && price < 1 -> String.format("%.4f", price)
        else -> String.format("%.2f", price)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TradingScreen(
    viewModel: TradingViewModel = hiltViewModel(),
    onNavigateBack: () -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsState()

    // Snackbar for messages
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    LaunchedEffect(uiState.successMessage) {
        uiState.successMessage?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearSuccessMessage()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("Trading")
                        if (uiState.isPaperMode) {
                            Text(
                                text = "Paper Mode",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.primary
                            )
                        }
                    }
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.Default.ArrowBack, "Back")
                    }
                },
                actions = {
                    // Paper/Live toggle
                    IconButton(onClick = { viewModel.togglePaperMode(!uiState.isPaperMode) }) {
                        Icon(
                            if (uiState.isPaperMode) Icons.Default.Science else Icons.Default.AccountBalance,
                            if (uiState.isPaperMode) "Paper Mode" else "Live Mode"
                        )
                    }
                    // Refresh
                    IconButton(onClick = {
                        when (uiState.selectedTab) {
                            TradingTab.PORTFOLIO -> viewModel.loadPortfolio()
                            TradingTab.ACTIVE -> viewModel.loadActiveTrades()
                            TradingTab.RESEARCH -> viewModel.loadResearch()
                            TradingTab.HISTORY -> viewModel.loadHistory()
                            TradingTab.SETTINGS -> viewModel.loadSettings()
                        }
                    }) {
                        Icon(Icons.Default.Refresh, "Refresh")
                    }
                }
            )
        }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Tab row
            TradingTabRow(
                selectedTab = uiState.selectedTab,
                onTabSelected = { viewModel.selectTab(it) }
            )

            // Tab content
            when (uiState.selectedTab) {
                TradingTab.PORTFOLIO -> PortfolioTab(
                    uiState = uiState,
                    onPlaceOrder = { viewModel.placeOrder() },
                    onUpdateSymbol = { viewModel.updateOrderSymbol(it) },
                    onUpdateSide = { viewModel.updateOrderSide(it) },
                    onUpdateAmount = { viewModel.updateOrderAmount(it) },
                    onUpdateStopLoss = { viewModel.updateOrderStopLoss(it) },
                    onUpdateTakeProfit = { viewModel.updateOrderTakeProfit(it) },
                    onResetPaper = { viewModel.resetPaperPortfolio() },
                    onHoldingClick = { viewModel.selectHolding(it) },
                    onPaperPositionClick = { viewModel.selectPaperPosition(it) }
                )
                TradingTab.ACTIVE -> ActiveTradesTab(
                    uiState = uiState,
                    onStopTrade = { viewModel.stopTrade(it) },
                    onUpdateSLTP = { id, sl, tp -> viewModel.updateTradeSLTP(id, sl, tp) }
                )
                TradingTab.RESEARCH -> ResearchTab(
                    uiState = uiState,
                    onExecuteSignal = { viewModel.executeSignal(it) }
                )
                TradingTab.HISTORY -> HistoryTab(uiState = uiState)
                TradingTab.SETTINGS -> SettingsTab(
                    uiState = uiState,
                    onToggleAutoTrading = { viewModel.toggleAutoTrading() },
                    onConnectExchange = { key, secret -> viewModel.connectExchange(key, secret) },
                    onDisconnectExchange = { viewModel.disconnectExchange() }
                )
            }
        }

        // Holdings trade modal
        if (uiState.showHoldingModal) {
            HoldingTradeModal(
                uiState = uiState,
                onDismiss = { viewModel.dismissHoldingModal() },
                onBuy = { symbol, amount -> viewModel.buyHolding(symbol, amount) },
                onSell = { symbol, amount -> viewModel.sellHolding(symbol, amount) },
                onClose = { symbol -> viewModel.closeHolding(symbol) }
            )
        }
    }
}

@Composable
fun TradingTabRow(
    selectedTab: TradingTab,
    onTabSelected: (TradingTab) -> Unit
) {
    val tabs = listOf(
        TradingTab.PORTFOLIO to "Portfolio",
        TradingTab.ACTIVE to "Active",
        TradingTab.RESEARCH to "Research",
        TradingTab.HISTORY to "History",
        TradingTab.SETTINGS to "Settings"
    )

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        tabs.forEach { (tab, label) ->
            FilterChip(
                selected = selectedTab == tab,
                onClick = { onTabSelected(tab) },
                label = { Text(label) }
            )
        }
    }
}

@Composable
fun PortfolioTab(
    uiState: TradingUiState,
    onPlaceOrder: () -> Unit,
    onUpdateSymbol: (String) -> Unit,
    onUpdateSide: (String) -> Unit,
    onUpdateAmount: (String) -> Unit,
    onUpdateStopLoss: (String) -> Unit,
    onUpdateTakeProfit: (String) -> Unit,
    onResetPaper: () -> Unit,
    onHoldingClick: (PortfolioHolding) -> Unit = {},
    onPaperPositionClick: (PaperPosition) -> Unit = {}
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Portfolio summary card
        item {
            PortfolioSummaryCard(uiState)
        }

        // Quick order form
        item {
            QuickOrderCard(
                uiState = uiState,
                onPlaceOrder = onPlaceOrder,
                onUpdateSymbol = onUpdateSymbol,
                onUpdateSide = onUpdateSide,
                onUpdateAmount = onUpdateAmount,
                onUpdateStopLoss = onUpdateStopLoss,
                onUpdateTakeProfit = onUpdateTakeProfit
            )
        }

        // Assets list
        if (uiState.isPaperMode && uiState.paperPortfolio != null) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        "Paper Positions",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    TextButton(onClick = onResetPaper) {
                        Text("Reset")
                    }
                }
            }
            items(uiState.paperPortfolio.positions) { position ->
                PaperPositionCard(
                    position = position,
                    onClick = { onPaperPositionClick(position) }
                )
            }
        } else if (uiState.portfolio != null) {
            item {
                Text(
                    "Assets",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
            }
            items(uiState.portfolio.holdings) { holding ->
                HoldingCard(
                    holding = holding,
                    onClick = { onHoldingClick(holding) }
                )
            }
        }
    }
}

@Composable
fun PortfolioSummaryCard(uiState: TradingUiState) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp)
        ) {
            Text(
                "Total Value",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.7f)
            )

            val totalValue = if (uiState.isPaperMode) {
                uiState.paperPortfolio?.totalValue ?: 0.0
            } else {
                uiState.portfolio?.totalValueUsdt ?: 0.0
            }

            Text(
                "$${String.format("%.2f", totalValue)}",
                style = MaterialTheme.typography.headlineLarge,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimaryContainer
            )

            if (uiState.isPaperMode && uiState.paperPortfolio != null) {
                val pnl = uiState.paperPortfolio.pnl
                val pnlPct = uiState.paperPortfolio.pnlPct
                Text(
                    "${if (pnl >= 0) "+" else ""}$${String.format("%.2f", pnl)} (${String.format("%.2f", pnlPct)}%)",
                    style = MaterialTheme.typography.bodyLarge,
                    color = if (pnl >= 0) Color(0xFF4CAF50) else Color(0xFFF44336)
                )
            }
        }
    }
}

@Composable
fun QuickOrderCard(
    uiState: TradingUiState,
    onPlaceOrder: () -> Unit,
    onUpdateSymbol: (String) -> Unit,
    onUpdateSide: (String) -> Unit,
    onUpdateAmount: (String) -> Unit,
    onUpdateStopLoss: (String) -> Unit,
    onUpdateTakeProfit: (String) -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text(
                "Quick Order",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )

            // Symbol input
            OutlinedTextField(
                value = uiState.orderSymbol,
                onValueChange = onUpdateSymbol,
                label = { Text("Symbol") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            // Buy/Sell toggle
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                FilterChip(
                    selected = uiState.orderSide == "buy",
                    onClick = { onUpdateSide("buy") },
                    label = { Text("Buy") },
                    modifier = Modifier.weight(1f),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Color(0xFF4CAF50)
                    )
                )
                FilterChip(
                    selected = uiState.orderSide == "sell",
                    onClick = { onUpdateSide("sell") },
                    label = { Text("Sell") },
                    modifier = Modifier.weight(1f),
                    colors = FilterChipDefaults.filterChipColors(
                        selectedContainerColor = Color(0xFFF44336)
                    )
                )
            }

            // Amount input
            OutlinedTextField(
                value = uiState.orderAmount,
                onValueChange = onUpdateAmount,
                label = { Text("Amount (USDC)") },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true
            )

            // SL/TP inputs (collapsed by default)
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = uiState.orderStopLoss,
                    onValueChange = onUpdateStopLoss,
                    label = { Text("Stop Loss") },
                    modifier = Modifier.weight(1f),
                    singleLine = true
                )
                OutlinedTextField(
                    value = uiState.orderTakeProfit,
                    onValueChange = onUpdateTakeProfit,
                    label = { Text("Take Profit") },
                    modifier = Modifier.weight(1f),
                    singleLine = true
                )
            }

            // Place order button
            Button(
                onClick = onPlaceOrder,
                modifier = Modifier.fillMaxWidth(),
                enabled = uiState.orderAmount.isNotEmpty() && !uiState.isPlacingOrder,
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (uiState.orderSide == "buy") Color(0xFF4CAF50) else Color(0xFFF44336)
                )
            ) {
                if (uiState.isPlacingOrder) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        color = Color.White
                    )
                } else {
                    Text(if (uiState.orderSide == "buy") "Buy" else "Sell")
                }
            }
        }
    }
}

@Composable
fun HoldingCard(
    holding: PortfolioHolding,
    onClick: () -> Unit = {}
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    holding.asset,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "${String.format("%.6f", holding.amount)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    "$${String.format("%.2f", holding.valueUsdt)}",
                    style = MaterialTheme.typography.titleMedium
                )
                holding.priceChange24h?.let { change ->
                    Text(
                        "${if (change >= 0) "+" else ""}${String.format("%.2f", change)}%",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (change >= 0) Color(0xFF4CAF50) else Color(0xFFF44336)
                    )
                }
            }
        }
    }
}

@Composable
fun PaperPositionCard(
    position: PaperPosition,
    onClick: () -> Unit = {}
) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    position.symbol,
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    "Entry: $${String.format("%.4f", position.entryPrice)}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(
                    "$${String.format("%.2f", position.value)}",
                    style = MaterialTheme.typography.titleMedium
                )
                Text(
                    "${if (position.pnl >= 0) "+" else ""}$${String.format("%.2f", position.pnl)} (${String.format("%.2f", position.pnlPct)}%)",
                    style = MaterialTheme.typography.bodySmall,
                    color = if (position.pnl >= 0) Color(0xFF4CAF50) else Color(0xFFF44336)
                )
            }
        }
    }
}

@Composable
fun ActiveTradesTab(
    uiState: TradingUiState,
    onStopTrade: (String) -> Unit,
    onUpdateSLTP: (String, Double?, Double?) -> Unit
) {
    if (uiState.isLoadingTrades) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator()
        }
    } else if (uiState.activeTrades.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    Icons.Default.TrendingUp,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.3f)
                )
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    "No active trades",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                )
            }
        }
    } else {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(uiState.activeTrades) { trade ->
                ActiveTradeCard(
                    trade = trade,
                    onStop = { onStopTrade(trade.id) },
                    onUpdateSLTP = { sl, tp -> onUpdateSLTP(trade.id, sl, tp) }
                )
            }
        }
    }
}

@Composable
fun ActiveTradeCard(
    trade: ActiveTrade,
    onStop: () -> Unit,
    onUpdateSLTP: (Double?, Double?) -> Unit
) {
    var showSLTPDialog by remember { mutableStateOf(false) }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            trade.symbol,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            trade.side.uppercase(),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (trade.side == "buy") Color(0xFF4CAF50) else Color(0xFFF44336),
                            modifier = Modifier
                                .background(
                                    if (trade.side == "buy") Color(0xFF4CAF50).copy(alpha = 0.1f)
                                    else Color(0xFFF44336).copy(alpha = 0.1f),
                                    RoundedCornerShape(4.dp)
                                )
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                        if (trade.isPaper) {
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(
                                "PAPER",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                                modifier = Modifier
                                    .background(
                                        MaterialTheme.colorScheme.primary.copy(alpha = 0.1f),
                                        RoundedCornerShape(4.dp)
                                    )
                                    .padding(horizontal = 6.dp, vertical = 2.dp)
                            )
                        }
                    }
                    Text(
                        "Entry: $${formatPrice(trade.entryPrice)} | Current: $${formatPrice(trade.currentPrice)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        "${if (trade.unrealizedPnl >= 0) "+" else ""}$${String.format("%.2f", trade.unrealizedPnl)}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (trade.unrealizedPnl >= 0) Color(0xFF4CAF50) else Color(0xFFF44336)
                    )
                    Text(
                        "${String.format("%.2f", trade.unrealizedPnlPct)}%",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (trade.unrealizedPnlPct >= 0) Color(0xFF4CAF50) else Color(0xFFF44336)
                    )
                }
            }

            // SL/TP info
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                trade.stopLossPrice?.let { sl ->
                    Text(
                        "SL: $${formatPrice(sl)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFFF44336)
                    )
                }
                trade.takeProfitPrice?.let { tp ->
                    Text(
                        "TP: $${formatPrice(tp)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = Color(0xFF4CAF50)
                    )
                }
            }

            // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedButton(
                    onClick = { showSLTPDialog = true },
                    modifier = Modifier.weight(1f)
                ) {
                    Text("Edit SL/TP")
                }
                Button(
                    onClick = onStop,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFF44336)
                    )
                ) {
                    Text("Close")
                }
            }
        }
    }
}

@Composable
fun ResearchTab(
    uiState: TradingUiState,
    onExecuteSignal: (String) -> Unit
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Metrics card
        uiState.researchMetrics?.let { metrics ->
            item {
                ResearchMetricsCard(metrics)
            }
        }

        // Signals
        item {
            Text(
                "Recent Signals",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
        }

        if (uiState.isLoadingSignals) {
            item {
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        } else if (uiState.researchSignals.isEmpty()) {
            item {
                Text(
                    "No signals yet",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                )
            }
        } else {
            items(uiState.researchSignals) { signal ->
                SignalCard(
                    signal = signal,
                    onExecute = { onExecuteSignal(signal.id) }
                )
            }
        }
    }
}

@Composable
fun ResearchMetricsCard(metrics: ResearchMetrics) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            MetricItem("Signals", "${metrics.research.totalSignals}")
            MetricItem("Executed", "${metrics.research.executedSignals}")
            MetricItem("Win Rate", "${String.format("%.1f", metrics.research.winRate * 100)}%")
            MetricItem("Avg P&L", "${String.format("%.2f", metrics.research.avgPnl)}%")
        }
    }
}

@Composable
fun MetricItem(label: String, value: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(
            value,
            style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Bold
        )
        Text(
            label,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSecondaryContainer.copy(alpha = 0.7f)
        )
    }
}

@Composable
fun SignalCard(
    signal: ResearchSignal,
    onExecute: () -> Unit
) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            signal.symbol,
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            signal.signalType.uppercase(),
                            style = MaterialTheme.typography.labelSmall,
                            color = if (signal.signalType == "buy") Color(0xFF4CAF50) else Color(0xFFF44336),
                            modifier = Modifier
                                .background(
                                    if (signal.signalType == "buy") Color(0xFF4CAF50).copy(alpha = 0.1f)
                                    else Color(0xFFF44336).copy(alpha = 0.1f),
                                    RoundedCornerShape(4.dp)
                                )
                                .padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                    Text(
                        "Entry: $${String.format("%.4f", signal.entryPrice)}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                    )
                }
                Column(horizontalAlignment = Alignment.End) {
                    Text(
                        "${String.format("%.0f", signal.confidence * 100)}%",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Text(
                        "confidence",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                    )
                }
            }

            // Status and action
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    signal.status.uppercase(),
                    style = MaterialTheme.typography.labelSmall,
                    color = when (signal.status) {
                        "pending" -> MaterialTheme.colorScheme.tertiary
                        "executed" -> Color(0xFF4CAF50)
                        "skipped" -> MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                        else -> MaterialTheme.colorScheme.onSurface
                    }
                )

                if (signal.status == "pending") {
                    Button(
                        onClick = onExecute,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = if (signal.signalType == "buy") Color(0xFF4CAF50) else Color(0xFFF44336)
                        )
                    ) {
                        Text("Execute")
                    }
                }
            }
        }
    }
}

@Composable
fun HistoryTab(uiState: TradingUiState) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Stats card
        uiState.tradingStats?.let { stats ->
            item {
                TradingStatsCard(stats)
            }
        }

        // Trade history
        item {
            Text(
                "Recent Trades",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
        }

        if (uiState.isLoadingTrades) {
            item {
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            }
        } else {
            items(uiState.trades) { trade ->
                TradeHistoryCard(trade)
            }
        }
    }
}

@Composable
fun TradingStatsCard(stats: TradingStats) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.secondaryContainer
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                "30 Day Stats",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                MetricItem("Trades", "${stats.totalTrades}")
                MetricItem("Win Rate", "${String.format("%.1f", stats.winRate * 100)}%")
                MetricItem(
                    "P&L",
                    "${if (stats.totalPnl >= 0) "+" else ""}$${String.format("%.2f", stats.totalPnl)}"
                )
            }
        }
    }
}

@Composable
fun TradeHistoryCard(trade: Trade) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        trade.symbol,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        trade.side.uppercase(),
                        style = MaterialTheme.typography.labelSmall,
                        color = if (trade.side == "buy") Color(0xFF4CAF50) else Color(0xFFF44336)
                    )
                }
                Text(
                    trade.status.uppercase(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                trade.pnl?.let { pnl ->
                    Text(
                        "${if (pnl >= 0) "+" else ""}$${String.format("%.2f", pnl)}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = if (pnl >= 0) Color(0xFF4CAF50) else Color(0xFFF44336)
                    )
                }
                trade.pnlPct?.let { pct ->
                    Text(
                        "${String.format("%.2f", pct)}%",
                        style = MaterialTheme.typography.bodySmall,
                        color = if (pct >= 0) Color(0xFF4CAF50) else Color(0xFFF44336)
                    )
                }
            }
        }
    }
}

@Composable
fun SettingsTab(
    uiState: TradingUiState,
    onToggleAutoTrading: () -> Unit,
    onConnectExchange: (String, String) -> Unit,
    onDisconnectExchange: () -> Unit
) {
    var apiKey by remember { mutableStateOf("") }
    var apiSecret by remember { mutableStateOf("") }

    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Connection status
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        "Exchange Connection",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )

                    Row(
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            if (uiState.isConnected) Icons.Default.CheckCircle else Icons.Default.Cancel,
                            contentDescription = null,
                            tint = if (uiState.isConnected) Color(0xFF4CAF50) else Color(0xFFF44336)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            if (uiState.isConnected) "Connected to ${uiState.exchange ?: "Exchange"}" else "Not connected"
                        )
                    }

                    if (!uiState.isConnected) {
                        OutlinedTextField(
                            value = apiKey,
                            onValueChange = { apiKey = it },
                            label = { Text("API Key") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true
                        )
                        OutlinedTextField(
                            value = apiSecret,
                            onValueChange = { apiSecret = it },
                            label = { Text("API Secret") },
                            modifier = Modifier.fillMaxWidth(),
                            singleLine = true
                        )
                        Button(
                            onClick = { onConnectExchange(apiKey, apiSecret) },
                            modifier = Modifier.fillMaxWidth(),
                            enabled = apiKey.isNotEmpty() && apiSecret.isNotEmpty()
                        ) {
                            Text("Connect")
                        }
                    } else {
                        OutlinedButton(
                            onClick = onDisconnectExchange,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Disconnect")
                        }
                    }
                }
            }
        }

        // Auto trading
        item {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        "Auto Trading",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold
                    )

                    uiState.autoState?.let { state ->
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(if (state.isRunning) "Running" else "Stopped")
                                if (state.isRunning) {
                                    Text(
                                        "Positions: ${state.activePositions} | Today: ${state.todayTrades} trades",
                                        style = MaterialTheme.typography.bodySmall,
                                        color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
                                    )
                                }
                            }
                            Switch(
                                checked = state.isRunning,
                                onCheckedChange = { onToggleAutoTrading() }
                            )
                        }
                    }
                }
            }
        }

        // Trading settings
        uiState.settings?.let { settings ->
            item {
                Card(modifier = Modifier.fillMaxWidth()) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Text(
                            "Risk Settings",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold
                        )

                        SettingsRow("Max Position", "${settings.maxPositionPct}%")
                        SettingsRow("Daily Loss Limit", "${settings.dailyLossLimitPct}%")
                        SettingsRow("Default Stop Loss", "${settings.defaultStopLossPct}%")
                        SettingsRow("Risk Tolerance", settings.riskTolerance.capitalize())
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsRow(label: String, value: String) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            label,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = 0.7f)
        )
        Text(value, fontWeight = FontWeight.Medium)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HoldingTradeModal(
    uiState: TradingUiState,
    onDismiss: () -> Unit,
    onBuy: (symbol: String, amount: Double) -> Unit,
    onSell: (symbol: String, amount: Double) -> Unit,
    onClose: (symbol: String) -> Unit
) {
    var amount by remember { mutableStateOf("") }
    var selectedAction by remember { mutableStateOf<String?>(null) }

    // Get the symbol and current info from either holding or paper position
    val symbol: String
    val currentPrice: Double
    val currentValue: Double
    val quantity: Double
    val pnl: Double?
    val pnlPct: Double?

    if (uiState.selectedHolding != null) {
        symbol = uiState.selectedHolding.symbol
        currentPrice = uiState.selectedHolding.price ?: 0.0
        currentValue = uiState.selectedHolding.valueUsdt
        quantity = uiState.selectedHolding.amount
        pnl = null
        pnlPct = uiState.selectedHolding.priceChange24h
    } else if (uiState.selectedPaperPosition != null) {
        symbol = uiState.selectedPaperPosition.symbol
        currentPrice = uiState.selectedPaperPosition.currentPrice
        currentValue = uiState.selectedPaperPosition.value
        quantity = uiState.selectedPaperPosition.quantity
        pnl = uiState.selectedPaperPosition.pnl
        pnlPct = uiState.selectedPaperPosition.pnlPct
    } else {
        return
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 24.dp)
                .padding(bottom = 32.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Header
            Text(
                text = symbol.replace("_USD", "").replace("USDT", ""),
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold
            )

            // Current info
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Price", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("$${String.format("%.4f", currentPrice)}")
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Holdings", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(String.format("%.6f", quantity))
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween
                    ) {
                        Text("Value", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("$${String.format("%.2f", currentValue)}")
                    }
                    if (pnl != null || pnlPct != null) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween
                        ) {
                            Text("P&L", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            val displayPnl = pnl?.let { "$${String.format("%.2f", it)}" } ?: ""
                            val displayPct = pnlPct?.let { "(${String.format("%.2f", it)}%)" } ?: ""
                            Text(
                                "$displayPnl $displayPct",
                                color = if ((pnl ?: 0.0) >= 0 && (pnlPct ?: 0.0) >= 0)
                                    Color(0xFF4CAF50) else Color(0xFFF44336)
                            )
                        }
                    }
                }
            }

            // Action buttons
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Button(
                    onClick = { selectedAction = "buy" },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (selectedAction == "buy")
                            Color(0xFF4CAF50) else MaterialTheme.colorScheme.primary
                    )
                ) {
                    Text("Buy More")
                }
                Button(
                    onClick = { selectedAction = "sell" },
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (selectedAction == "sell")
                            Color(0xFFF44336) else MaterialTheme.colorScheme.secondary
                    )
                ) {
                    Text("Sell")
                }
            }

            // Close all button
            OutlinedButton(
                onClick = { onClose(symbol) },
                modifier = Modifier.fillMaxWidth(),
                enabled = !uiState.isPlacingOrder
            ) {
                if (uiState.isPlacingOrder) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        strokeWidth = 2.dp
                    )
                } else {
                    Text("Close Entire Position")
                }
            }

            // Amount input (shown when action selected)
            if (selectedAction != null) {
                OutlinedTextField(
                    value = amount,
                    onValueChange = { amount = it },
                    label = { Text("Amount (USD)") },
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true
                )

                Button(
                    onClick = {
                        val amountVal = amount.toDoubleOrNull() ?: return@Button
                        if (selectedAction == "buy") {
                            onBuy(symbol, amountVal)
                        } else {
                            onSell(symbol, amountVal)
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = amount.toDoubleOrNull() != null && !uiState.isPlacingOrder,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = if (selectedAction == "buy")
                            Color(0xFF4CAF50) else Color(0xFFF44336)
                    )
                ) {
                    if (uiState.isPlacingOrder) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp,
                            color = Color.White
                        )
                    } else {
                        Text(
                            "Confirm ${if (selectedAction == "buy") "Buy" else "Sell"}",
                            color = Color.White
                        )
                    }
                }
            }
        }
    }
}
