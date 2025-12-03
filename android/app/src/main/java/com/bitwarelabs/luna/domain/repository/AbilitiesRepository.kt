package com.bitwarelabs.luna.domain.repository

import com.bitwarelabs.luna.domain.model.*

interface AbilitiesRepository {

    // Summary
    suspend fun getAbilitySummary(): Result<AbilitySummary>

    // Knowledge
    suspend fun getKnowledge(category: String? = null, limit: Int? = null, offset: Int? = null): Result<List<KnowledgeItem>>
    suspend fun searchKnowledge(query: String, limit: Int? = null): Result<List<KnowledgeItem>>
    suspend fun createKnowledge(category: String, key: String, value: String, source: String? = null, confidence: Double? = null): Result<KnowledgeItem>
    suspend fun updateKnowledge(id: String, category: String? = null, key: String? = null, value: String? = null): Result<KnowledgeItem>
    suspend fun deleteKnowledge(id: String): Result<Boolean>

    // Tasks
    suspend fun getTasks(status: String? = null, priority: String? = null, upcoming: Boolean? = null, limit: Int? = null): Result<List<Task>>
    suspend fun createTask(title: String, description: String? = null, priority: String = "medium", dueDate: String? = null, tags: List<String>? = null): Result<Task>
    suspend fun parseTask(text: String): Result<ParsedTask>
    suspend fun updateTask(id: String, title: String? = null, description: String? = null, priority: String? = null, dueDate: String? = null, tags: List<String>? = null): Result<Task>
    suspend fun updateTaskStatus(id: String, status: String): Result<Task>
    suspend fun deleteTask(id: String): Result<Boolean>

    // Workspace
    suspend fun getWorkspaceFiles(): Result<List<WorkspaceFile>>
    suspend fun getWorkspaceStats(): Result<WorkspaceStats>
    suspend fun readFile(filename: String): Result<FileContent>
    suspend fun writeFile(filename: String, content: String): Result<WorkspaceFile>
    suspend fun deleteFile(filename: String): Result<Boolean>
    suspend fun executeFile(filename: String, sessionId: String? = null, args: List<String>? = null): Result<ExecutionResult>

    // Code Execution
    suspend fun executeCode(code: String, language: String = "python", sessionId: String? = null): Result<ExecutionResult>
    suspend fun getExecutionHistory(limit: Int? = null): Result<List<ExecutionHistory>>

    // Documents
    suspend fun getDocuments(status: String? = null, limit: Int? = null): Result<List<Document>>
    suspend fun uploadDocument(filename: String, content: ByteArray, mimeType: String): Result<Document>
    suspend fun searchDocuments(query: String, documentId: String? = null, limit: Int? = null): Result<List<DocumentChunk>>
    suspend fun deleteDocument(id: String): Result<Boolean>

    // Tools
    suspend fun getTools(enabledOnly: Boolean? = null): Result<List<Tool>>
    suspend fun createTool(name: String, description: String, parameters: List<ToolParameter>, code: String, enabled: Boolean = true): Result<Tool>
    suspend fun executeTool(name: String, params: Map<String, String>): Result<ToolExecutionResult>
    suspend fun updateTool(id: String, name: String? = null, description: String? = null, code: String? = null, enabled: Boolean? = null): Result<Tool>
    suspend fun deleteTool(id: String): Result<Boolean>

    // Agents
    suspend fun getAgents(): Result<AgentsData>
    suspend fun createAgent(name: String, description: String, systemPrompt: String, tools: List<String>? = null, model: String? = null): Result<CustomAgent>
    suspend fun executeAgent(agentName: String, task: String, context: Map<String, String>? = null): Result<AgentExecutionResult>
    suspend fun orchestrateTask(task: String, context: Map<String, String>? = null): Result<AgentExecutionResult>
    suspend fun deleteAgent(id: String): Result<Boolean>

    // Mood
    suspend fun getMoodHistory(limit: Int? = null): Result<List<MoodEntry>>
    suspend fun getMoodTrends(days: Int? = null): Result<MoodTrends>

    // Check-ins
    suspend fun getCheckins(): Result<CheckinsData>
    suspend fun createCheckin(type: String, name: String, cronExpression: String, timezone: String = "UTC", enabled: Boolean = true): Result<CheckinSchedule>
    suspend fun getCheckinHistory(limit: Int? = null): Result<List<CheckinHistory>>
    suspend fun updateCheckin(id: String, name: String? = null, cronExpression: String? = null, timezone: String? = null, enabled: Boolean? = null): Result<CheckinSchedule>
    suspend fun deleteCheckin(id: String): Result<Boolean>

    // Calendar
    suspend fun getCalendarConnections(): Result<List<CalendarConnection>>
    suspend fun getCalendarEvents(days: Int? = null, limit: Int? = null): Result<List<CalendarEvent>>
    suspend fun getTodayEvents(): Result<List<CalendarEvent>>

    // Email
    suspend fun getEmailConnections(): Result<List<EmailConnection>>
    suspend fun getRecentEmails(limit: Int? = null, unreadOnly: Boolean? = null, important: Boolean? = null): Result<List<Email>>
    suspend fun searchEmails(query: String, limit: Int? = null): Result<List<Email>>
    suspend fun getEmailSummary(): Result<EmailSummaryInfo>
}
