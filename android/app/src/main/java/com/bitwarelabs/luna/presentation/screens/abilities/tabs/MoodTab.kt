package com.bitwarelabs.luna.presentation.screens.abilities.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.MoodEntry
import com.bitwarelabs.luna.domain.model.MoodTrends
import com.bitwarelabs.luna.presentation.screens.abilities.AbilitiesViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun MoodTab(viewModel: AbilitiesViewModel) {
    val uiState by viewModel.uiState.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Text(
            text = "Mood Tracking",
            style = MaterialTheme.typography.titleMedium,
            color = LunaTheme.colors.textPrimary,
            fontWeight = FontWeight.SemiBold
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "Luna tracks emotional patterns from conversations to provide better support.",
            style = MaterialTheme.typography.bodySmall,
            color = LunaTheme.colors.textMuted
        )

        Spacer(modifier = Modifier.height(16.dp))

        if (uiState.isLoadingMood) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                // Trends summary
                uiState.moodTrends?.let { trends ->
                    item {
                        MoodTrendsCard(trends = trends)
                    }
                }

                // Recent mood entries
                if (uiState.moodHistory.isNotEmpty()) {
                    item {
                        Text(
                            text = "Recent Entries",
                            style = MaterialTheme.typography.labelLarge,
                            color = LunaTheme.colors.textMuted
                        )
                    }

                    items(uiState.moodHistory, key = { it.id }) { entry ->
                        MoodEntryItem(entry = entry)
                    }
                } else {
                    item {
                        Box(
                            modifier = Modifier.fillMaxWidth().padding(32.dp),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(
                                    Icons.Default.Mood,
                                    contentDescription = null,
                                    tint = LunaTheme.colors.textMuted,
                                    modifier = Modifier.size(48.dp)
                                )
                                Spacer(Modifier.height(8.dp))
                                Text("No mood data yet", color = LunaTheme.colors.textMuted)
                                Text(
                                    "Mood is tracked from conversations",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = LunaTheme.colors.textMuted
                                )
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun MoodTrendsCard(trends: MoodTrends) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "30-Day Average",
                    style = MaterialTheme.typography.labelMedium,
                    color = LunaTheme.colors.textMuted
                )
                Row(
                    verticalAlignment = Alignment.Bottom,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = String.format("%.1f", trends.averageScore),
                        style = MaterialTheme.typography.headlineLarge,
                        color = getMoodColor(trends.averageScore),
                        fontWeight = FontWeight.Bold
                    )
                    Text(
                        text = "/ 10",
                        style = MaterialTheme.typography.bodyMedium,
                        color = LunaTheme.colors.textMuted
                    )
                }
            }

            // Mood emoji based on score
            val moodEmoji = when {
                trends.averageScore >= 8 -> Icons.Default.SentimentVerySatisfied
                trends.averageScore >= 6 -> Icons.Default.SentimentSatisfied
                trends.averageScore >= 4 -> Icons.Default.SentimentNeutral
                trends.averageScore >= 2 -> Icons.Default.SentimentDissatisfied
                else -> Icons.Default.SentimentVeryDissatisfied
            }
            Icon(
                imageVector = moodEmoji,
                contentDescription = null,
                tint = getMoodColor(trends.averageScore),
                modifier = Modifier.size(48.dp)
            )
        }

        if (trends.dominantEmotions.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            Text(
                text = "Dominant Emotions",
                style = MaterialTheme.typography.labelMedium,
                color = LunaTheme.colors.textMuted
            )
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                trends.dominantEmotions.take(4).forEach { emotion ->
                    Surface(
                        shape = RoundedCornerShape(16.dp),
                        color = LunaTheme.colors.accentPrimary.copy(alpha = 0.2f)
                    ) {
                        Text(
                            text = emotion,
                            style = MaterialTheme.typography.bodySmall,
                            color = LunaTheme.colors.accentPrimary,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun MoodEntryItem(entry: MoodEntry) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Score indicator
        Box(
            modifier = Modifier
                .size(48.dp)
                .clip(CircleShape)
                .background(getMoodColor(entry.score).copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = String.format("%.0f", entry.score),
                style = MaterialTheme.typography.titleMedium,
                color = getMoodColor(entry.score),
                fontWeight = FontWeight.Bold
            )
        }

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                entry.emotions.take(3).forEach { emotion ->
                    Surface(
                        shape = RoundedCornerShape(4.dp),
                        color = LunaTheme.colors.bgTertiary
                    ) {
                        Text(
                            text = emotion,
                            style = MaterialTheme.typography.labelSmall,
                            color = LunaTheme.colors.textSecondary,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
                        )
                    }
                }
            }

            entry.notes?.let {
                Spacer(Modifier.height(4.dp))
                Text(
                    text = it,
                    style = MaterialTheme.typography.bodySmall,
                    color = LunaTheme.colors.textMuted,
                    maxLines = 2
                )
            }

            Spacer(Modifier.height(4.dp))
            Text(
                text = entry.createdAt.take(16).replace("T", " "),
                style = MaterialTheme.typography.labelSmall,
                color = LunaTheme.colors.textMuted
            )
        }
    }
}

@Composable
private fun getMoodColor(score: Double): Color {
    return when {
        score >= 8 -> LunaTheme.colors.success
        score >= 6 -> LunaTheme.colors.accentPrimary
        score >= 4 -> LunaTheme.colors.warning
        else -> LunaTheme.colors.error
    }
}
