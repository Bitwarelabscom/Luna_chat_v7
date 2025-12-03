package com.bitwarelabs.luna.presentation.screens.abilities

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bitwarelabs.luna.domain.model.*
import com.bitwarelabs.luna.domain.repository.AbilitiesRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class AbilitiesUiState(
    // Summary
    val summary: AbilitySummary? = null,
    val isLoadingSummary: Boolean = false,

    // Tasks
    val tasks: List<Task> = emptyList(),
    val isLoadingTasks: Boolean = false,
    val editingTask: Task? = null,
    val isCreatingTask: Boolean = false,

    // Knowledge
    val knowledge: List<KnowledgeItem> = emptyList(),
    val knowledgeCategories: List<String> = emptyList(),
    val selectedCategory: String? = null,
    val isLoadingKnowledge: Boolean = false,
    val editingKnowledge: KnowledgeItem? = null,
    val isCreatingKnowledge: Boolean = false,

    // Workspace
    val workspaceFiles: List<WorkspaceFile> = emptyList(),
    val workspaceStats: WorkspaceStats? = null,
    val isLoadingWorkspace: Boolean = false,
    val editingFile: FileContent? = null,
    val isCreatingFile: Boolean = false,

    // Documents
    val documents: List<Document> = emptyList(),
    val isLoadingDocuments: Boolean = false,
    val isUploadingDocument: Boolean = false,

    // Tools
    val tools: List<Tool> = emptyList(),
    val isLoadingTools: Boolean = false,
    val editingTool: Tool? = null,
    val isCreatingTool: Boolean = false,

    // Agents
    val agents: AgentsData? = null,
    val isLoadingAgents: Boolean = false,

    // Mood
    val moodHistory: List<MoodEntry> = emptyList(),
    val moodTrends: MoodTrends? = null,
    val isLoadingMood: Boolean = false,

    // Check-ins
    val checkins: CheckinsData? = null,
    val checkinHistory: List<CheckinHistory> = emptyList(),
    val isLoadingCheckins: Boolean = false,

    // General
    val error: String? = null,
    val successMessage: String? = null
)

