package com.bitwarelabs.luna.presentation.theme

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

@Immutable
data class LunaColorScheme(
    val bgPrimary: Color,
    val bgSecondary: Color,
    val bgTertiary: Color,
    val bgInput: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textMuted: Color,
    val border: Color,
    val borderFocus: Color,
    val accentPrimary: Color,
    val accentSecondary: Color,
    val accentHover: Color,
    val warning: Color,
    val messageUser: Color,
    val messageAssistant: Color,
    val messageUserText: Color,
    val messageAssistantText: Color,
    val error: Color,
    val success: Color
)

val DarkColorScheme = LunaColorScheme(
    bgPrimary = DarkColors.bgPrimary,
    bgSecondary = DarkColors.bgSecondary,
    bgTertiary = DarkColors.bgTertiary,
    bgInput = DarkColors.bgInput,
    textPrimary = DarkColors.textPrimary,
    textSecondary = DarkColors.textSecondary,
    textMuted = DarkColors.textMuted,
    border = DarkColors.border,
    borderFocus = DarkColors.borderFocus,
    accentPrimary = DarkColors.accentPrimary,
    accentSecondary = DarkColors.accentSecondary,
    accentHover = DarkColors.accentHover,
    warning = DarkColors.warning,
    messageUser = DarkColors.messageUser,
    messageAssistant = DarkColors.messageAssistant,
    messageUserText = DarkColors.messageUserText,
    messageAssistantText = DarkColors.messageAssistantText,
    error = DarkColors.error,
    success = DarkColors.success
)

val RetroColorScheme = LunaColorScheme(
    bgPrimary = RetroColors.bgPrimary,
    bgSecondary = RetroColors.bgSecondary,
    bgTertiary = RetroColors.bgTertiary,
    bgInput = RetroColors.bgInput,
    textPrimary = RetroColors.textPrimary,
    textSecondary = RetroColors.textSecondary,
    textMuted = RetroColors.textMuted,
    border = RetroColors.border,
    borderFocus = RetroColors.borderFocus,
    accentPrimary = RetroColors.accentPrimary,
    accentSecondary = RetroColors.accentSecondary,
    accentHover = RetroColors.accentHover,
    warning = RetroColors.warning,
    messageUser = RetroColors.messageUser,
    messageAssistant = RetroColors.messageAssistant,
    messageUserText = RetroColors.messageUserText,
    messageAssistantText = RetroColors.messageAssistantText,
    error = RetroColors.error,
    success = RetroColors.success
)

val LocalLunaColors = staticCompositionLocalOf { DarkColorScheme }
