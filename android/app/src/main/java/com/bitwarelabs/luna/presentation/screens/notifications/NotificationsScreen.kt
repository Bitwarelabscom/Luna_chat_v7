package com.bitwarelabs.luna.presentation.screens.notifications

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.domain.model.*
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NotificationsScreen(
    onNavigateBack: () -> Unit,
    viewModel: NotificationsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    // Show error/success messages
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
                title = { Text("Notifications", color = LunaTheme.colors.textPrimary) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.Default.ArrowBack,
                            contentDescription = "Back",
                            tint = LunaTheme.colors.textPrimary
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
            // Tab Row
            ScrollableTabRow(
                selectedTabIndex = NotificationsTab.entries.indexOf(uiState.selectedTab),
                containerColor = LunaTheme.colors.bgSecondary,
                contentColor = LunaTheme.colors.textPrimary,
                edgePadding = 16.dp
            ) {
                NotificationsTab.entries.forEach { tab ->
                    Tab(
                        selected = uiState.selectedTab == tab,
                        onClick = { viewModel.selectTab(tab) },
                        text = {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(
                                    text = when (tab) {
                                        NotificationsTab.PREFERENCES -> "Preferences"
                                        NotificationsTab.SCHEDULES -> "Schedules"
                                        NotificationsTab.TELEGRAM -> "Telegram"
                                        NotificationsTab.HISTORY -> "History"
                                    }
                                )
                                if (tab == NotificationsTab.HISTORY && uiState.pendingCount > 0) {
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Badge { Text("${uiState.pendingCount}") }
                                }
                            }
                        }
                    )
                }
            }

            // Content
            when (uiState.selectedTab) {
                NotificationsTab.PREFERENCES -> PreferencesTab(uiState, viewModel)
                NotificationsTab.SCHEDULES -> SchedulesTab(uiState, viewModel)
                NotificationsTab.TELEGRAM -> TelegramTab(uiState, viewModel)
                NotificationsTab.HISTORY -> HistoryTab(uiState, viewModel)
            }
        }
    }
}

// ============================================
// Preferences Tab
// ============================================

@Composable
private fun PreferencesTab(
    uiState: NotificationsUiState,
    viewModel: NotificationsViewModel
) {
    if (uiState.isLoadingPreferences) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
        }
        return
    }

    val prefs = uiState.preferences ?: return

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        item {
            Text(
                text = "Notification Channels",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.Bold
            )
        }

        item {
            PreferenceSwitch(
                title = "Chat Notifications",
                subtitle = "Show notifications in chat interface",
                checked = prefs.enableChatNotifications,
                onCheckedChange = {
                    viewModel.updatePreference(UpdatePreferencesRequest(enableChatNotifications = it))
                }
            )
        }

        item {
            PreferenceSwitch(
                title = "Push Notifications",
                subtitle = "Receive push notifications on this device",
                checked = prefs.enablePushNotifications,
                onCheckedChange = {
                    viewModel.updatePreference(UpdatePreferencesRequest(enablePushNotifications = it))
                }
            )
        }

        item {
            PreferenceSwitch(
                title = "Telegram",
                subtitle = "Receive notifications via Telegram",
                checked = prefs.enableTelegram,
                onCheckedChange = {
                    viewModel.updatePreference(UpdatePreferencesRequest(enableTelegram = it))
                }
            )
        }

        item {
            PreferenceSwitch(
                title = "Email Digest",
                subtitle = "Receive daily email summary",
                checked = prefs.enableEmailDigest,
                onCheckedChange = {
                    viewModel.updatePreference(UpdatePreferencesRequest(enableEmailDigest = it))
                }
            )
        }

        item {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Notification Types",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.Bold
            )
        }

        item {
            PreferenceSwitch(
                title = "Reminders",
                subtitle = "Task and event reminders",
                checked = prefs.enableReminders,
                onCheckedChange = {
                    viewModel.updatePreference(UpdatePreferencesRequest(enableReminders = it))
                }
            )
        }

        item {
            PreferenceSwitch(
                title = "Check-ins",
                subtitle = "Scheduled check-in prompts",
                checked = prefs.enableCheckins,
                onCheckedChange = {
                    viewModel.updatePreference(UpdatePreferencesRequest(enableCheckins = it))
                }
            )
        }

        item {
            PreferenceSwitch(
                title = "Insights",
                subtitle = "AI-generated insights and suggestions",
                checked = prefs.enableInsights,
                onCheckedChange = {
                    viewModel.updatePreference(UpdatePreferencesRequest(enableInsights = it))
                }
            )
        }

        item {
            PreferenceSwitch(
                title = "Achievements",
                subtitle = "Progress and achievement notifications",
                checked = prefs.enableAchievements,
                onCheckedChange = {
                    viewModel.updatePreference(UpdatePreferencesRequest(enableAchievements = it))
                }
            )
        }

        item {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Quiet Hours",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.Bold
            )
        }

        item {
            PreferenceSwitch(
                title = "Enable Quiet Hours",
                subtitle = "Pause notifications during set hours",
                checked = prefs.quietHoursEnabled,
                onCheckedChange = {
                    viewModel.updatePreference(UpdatePreferencesRequest(quietHoursEnabled = it))
                }
            )
        }

        if (prefs.quietHoursEnabled) {
            item {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Text(
                        text = "Start: ${prefs.quietHoursStart ?: "22:00"}",
                        color = LunaTheme.colors.textSecondary
                    )
                    Text(
                        text = "End: ${prefs.quietHoursEnd ?: "08:00"}",
                        color = LunaTheme.colors.textSecondary
                    )
                }
            }
        }

        item {
            Spacer(modifier = Modifier.height(16.dp))
            Button(
                onClick = { viewModel.sendTestNotification() },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = LunaTheme.colors.accentPrimary
                )
            ) {
                Icon(Icons.Default.Notifications, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Send Test Notification")
            }
        }
    }
}