@HiltViewModel
class AbilitiesViewModel @Inject constructor(
    private val repository: AbilitiesRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(AbilitiesUiState())
    val uiState: StateFlow<AbilitiesUiState> = _uiState.asStateFlow()

    init {
        loadSummary()
    }

    // ============================================
    // SUMMARY
    // ============================================

    fun loadSummary() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingSummary = true) }
            repository.getAbilitySummary()
                .onSuccess { summary ->
                    _uiState.update { it.copy(summary = summary, isLoadingSummary = false) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoadingSummary = false, error = e.message) }
                }
        }
    }

    // ============================================
    // TASKS
    // ============================================

    fun loadTasks(status: String? = null, priority: String? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingTasks = true) }
            repository.getTasks(status, priority)
                .onSuccess { tasks ->
                    _uiState.update { it.copy(tasks = tasks, isLoadingTasks = false) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoadingTasks = false, error = e.message) }
                }
        }
    }

    fun startCreatingTask() {
        _uiState.update { it.copy(isCreatingTask = true) }
    }

    fun startEditingTask(task: Task) {
        _uiState.update { it.copy(editingTask = task) }
    }

    fun cancelEditingTask() {
        _uiState.update { it.copy(editingTask = null, isCreatingTask = false) }
    }

    fun saveTask(title: String, description: String?, priority: String, dueDate: String?, tags: List<String>?) {
        viewModelScope.launch {
            val editingTask = _uiState.value.editingTask

            if (editingTask != null) {
                repository.updateTask(editingTask.id, title, description, priority, dueDate, tags)
                    .onSuccess {
                        _uiState.update { it.copy(editingTask = null, successMessage = "Task updated") }
                        loadTasks()
                    }
                    .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            } else {
                repository.createTask(title, description, priority, dueDate, tags)
                    .onSuccess {
                        _uiState.update { it.copy(isCreatingTask = false, successMessage = "Task created") }
                        loadTasks()
                    }
                    .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            }
        }
    }

    fun updateTaskStatus(taskId: String, status: String) {
        viewModelScope.launch {
            repository.updateTaskStatus(taskId, status)
                .onSuccess { loadTasks() }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun deleteTask(taskId: String) {
        viewModelScope.launch {
            repository.deleteTask(taskId)
                .onSuccess {
                    _uiState.update { it.copy(successMessage = "Task deleted") }
                    loadTasks()
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    // ============================================
    // KNOWLEDGE
    // ============================================

    fun loadKnowledge(category: String? = null) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingKnowledge = true, selectedCategory = category) }
            repository.getKnowledge(category)
                .onSuccess { items ->
                    val categories = items.map { it.category }.distinct()
                    _uiState.update { it.copy(knowledge = items, knowledgeCategories = categories, isLoadingKnowledge = false) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoadingKnowledge = false, error = e.message) }
                }
        }
    }

    fun startCreatingKnowledge() {
        _uiState.update { it.copy(isCreatingKnowledge = true) }
    }

    fun startEditingKnowledge(item: KnowledgeItem) {
        _uiState.update { it.copy(editingKnowledge = item) }
    }

    fun cancelEditingKnowledge() {
        _uiState.update { it.copy(editingKnowledge = null, isCreatingKnowledge = false) }
    }

    fun saveKnowledge(category: String, key: String, value: String, source: String?) {
        viewModelScope.launch {
            val editing = _uiState.value.editingKnowledge

            if (editing != null) {
                repository.updateKnowledge(editing.id, category, key, value)
                    .onSuccess {
                        _uiState.update { it.copy(editingKnowledge = null, successMessage = "Knowledge updated") }
                        loadKnowledge(_uiState.value.selectedCategory)
                    }
                    .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            } else {
                repository.createKnowledge(category, key, value, source)
                    .onSuccess {
                        _uiState.update { it.copy(isCreatingKnowledge = false, successMessage = "Knowledge created") }
                        loadKnowledge(_uiState.value.selectedCategory)
                    }
                    .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
            }
        }
    }

    fun deleteKnowledge(id: String) {
        viewModelScope.launch {
            repository.deleteKnowledge(id)
                .onSuccess {
                    _uiState.update { it.copy(successMessage = "Knowledge deleted") }
                    loadKnowledge(_uiState.value.selectedCategory)
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    // ============================================
    // WORKSPACE
    // ============================================

    fun loadWorkspace() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingWorkspace = true) }

            repository.getWorkspaceFiles()
                .onSuccess { files ->
                    _uiState.update { it.copy(workspaceFiles = files) }
                }

            repository.getWorkspaceStats()
                .onSuccess { stats ->
                    _uiState.update { it.copy(workspaceStats = stats) }
                }

            _uiState.update { it.copy(isLoadingWorkspace = false) }
        }
    }

    fun startCreatingFile() {
        _uiState.update { it.copy(isCreatingFile = true) }
    }

    fun openFile(filename: String) {
        viewModelScope.launch {
            repository.readFile(filename)
                .onSuccess { content ->
                    _uiState.update { it.copy(editingFile = content) }
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun cancelEditingFile() {
        _uiState.update { it.copy(editingFile = null, isCreatingFile = false) }
    }

    fun saveFile(filename: String, content: String) {
        viewModelScope.launch {
            repository.writeFile(filename, content)
                .onSuccess {
                    _uiState.update { it.copy(editingFile = null, isCreatingFile = false, successMessage = "File saved") }
                    loadWorkspace()
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun deleteFile(filename: String) {
        viewModelScope.launch {
            repository.deleteFile(filename)
                .onSuccess {
                    _uiState.update { it.copy(successMessage = "File deleted") }
                    loadWorkspace()
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    fun executeFile(filename: String, onResult: (ExecutionResult) -> Unit) {
        viewModelScope.launch {
            repository.executeFile(filename)
                .onSuccess { result -> onResult(result) }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    // ============================================
    // DOCUMENTS
    // ============================================

    fun loadDocuments() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingDocuments = true) }
            repository.getDocuments()
                .onSuccess { docs ->
                    _uiState.update { it.copy(documents = docs, isLoadingDocuments = false) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoadingDocuments = false, error = e.message) }
                }
        }
    }

    fun uploadDocument(filename: String, content: ByteArray, mimeType: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isUploadingDocument = true) }
            repository.uploadDocument(filename, content, mimeType)
                .onSuccess {
                    _uiState.update { it.copy(isUploadingDocument = false, successMessage = "Document uploaded") }
                    loadDocuments()
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isUploadingDocument = false, error = e.message) }
                }
        }
    }

    fun deleteDocument(id: String) {
        viewModelScope.launch {
            repository.deleteDocument(id)
                .onSuccess {
                    _uiState.update { it.copy(successMessage = "Document deleted") }
                    loadDocuments()
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    // ============================================
    // TOOLS
    // ============================================

    fun loadTools() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingTools = true) }
            repository.getTools()
                .onSuccess { tools ->
                    _uiState.update { it.copy(tools = tools, isLoadingTools = false) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoadingTools = false, error = e.message) }
                }
        }
    }

    fun deleteTool(id: String) {
        viewModelScope.launch {
            repository.deleteTool(id)
                .onSuccess {
                    _uiState.update { it.copy(successMessage = "Tool deleted") }
                    loadTools()
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    // ============================================
    // AGENTS
    // ============================================

    fun loadAgents() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingAgents = true) }
            repository.getAgents()
                .onSuccess { agents ->
                    _uiState.update { it.copy(agents = agents, isLoadingAgents = false) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(isLoadingAgents = false, error = e.message) }
                }
        }
    }

    fun deleteAgent(id: String) {
        viewModelScope.launch {
            repository.deleteAgent(id)
                .onSuccess {
                    _uiState.update { it.copy(successMessage = "Agent deleted") }
                    loadAgents()
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    // ============================================
    // MOOD
    // ============================================

    fun loadMood() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingMood = true) }

            repository.getMoodHistory(limit = 20)
                .onSuccess { history ->
                    _uiState.update { it.copy(moodHistory = history) }
                }

            repository.getMoodTrends(days = 30)
                .onSuccess { trends ->
                    _uiState.update { it.copy(moodTrends = trends) }
                }

            _uiState.update { it.copy(isLoadingMood = false) }
        }
    }

    // ============================================
    // CHECK-INS
    // ============================================

    fun loadCheckins() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingCheckins = true) }

            repository.getCheckins()
                .onSuccess { data ->
                    _uiState.update { it.copy(checkins = data) }
                }

            repository.getCheckinHistory(limit = 20)
                .onSuccess { history ->
                    _uiState.update { it.copy(checkinHistory = history) }
                }

            _uiState.update { it.copy(isLoadingCheckins = false) }
        }
    }

    fun deleteCheckin(id: String) {
        viewModelScope.launch {
            repository.deleteCheckin(id)
                .onSuccess {
                    _uiState.update { it.copy(successMessage = "Check-in deleted") }
                    loadCheckins()
                }
                .onFailure { e -> _uiState.update { it.copy(error = e.message) } }
        }
    }

    // ============================================
    // GENERAL
    // ============================================

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearSuccessMessage() {
        _uiState.update { it.copy(successMessage = null) }
    }
}
