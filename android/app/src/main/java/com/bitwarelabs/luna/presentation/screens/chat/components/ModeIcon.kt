package com.bitwarelabs.luna.presentation.screens.chat.components

import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MusicNote
import androidx.compose.material3.Icon
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.ChatMode
import com.bitwarelabs.luna.presentation.theme.LunaTheme

private val CompanionPink = Color(0xFFEC4899)

@Composable
fun ModeIcon(
    mode: ChatMode,
    modifier: Modifier = Modifier,
    size: Dp = 20.dp
) {
    when (mode) {
        ChatMode.ASSISTANT -> Icon(
            imageVector = Icons.AutoMirrored.Filled.Chat,
            contentDescription = "Assistant mode",
            tint = LunaTheme.colors.accentPrimary,
            modifier = modifier.size(size)
        )
        ChatMode.COMPANION -> Icon(
            imageVector = Icons.Default.Favorite,
            contentDescription = "Companion mode",
            tint = CompanionPink,
            modifier = modifier.size(size)
        )
        ChatMode.VOICE -> Icon(
            imageVector = Icons.Default.Mic,
            contentDescription = "Voice mode",
            tint = LunaTheme.colors.accentSecondary,
            modifier = modifier.size(size)
        )
        ChatMode.DJ_LUNA -> Icon(
            imageVector = Icons.Default.MusicNote,
            contentDescription = "DJ Luna mode",
            tint = Color(0xFFFF6B6B),
            modifier = modifier.size(size)
        )
    }
}
