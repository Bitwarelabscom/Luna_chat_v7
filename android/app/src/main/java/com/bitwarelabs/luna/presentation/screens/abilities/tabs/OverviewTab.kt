package com.bitwarelabs.luna.presentation.screens.abilities.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.presentation.screens.abilities.AbilitiesViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun OverviewTab(viewModel: AbilitiesViewModel) {
    val uiState by viewModel.uiState.collectAsState()
    val summary = uiState.summary

    if (uiState.isLoadingSummary && summary == null) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
        }
    } else if (summary != null) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text(
                text = "Abilities Overview",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.SemiBold
            )

            // Tasks summary
            SummaryCard(
                icon = Icons.Default.CheckCircle,
                title = "Tasks",
                items = listOf(
                    "Total" to "${summary.tasks.total}",
                    "Pending" to "${summary.tasks.pending}",
                    "In Progress" to "${summary.tasks.inProgress}",
                    "Completed" to "${summary.tasks.completed}",
                    "Overdue" to "${summary.tasks.overdue}"
                ),
                accentColor = LunaTheme.colors.accentPrimary
            )

            // Knowledge summary
            SummaryCard(
                icon = Icons.Default.Psychology,
                title = "Knowledge Base",
                items = listOf(
                    "Total Items" to "${summary.knowledge.totalItems}",
                    "Categories" to "${summary.knowledge.categories.size}"
                ),
                accentColor = LunaTheme.colors.accentSecondary
            )

            // Workspace summary
            SummaryCard(
                icon = Icons.Default.Code,
                title = "Workspace",
                items = listOf(
                    "Files" to "${summary.workspace.totalFiles}",
                    "Size" to formatBytes(summary.workspace.totalSize)
                ),
                accentColor = LunaTheme.colors.accentPrimary
            )

            // Documents summary
            SummaryCard(
                icon = Icons.Default.Description,
                title = "Documents",
                items = listOf(
                    "Total" to "${summary.documents.total}",
                    "Ready" to "${summary.documents.ready}",
                    "Processing" to "${summary.documents.processing}"
                ),
                accentColor = LunaTheme.colors.accentSecondary
            )

            // Tools summary
            SummaryCard(
                icon = Icons.Default.Build,
                title = "Custom Tools",
                items = listOf(
                    "Total" to "${summary.tools.total}",
                    "Enabled" to "${summary.tools.enabled}"
                ),
                accentColor = LunaTheme.colors.accentPrimary
            )

            // Agents summary
            SummaryCard(
                icon = Icons.Default.SmartToy,
                title = "AI Agents",
                items = listOf(
                    "Built-in" to "${summary.agents.builtIn}",
                    "Custom" to "${summary.agents.custom}"
                ),
                accentColor = LunaTheme.colors.accentSecondary
            )

            // Mood summary (if available)
            summary.mood?.let { mood ->
                SummaryCard(
                    icon = Icons.Default.Mood,
                    title = "Mood Tracking",
                    items = listOfNotNull(
                        mood.currentMood?.let { "Current" to it },
                        mood.averageScore?.let { "Average" to String.format("%.1f", it) }
                    ),
                    accentColor = LunaTheme.colors.accentPrimary
                )
            }

            // Check-ins summary
            SummaryCard(
                icon = Icons.Default.Schedule,
                title = "Check-ins",
                items = listOf(
                    "Active" to "${summary.checkins.active}",
                    "Upcoming" to "${summary.checkins.upcoming}"
                ),
                accentColor = LunaTheme.colors.accentSecondary
            )

            Spacer(modifier = Modifier.height(16.dp))
        }
    } else {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "Unable to load abilities summary",
                color = LunaTheme.colors.textMuted
            )
        }
    }
}

@Composable
private fun SummaryCard(
    icon: ImageVector,
    title: String,
    items: List<Pair<String, String>>,
    accentColor: androidx.compose.ui.graphics.Color
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(16.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Icon(
                imageVector = icon,
                contentDescription = null,
                tint = accentColor,
                modifier = Modifier.size(24.dp)
            )
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.Medium
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceEvenly
        ) {
            items.forEach { (label, value) ->
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = value,
                        style = MaterialTheme.typography.headlineSmall,
                        color = LunaTheme.colors.textPrimary,
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = label,
                        style = MaterialTheme.typography.bodySmall,
                        color = LunaTheme.colors.textMuted
                    )
                }
            }
        }
    }
}

private fun formatBytes(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
        else -> String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024))
    }
}
