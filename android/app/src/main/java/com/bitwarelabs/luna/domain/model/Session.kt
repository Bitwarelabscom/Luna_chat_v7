package com.bitwarelabs.luna.domain.model

data class Session(
    val id: String,
    val userId: String,
    val title: String,
    val mode: ChatMode,
    val isArchived: Boolean,
    val createdAt: String,
    val updatedAt: String
)

data class SessionWithMessages(
    val id: String,
    val userId: String,
    val title: String,
    val mode: ChatMode,
    val isArchived: Boolean,
    val createdAt: String,
    val updatedAt: String,
    val messages: List<Message>
)
