package com.bitwarelabs.luna.presentation.screens.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material3.DrawerValue
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalNavigationDrawer
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberDrawerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.presentation.screens.chat.components.ChatArea
import com.bitwarelabs.luna.presentation.screens.chat.components.ChatInput
import com.bitwarelabs.luna.presentation.screens.chat.components.ModeIcon
import com.bitwarelabs.luna.presentation.screens.chat.components.Sidebar
import com.bitwarelabs.luna.presentation.theme.LunaTheme
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    initialSessionId: String? = null,
    onNavigateToSettings: () -> Unit,
    onNavigateToAbilities: () -> Unit = {},
    onNavigateToTrading: () -> Unit = {},
    onNavigateToNotifications: () -> Unit = {},
    onNavigateToActivity: () -> Unit = {},
    onLogout: () -> Unit,
    viewModel: ChatViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val drawerState = rememberDrawerState(initialValue = DrawerValue.Closed)
    val scope = rememberCoroutineScope()
    val snackbarHostState = remember { SnackbarHostState() }

    // Load initial session if provided
    LaunchedEffect(initialSessionId) {
        initialSessionId?.let { viewModel.loadSession(it) }
    }

    // Show error in snackbar
    LaunchedEffect(uiState.error) {
        uiState.error?.let { error ->
            snackbarHostState.showSnackbar(error)
            viewModel.clearError()
        }
    }

    ModalNavigationDrawer(
        drawerState = drawerState,
        drawerContent = {
            Sidebar(
                sessions = uiState.sessions,
                currentSessionId = uiState.currentSessionId,
                isLoading = uiState.isLoadingSessions,
                editingSessionId = uiState.editingSessionId,
                editingTitle = uiState.editingTitle,
                onNewChat = {
                    viewModel.createSession()
                    scope.launch { drawerState.close() }
                },
                onSessionClick = { session ->
                    viewModel.loadSession(session.id)
                    scope.launch { drawerState.close() }
                },
                onDeleteSession = viewModel::deleteSession,
                onStartEditSession = viewModel::startEditingSession,
                onUpdateEditingTitle = viewModel::updateEditingTitle,
                onSaveSessionTitle = viewModel::saveSessionTitle,
                onCancelEditSession = viewModel::cancelEditingSession,
                onSettingsClick = {
                    scope.launch { drawerState.close() }
                    onNavigateToSettings()
                },
                onAbilitiesClick = {
                    scope.launch { drawerState.close() }
                    onNavigateToAbilities()
                },
                onTradingClick = {
                    scope.launch { drawerState.close() }
                    onNavigateToTrading()
                },
                onNotificationsClick = {
                    scope.launch { drawerState.close() }
                    onNavigateToNotifications()
                },
                onActivityClick = {
                    scope.launch { drawerState.close() }
                    onNavigateToActivity()
                },
                onLogoutClick = {
                    viewModel.logout()
                    onLogout()
                }
            )
        },
        gesturesEnabled = true
    ) {
        Scaffold(
            modifier = Modifier
                .fillMaxSize()
                .background(LunaTheme.colors.bgPrimary)
                .imePadding(),
            containerColor = LunaTheme.colors.bgPrimary,
            topBar = {
                TopAppBar(
                    title = {
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            Text(
                                text = "Luna",
                                color = LunaTheme.colors.textPrimary
                            )
                            uiState.currentMode?.let { mode ->
                                Spacer(modifier = Modifier.width(8.dp))
                                ModeIcon(mode = mode, size = 18.dp)
                            }
                        }
                    },
                    navigationIcon = {
                        IconButton(onClick = { scope.launch { drawerState.open() } }) {
                            Icon(
                                imageVector = Icons.Default.Menu,
                                contentDescription = "Menu",
                                tint = LunaTheme.colors.textPrimary
                            )
                        }
                    },
                    colors = TopAppBarDefaults.topAppBarColors(
                        containerColor = LunaTheme.colors.bgSecondary
                    )
                )
            },
            snackbarHost = { SnackbarHost(snackbarHostState) }
        ) { paddingValues ->
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(paddingValues)
            ) {
                // Messages area
                ChatArea(
                    messages = uiState.messages,
                    streamingContent = uiState.streamingContent,
                    statusMessage = uiState.statusMessage,
                    isLoading = uiState.isLoadingMessages,
                    isSending = uiState.isSending,
                    hasSession = uiState.currentSessionId != null,
                    expandedMessageIds = uiState.expandedMessageIds,
                    onMessageClick = viewModel::toggleMessageExpand,
                    modifier = Modifier
                        .weight(1f)
                        .fillMaxWidth()
                )

                // Input area
                ChatInput(
                    value = uiState.inputText,
                    onValueChange = viewModel::updateInputText,
                    onSend = viewModel::sendMessage,
                    isSending = uiState.isSending,
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(16.dp)
                )
            }
        }
    }
}
