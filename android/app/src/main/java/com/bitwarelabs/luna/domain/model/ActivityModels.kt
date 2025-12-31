package com.bitwarelabs.luna.domain.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class ActivityLog(
    val id: String,
    @SerialName("user_id") val userId: String? = null,
    @SerialName("session_id") val sessionId: String? = null,
    val category: String, // 'llm_call', 'tool_invoke', 'memory_op', 'state_event', 'error', 'background', 'system'
    val level: String, // 'info', 'success', 'warn', 'error'
    val message: String,
    val metadata: Map<String, String>? = null,
    @SerialName("created_at") val createdAt: String,
    val duration: Long? = null,
    @SerialName("tokens_used") val tokensUsed: Int? = null,
    val model: String? = null,
    @SerialName("tool_name") val toolName: String? = null,
    @SerialName("error_message") val errorMessage: String? = null
)

@Serializable
data class ActivityResponse(
    val logs: List<ActivityLog>
)

@Serializable
data class ClearActivityResponse(
    val success: Boolean
)

@Serializable
data class ArchiveActivityResponse(
    val success: Boolean,
    val archivedCount: Int? = null
)

@Serializable
data class ArchiveRequest(
    val daysToKeep: Int = 7
)
