package com.bitwarelabs.luna.domain.model

data class User(
    val id: String,
    val email: String,
    val displayName: String?,
    val avatarUrl: String?,
    val settings: UserSettings,
    val createdAt: String
)

data class UserSettings(
    val theme: ThemeType = ThemeType.DARK,
    val crtFlicker: Boolean = false,
    val language: String = "en",
    val notifications: Boolean = true,
    val defaultMode: ChatMode = ChatMode.ASSISTANT
)

enum class ThemeType {
    DARK,
    RETRO
}

enum class ChatMode {
    ASSISTANT,
    COMPANION
}