@Composable
private fun PreferenceSwitch(
    title: String,
    subtitle: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(LunaTheme.colors.bgSecondary)
            .clickable { onCheckedChange(!checked) }
            .padding(16.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
                color = LunaTheme.colors.textPrimary
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = LunaTheme.colors.textMuted
            )
        }
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            colors = SwitchDefaults.colors(
                checkedThumbColor = LunaTheme.colors.accentPrimary,
                checkedTrackColor = LunaTheme.colors.accentPrimary.copy(alpha = 0.5f)
            )
        )
    }
}

// ============================================
// Schedules Tab
// ============================================

@Composable
private fun SchedulesTab(
    uiState: NotificationsUiState,
    viewModel: NotificationsViewModel
) {
    if (uiState.isLoadingSchedules) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
        }
        return
    }

    // Show schedule form if editing/creating
    if (uiState.isCreatingSchedule || uiState.editingScheduleId != null) {
        ScheduleForm(uiState, viewModel)
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Button(
                onClick = { viewModel.startCreatingSchedule() },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = LunaTheme.colors.accentPrimary
                )
            ) {
                Icon(Icons.Default.Add, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Create Schedule")
            }
        }

        if (uiState.schedules.isEmpty()) {
            item {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(32.dp),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = "No schedules yet",
                        color = LunaTheme.colors.textMuted
                    )
                }
            }
        }

        items(uiState.schedules) { schedule ->
            ScheduleCard(
                schedule = schedule,
                onToggle = { viewModel.toggleScheduleEnabled(schedule) },
                onEdit = { viewModel.startEditingSchedule(schedule) },
                onDelete = { viewModel.deleteSchedule(schedule.id) }
            )
        }

        if (uiState.builtinSchedules.isNotEmpty()) {
            item {
                Spacer(modifier = Modifier.height(16.dp))
                Text(
                    text = "Built-in Templates",
                    style = MaterialTheme.typography.titleMedium,
                    color = LunaTheme.colors.textPrimary,
                    fontWeight = FontWeight.Bold
                )
            }

            items(uiState.builtinSchedules) { builtin ->
                BuiltinScheduleCard(builtin = builtin)
            }
        }
    }
}

@Composable
private fun ScheduleCard(
    schedule: CheckinSchedule,
    onToggle: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = LunaTheme.colors.bgSecondary
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = schedule.name,
                    style = MaterialTheme.typography.bodyLarge,
                    color = LunaTheme.colors.textPrimary,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = schedule.triggerConfig.cron ?: schedule.triggerType,
                    style = MaterialTheme.typography.bodySmall,
                    color = LunaTheme.colors.textMuted
                )
                Text(
                    text = schedule.promptTemplate,
                    style = MaterialTheme.typography.bodySmall,
                    color = LunaTheme.colors.textSecondary,
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
            }

            Switch(
                checked = schedule.isEnabled,
                onCheckedChange = { onToggle() },
                colors = SwitchDefaults.colors(
                    checkedThumbColor = LunaTheme.colors.success,
                    checkedTrackColor = LunaTheme.colors.success.copy(alpha = 0.5f)
                )
            )

            IconButton(onClick = onEdit) {
                Icon(
                    Icons.Default.Edit,
                    contentDescription = "Edit",
                    tint = LunaTheme.colors.textMuted
                )
            }

            IconButton(onClick = onDelete) {
                Icon(
                    Icons.Default.Delete,
                    contentDescription = "Delete",
                    tint = LunaTheme.colors.error
                )
            }
        }
    }
}

