package com.bitwarelabs.luna.domain.model

data class Message(
    val id: String,
    val sessionId: String,
    val role: MessageRole,
    val content: String,
    val tokensUsed: Int?,
    val model: String?,
    val createdAt: String,
    val metrics: StreamMetrics? = null
)

enum class MessageRole {
    USER,
    ASSISTANT,
    SYSTEM
}
