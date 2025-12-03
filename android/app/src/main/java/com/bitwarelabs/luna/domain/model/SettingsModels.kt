package com.bitwarelabs.luna.domain.model

data class SavedPrompt(
    val id: String,
    val userId: String,
    val name: String,
    val description: String?,
    val basePrompt: String,
    val assistantAdditions: String?,
    val companionAdditions: String?,
    val isDefault: Boolean,
    val createdAt: String,
    val updatedAt: String
)

data class DefaultPrompts(
    val basePrompt: String,
    val assistantAdditions: String,
    val companionAdditions: String
)

data class UserStats(
    val tokens: TokenStats,
    val memory: MemoryStats,
    val sessions: SessionStats
)

data class TokenStats(
    val total: Long,
    val thisMonth: Long,
    val thisWeek: Long,
    val today: Long,
    val byModel: Map<String, Long>
)

data class MemoryStats(
    val totalFacts: Int,
    val activeFacts: Int,
    val factsByCategory: Map<String, Int>,
    val totalEmbeddings: Int,
    val totalSummaries: Int
)

data class SessionStats(
    val total: Int,
    val archived: Int,
    val totalMessages: Int
)

data class ModelConfig(
    val taskType: String,
    val provider: String,
    val model: String
)

data class AvailableModels(
    val providers: Map<String, List<String>>
)
