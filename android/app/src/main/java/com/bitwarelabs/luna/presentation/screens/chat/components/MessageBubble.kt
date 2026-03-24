package com.bitwarelabs.luna.presentation.screens.chat.components

import android.widget.TextView
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.bitwarelabs.luna.domain.model.Message
import com.bitwarelabs.luna.domain.model.MessageRole
import com.bitwarelabs.luna.presentation.theme.LunaTheme
import io.noties.markwon.Markwon
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin

@Composable
fun MessageBubble(
    message: Message,
    isExpanded: Boolean = false,
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val isUser = message.role == MessageRole.USER
    val isAssistant = message.role == MessageRole.ASSISTANT
    val configuration = LocalConfiguration.current
    val maxWidth = (configuration.screenWidthDp * 0.85f).dp

    val backgroundColor = if (isUser) {
        LunaTheme.colors.messageUser
    } else {
        LunaTheme.colors.messageAssistant
    }

    val textColor = if (isUser) {
        LunaTheme.colors.messageUserText
    } else {
        LunaTheme.colors.messageAssistantText
    }

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = maxWidth)
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = if (isUser) 16.dp else 4.dp,
                        bottomEnd = if (isUser) 4.dp else 16.dp
                    )
                )
                .background(backgroundColor)
                .then(
                    if (isAssistant && onClick != null) {
                        Modifier.clickable(onClick = onClick)
                    } else {
                        Modifier
                    }
                )
                .padding(12.dp)
        ) {
            Column {
                if (isAssistant) {
                    MarkdownText(
                        content = message.content,
                        textColorArgb = textColor.toArgb()
                    )
                } else {
                    Text(
                        text = message.content,
                        style = MaterialTheme.typography.bodyLarge,
                        color = textColor
                    )
                }

                // Expandable metadata for assistant messages
                if (isAssistant) {
                    ExpandableMetadata(
                        isExpanded = isExpanded,
                        metrics = message.metrics
                    )
                }
            }
        }
    }
}

@Composable
fun MarkdownText(
    content: String,
    textColorArgb: Int,
    modifier: Modifier = Modifier
) {
    val context = LocalContext.current
    val markwon = remember(context) {
        Markwon.builder(context)
            .usePlugin(StrikethroughPlugin.create())
            .usePlugin(TablePlugin.create(context))
            .build()
    }

    AndroidView(
        factory = { ctx ->
            TextView(ctx).apply {
                setTextColor(textColorArgb)
                textSize = 16f
                setLineSpacing(4f, 1f)
            }
        },
        update = { tv ->
            markwon.setMarkdown(tv, content)
            tv.setTextColor(textColorArgb)
        },
        modifier = modifier
    )
}

@Composable
fun StreamingBubble(
    content: String,
    modifier: Modifier = Modifier
) {
    val configuration = LocalConfiguration.current
    val maxWidth = (configuration.screenWidthDp * 0.85f).dp
    val textColor = LunaTheme.colors.messageAssistantText

    Row(
        modifier = modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.Start
    ) {
        Box(
            modifier = Modifier
                .widthIn(max = maxWidth)
                .clip(
                    RoundedCornerShape(
                        topStart = 16.dp,
                        topEnd = 16.dp,
                        bottomStart = 4.dp,
                        bottomEnd = 16.dp
                    )
                )
                .background(LunaTheme.colors.messageAssistant)
                .padding(12.dp)
        ) {
            MarkdownText(
                content = content,
                textColorArgb = textColor.toArgb()
            )
        }
    }
}
