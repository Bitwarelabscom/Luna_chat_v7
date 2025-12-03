package com.bitwarelabs.luna.presentation.screens.chat.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.Message
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun ChatArea(
    messages: List<Message>,
    streamingContent: String,
    statusMessage: String,
    isLoading: Boolean,
    isSending: Boolean,
    hasSession: Boolean,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()

    // Auto-scroll to bottom when new messages arrive or streaming content changes
    LaunchedEffect(messages.size, streamingContent) {
        if (messages.isNotEmpty() || streamingContent.isNotEmpty()) {
            listState.animateScrollToItem(
                index = maxOf(0, messages.size - 1 + if (streamingContent.isNotEmpty() || statusMessage.isNotEmpty()) 1 else 0)
            )
        }
    }

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(LunaTheme.colors.bgPrimary)
    ) {
        when {
            isLoading -> {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator(
                        color = LunaTheme.colors.accentPrimary,
                        modifier = Modifier.size(40.dp)
                    )
                }
            }
            !hasSession && messages.isEmpty() -> {
                // Welcome screen
                Column(
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(32.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = "Welcome to Luna",
                        style = MaterialTheme.typography.headlineMedium,
                        color = LunaTheme.colors.textPrimary,
                        textAlign = TextAlign.Center
                    )
                    Text(
                        text = "Your AI assistant is ready to help. Start a new conversation or select an existing one from the menu.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = LunaTheme.colors.textMuted,
                        textAlign = TextAlign.Center,
                        modifier = Modifier.padding(top = 16.dp)
                    )
                }
            }
            else -> {
                LazyColumn(
                    state = listState,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp)
                ) {
                    items(messages, key = { it.id }) { message ->
                        MessageBubble(message = message)
                    }

                    // Streaming content or status
                    if (streamingContent.isNotEmpty() || statusMessage.isNotEmpty()) {
                        item {
                            if (statusMessage.isNotEmpty()) {
                                StreamingIndicator(status = statusMessage)
                            } else {
                                StreamingBubble(content = streamingContent)
                            }
                        }
                    }
                }
            }
        }
    }
}
