package com.bitwarelabs.luna.domain.model

enum class VoiceState {
    IDLE,
    LISTENING,
    THINKING,
    SPEAKING
}

data class VoiceMessage(
    val role: String,
    val content: String,
    val timestamp: Long = System.currentTimeMillis()
)

data class VoiceUiState(
    val voiceState: VoiceState = VoiceState.IDLE,
    val sessionId: String? = null,
    val transcriptText: String = "",
    val responseText: String = "",
    val reasoningText: String = "",
    val amplitude: Float = 0f,
    val messages: List<VoiceMessage> = emptyList(),
    val inputText: String = "",
    val error: String? = null,
    val isConnected: Boolean = false,
    val autoPlayEnabled: Boolean = true,
    val permissionGranted: Boolean = false
)
