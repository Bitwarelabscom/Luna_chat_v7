package com.bitwarelabs.luna.domain.repository

import com.bitwarelabs.luna.data.network.StreamEvent
import com.bitwarelabs.luna.domain.model.ChatMode
import com.bitwarelabs.luna.domain.model.Session
import com.bitwarelabs.luna.domain.model.SessionWithMessages
import kotlinx.coroutines.flow.Flow

interface ChatRepository {
    suspend fun getSessions(
        limit: Int = 50,
        offset: Int = 0,
        archived: Boolean = false
    ): Result<List<Session>>

    suspend fun getSession(id: String): Result<SessionWithMessages>

    suspend fun createSession(
        title: String? = null,
        mode: ChatMode = ChatMode.ASSISTANT
    ): Result<Session>

    suspend fun updateSession(
        id: String,
        title: String? = null,
        mode: ChatMode? = null,
        isArchived: Boolean? = null
    ): Result<Session>

    suspend fun deleteSession(id: String): Result<Unit>

    fun streamMessage(sessionId: String, message: String): Flow<StreamEvent>
}
