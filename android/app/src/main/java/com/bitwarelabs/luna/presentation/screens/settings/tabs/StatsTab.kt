package com.bitwarelabs.luna.presentation.screens.settings.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Memory
import androidx.compose.material.icons.filled.Message
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Token
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.presentation.screens.settings.SettingsViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme
import java.text.NumberFormat

@Composable
fun StatsTab(
    modifier: Modifier = Modifier,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val stats = uiState.stats

    Column(
        modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)
    ) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text(text = "Usage Statistics", style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary, fontWeight = FontWeight.SemiBold)
            IconButton(onClick = { viewModel.loadStats() }, enabled = !uiState.isLoadingStats) {
                if (uiState.isLoadingStats) {
                    CircularProgressIndicator(modifier = Modifier.size(20.dp), color = LunaTheme.colors.accentPrimary, strokeWidth = 2.dp)
                } else {
                    Icon(imageVector = Icons.Default.Refresh, contentDescription = "Refresh", tint = LunaTheme.colors.textMuted)
                }
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        if (stats == null && uiState.isLoadingStats) {
            Box(modifier = Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else if (stats != null) {
            SectionTitle("Token Usage", Icons.Default.Token)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard(label = "Total", value = formatNumber(stats.tokens.total), modifier = Modifier.weight(1f))
                StatCard(label = "This Month", value = formatNumber(stats.tokens.thisMonth), modifier = Modifier.weight(1f))
            }
            Spacer(modifier = Modifier.height(12.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard(label = "This Week", value = formatNumber(stats.tokens.thisWeek), modifier = Modifier.weight(1f))
                StatCard(label = "Today", value = formatNumber(stats.tokens.today), modifier = Modifier.weight(1f))
            }

            if (stats.tokens.byModel.isNotEmpty()) {
                Spacer(modifier = Modifier.height(16.dp))
                Text(text = "By Model", style = MaterialTheme.typography.bodyMedium, color = LunaTheme.colors.textMuted, fontWeight = FontWeight.Medium)
                Spacer(modifier = Modifier.height(8.dp))
                Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(LunaTheme.colors.bgSecondary).padding(12.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    stats.tokens.byModel.forEach { (model, tokens) ->
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                            Text(text = model, style = MaterialTheme.typography.bodySmall, color = LunaTheme.colors.textSecondary)
                            Text(text = formatNumber(tokens), style = MaterialTheme.typography.bodySmall, color = LunaTheme.colors.textPrimary, fontWeight = FontWeight.Medium)
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
            SectionTitle("Memory", Icons.Default.Memory)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard(label = "Facts", value = "${stats.memory.activeFacts}/${stats.memory.totalFacts}", modifier = Modifier.weight(1f))
                StatCard(label = "Embeddings", value = formatNumber(stats.memory.totalEmbeddings.toLong()), modifier = Modifier.weight(1f))
            }
            Spacer(modifier = Modifier.height(12.dp))
            StatCard(label = "Summaries", value = formatNumber(stats.memory.totalSummaries.toLong()), modifier = Modifier.fillMaxWidth())

            Spacer(modifier = Modifier.height(24.dp))
            SectionTitle("Sessions", Icons.Default.Message)
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                StatCard(label = "Total Sessions", value = formatNumber(stats.sessions.total.toLong()), modifier = Modifier.weight(1f))
                StatCard(label = "Archived", value = formatNumber(stats.sessions.archived.toLong()), modifier = Modifier.weight(1f))
            }
            Spacer(modifier = Modifier.height(12.dp))
            StatCard(label = "Total Messages", value = formatNumber(stats.sessions.totalMessages.toLong()), modifier = Modifier.fillMaxWidth())
        }
    }
}

@Composable
private fun SectionTitle(title: String, icon: ImageVector) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 12.dp)) {
        Icon(imageVector = icon, contentDescription = null, tint = LunaTheme.colors.accentPrimary, modifier = Modifier.size(20.dp))
        Spacer(modifier = Modifier.width(8.dp))
        Text(text = title, style = MaterialTheme.typography.titleSmall, color = LunaTheme.colors.textPrimary, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun StatCard(label: String, value: String, modifier: Modifier = Modifier) {
    Column(modifier = modifier.clip(RoundedCornerShape(12.dp)).background(LunaTheme.colors.bgSecondary).padding(16.dp)) {
        Text(text = label, style = MaterialTheme.typography.bodySmall, color = LunaTheme.colors.textMuted)
        Spacer(modifier = Modifier.height(4.dp))
        Text(text = value, style = MaterialTheme.typography.headlineSmall, color = LunaTheme.colors.textPrimary, fontWeight = FontWeight.Bold)
    }
}

private fun formatNumber(number: Long): String = NumberFormat.getNumberInstance().format(number)
