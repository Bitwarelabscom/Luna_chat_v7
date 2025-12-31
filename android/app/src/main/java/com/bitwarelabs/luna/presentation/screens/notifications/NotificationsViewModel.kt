package com.bitwarelabs.luna.presentation.screens.notifications

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bitwarelabs.luna.domain.model.*
import com.bitwarelabs.luna.domain.repository.TriggersRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject

enum class NotificationsTab {
    PREFERENCES, SCHEDULES, TELEGRAM, HISTORY
}

data class NotificationsUiState(
    // Tab selection
    val selectedTab: NotificationsTab = NotificationsTab.PREFERENCES,

    // Loading states
    val isLoadingPreferences: Boolean = false,
    val isLoadingSchedules: Boolean = false,
    val isLoadingTelegram: Boolean = false,
    val isLoadingHistory: Boolean = false,
    val isSaving: Boolean = false,

    // Data
    val preferences: NotificationPreferences? = null,
    val schedules: List<CheckinSchedule> = emptyList(),
    val builtinSchedules: List<BuiltinSchedule> = emptyList(),
    val history: List<TriggerHistoryItem> = emptyList(),
    val pendingCount: Int = 0,

    // Telegram
    val telegramStatus: TelegramStatusResponse? = null,
    val telegramLinkCode: TelegramLinkResponse? = null,
    val tradingTelegramStatus: TelegramStatusResponse? = null,
    val tradingTelegramLinkCode: TelegramLinkResponse? = null,

    // Schedule form
    val isCreatingSchedule: Boolean = false,
    val editingScheduleId: String? = null,
    val scheduleName: String = "",
    val scheduleTriggerType: String = "time",
    val scheduleCron: String = "",
    val scheduleTimezone: String = "UTC",
    val schedulePrompt: String = "",
    val scheduleEnabled: Boolean = true,

    // Error handling
    val error: String? = null,
    val successMessage: String? = null
)

