package com.bitwarelabs.luna.presentation.screens.abilities

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.presentation.screens.abilities.tabs.*
import com.bitwarelabs.luna.presentation.theme.LunaTheme

enum class AbilityTab(val title: String, val icon: ImageVector) {
    OVERVIEW("Overview", Icons.Default.Dashboard),
    TASKS("Tasks", Icons.Default.CheckCircle),
    KNOWLEDGE("Knowledge", Icons.Default.Psychology),
    WORKSPACE("Workspace", Icons.Default.Code),
    DOCUMENTS("Documents", Icons.Default.Description),
    TOOLS("Tools", Icons.Default.Build),
    AGENTS("Agents", Icons.Default.SmartToy),
    MOOD("Mood", Icons.Default.Mood),
    CHECKINS("Check-ins", Icons.Default.Schedule)
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AbilitiesScreen(
    onNavigateBack: () -> Unit,
    viewModel: AbilitiesViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    var selectedTab by remember { mutableStateOf(AbilityTab.OVERVIEW) }

    LaunchedEffect(selectedTab) {
        when (selectedTab) {
            AbilityTab.OVERVIEW -> viewModel.loadSummary()
            AbilityTab.TASKS -> viewModel.loadTasks()
            AbilityTab.KNOWLEDGE -> viewModel.loadKnowledge()
            AbilityTab.WORKSPACE -> viewModel.loadWorkspace()
            AbilityTab.DOCUMENTS -> viewModel.loadDocuments()
            AbilityTab.TOOLS -> viewModel.loadTools()
            AbilityTab.AGENTS -> viewModel.loadAgents()
            AbilityTab.MOOD -> viewModel.loadMood()
            AbilityTab.CHECKINS -> viewModel.loadCheckins()
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Abilities",
                        color = LunaTheme.colors.textPrimary,
                        fontWeight = FontWeight.SemiBold
                    )
                },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = "Back",
                            tint = LunaTheme.colors.textPrimary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = LunaTheme.colors.bgPrimary
                )
            )
        },
        containerColor = LunaTheme.colors.bgPrimary
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            // Tab selector
            LazyRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(AbilityTab.entries) { tab ->
                    AbilityTabChip(
                        tab = tab,
                        isSelected = selectedTab == tab,
                        onClick = { selectedTab = tab }
                    )
                }
            }

            // Content
            Box(modifier = Modifier.fillMaxSize()) {
                when (selectedTab) {
                    AbilityTab.OVERVIEW -> OverviewTab(viewModel = viewModel)
                    AbilityTab.TASKS -> TasksTab(viewModel = viewModel)
                    AbilityTab.KNOWLEDGE -> KnowledgeTab(viewModel = viewModel)
                    AbilityTab.WORKSPACE -> WorkspaceTab(viewModel = viewModel)
                    AbilityTab.DOCUMENTS -> DocumentsTab(viewModel = viewModel)
                    AbilityTab.TOOLS -> ToolsTab(viewModel = viewModel)
                    AbilityTab.AGENTS -> AgentsTab(viewModel = viewModel)
                    AbilityTab.MOOD -> MoodTab(viewModel = viewModel)
                    AbilityTab.CHECKINS -> CheckinsTab(viewModel = viewModel)
                }
            }
        }
    }

    // Error snackbar
    uiState.error?.let { error ->
        LaunchedEffect(error) {
            // Show error, then clear
            viewModel.clearError()
        }
    }

    uiState.successMessage?.let { message ->
        LaunchedEffect(message) {
            // Show success, then clear
            viewModel.clearSuccessMessage()
        }
    }
}

@Composable
private fun AbilityTabChip(
    tab: AbilityTab,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val backgroundColor = if (isSelected) {
        LunaTheme.colors.accentPrimary
    } else {
        LunaTheme.colors.bgSecondary
    }

    val contentColor = if (isSelected) {
        LunaTheme.colors.textPrimary
    } else {
        LunaTheme.colors.textMuted
    }

    Surface(
        onClick = onClick,
        shape = RoundedCornerShape(20.dp),
        color = backgroundColor
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Icon(
                imageVector = tab.icon,
                contentDescription = null,
                tint = contentColor,
                modifier = Modifier.size(18.dp)
            )
            Text(
                text = tab.title,
                style = MaterialTheme.typography.bodyMedium,
                color = contentColor,
                fontWeight = if (isSelected) FontWeight.Medium else FontWeight.Normal
            )
        }
    }
}
