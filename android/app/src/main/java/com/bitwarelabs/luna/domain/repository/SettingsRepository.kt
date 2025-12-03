package com.bitwarelabs.luna.domain.repository

import com.bitwarelabs.luna.domain.model.AvailableModels
import com.bitwarelabs.luna.domain.model.DefaultPrompts
import com.bitwarelabs.luna.domain.model.ModelConfig
import com.bitwarelabs.luna.domain.model.SavedPrompt
import com.bitwarelabs.luna.domain.model.UserStats

interface SettingsRepository {
    // Prompts
    suspend fun getDefaultPrompts(): Result<DefaultPrompts>
    suspend fun getSavedPrompts(): Result<List<SavedPrompt>>
    suspend fun getActivePromptId(): Result<String?>
    suspend fun setActivePrompt(promptId: String?): Result<Unit>
    suspend fun createPrompt(
        name: String,
        description: String?,
        basePrompt: String,
        assistantAdditions: String?,
        companionAdditions: String?
    ): Result<SavedPrompt>
    suspend fun updatePrompt(
        id: String,
        name: String?,
        description: String?,
        basePrompt: String?,
        assistantAdditions: String?,
        companionAdditions: String?
    ): Result<SavedPrompt>
    suspend fun deletePrompt(id: String): Result<Unit>

    // Stats
    suspend fun getStats(): Result<UserStats>

    // Models
    suspend fun getAvailableModels(): Result<AvailableModels>
    suspend fun getModelConfigs(): Result<List<ModelConfig>>
    suspend fun setModelConfig(taskType: String, provider: String, model: String): Result<Unit>
    suspend fun resetModelConfigs(): Result<Unit>

    // Data management
    suspend fun exportData(): Result<String> // Returns JSON string
    suspend fun importData(jsonData: String): Result<Unit>
    suspend fun clearMemory(): Result<Unit>
    suspend fun clearAllData(): Result<Unit>
}