@Composable
private fun BuiltinScheduleCard(builtin: BuiltinSchedule) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = LunaTheme.colors.bgTertiary
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp)
        ) {
            Text(
                text = builtin.name,
                style = MaterialTheme.typography.bodyLarge,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.Medium
            )
            Text(
                text = builtin.description,
                style = MaterialTheme.typography.bodySmall,
                color = LunaTheme.colors.textMuted
            )
        }
    }
}

@Composable
private fun ScheduleForm(
    uiState: NotificationsUiState,
    viewModel: NotificationsViewModel
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text(
            text = if (uiState.editingScheduleId != null) "Edit Schedule" else "Create Schedule",
            style = MaterialTheme.typography.titleLarge,
            color = LunaTheme.colors.textPrimary,
            fontWeight = FontWeight.Bold
        )

        OutlinedTextField(
            value = uiState.scheduleName,
            onValueChange = { viewModel.updateScheduleName(it) },
            label = { Text("Name") },
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = LunaTheme.colors.accentPrimary,
                unfocusedBorderColor = LunaTheme.colors.border
            )
        )

        OutlinedTextField(
            value = uiState.scheduleCron,
            onValueChange = { viewModel.updateScheduleCron(it) },
            label = { Text("Cron Expression") },
            placeholder = { Text("0 9 * * *") },
            modifier = Modifier.fillMaxWidth(),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = LunaTheme.colors.accentPrimary,
                unfocusedBorderColor = LunaTheme.colors.border
            )
        )

        OutlinedTextField(
            value = uiState.schedulePrompt,
            onValueChange = { viewModel.updateSchedulePrompt(it) },
            label = { Text("Prompt Template") },
            modifier = Modifier.fillMaxWidth(),
            minLines = 3,
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = LunaTheme.colors.accentPrimary,
                unfocusedBorderColor = LunaTheme.colors.border
            )
        )

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text("Enabled", color = LunaTheme.colors.textPrimary)
            Switch(
                checked = uiState.scheduleEnabled,
                onCheckedChange = { viewModel.updateScheduleEnabled(it) }
            )
        }

        Spacer(modifier = Modifier.weight(1f))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            OutlinedButton(
                onClick = { viewModel.cancelScheduleForm() },
                modifier = Modifier.weight(1f)
            ) {
                Text("Cancel")
            }

            Button(
                onClick = { viewModel.saveSchedule() },
                modifier = Modifier.weight(1f),
                enabled = !uiState.isSaving,
                colors = ButtonDefaults.buttonColors(
                    containerColor = LunaTheme.colors.accentPrimary
                )
            ) {
                if (uiState.isSaving) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(16.dp),
                        color = LunaTheme.colors.textPrimary
                    )
                } else {
                    Text("Save")
                }
            }
        }
    }
}

// ============================================
// Telegram Tab
// ============================================

@Composable
private fun TelegramTab(
    uiState: NotificationsUiState,
    viewModel: NotificationsViewModel
) {
    if (uiState.isLoadingTelegram) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
        }
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Main Telegram Bot
        item {
            Text(
                text = "Luna Bot",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.Bold
            )
        }

        item {
            TelegramConnectionCard(
                status = uiState.telegramStatus,
                linkCode = uiState.telegramLinkCode,
                onGenerateLink = { viewModel.generateTelegramLink() },
                onUnlink = { viewModel.unlinkTelegram() },
                onTest = { viewModel.testTelegram() },
                isSaving = uiState.isSaving
            )
        }

        // Trading Telegram Bot
        item {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Trading Bot",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.Bold
            )
        }

        item {
            TelegramConnectionCard(
                status = uiState.tradingTelegramStatus,
                linkCode = uiState.tradingTelegramLinkCode,
                onGenerateLink = { viewModel.generateTradingTelegramLink() },
                onUnlink = { viewModel.unlinkTradingTelegram() },
                onTest = { viewModel.testTradingTelegram() },
                isSaving = uiState.isSaving
            )
        }
    }
}