@HiltViewModel
class NotificationsViewModel @Inject constructor(
    private val triggersRepository: TriggersRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(NotificationsUiState())
    val uiState: StateFlow<NotificationsUiState> = _uiState.asStateFlow()

    init {
        loadInitialData()
    }

    fun selectTab(tab: NotificationsTab) {
        _uiState.value = _uiState.value.copy(selectedTab = tab)
        when (tab) {
            NotificationsTab.PREFERENCES -> loadPreferences()
            NotificationsTab.SCHEDULES -> loadSchedules()
            NotificationsTab.TELEGRAM -> loadTelegramStatus()
            NotificationsTab.HISTORY -> loadHistory()
        }
    }

    private fun loadInitialData() {
        loadPreferences()
        loadPendingCount()
    }

    // ============================================
    // Preferences
    // ============================================

    fun loadPreferences() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingPreferences = true)

            triggersRepository.getPreferences().fold(
                onSuccess = { prefs ->
                    _uiState.value = _uiState.value.copy(
                        preferences = prefs,
                        isLoadingPreferences = false
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        error = e.message,
                        isLoadingPreferences = false
                    )
                }
            )
        }
    }

    fun updatePreference(update: UpdatePreferencesRequest) {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSaving = true)

            triggersRepository.updatePreferences(update).fold(
                onSuccess = { prefs ->
                    _uiState.value = _uiState.value.copy(
                        preferences = prefs,
                        isSaving = false,
                        successMessage = "Preferences updated"
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        error = e.message,
                        isSaving = false
                    )
                }
            )
        }
    }

    // ============================================
    // Schedules
    // ============================================

    fun loadSchedules() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingSchedules = true)

            val schedulesResult = triggersRepository.getSchedules()
            val builtinsResult = triggersRepository.getBuiltinSchedules()

            schedulesResult.onSuccess { schedules ->
                _uiState.value = _uiState.value.copy(schedules = schedules)
            }

            builtinsResult.onSuccess { builtins ->
                _uiState.value = _uiState.value.copy(builtinSchedules = builtins)
            }

            _uiState.value = _uiState.value.copy(isLoadingSchedules = false)
        }
    }

    fun startCreatingSchedule() {
        _uiState.value = _uiState.value.copy(
            isCreatingSchedule = true,
            editingScheduleId = null,
            scheduleName = "",
            scheduleTriggerType = "time",
            scheduleCron = "",
            scheduleTimezone = "UTC",
            schedulePrompt = "",
            scheduleEnabled = true
        )
    }

    fun startEditingSchedule(schedule: CheckinSchedule) {
        _uiState.value = _uiState.value.copy(
            isCreatingSchedule = false,
            editingScheduleId = schedule.id,
            scheduleName = schedule.name,
            scheduleTriggerType = schedule.triggerType,
            scheduleCron = schedule.triggerConfig.cron ?: "",
            scheduleTimezone = schedule.triggerConfig.timezone ?: "UTC",
            schedulePrompt = schedule.promptTemplate,
            scheduleEnabled = schedule.isEnabled
        )
    }

    fun cancelScheduleForm() {
        _uiState.value = _uiState.value.copy(
            isCreatingSchedule = false,
            editingScheduleId = null
        )
    }

    fun updateScheduleName(name: String) {
        _uiState.value = _uiState.value.copy(scheduleName = name)
    }

    fun updateScheduleTriggerType(type: String) {
        _uiState.value = _uiState.value.copy(scheduleTriggerType = type)
    }

    fun updateScheduleCron(cron: String) {
        _uiState.value = _uiState.value.copy(scheduleCron = cron)
    }

    fun updateScheduleTimezone(timezone: String) {
        _uiState.value = _uiState.value.copy(scheduleTimezone = timezone)
    }

    fun updateSchedulePrompt(prompt: String) {
        _uiState.value = _uiState.value.copy(schedulePrompt = prompt)
    }

    fun updateScheduleEnabled(enabled: Boolean) {
        _uiState.value = _uiState.value.copy(scheduleEnabled = enabled)
    }

    fun saveSchedule() {
        val state = _uiState.value
        if (state.scheduleName.isBlank() || state.schedulePrompt.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "Name and prompt are required")
            return
        }

        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSaving = true)

            val triggerConfig = TriggerConfig(
                cron = if (state.scheduleTriggerType == "time") state.scheduleCron else null,
                timezone = state.scheduleTimezone
            )

            if (state.editingScheduleId != null) {
                // Update existing
                val request = UpdateScheduleRequest(
                    name = state.scheduleName,
                    triggerConfig = triggerConfig,
                    promptTemplate = state.schedulePrompt,
                    isEnabled = state.scheduleEnabled
                )

                triggersRepository.updateSchedule(state.editingScheduleId, request).fold(
                    onSuccess = {
                        _uiState.value = _uiState.value.copy(
                            isSaving = false,
                            editingScheduleId = null,
                            successMessage = "Schedule updated"
                        )
                        loadSchedules()
                    },
                    onFailure = { e ->
                        _uiState.value = _uiState.value.copy(
                            error = e.message,
                            isSaving = false
                        )
                    }
                )
            } else {
                // Create new
                val request = CreateScheduleRequest(
                    name = state.scheduleName,
                    triggerType = state.scheduleTriggerType,
                    triggerConfig = triggerConfig,
                    promptTemplate = state.schedulePrompt,
                    isEnabled = state.scheduleEnabled
                )

                triggersRepository.createSchedule(request).fold(
                    onSuccess = {
                        _uiState.value = _uiState.value.copy(
                            isSaving = false,
                            isCreatingSchedule = false,
                            successMessage = "Schedule created"
                        )
                        loadSchedules()
                    },
                    onFailure = { e ->
                        _uiState.value = _uiState.value.copy(
                            error = e.message,
                            isSaving = false
                        )
                    }
                )
            }
        }
    }

    fun deleteSchedule(scheduleId: String) {
        viewModelScope.launch {
            triggersRepository.deleteSchedule(scheduleId).fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(successMessage = "Schedule deleted")
                    loadSchedules()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun toggleScheduleEnabled(schedule: CheckinSchedule) {
        viewModelScope.launch {
            val request = UpdateScheduleRequest(isEnabled = !schedule.isEnabled)
            triggersRepository.updateSchedule(schedule.id, request).fold(
                onSuccess = { loadSchedules() },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    // ============================================
    // Telegram
    // ============================================

    fun loadTelegramStatus() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingTelegram = true)

            val telegramResult = triggersRepository.getTelegramStatus()
            val tradingResult = triggersRepository.getTradingTelegramStatus()

            telegramResult.onSuccess { status ->
                _uiState.value = _uiState.value.copy(telegramStatus = status)
            }

            tradingResult.onSuccess { status ->
                _uiState.value = _uiState.value.copy(tradingTelegramStatus = status)
            }

            _uiState.value = _uiState.value.copy(isLoadingTelegram = false)
        }
    }

    fun generateTelegramLink() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSaving = true)

            triggersRepository.generateTelegramLinkCode().fold(
                onSuccess = { link ->
                    _uiState.value = _uiState.value.copy(
                        telegramLinkCode = link,
                        isSaving = false
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        error = e.message,
                        isSaving = false
                    )
                }
            )
        }
    }

    fun unlinkTelegram() {
        viewModelScope.launch {
            triggersRepository.unlinkTelegram().fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        successMessage = "Telegram unlinked",
                        telegramLinkCode = null
                    )
                    loadTelegramStatus()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun testTelegram() {
        viewModelScope.launch {
            triggersRepository.testTelegram().fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(successMessage = "Test message sent")
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun generateTradingTelegramLink() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isSaving = true)

            triggersRepository.generateTradingTelegramLinkCode().fold(
                onSuccess = { link ->
                    _uiState.value = _uiState.value.copy(
                        tradingTelegramLinkCode = link,
                        isSaving = false
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        error = e.message,
                        isSaving = false
                    )
                }
            )
        }
    }

    fun unlinkTradingTelegram() {
        viewModelScope.launch {
            triggersRepository.unlinkTradingTelegram().fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(
                        successMessage = "Trading Telegram unlinked",
                        tradingTelegramLinkCode = null
                    )
                    loadTelegramStatus()
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    fun testTradingTelegram() {
        viewModelScope.launch {
            triggersRepository.testTradingTelegram().fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(successMessage = "Test message sent")
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    // ============================================
    // History
    // ============================================

    fun loadHistory() {
        viewModelScope.launch {
            _uiState.value = _uiState.value.copy(isLoadingHistory = true)

            triggersRepository.getHistory(50).fold(
                onSuccess = { history ->
                    _uiState.value = _uiState.value.copy(
                        history = history,
                        isLoadingHistory = false
                    )
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(
                        error = e.message,
                        isLoadingHistory = false
                    )
                }
            )
        }
    }

    fun loadPendingCount() {
        viewModelScope.launch {
            triggersRepository.getPendingCount().onSuccess { count ->
                _uiState.value = _uiState.value.copy(pendingCount = count)
            }
        }
    }

    // ============================================
    // Test Notifications
    // ============================================

    fun sendTestNotification() {
        viewModelScope.launch {
            triggersRepository.sendTestTrigger(
                "This is a test notification from the Android app!",
                "chat"
            ).fold(
                onSuccess = {
                    _uiState.value = _uiState.value.copy(successMessage = "Test notification sent")
                },
                onFailure = { e ->
                    _uiState.value = _uiState.value.copy(error = e.message)
                }
            )
        }
    }

    // ============================================
    // Error Handling
    // ============================================

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun clearSuccessMessage() {
        _uiState.value = _uiState.value.copy(successMessage = null)
    }
}
