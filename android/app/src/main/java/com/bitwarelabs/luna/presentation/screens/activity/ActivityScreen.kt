package com.bitwarelabs.luna.presentation.screens.activity

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.domain.model.ActivityLog
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ActivityScreen(
    onNavigateBack: () -> Unit,
    viewModel: ActivityViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
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
        modifier = Modifier
            .fillMaxSize()
            .background(LunaTheme.colors.bgPrimary),
        containerColor = LunaTheme.colors.bgPrimary,
        topBar = {
            TopAppBar(
                title = { Text("Activity", color = LunaTheme.colors.textPrimary) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.Default.ArrowBack,
                            contentDescription = "Back",
                            tint = LunaTheme.colors.textPrimary
                        )
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.loadActivity() }) {
                        Icon(
                            imageVector = Icons.Default.Refresh,
                            contentDescription = "Refresh",
                            tint = LunaTheme.colors.textPrimary
                        )
                    }
                    IconButton(onClick = { viewModel.clearActivity() }) {
                        Icon(
                            imageVector = Icons.Default.Delete,
                            contentDescription = "Clear",
                            tint = LunaTheme.colors.error
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = LunaTheme.colors.bgSecondary
                )
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { paddingValues ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues)
        ) {
            // Category filters
            LazyRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                val categories = listOf(
                    null to "All",
                    "llm_call" to "LLM",
                    "tool_invoke" to "Tools",
                    "memory_op" to "Memory",
                    "state_event" to "State",
                    "error" to "Errors",
                    "background" to "Background",
                    "system" to "System"
                )

                items(categories) { (value, label) ->
                    FilterChip(
                        selected = uiState.selectedCategory == value,
                        onClick = { viewModel.filterByCategory(value) },
                        label = { Text(label) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = LunaTheme.colors.accentPrimary,
                            selectedLabelColor = LunaTheme.colors.textPrimary
                        )
                    )
                }
            }

            // Level filters
            LazyRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                val levels = listOf(
                    null to "All Levels",
                    "info" to "Info",
                    "success" to "Success",
                    "warn" to "Warning",
                    "error" to "Error"
                )

                items(levels) { (value, label) ->
                    FilterChip(
                        selected = uiState.selectedLevel == value,
                        onClick = { viewModel.filterByLevel(value) },
                        label = { Text(label) },
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = when (value) {
                                "success" -> LunaTheme.colors.success
                                "warn" -> LunaTheme.colors.warning
                                "error" -> LunaTheme.colors.error
                                else -> LunaTheme.colors.accentPrimary
                            },
                            selectedLabelColor = LunaTheme.colors.textPrimary
                        )
                    )
                }
            }

            // Activity list
            if (uiState.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
                }
            } else if (uiState.activities.isEmpty()) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "No activity yet",
                        color = LunaTheme.colors.textMuted
                    )
                }
            } else {
                LazyColumn(
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    items(uiState.activities) { activity ->
                        ActivityCard(activity)
                    }
                }
            }
        }
    }
}

@Composable
private fun ActivityCard(activity: ActivityLog) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = LunaTheme.colors.bgSecondary
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.Top
        ) {
            // Level indicator
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(RoundedCornerShape(4.dp))
                    .background(
                        when (activity.level) {
                            "success" -> LunaTheme.colors.success
                            "warn" -> LunaTheme.colors.warning
                            "error" -> LunaTheme.colors.error
                            else -> LunaTheme.colors.accentPrimary
                        }
                    )
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = getCategoryLabel(activity.category),
                        style = MaterialTheme.typography.labelMedium,
                        color = LunaTheme.colors.accentPrimary,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        text = formatTimestamp(activity.createdAt),
                        style = MaterialTheme.typography.bodySmall,
                        color = LunaTheme.colors.textMuted
                    )
                }

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = activity.message,
                    style = MaterialTheme.typography.bodyMedium,
                    color = LunaTheme.colors.textPrimary,
                    maxLines = 3,
                    overflow = TextOverflow.Ellipsis
                )

                // Show additional info
                activity.toolName?.let { tool ->
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.Build,
                            contentDescription = null,
                            modifier = Modifier.size(12.dp),
                            tint = LunaTheme.colors.textMuted
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = tool,
                            style = MaterialTheme.typography.bodySmall,
                            color = LunaTheme.colors.textMuted
                        )
                    }
                }

                activity.model?.let { model ->
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.Memory,
                            contentDescription = null,
                            modifier = Modifier.size(12.dp),
                            tint = LunaTheme.colors.textMuted
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = model,
                            style = MaterialTheme.typography.bodySmall,
                            color = LunaTheme.colors.textMuted
                        )
                        activity.tokensUsed?.let { tokens ->
                            Text(
                                text = " - $tokens tokens",
                                style = MaterialTheme.typography.bodySmall,
                                color = LunaTheme.colors.textMuted
                            )
                        }
                    }
                }

                activity.duration?.let { duration ->
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            Icons.Default.Timer,
                            contentDescription = null,
                            modifier = Modifier.size(12.dp),
                            tint = LunaTheme.colors.textMuted
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = "${duration}ms",
                            style = MaterialTheme.typography.bodySmall,
                            color = LunaTheme.colors.textMuted
                        )
                    }
                }

                activity.errorMessage?.let { error ->
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = error,
                        style = MaterialTheme.typography.bodySmall,
                        color = LunaTheme.colors.error,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
            }
        }
    }
}

private fun getCategoryLabel(category: String): String {
    return when (category) {
        "llm_call" -> "LLM Call"
        "tool_invoke" -> "Tool"
        "memory_op" -> "Memory"
        "state_event" -> "State"
        "error" -> "Error"
        "background" -> "Background"
        "system" -> "System"
        else -> category.replaceFirstChar { it.uppercase() }
    }
}

private fun formatTimestamp(timestamp: String): String {
    // Simple format - could be enhanced with proper date parsing
    return try {
        timestamp.substringAfter("T").substringBefore(".")
    } catch (e: Exception) {
        timestamp
    }
}
