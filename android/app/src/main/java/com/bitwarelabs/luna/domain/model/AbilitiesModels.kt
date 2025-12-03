package com.bitwarelabs.luna.domain.model

// ============================================
// ABILITIES SUMMARY
// ============================================

data class AbilitySummary(
    val knowledge: KnowledgeSummary,
    val tasks: TasksSummary,
    val workspace: WorkspaceSummary,
    val documents: DocumentsSummary,
    val tools: ToolsSummary,
    val agents: AgentsSummary,
    val mood: MoodSummary?,
    val checkins: CheckinsSummary
)

data class KnowledgeSummary(val totalItems: Int, val categories: Map<String, Int>)
data class TasksSummary(val total: Int, val pending: Int, val inProgress: Int, val completed: Int, val overdue: Int)
data class WorkspaceSummary(val totalFiles: Int, val totalSize: Long)
data class DocumentsSummary(val total: Int, val processing: Int, val ready: Int)
data class ToolsSummary(val total: Int, val enabled: Int)
data class AgentsSummary(val builtIn: Int, val custom: Int)
data class MoodSummary(val currentMood: String?, val averageScore: Double?)
data class CheckinsSummary(val active: Int, val upcoming: Int)

// ============================================
// KNOWLEDGE
// ============================================

data class KnowledgeItem(
    val id: String,
    val category: String,
    val key: String,
    val value: String,
    val source: String?,
    val confidence: Double,
    val metadata: Map<String, String>?,
    val createdAt: String,
    val updatedAt: String
)

// ============================================
// TASKS
// ============================================

data class Task(
    val id: String,
    val title: String,
    val description: String?,
    val status: TaskStatus,
    val priority: TaskPriority,
    val dueDate: String?,
    val completedAt: String?,
    val tags: List<String>,
    val createdAt: String,
    val updatedAt: String
)

enum class TaskStatus(val value: String) {
    PENDING("pending"),
    IN_PROGRESS("in_progress"),
    COMPLETED("completed"),
    CANCELLED("cancelled");

    companion object {
        fun fromString(value: String): TaskStatus =
            values().find { it.value == value } ?: PENDING
    }
}

enum class TaskPriority(val value: String) {
    LOW("low"),
    MEDIUM("medium"),
    HIGH("high"),
    URGENT("urgent");

    companion object {
        fun fromString(value: String): TaskPriority =
            values().find { it.value == value } ?: MEDIUM
    }
}

data class ParsedTask(
    val title: String,
    val dueDate: String?,
    val priority: TaskPriority?,
    val tags: List<String>
)

// ============================================
// WORKSPACE
// ============================================

data class WorkspaceFile(
    val filename: String,
    val size: Long,
    val language: String?,
    val createdAt: String,
    val updatedAt: String
)

data class WorkspaceStats(
    val totalFiles: Int,
    val totalSize: Long,
    val filesByLanguage: Map<String, Int>
)

data class FileContent(
    val filename: String,
    val content: String
)

// ============================================
// CODE EXECUTION
// ============================================

data class ExecutionResult(
    val id: String,
    val output: String,
    val error: String?,
    val exitCode: Int,
    val executionTime: Long,
    val language: String
)

data class ExecutionHistory(
    val id: String,
    val code: String,
    val language: String,
    val output: String?,
    val error: String?,
    val exitCode: Int,
    val executionTime: Long,
    val createdAt: String
)

// ============================================
// DOCUMENTS
// ============================================

data class Document(
    val id: String,
    val filename: String,
    val mimeType: String,
    val size: Long,
    val status: DocumentStatus,
    val chunkCount: Int,
    val createdAt: String,
    val processedAt: String?
)

enum class DocumentStatus(val value: String) {
    UPLOADING("uploading"),
    PROCESSING("processing"),
    READY("ready"),
    FAILED("failed");

    companion object {
        fun fromString(value: String): DocumentStatus =
            values().find { it.value == value } ?: PROCESSING
    }
}

data class DocumentChunk(
    val documentId: String,
    val documentName: String,
    val chunkIndex: Int,
    val content: String,
    val similarity: Double?
)

// ============================================
// TOOLS
// ============================================

data class Tool(
    val id: String,
    val name: String,
    val description: String,
    val parameters: List<ToolParameter>,
    val code: String,
    val enabled: Boolean,
    val createdAt: String,
    val updatedAt: String
)

data class ToolParameter(
    val name: String,
    val type: String,
    val description: String,
    val required: Boolean,
    val default: String?
)

data class ToolExecutionResult(
    val success: Boolean,
    val result: String?,
    val error: String?,
    val executionTime: Long
)

// ============================================
// AGENTS
// ============================================

data class AgentsData(
    val builtIn: List<BuiltInAgent>,
    val custom: List<CustomAgent>
)

data class BuiltInAgent(
    val name: String,
    val description: String,
    val capabilities: List<String>
)

data class CustomAgent(
    val id: String,
    val name: String,
    val description: String,
    val systemPrompt: String,
    val tools: List<String>,
    val model: String?,
    val createdAt: String,
    val updatedAt: String
)

data class AgentExecutionResult(
    val agentName: String,
    val result: String,
    val steps: List<AgentStep>?,
    val executionTime: Long
)

data class AgentStep(
    val action: String,
    val input: String?,
    val output: String?
)

// ============================================
// MOOD
// ============================================

data class MoodEntry(
    val id: String,
    val score: Double,
    val emotions: List<String>,
    val notes: String?,
    val source: String,
    val createdAt: String
)

data class MoodTrends(
    val averageScore: Double,
    val dominantEmotions: List<String>,
    val scoreByDay: Map<String, Double>,
    val emotionFrequency: Map<String, Int>
)

// ============================================
// CHECK-INS
// ============================================

data class CheckinsData(
    val builtIn: List<BuiltInCheckin>,
    val schedules: List<CheckinSchedule>
)

data class BuiltInCheckin(
    val type: String,
    val name: String,
    val description: String,
    val defaultTime: String
)

data class CheckinSchedule(
    val id: String,
    val type: String,
    val name: String,
    val cronExpression: String,
    val timezone: String,
    val enabled: Boolean,
    val lastTriggered: String?,
    val nextTrigger: String?,
    val createdAt: String
)

data class CheckinHistory(
    val id: String,
    val scheduleId: String,
    val type: String,
    val response: String?,
    val completedAt: String?,
    val createdAt: String
)

// ============================================
// CALENDAR
// ============================================

data class CalendarConnection(
    val provider: String,
    val email: String,
    val connected: Boolean,
    val scopes: List<String>
)

data class CalendarEvent(
    val id: String,
    val title: String,
    val description: String?,
    val start: String,
    val end: String,
    val location: String?,
    val attendees: List<String>?,
    val isAllDay: Boolean
)

// ============================================
// EMAIL
// ============================================

data class EmailConnection(
    val provider: String,
    val email: String,
    val connected: Boolean
)

data class Email(
    val id: String,
    val from: String,
    val subject: String,
    val snippet: String,
    val date: String,
    val isRead: Boolean,
    val isImportant: Boolean
)

data class EmailSummaryInfo(
    val unread: Int,
    val important: Int,
    val total: Int
)
