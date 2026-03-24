package com.bitwarelabs.luna.domain.repository

import com.bitwarelabs.luna.data.network.VoiceWsEvent
import kotlinx.coroutines.flow.SharedFlow

interface VoiceRepository {
    suspend fun createSession(): Result<String>
    fun connect(sessionId: String, sampleRate: Int)
    fun disconnect()
    fun sendAudio(pcmData: ByteArray)
    fun sendText(text: String)
    val events: SharedFlow<VoiceWsEvent>
    val audioChunks: SharedFlow<ByteArray>
}
