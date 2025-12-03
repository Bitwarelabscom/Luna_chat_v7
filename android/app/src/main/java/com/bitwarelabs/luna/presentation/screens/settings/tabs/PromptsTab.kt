package com.bitwarelabs.luna.presentation.screens.settings.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.domain.model.SavedPrompt
import com.bitwarelabs.luna.presentation.screens.settings.SettingsViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun PromptsTab(
    modifier: Modifier = Modifier,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "System Prompts",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.SemiBold
            )

            Button(
                onClick = { viewModel.startCreatingPrompt() },
                colors = ButtonDefaults.buttonColors(
                    containerColor = LunaTheme.colors.accentPrimary
                )
            ) {
                Icon(imageVector = Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(4.dp))
                Text("New")
            }
        }

        Spacer(modifier = Modifier.height(8.dp))

        PromptItem(
            name = "Default",
            description = "Use the built-in system prompt",
            isActive = uiState.activePromptId == null,
            onActivate = { viewModel.setActivePrompt(null) },
            onEdit = null,
            onDelete = null
        )

        Spacer(modifier = Modifier.height(8.dp))

        if (uiState.isLoadingPrompts) {
            Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else if (uiState.prompts.isEmpty()) {
            Box(modifier = Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                Text(text = "No custom prompts yet", color = LunaTheme.colors.textMuted)
            }
        } else {
            LazyColumn(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(uiState.prompts, key = { it.id }) { prompt ->
                    PromptItem(
                        name = prompt.name,
                        description = prompt.description,
                        isActive = uiState.activePromptId == prompt.id,
                        onActivate = { viewModel.setActivePrompt(prompt.id) },
                        onEdit = { viewModel.startEditingPrompt(prompt) },
                        onDelete = { viewModel.deletePrompt(prompt.id) }
                    )
                }
            }
        }
    }

    if (uiState.editingPrompt != null || uiState.isCreatingPrompt) {
        PromptEditorDialog(
            prompt = uiState.editingPrompt,
            defaultPrompts = uiState.defaultPrompts,
            onSave = { name, desc, base, assistant, companion ->
                viewModel.savePrompt(name, desc, base, assistant, companion)
            },
            onDismiss = { viewModel.cancelEditingPrompt() }
        )
    }
}

@Composable
private fun PromptItem(
    name: String,
    description: String?,
    isActive: Boolean,
    onActivate: () -> Unit,
    onEdit: (() -> Unit)?,
    onDelete: (() -> Unit)?
) {
    val borderColor = if (isActive) LunaTheme.colors.accentPrimary else LunaTheme.colors.border

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, borderColor, RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .clickable(onClick = onActivate)
            .padding(16.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier.size(24.dp).clip(CircleShape)
                .background(if (isActive) LunaTheme.colors.accentPrimary else LunaTheme.colors.bgTertiary),
            contentAlignment = Alignment.Center
        ) {
            if (isActive) {
                Icon(imageVector = Icons.Default.Check, contentDescription = null,
                    tint = LunaTheme.colors.textPrimary, modifier = Modifier.size(16.dp))
            }
        }

        Spacer(modifier = Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(text = name, style = MaterialTheme.typography.bodyLarge,
                color = LunaTheme.colors.textPrimary, fontWeight = FontWeight.Medium)
            if (description != null) {
                Text(text = description, style = MaterialTheme.typography.bodySmall,
                    color = LunaTheme.colors.textMuted, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }

        if (onEdit != null) {
            IconButton(onClick = onEdit) {
                Icon(imageVector = Icons.Default.Edit, contentDescription = "Edit", tint = LunaTheme.colors.textMuted)
            }
        }
        if (onDelete != null) {
            IconButton(onClick = onDelete) {
                Icon(imageVector = Icons.Default.Delete, contentDescription = "Delete", tint = LunaTheme.colors.error)
            }
        }
    }
}

@Composable
private fun PromptEditorDialog(
    prompt: SavedPrompt?,
    defaultPrompts: com.bitwarelabs.luna.domain.model.DefaultPrompts?,
    onSave: (String, String?, String, String?, String?) -> Unit,
    onDismiss: () -> Unit
) {
    var name by remember { mutableStateOf(prompt?.name ?: "") }
    var description by remember { mutableStateOf(prompt?.description ?: "") }
    var basePrompt by remember { mutableStateOf(prompt?.basePrompt ?: defaultPrompts?.basePrompt ?: "") }
    var assistantAdditions by remember { mutableStateOf(prompt?.assistantAdditions ?: defaultPrompts?.assistantAdditions ?: "") }
    var companionAdditions by remember { mutableStateOf(prompt?.companionAdditions ?: defaultPrompts?.companionAdditions ?: "") }

    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp))
                .background(LunaTheme.colors.bgSecondary).padding(20.dp).verticalScroll(rememberScrollState())
        ) {
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(text = if (prompt != null) "Edit Prompt" else "New Prompt",
                    style = MaterialTheme.typography.titleLarge, color = LunaTheme.colors.textPrimary)
                IconButton(onClick = onDismiss) {
                    Icon(imageVector = Icons.Default.Close, contentDescription = "Close", tint = LunaTheme.colors.textMuted)
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            PromptTextField(value = name, onValueChange = { name = it }, label = "Name", singleLine = true)
            Spacer(modifier = Modifier.height(12.dp))
            PromptTextField(value = description, onValueChange = { description = it }, label = "Description (optional)", singleLine = true)
            Spacer(modifier = Modifier.height(12.dp))
            PromptTextField(value = basePrompt, onValueChange = { basePrompt = it }, label = "Base Prompt", minLines = 4)
            Spacer(modifier = Modifier.height(12.dp))
            PromptTextField(value = assistantAdditions, onValueChange = { assistantAdditions = it }, label = "Assistant Mode Additions", minLines = 2)
            Spacer(modifier = Modifier.height(12.dp))
            PromptTextField(value = companionAdditions, onValueChange = { companionAdditions = it }, label = "Companion Mode Additions", minLines = 2)
            Spacer(modifier = Modifier.height(20.dp))

            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                TextButton(onClick = onDismiss) { Text("Cancel", color = LunaTheme.colors.textMuted) }
                Spacer(modifier = Modifier.width(8.dp))
                Button(
                    onClick = { onSave(name, description.ifBlank { null }, basePrompt, assistantAdditions.ifBlank { null }, companionAdditions.ifBlank { null }) },
                    enabled = name.isNotBlank() && basePrompt.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)
                ) { Text("Save") }
            }
        }
    }
}

@Composable
private fun PromptTextField(value: String, onValueChange: (String) -> Unit, label: String, singleLine: Boolean = false, minLines: Int = 1) {
    OutlinedTextField(
        value = value, onValueChange = onValueChange, label = { Text(label) },
        modifier = Modifier.fillMaxWidth(), singleLine = singleLine, minLines = minLines,
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = LunaTheme.colors.borderFocus, unfocusedBorderColor = LunaTheme.colors.border,
            focusedTextColor = LunaTheme.colors.textPrimary, unfocusedTextColor = LunaTheme.colors.textPrimary,
            focusedLabelColor = LunaTheme.colors.textMuted, unfocusedLabelColor = LunaTheme.colors.textMuted,
            cursorColor = LunaTheme.colors.accentPrimary, focusedContainerColor = LunaTheme.colors.bgInput, unfocusedContainerColor = LunaTheme.colors.bgInput
        ),
        shape = RoundedCornerShape(8.dp)
    )
}