@Composable
private fun TelegramConnectionCard(
    status: TelegramStatusResponse?,
    linkCode: TelegramLinkResponse?,
    onGenerateLink: () -> Unit,
    onUnlink: () -> Unit,
    onTest: () -> Unit,
    isSaving: Boolean
) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(
            containerColor = LunaTheme.colors.bgSecondary
        )
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            if (!status?.isConfigured!!) {
                Text(
                    text = "Telegram not configured on server",
                    color = LunaTheme.colors.warning
                )
                status.setupInstructions?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = LunaTheme.colors.textMuted
                    )
                }
                return@Column
            }

            val connection = status.connection

            if (connection?.isActive == true) {
                // Connected state
                Row(
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(
                        Icons.Default.CheckCircle,
                        contentDescription = null,
                        tint = LunaTheme.colors.success
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Column {
                        Text(
                            text = "Connected",
                            color = LunaTheme.colors.success,
                            fontWeight = FontWeight.Medium
                        )
                        Text(
                            text = "@${connection.username ?: connection.firstName ?: "User"}",
                            style = MaterialTheme.typography.bodySmall,
                            color = LunaTheme.colors.textMuted
                        )
                    }
                }

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onTest,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("Test")
                    }
                    OutlinedButton(
                        onClick = onUnlink,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.outlinedButtonColors(
                            contentColor = LunaTheme.colors.error
                        )
                    ) {
                        Text("Unlink")
                    }
                }
            } else {
                // Not connected state
                Text(
                    text = "Not connected",
                    color = LunaTheme.colors.textMuted
                )

                if (linkCode != null) {
                    // Show link code
                    Column(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(LunaTheme.colors.bgTertiary)
                            .padding(12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                        Text(
                            text = "Open this link in Telegram:",
                            style = MaterialTheme.typography.bodySmall,
                            color = LunaTheme.colors.textMuted
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = linkCode.linkUrl ?: "t.me/${linkCode.botUsername}?start=${linkCode.code}",
                            color = LunaTheme.colors.accentPrimary,
                            fontWeight = FontWeight.Medium
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Expires in ${linkCode.expiresInMinutes} minutes",
                            style = MaterialTheme.typography.bodySmall,
                            color = LunaTheme.colors.textMuted
                        )
                    }
                }

                Button(
                    onClick = onGenerateLink,
                    modifier = Modifier.fillMaxWidth(),
                    enabled = !isSaving,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = LunaTheme.colors.accentPrimary
                    )
                ) {
                    if (isSaving) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = LunaTheme.colors.textPrimary
                        )
                    } else {
                        Icon(Icons.Default.Link, contentDescription = null)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(if (linkCode != null) "Generate New Link" else "Generate Link")
                    }
                }
            }
        }
    }
}

// ============================================
// History Tab
// ============================================

@Composable
private fun HistoryTab(
    uiState: NotificationsUiState,
    viewModel: NotificationsViewModel
) {
    if (uiState.isLoadingHistory) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
        }
        return
    }

    if (uiState.history.isEmpty()) {
        Box(
            modifier = Modifier.fillMaxSize(),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = "No notification history",
                color = LunaTheme.colors.textMuted
            )
        }
        return
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(uiState.history) { item ->
            HistoryItemCard(item)
        }
    }
}

@Composable
private fun HistoryItemCard(item: TriggerHistoryItem) {
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
            verticalAlignment = Alignment.CenterVertically
        ) {
            // Status icon
            Icon(
                imageVector = when (item.status) {
                    "delivered" -> Icons.Default.CheckCircle
                    "failed" -> Icons.Default.Error
                    else -> Icons.Default.Schedule
                },
                contentDescription = null,
                tint = when (item.status) {
                    "delivered" -> LunaTheme.colors.success
                    "failed" -> LunaTheme.colors.error
                    else -> LunaTheme.colors.warning
                },
                modifier = Modifier.size(24.dp)
            )

            Spacer(modifier = Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.scheduleName ?: item.triggerType,
                    style = MaterialTheme.typography.bodyMedium,
                    color = LunaTheme.colors.textPrimary,
                    fontWeight = FontWeight.Medium
                )
                item.message?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = LunaTheme.colors.textSecondary,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis
                    )
                }
                Text(
                    text = "${item.deliveryMethod} - ${item.createdAt}",
                    style = MaterialTheme.typography.bodySmall,
                    color = LunaTheme.colors.textMuted
                )
            }
        }
    }
}
