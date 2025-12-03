package com.bitwarelabs.luna.presentation.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bitwarelabs.luna.domain.model.AvailableModels
import com.bitwarelabs.luna.domain.model.DefaultPrompts
import com.bitwarelabs.luna.domain.model.ModelConfig
import com.bitwarelabs.luna.domain.model.SavedPrompt
import com.bitwarelabs.luna.domain.model.UserStats
import com.bitwarelabs.luna.domain.repository.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class SettingsUiState(
    // Prompts
    val prompts: List<SavedPrompt> = emptyList(),
    val activePromptId: String? = null,
    val defaultPrompts: DefaultPrompts? = null,
    val isLoadingPrompts: Boolean = false,
    val editingPrompt: SavedPrompt? = null,
    val isCreatingPrompt: Boolean = false,

    // Stats
    val stats: UserStats? = null,
    val isLoadingStats: Boolean = false,

    // Models
    val availableModels: AvailableModels? = null,
    val modelConfigs: List<ModelConfig> = emptyList(),
    val isLoadingModels: Boolean = false,

    // Data
    val isExporting: Boolean = false,
    val isImporting: Boolean = false,
    val isClearing: Boolean = false,

    // General
    val error: String? = null,
    val successMessage: String? = null
)

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val settingsRepository: SettingsRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(SettingsUiState())
    val uiState: StateFlow<SettingsUiState> = _uiState.asStateFlow()

    init {
        loadPrompts()
        loadStats()
        loadModels()
    }

    // --- Prompts ---

    fun loadPrompts() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingPrompts = true, error = null) }

            val promptsResult = settingsRepository.getSavedPrompts()
            val activeResult = settingsRepository.getActivePromptId()
            val defaultsResult = settingsRepository.getDefaultPrompts()

            promptsResult.onSuccess { prompts ->
                _uiState.update { it.copy(prompts = prompts) }
            }

            activeResult.onSuccess { activeId ->
                _uiState.update { it.copy(activePromptId = activeId) }
            }

            defaultsResult.onSuccess { defaults ->
                _uiState.update { it.copy(defaultPrompts = defaults) }
            }

            _uiState.update { it.copy(isLoadingPrompts = false) }
        }
    }

    fun setActivePrompt(promptId: String?) {
        viewModelScope.launch {
            settingsRepository.setActivePrompt(promptId)
                .onSuccess {
                    _uiState.update { it.copy(activePromptId = promptId) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message) }
                }
        }
    }

    fun startEditingPrompt(prompt: SavedPrompt) {
        _uiState.update { it.copy(editingPrompt = prompt) }
    }

    fun startCreatingPrompt() {
        _uiState.update { it.copy(isCreatingPrompt = true) }
    }

    fun cancelEditingPrompt() {
        _uiState.update { it.copy(editingPrompt = null, isCreatingPrompt = false) }
    }

    fun savePrompt(
        name: String,
        description: String?,
        basePrompt: String,
        assistantAdditions: String?,
        companionAdditions: String?
    ) {
        viewModelScope.launch {
            val editingPrompt = _uiState.value.editingPrompt

            if (editingPrompt != null) {
                settingsRepository.updatePrompt(
                    id = editingPrompt.id,
                    name = name,
                    description = description,
                    basePrompt = basePrompt,
                    assistantAdditions = assistantAdditions,
                    companionAdditions = companionAdditions
                ).onSuccess {
                    _uiState.update { it.copy(editingPrompt = null, successMessage = "Prompt updated") }
                    loadPrompts()
                }.onFailure { e ->
                    _uiState.update { it.copy(error = e.message) }
                }
            } else {
                settingsRepository.createPrompt(
                    name = name,
                    description = description,
                    basePrompt = basePrompt,
                    assistantAdditions = assistantAdditions,
                    companionAdditions = companionAdditions
                ).onSuccess {
                    _uiState.update { it.copy(isCreatingPrompt = false, successMessage = "Prompt created") }
                    loadPrompts()
                }.onFailure { e ->
                    _uiState.update { it.copy(error = e.message) }
                }
            }
        }
    }

    fun deletePrompt(promptId: String) {
        viewModelScope.launch {
            settingsRepository.deletePrompt(promptId)
                .onSuccess {
                    _uiState.update { it.copy(successMessage = "Prompt deleted") }
                    loadPrompts()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message) }
                }
        }
    }

    // --- Stats ---

    fun loadStats() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingStats = true) }

            settingsRepository.getStats()
                .onSuccess { stats ->
                    _uiState.update { it.copy(stats = stats, isLoadingStats = false) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoadingStats = false, error = e.message) }
                }
        }
    }

    // --- Models ---

    fun loadModels() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingModels = true) }

            val availableResult = settingsRepository.getAvailableModels()
            val configsResult = settingsRepository.getModelConfigs()

            availableResult.onSuccess { available ->
                _uiState.update { it.copy(availableModels = available) }
            }

            configsResult.onSuccess { configs ->
                _uiState.update { it.copy(modelConfigs = configs) }
            }

            _uiState.update { it.copy(isLoadingModels = false) }
        }
    }

    fun setModelConfig(taskType: String, provider: String, model: String) {
        viewModelScope.launch {
            settingsRepository.setModelConfig(taskType, provider, model)
                .onSuccess {
                    _uiState.update { it.copy(successMessage = "Model updated") }
                    loadModels()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message) }
                }
        }
    }

    fun resetModelConfigs() {
        viewModelScope.launch {
            settingsRepository.resetModelConfigs()
                .onSuccess {
                    _uiState.update { it.copy(successMessage = "Models reset to defaults") }
                    loadModels()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message) }
                }
        }
    }

    // --- Data ---

    fun exportData(onExported: (String) -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isExporting = true) }

            settingsRepository.exportData()
                .onSuccess { jsonData ->
                    _uiState.update { it.copy(isExporting = false, successMessage = "Data exported") }
                    onExported(jsonData)
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isExporting = false, error = e.message) }
                }
        }
    }

    fun importData(jsonData: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isImporting = true) }

            settingsRepository.importData(jsonData)
                .onSuccess {
                    _uiState.update { it.copy(isImporting = false, successMessage = "Data imported") }
                    loadPrompts()
                    loadStats()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isImporting = false, error = e.message) }
                }
        }
    }

    fun clearMemory() {
        viewModelScope.launch {
            _uiState.update { it.copy(isClearing = true) }

            settingsRepository.clearMemory()
                .onSuccess {
                    _uiState.update { it.copy(isClearing = false, successMessage = "Memory cleared") }
                    loadStats()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isClearing = false, error = e.message) }
                }
        }
    }

    fun clearAllData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isClearing = true) }

            settingsRepository.clearAllData()
                .onSuccess {
                    _uiState.update { it.copy(isClearing = false, successMessage = "All data cleared") }
                    loadPrompts()
                    loadStats()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isClearing = false, error = e.message) }
                }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearSuccessMessage() {
        _uiState.update { it.copy(successMessage = null) }
    }
}
