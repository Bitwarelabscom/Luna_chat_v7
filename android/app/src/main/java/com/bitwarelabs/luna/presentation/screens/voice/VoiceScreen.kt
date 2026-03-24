package com.bitwarelabs.luna.presentation.screens.voice

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Snackbar
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.domain.model.VoiceState
import com.bitwarelabs.luna.presentation.screens.voice.components.VoiceOrb
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun VoiceScreen(
    onNavigateBack: () -> Unit,
    viewModel: VoiceViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val listState = rememberLazyListState()

    // Permission launcher
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            viewModel.onPermissionGranted()
            viewModel.initSession()
        }
    }

    // Set temp dir and request permission on first compose
    LaunchedEffect(Unit) {
        viewModel.setTempDir(context.cacheDir)
        permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
    }

    // Auto-scroll messages
    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty()) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    val stateLabel = when (uiState.voiceState) {
        VoiceState.IDLE -> if (uiState.isConnected) "Tap to start" else "Connecting..."
        VoiceState.LISTENING -> "Listening..."
        VoiceState.THINKING -> "Thinking..."
        VoiceState.SPEAKING -> "Speaking..."
    }

    val stateColor = when (uiState.voiceState) {
        VoiceState.IDLE -> LunaTheme.colors.textMuted
        VoiceState.LISTENING -> Color(0xFF3B82F6)
        VoiceState.THINKING -> Color(0xFFF59E0B)
        VoiceState.SPEAKING -> Color(0xFF10B981)
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .imePadding()
    ) {
        Column(
            modifier = Modifier.fillMaxSize()
        ) {
            // Top bar with back button
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = onNavigateBack) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                        contentDescription = "Back",
                        tint = LunaTheme.colors.textMuted
                    )
                }
                Text(
                    text = "Luna Voice",
                    style = MaterialTheme.typography.titleMedium,
                    color = LunaTheme.colors.textPrimary
                )
            }

            // Orb area
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(0.4f),
                contentAlignment = Alignment.Center
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    VoiceOrb(
                        voiceState = uiState.voiceState,
                        amplitude = uiState.amplitude,
                        size = 180.dp
                    )

                    Spacer(modifier = Modifier.height(16.dp))

                    Text(
                        text = stateLabel,
                        style = MaterialTheme.typography.titleSmall,
                        color = stateColor
                    )

                    // Streaming response text
                    if (uiState.responseText.isNotBlank()) {
                        Text(
                            text = uiState.responseText,
                            style = MaterialTheme.typography.bodyMedium,
                            color = LunaTheme.colors.textPrimary,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 32.dp, vertical = 8.dp)
                        )
                    }
                }
            }

            // Message history
            LazyColumn(
                state = listState,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(0.4f)
                    .padding(horizontal = 16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(uiState.messages, key = { "${it.role}_${it.timestamp}" }) { message ->
                    val isUser = message.role == "user"
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
                    ) {
                        Text(
                            text = message.content,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (isUser) Color(0xFF93C5FD) else LunaTheme.colors.textPrimary,
                            modifier = Modifier
                                .clip(RoundedCornerShape(12.dp))
                                .background(
                                    if (isUser) Color(0xFF1E3A5F).copy(alpha = 0.5f)
                                    else Color(0xFF1F2937).copy(alpha = 0.5f)
                                )
                                .padding(horizontal = 12.dp, vertical = 8.dp)
                        )
                    }
                }
            }

            // Controls
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                when (uiState.voiceState) {
                    VoiceState.IDLE -> {
                        if (uiState.isConnected) {
                            Button(
                                onClick = { viewModel.startListening() },
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(0xFF3B82F6)
                                ),
                                shape = CircleShape,
                                modifier = Modifier.size(64.dp)
                            ) {
                                Icon(
                                    imageVector = Icons.Default.Mic,
                                    contentDescription = "Start",
                                    tint = Color.White,
                                    modifier = Modifier.size(28.dp)
                                )
                            }
                        }
                    }
                    VoiceState.LISTENING, VoiceState.THINKING, VoiceState.SPEAKING -> {
                        Button(
                            onClick = { viewModel.stopConversation() },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = Color(0xFFEF4444)
                            ),
                            shape = CircleShape,
                            modifier = Modifier.size(64.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Stop,
                                contentDescription = "Stop",
                                tint = Color.White,
                                modifier = Modifier.size(28.dp)
                            )
                        }
                    }
                }
            }

            // Text input (fallback)
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .padding(bottom = 16.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(Color(0xFF1F2937))
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                BasicTextField(
                    value = uiState.inputText,
                    onValueChange = viewModel::updateInputText,
                    modifier = Modifier.weight(1f),
                    textStyle = MaterialTheme.typography.bodyLarge.copy(
                        color = LunaTheme.colors.textPrimary
                    ),
                    cursorBrush = SolidColor(LunaTheme.colors.accentPrimary),
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                    keyboardActions = KeyboardActions(onSend = { viewModel.sendTextMessage() }),
                    singleLine = true,
                    decorationBox = { innerTextField ->
                        if (uiState.inputText.isEmpty()) {
                            Text(
                                text = "Type a message...",
                                style = MaterialTheme.typography.bodyLarge,
                                color = LunaTheme.colors.textMuted
                            )
                        }
                        innerTextField()
                    }
                )

                Spacer(modifier = Modifier.width(8.dp))

                IconButton(
                    onClick = { viewModel.sendTextMessage() },
                    enabled = uiState.inputText.isNotBlank(),
                    colors = IconButtonDefaults.iconButtonColors(
                        containerColor = if (uiState.inputText.isNotBlank()) {
                            LunaTheme.colors.accentPrimary
                        } else {
                            Color(0xFF374151)
                        }
                    ),
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        imageVector = Icons.AutoMirrored.Filled.Send,
                        contentDescription = "Send",
                        tint = Color.White,
                        modifier = Modifier.size(18.dp)
                    )
                }
            }
        }

        // Error snackbar
        uiState.error?.let { error ->
            Snackbar(
                modifier = Modifier
                    .align(Alignment.BottomCenter)
                    .padding(16.dp),
                action = {
                    Text(
                        text = "Dismiss",
                        color = LunaTheme.colors.accentPrimary,
                        modifier = Modifier.padding(8.dp)
                    )
                }
            ) {
                Text(text = error)
            }
            LaunchedEffect(error) {
                kotlinx.coroutines.delay(3000)
                viewModel.clearError()
            }
        }
    }
}
