package com.bitwarelabs.luna.presentation.screens.settings.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.presentation.screens.settings.SettingsViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

private val TASK_TYPES = listOf("chat" to "Chat", "analysis" to "Analysis", "memory" to "Memory", "summary" to "Summary")

@Composable
fun ModelsTab(modifier: Modifier = Modifier, viewModel: SettingsViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val availableModels = uiState.availableModels
    val modelConfigs = uiState.modelConfigs

    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text(text = "Model Configuration", style = MaterialTheme.typography.titleMedium, color = LunaTheme.colors.textPrimary, fontWeight = FontWeight.SemiBold)
        Spacer(modifier = Modifier.height(8.dp))
        Text(text = "Configure which AI model to use for different tasks", style = MaterialTheme.typography.bodySmall, color = LunaTheme.colors.textMuted)
        Spacer(modifier = Modifier.height(24.dp))

        if (uiState.isLoadingModels && availableModels == null) {
            Box(modifier = Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else if (availableModels != null) {
            TASK_TYPES.forEach { (taskType, displayName) ->
                val currentConfig = modelConfigs.find { it.taskType == taskType }
                ModelConfigCard(
                    taskName = displayName,
                    currentProvider = currentConfig?.provider ?: "openai",
                    currentModel = currentConfig?.model ?: "",
                    availableProviders = availableModels.providers.keys.toList(),
                    getModelsForProvider = { provider -> availableModels.providers[provider] ?: emptyList() },
                    onConfigChange = { provider, model -> viewModel.setModelConfig(taskType, provider, model) }
                )
                Spacer(modifier = Modifier.height(12.dp))
            }
            Spacer(modifier = Modifier.height(24.dp))
            Button(
                onClick = { viewModel.resetModelConfigs() }, modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.bgTertiary, contentColor = LunaTheme.colors.textPrimary)
            ) {
                Icon(imageVector = Icons.Default.Refresh, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Reset to Defaults")
            }
        }
    }
}

@Composable
private fun ModelConfigCard(
    taskName: String, currentProvider: String, currentModel: String, availableProviders: List<String>,
    getModelsForProvider: (String) -> List<String>, onConfigChange: (String, String) -> Unit
) {
    var selectedProvider by remember(currentProvider) { mutableStateOf(currentProvider) }
    var selectedModel by remember(currentModel) { mutableStateOf(currentModel) }
    var providerExpanded by remember { mutableStateOf(false) }
    var modelExpanded by remember { mutableStateOf(false) }
    val modelsForProvider = getModelsForProvider(selectedProvider)

    Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(LunaTheme.colors.bgSecondary).padding(16.dp)) {
        Text(text = taskName, style = MaterialTheme.typography.titleSmall, color = LunaTheme.colors.textPrimary, fontWeight = FontWeight.Medium)
        Spacer(modifier = Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Box(modifier = Modifier.weight(1f)) {
                DropdownSelector(label = "Provider", value = selectedProvider, expanded = providerExpanded, onExpandedChange = { providerExpanded = it },
                    items = availableProviders, onItemSelected = { provider ->
                        selectedProvider = provider
                        val newModels = getModelsForProvider(provider)
                        selectedModel = newModels.firstOrNull() ?: ""
                        if (selectedModel.isNotEmpty()) onConfigChange(provider, selectedModel)
                        providerExpanded = false
                    })
            }
            Box(modifier = Modifier.weight(1f)) {
                DropdownSelector(label = "Model", value = selectedModel.ifEmpty { "Select..." }, expanded = modelExpanded, onExpandedChange = { modelExpanded = it },
                    items = modelsForProvider, onItemSelected = { model ->
                        selectedModel = model
                        onConfigChange(selectedProvider, model)
                        modelExpanded = false
                    })
            }
        }
    }
}

@Composable
private fun DropdownSelector(label: String, value: String, expanded: Boolean, onExpandedChange: (Boolean) -> Unit, items: List<String>, onItemSelected: (String) -> Unit) {
    Column {
        Text(text = label, style = MaterialTheme.typography.labelSmall, color = LunaTheme.colors.textMuted)
        Spacer(modifier = Modifier.height(4.dp))
        Box {
            Row(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(LunaTheme.colors.bgInput).clickable { onExpandedChange(true) }.padding(12.dp),
                horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(text = value, style = MaterialTheme.typography.bodyMedium, color = LunaTheme.colors.textPrimary)
                Icon(imageVector = Icons.Default.KeyboardArrowDown, contentDescription = null, tint = LunaTheme.colors.textMuted)
            }
            DropdownMenu(expanded = expanded, onDismissRequest = { onExpandedChange(false) }, modifier = Modifier.background(LunaTheme.colors.bgTertiary)) {
                items.forEach { item -> DropdownMenuItem(text = { Text(text = item, color = LunaTheme.colors.textPrimary) }, onClick = { onItemSelected(item) }) }
            }
        }
    }
}
