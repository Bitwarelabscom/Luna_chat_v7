package com.bitwarelabs.luna.presentation.screens.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bitwarelabs.luna.data.network.StreamEvent
import com.bitwarelabs.luna.domain.model.ChatMode
import com.bitwarelabs.luna.domain.model.Message
import com.bitwarelabs.luna.domain.model.MessageRole
import com.bitwarelabs.luna.domain.model.Session
import com.bitwarelabs.luna.domain.repository.AuthRepository
import com.bitwarelabs.luna.domain.repository.ChatRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject

data class ChatUiState(
    val sessions: List<Session> = emptyList(),
    val currentSessionId: String? = null,
    val messages: List<Message> = emptyList(),
    val isLoadingSessions: Boolean = false,
    val isLoadingMessages: Boolean = false,
    val isSending: Boolean = false,
    val streamingContent: String = "",
    val statusMessage: String = "",
    val inputText: String = "",
    val error: String? = null,
    val editingSessionId: String? = null,
    val editingTitle: String = "",
    val expandedMessageIds: Set<String> = emptySet()
) {
    val currentMode: ChatMode?
        get() = sessions.find { it.id == currentSessionId }?.mode
}

@HiltViewModel
class ChatViewModel @Inject constructor(
    private val chatRepository: ChatRepository,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(ChatUiState())
    val uiState: StateFlow<ChatUiState> = _uiState.asStateFlow()

    private var streamingJob: Job? = null

    init {
        loadSessions()
    }

    fun loadSessions() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoadingSessions = true, error = null) }

            chatRepository.getSessions()
                .onSuccess { sessions ->
                    _uiState.update { it.copy(sessions = sessions, isLoadingSessions = false) }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isLoadingSessions = false,
                            error = e.message ?: "Failed to load sessions"
                        )
                    }
                }
        }
    }

    fun loadSession(sessionId: String) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    currentSessionId = sessionId,
                    isLoadingMessages = true,
                    messages = emptyList(),
                    streamingContent = "",
                    statusMessage = "",
                    error = null
                )
            }

            chatRepository.getSession(sessionId)
                .onSuccess { session ->
                    _uiState.update {
                        it.copy(
                            messages = session.messages,
                            isLoadingMessages = false
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update {
                        it.copy(
                            isLoadingMessages = false,
                            error = e.message ?: "Failed to load messages"
                        )
                    }
                }
        }
    }

    fun createSession() {
        viewModelScope.launch {
            chatRepository.createSession()
                .onSuccess { session ->
                    _uiState.update {
                        it.copy(
                            sessions = listOf(session) + it.sessions,
                            currentSessionId = session.id,
                            messages = emptyList(),
                            streamingContent = "",
                            statusMessage = ""
                        )
                    }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to create session") }
                }
        }
    }

    fun deleteSession(sessionId: String) {
        viewModelScope.launch {
            chatRepository.deleteSession(sessionId)
                .onSuccess {
                    _uiState.update {
                        val newSessions = it.sessions.filter { s -> s.id != sessionId }
                        val newCurrentId = if (it.currentSessionId == sessionId) {
                            newSessions.firstOrNull()?.id
                        } else {
                            it.currentSessionId
                        }
                        it.copy(
                            sessions = newSessions,
                            currentSessionId = newCurrentId,
                            messages = if (it.currentSessionId == sessionId) emptyList() else it.messages
                        )
                    }
                    // Load new current session if needed
                    _uiState.value.currentSessionId?.let { loadSession(it) }
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to delete session") }
                }
        }
    }

    fun startEditingSession(sessionId: String, currentTitle: String) {
        _uiState.update { it.copy(editingSessionId = sessionId, editingTitle = currentTitle) }
    }

    fun updateEditingTitle(title: String) {
        _uiState.update { it.copy(editingTitle = title) }
    }

    fun cancelEditingSession() {
        _uiState.update { it.copy(editingSessionId = null, editingTitle = "") }
    }

    fun saveSessionTitle() {
        val state = _uiState.value
        val sessionId = state.editingSessionId ?: return
        val title = state.editingTitle.trim()

        if (title.isBlank()) {
            cancelEditingSession()
            return
        }

        viewModelScope.launch {
            chatRepository.updateSession(sessionId, title = title)
                .onSuccess { updatedSession ->
                    _uiState.update {
                        it.copy(
                            sessions = it.sessions.map { s ->
                                if (s.id == sessionId) updatedSession else s
                            },
                            editingSessionId = null,
                            editingTitle = ""
                        )
                    }
                }
                .onFailure {
                    cancelEditingSession()
                }
        }
    }

    fun updateInputText(text: String) {
        _uiState.update { it.copy(inputText = text) }
    }

    fun sendMessage() {
        val state = _uiState.value
        val message = state.inputText.trim()

        if (message.isBlank() || state.isSending) return

        viewModelScope.launch {
            // Create session if needed
            val sessionId = state.currentSessionId ?: run {
                val result = chatRepository.createSession()
                result.getOrNull()?.let { session ->
                    _uiState.update {
                        it.copy(
                            sessions = listOf(session) + it.sessions,
                            currentSessionId = session.id
                        )
                    }
                    session.id
                } ?: return@launch
            }

            // Add user message to UI
            val userMessage = Message(
                id = "temp-${UUID.randomUUID()}",
                sessionId = sessionId,
                role = MessageRole.USER,
                content = message,
                tokensUsed = null,
                model = null,
                createdAt = System.currentTimeMillis().toString()
            )

            _uiState.update {
                it.copy(
                    isSending = true,
                    inputText = "",
                    messages = it.messages + userMessage,
                    streamingContent = "",
                    statusMessage = "",
                    error = null
                )
            }

            // Stream the response
            streamingJob?.cancel()
            streamingJob = launch {
                chatRepository.streamMessage(sessionId, message)
                    .catch { e ->
                        _uiState.update {
                            it.copy(
                                isSending = false,
                                error = e.message ?: "Failed to send message"
                            )
                        }
                    }
                    .collect { event ->
                        when (event) {
                            is StreamEvent.Status -> {
                                _uiState.update { it.copy(statusMessage = event.status) }
                            }
                            is StreamEvent.Content -> {
                                _uiState.update {
                                    it.copy(
                                        statusMessage = "",
                                        streamingContent = it.streamingContent + event.content
                                    )
                                }
                            }
                            is StreamEvent.Reasoning -> {
                                // Show reasoning in status or handle as needed
                                _uiState.update { it.copy(statusMessage = event.content) }
                            }
                            is StreamEvent.BrowserAction -> {
                                // Log browser activity (future: open browser window)
                                // Currently just log the action
                            }
                            is StreamEvent.VideoAction -> {
                                // Log video results (future: open video player)
                                // Currently just log the action
                            }
                            is StreamEvent.MediaAction -> {
                                // Log media results (future: open media player)
                                // Currently just log the action
                            }
                            is StreamEvent.Done -> {
                                val assistantMessage = Message(
                                    id = event.messageId,
                                    sessionId = sessionId,
                                    role = MessageRole.ASSISTANT,
                                    content = _uiState.value.streamingContent,
                                    tokensUsed = event.tokensUsed,
                                    model = event.metrics?.model,
                                    createdAt = System.currentTimeMillis().toString(),
                                    metrics = event.metrics
                                )
                                _uiState.update {
                                    it.copy(
                                        isSending = false,
                                        messages = it.messages + assistantMessage,
                                        streamingContent = "",
                                        statusMessage = ""
                                    )
                                }
                                // Refresh sessions to update title
                                loadSessions()
                            }
                            is StreamEvent.Error -> {
                                _uiState.update {
                                    it.copy(
                                        isSending = false,
                                        error = event.message
                                    )
                                }
                            }
                        }
                    }
            }
        }
    }

    fun endCurrentSession() {
        val sessionId = _uiState.value.currentSessionId ?: return
        viewModelScope.launch {
            chatRepository.endSession(sessionId)
        }
    }

    fun logout() {
        viewModelScope.launch {
            authRepository.logout()
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun toggleMessageExpand(messageId: String) {
        _uiState.update {
            val newExpanded = if (messageId in it.expandedMessageIds) {
                it.expandedMessageIds - messageId
            } else {
                it.expandedMessageIds + messageId
            }
            it.copy(expandedMessageIds = newExpanded)
        }
    }

    override fun onCleared() {
        super.onCleared()
        streamingJob?.cancel()
    }
}
