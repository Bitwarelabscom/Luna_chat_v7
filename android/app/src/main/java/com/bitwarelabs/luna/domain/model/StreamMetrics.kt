package com.bitwarelabs.luna.domain.model

import kotlinx.serialization.Serializable

@Serializable
data class StreamMetrics(
    val promptTokens: Int = 0,
    val completionTokens: Int = 0,
    val processingTimeMs: Long = 0,
    val tokensPerSecond: Float = 0f,
    val toolsUsed: List<String> = emptyList(),
    val model: String = "",
    val totalCost: Float? = null,
    val llmBreakdown: List<LlmBreakdownItem>? = null
)

@Serializable
data class LlmBreakdownItem(
    val node: String,
    val model: String,
    val provider: String,
    val inputTokens: Int,
    val outputTokens: Int,
    val cacheTokens: Int? = null,
    val cost: Float,
    val durationMs: Long? = null
)
