package com.bitwarelabs.luna.presentation.screens.chat.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun ChatInput(
    value: String,
    onValueChange: (String) -> Unit,
    onSend: () -> Unit,
    onVoiceClick: () -> Unit,
    isSending: Boolean,
    modifier: Modifier = Modifier
) {
    Row(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(24.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(start = 4.dp, end = 8.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        TextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier
                .weight(1f)
                .heightIn(min = 48.dp, max = 200.dp),
            textStyle = MaterialTheme.typography.bodyLarge,
            placeholder = {
                Text(
                    text = "Type a message...",
                    style = MaterialTheme.typography.bodyLarge
                )
            },
            keyboardOptions = KeyboardOptions(
                imeAction = ImeAction.Send
            ),
            keyboardActions = KeyboardActions(
                onSend = { if (value.isNotBlank()) onSend() }
            ),
            colors = TextFieldDefaults.colors(
                focusedTextColor = LunaTheme.colors.textPrimary,
                unfocusedTextColor = LunaTheme.colors.textPrimary,
                focusedPlaceholderColor = LunaTheme.colors.textMuted,
                unfocusedPlaceholderColor = LunaTheme.colors.textMuted,
                cursorColor = LunaTheme.colors.accentPrimary,
                focusedContainerColor = Color.Transparent,
                unfocusedContainerColor = Color.Transparent,
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent
            ),
            singleLine = false,
            maxLines = 5
        )

        // Voice button
        IconButton(
            onClick = onVoiceClick,
            enabled = !isSending,
            colors = IconButtonDefaults.iconButtonColors(
                containerColor = LunaTheme.colors.bgTertiary,
                contentColor = LunaTheme.colors.textMuted
            ),
            modifier = Modifier.size(40.dp)
        ) {
            Icon(
                imageVector = Icons.Default.Mic,
                contentDescription = "Voice",
                modifier = Modifier.size(20.dp)
            )
        }

        Spacer(modifier = Modifier.width(4.dp))

        // Send button
        IconButton(
            onClick = onSend,
            enabled = value.isNotBlank() && !isSending,
            colors = IconButtonDefaults.iconButtonColors(
                containerColor = if (value.isNotBlank() && !isSending) {
                    LunaTheme.colors.accentPrimary
                } else {
                    LunaTheme.colors.bgTertiary
                },
                contentColor = LunaTheme.colors.textPrimary,
                disabledContainerColor = LunaTheme.colors.bgTertiary,
                disabledContentColor = LunaTheme.colors.textMuted
            ),
            modifier = Modifier.size(40.dp)
        ) {
            if (isSending) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    color = LunaTheme.colors.textPrimary,
                    strokeWidth = 2.dp
                )
            } else {
                Icon(
                    imageVector = Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Send",
                    modifier = Modifier.size(20.dp)
                )
            }
        }
    }
}
