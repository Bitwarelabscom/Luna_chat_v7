package com.bitwarelabs.luna.presentation.screens.abilities.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.BuiltInCheckin
import com.bitwarelabs.luna.domain.model.CheckinHistory
import com.bitwarelabs.luna.domain.model.LegacyCheckinSchedule
import com.bitwarelabs.luna.presentation.screens.abilities.AbilitiesViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun CheckinsTab(viewModel: AbilitiesViewModel) {
    val uiState by viewModel.uiState.collectAsState()
    val checkinsData = uiState.checkins
    var showHistory by remember { mutableStateOf(false) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Check-ins",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.SemiBold
            )
            TextButton(onClick = { showHistory = !showHistory }) {
                Text(
                    text = if (showHistory) "Schedules" else "History",
                    color = LunaTheme.colors.accentPrimary
                )
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = "Scheduled prompts for daily check-ins, reflections, and wellness tracking.",
            style = MaterialTheme.typography.bodySmall,
            color = LunaTheme.colors.textMuted
        )

        Spacer(modifier = Modifier.height(16.dp))

        if (uiState.isLoadingCheckins) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else if (showHistory) {
            // History view
            if (uiState.checkinHistory.isEmpty()) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Icon(Icons.Default.History, contentDescription = null, tint = LunaTheme.colors.textMuted, modifier = Modifier.size(48.dp))
                        Spacer(Modifier.height(8.dp))
                        Text("No check-in history", color = LunaTheme.colors.textMuted)
                    }
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(uiState.checkinHistory, key = { it.id }) { history ->
                        CheckinHistoryItem(history = history)
                    }
                }
            }
        } else {
            // Schedules view
            if (checkinsData == null) {
                Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("Unable to load check-ins", color = LunaTheme.colors.textMuted)
                }
            } else {
                LazyColumn(verticalArrangement = Arrangement.spacedBy(16.dp)) {
                    // Built-in check-in types
                    item {
                        Text(
                            text = "Available Check-in Types",
                            style = MaterialTheme.typography.labelLarge,
                            color = LunaTheme.colors.textMuted
                        )
                    }

                    items(checkinsData.builtIn, key = { "builtin-${it.type}" }) { checkin ->
                        BuiltInCheckinItem(checkin = checkin)
                    }

                    // Active schedules
                    if (checkinsData.schedules.isNotEmpty()) {
                        item {
                            Spacer(Modifier.height(8.dp))
                            Text(
                                text = "Your Schedules",
                                style = MaterialTheme.typography.labelLarge,
                                color = LunaTheme.colors.textMuted
                            )
                        }

                        items(checkinsData.schedules, key = { "schedule-${it.id}" }) { schedule ->
                            CheckinScheduleItem(
                                schedule = schedule,
                                onDelete = { viewModel.deleteCheckin(schedule.id) }
                            )
                        }
                    } else {
                        item {
                            Spacer(Modifier.height(16.dp))
                            Box(
                                modifier = Modifier.fillMaxWidth(),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "No active schedules. Ask Luna to set up check-ins.",
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
private fun BuiltInCheckinItem(checkin: BuiltInCheckin) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        val icon = when (checkin.type) {
            "morning" -> Icons.Default.WbSunny
            "evening" -> Icons.Default.NightsStay
            "mood" -> Icons.Default.Mood
            "gratitude" -> Icons.Default.Favorite
            "reflection" -> Icons.Default.AutoStories
            else -> Icons.Default.Schedule
        }

        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = LunaTheme.colors.accentPrimary,
            modifier = Modifier.size(32.dp)
        )

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = checkin.name,
                style = MaterialTheme.typography.bodyLarge,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = checkin.description,
                style = MaterialTheme.typography.bodySmall,
                color = LunaTheme.colors.textMuted
            )
        }

        Text(
            text = checkin.defaultTime,
            style = MaterialTheme.typography.labelSmall,
            color = LunaTheme.colors.textMuted
        )
    }
}

@Composable
private fun CheckinScheduleItem(
    schedule: LegacyCheckinSchedule,
    onDelete: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Text(
                    text = schedule.name,
                    style = MaterialTheme.typography.bodyLarge,
                    color = LunaTheme.colors.textPrimary,
                    fontWeight = FontWeight.Medium
                )
                if (!schedule.enabled) {
                    Surface(
                        shape = RoundedCornerShape(4.dp),
                        color = LunaTheme.colors.textMuted.copy(alpha = 0.2f)
                    ) {
                        Text(
                            text = "Disabled",
                            style = MaterialTheme.typography.labelSmall,
                            color = LunaTheme.colors.textMuted,
                            modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
                        )
                    }
                }
            }
            Text(
                text = "Type: ${schedule.type}",
                style = MaterialTheme.typography.bodySmall,
                color = LunaTheme.colors.textMuted
            )
            schedule.nextTrigger?.let {
                Text(
                    text = "Next: ${it.take(16).replace("T", " ")}",
                    style = MaterialTheme.typography.labelSmall,
                    color = LunaTheme.colors.accentPrimary
                )
            }
        }

        IconButton(onClick = onDelete) {
            Icon(Icons.Default.Delete, contentDescription = "Delete", tint = LunaTheme.colors.error)
        }
    }
}

@Composable
private fun CheckinHistoryItem(history: CheckinHistory) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = history.type.replaceFirstChar { it.uppercase() },
                style = MaterialTheme.typography.bodyMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = history.createdAt.take(10),
                style = MaterialTheme.typography.labelSmall,
                color = LunaTheme.colors.textMuted
            )
        }

        history.response?.let { response ->
            Spacer(Modifier.height(8.dp))
            Text(
                text = response,
                style = MaterialTheme.typography.bodySmall,
                color = LunaTheme.colors.textSecondary,
                maxLines = 3
            )
        }

        if (history.completedAt != null) {
            Spacer(Modifier.height(4.dp))
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                Icon(
                    Icons.Default.CheckCircle,
                    contentDescription = null,
                    tint = LunaTheme.colors.success,
                    modifier = Modifier.size(14.dp)
                )
                Text(
                    text = "Completed",
                    style = MaterialTheme.typography.labelSmall,
                    color = LunaTheme.colors.success
                )
            }
        }
    }
}
