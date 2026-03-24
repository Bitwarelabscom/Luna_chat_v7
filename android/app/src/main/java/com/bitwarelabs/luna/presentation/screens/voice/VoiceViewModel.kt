package com.bitwarelabs.luna.presentation.screens.voice

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaPlayer
import android.media.MediaRecorder
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.bitwarelabs.luna.data.network.VoiceWsEvent
import com.bitwarelabs.luna.domain.model.VoiceMessage
import com.bitwarelabs.luna.domain.model.VoiceState
import com.bitwarelabs.luna.domain.model.VoiceUiState
import com.bitwarelabs.luna.domain.repository.VoiceRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.inject.Inject
import kotlin.math.sqrt

private const val SAMPLE_RATE = 16000 // 16kHz is sufficient for voice (saves 63% bandwidth vs 44.1kHz)
private const val MAX_AUDIO_QUEUE_BYTES = 10 * 1024 * 1024 // 10MB safety cap
private const val MAX_VOICE_MESSAGES = 100

@HiltViewModel
class VoiceViewModel @Inject constructor(
    private val voiceRepository: VoiceRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(VoiceUiState())
    val uiState: StateFlow<VoiceUiState> = _uiState.asStateFlow()

    private var audioRecord: AudioRecord? = null
    private var recordingJob: Job? = null
    private var mediaPlayer: MediaPlayer? = null
    private var isRecording = false
    private var tempDir: File? = null

    // Use ByteArrayOutputStream instead of List<ByteArray> to avoid O(n^2) fold
    private val audioBuffer = ByteArrayOutputStream()
    private var audioBufferSize = 0
    private var isPlayingAudio = false

    // Use StringBuilder for streaming text to avoid O(n^2) string concatenation
    private val responseBuilder = StringBuilder()
    private val reasoningBuilder = StringBuilder()

    init {
        collectEvents()
        collectAudioChunks()
    }

    fun setTempDir(dir: File) {
        tempDir = dir
    }

    fun onPermissionGranted() {
        _uiState.update { it.copy(permissionGranted = true) }
    }

    fun initSession() {
        viewModelScope.launch {
            voiceRepository.createSession()
                .onSuccess { sessionId ->
                    _uiState.update { it.copy(sessionId = sessionId) }
                    voiceRepository.connect(sessionId, SAMPLE_RATE)
                }
                .onFailure { e ->
                    _uiState.update { it.copy(error = e.message ?: "Failed to create voice session") }
                }
        }
    }

    fun startListening() {
        if (!_uiState.value.permissionGranted) return
        if (isRecording) return

        _uiState.update { it.copy(voiceState = VoiceState.LISTENING) }

        val bufferSize = AudioRecord.getMinBufferSize(
            SAMPLE_RATE,
            AudioFormat.CHANNEL_IN_MONO,
            AudioFormat.ENCODING_PCM_16BIT
        )

        try {
            audioRecord = AudioRecord(
                MediaRecorder.AudioSource.MIC,
                SAMPLE_RATE,
                AudioFormat.CHANNEL_IN_MONO,
                AudioFormat.ENCODING_PCM_16BIT,
                maxOf(bufferSize * 4, 16384) // Extra headroom to prevent underruns
            )

            audioRecord?.startRecording()
            isRecording = true

            recordingJob = viewModelScope.launch(Dispatchers.IO) {
                val buffer = ShortArray(2048)
                val byteBuffer = ByteBuffer.allocate(buffer.size * 2).order(ByteOrder.LITTLE_ENDIAN)

                while (isRecording) {
                    val read = audioRecord?.read(buffer, 0, buffer.size) ?: -1
                    if (read > 0) {
                        // Bulk convert shorts to bytes
                        byteBuffer.clear()
                        byteBuffer.asShortBuffer().put(buffer, 0, read)
                        val bytes = ByteArray(read * 2)
                        byteBuffer.get(bytes, 0, read * 2)
                        voiceRepository.sendAudio(bytes)

                        // Calculate RMS amplitude
                        var sum = 0.0
                        for (i in 0 until read) {
                            sum += buffer[i].toFloat() * buffer[i].toFloat()
                        }
                        val rms = sqrt(sum / read).toFloat()
                        val normalized = (rms / 32768f).coerceIn(0f, 1f)

                        _uiState.update { it.copy(amplitude = normalized) }
                    }
                }
            }
        } catch (e: SecurityException) {
            _uiState.update { it.copy(error = "Microphone permission denied") }
        }
    }

    fun stopListening() {
        isRecording = false
        recordingJob?.cancel()
        recordingJob = null
        try {
            audioRecord?.stop()
            audioRecord?.release()
        } catch (_: Exception) { }
        audioRecord = null
        _uiState.update { it.copy(amplitude = 0f) }
    }

    fun stopConversation() {
        stopListening()
        stopAudioPlayback()
        _uiState.update { it.copy(voiceState = VoiceState.IDLE) }
    }

    fun updateInputText(text: String) {
        _uiState.update { it.copy(inputText = text) }
    }

    fun sendTextMessage() {
        val text = _uiState.value.inputText.trim()
        if (text.isBlank()) return

        voiceRepository.sendText(text)
        addMessage("user", text)
        _uiState.update { it.copy(inputText = "") }
    }

    fun toggleAutoPlay() {
        _uiState.update { it.copy(autoPlayEnabled = !it.autoPlayEnabled) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    private fun addMessage(role: String, content: String) {
        _uiState.update {
            val messages = it.messages + VoiceMessage(role = role, content = content)
            // Cap message list to prevent unbounded growth
            val trimmed = if (messages.size > MAX_VOICE_MESSAGES) {
                messages.drop(messages.size - MAX_VOICE_MESSAGES)
            } else {
                messages
            }
            it.copy(messages = trimmed)
        }
    }

    private fun collectEvents() {
        viewModelScope.launch {
            voiceRepository.events.collect { event ->
                when (event) {
                    is VoiceWsEvent.Connected -> {
                        _uiState.update { it.copy(isConnected = true) }
                    }
                    is VoiceWsEvent.Disconnected -> {
                        _uiState.update { it.copy(isConnected = false, voiceState = VoiceState.IDLE) }
                        stopListening()
                    }
                    is VoiceWsEvent.Status -> {
                        val newState = when (event.status) {
                            "transcribing", "thinking" -> VoiceState.THINKING
                            "speaking" -> VoiceState.SPEAKING
                            "listening" -> VoiceState.LISTENING
                            else -> _uiState.value.voiceState
                        }
                        _uiState.update { it.copy(voiceState = newState) }
                    }
                    is VoiceWsEvent.Transcript -> {
                        addMessage("user", event.text)
                        _uiState.update {
                            it.copy(
                                transcriptText = event.text,
                                voiceState = VoiceState.THINKING
                            )
                        }
                        stopListening()
                    }
                    is VoiceWsEvent.Reasoning -> {
                        reasoningBuilder.append(event.content)
                        _uiState.update { it.copy(reasoningText = reasoningBuilder.toString()) }
                    }
                    is VoiceWsEvent.TextDelta -> {
                        responseBuilder.append(event.delta)
                        _uiState.update { it.copy(responseText = responseBuilder.toString()) }
                    }
                    is VoiceWsEvent.TextDone -> {
                        val responseText = responseBuilder.toString()
                        if (responseText.isNotBlank()) {
                            addMessage("assistant", responseText)
                        }
                        responseBuilder.clear()
                        reasoningBuilder.clear()
                        _uiState.update { it.copy(responseText = "", reasoningText = "") }
                    }
                    is VoiceWsEvent.AudioStart -> {
                        _uiState.update { it.copy(voiceState = VoiceState.SPEAKING) }
                        stopListening()
                        synchronized(audioBuffer) {
                            audioBuffer.reset()
                            audioBufferSize = 0
                        }
                        isPlayingAudio = true
                    }
                    is VoiceWsEvent.AudioEnd -> {
                        playQueuedAudio()
                    }
                    is VoiceWsEvent.Error -> {
                        _uiState.update { it.copy(error = event.message) }
                    }
                }
            }
        }
    }

    private fun collectAudioChunks() {
        viewModelScope.launch {
            voiceRepository.audioChunks.collect { chunk ->
                synchronized(audioBuffer) {
                    if (audioBufferSize + chunk.size <= MAX_AUDIO_QUEUE_BYTES) {
                        audioBuffer.write(chunk)
                        audioBufferSize += chunk.size
                    }
                    // Silently drop if over 10MB to prevent OOM
                }
            }
        }
    }

    private fun playQueuedAudio() {
        val audioData: ByteArray
        synchronized(audioBuffer) {
            audioData = audioBuffer.toByteArray()
            audioBuffer.reset()
            audioBufferSize = 0
        }

        if (audioData.isEmpty()) {
            onAudioPlaybackComplete()
            return
        }

        viewModelScope.launch {
            var tempFile: File? = null
            try {
                tempFile = withContext(Dispatchers.IO) {
                    File.createTempFile("tts_", ".mp3", tempDir).also {
                        it.writeBytes(audioData)
                    }
                }

                val fileToDelete = tempFile
                withContext(Dispatchers.Main) {
                    mediaPlayer?.release()
                    mediaPlayer = MediaPlayer().apply {
                        setDataSource(fileToDelete.absolutePath)
                        prepare()
                        start()
                        setOnCompletionListener { mp ->
                            mp.release()
                            mediaPlayer = null
                            fileToDelete.delete()
                            onAudioPlaybackComplete()
                        }
                    }
                }
            } catch (_: Exception) {
                // Clean up temp file on error
                tempFile?.delete()
                mediaPlayer?.release()
                mediaPlayer = null
                onAudioPlaybackComplete()
            }
        }
    }

    private fun onAudioPlaybackComplete() {
        isPlayingAudio = false
        _uiState.update { it.copy(voiceState = VoiceState.IDLE) }

        // Auto-resume listening after short cooldown
        if (_uiState.value.autoPlayEnabled && _uiState.value.isConnected) {
            viewModelScope.launch {
                delay(500)
                if (!isPlayingAudio && _uiState.value.isConnected) {
                    startListening()
                }
            }
        }
    }

    private fun stopAudioPlayback() {
        isPlayingAudio = false
        try {
            mediaPlayer?.stop()
            mediaPlayer?.release()
        } catch (_: Exception) { }
        mediaPlayer = null
        synchronized(audioBuffer) {
            audioBuffer.reset()
            audioBufferSize = 0
        }
    }

    override fun onCleared() {
        super.onCleared()
        stopListening()
        stopAudioPlayback()
        voiceRepository.disconnect()
    }
}
