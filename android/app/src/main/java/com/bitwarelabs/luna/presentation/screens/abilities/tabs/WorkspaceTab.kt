package com.bitwarelabs.luna.presentation.screens.abilities.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.WorkspaceFile
import com.bitwarelabs.luna.presentation.screens.abilities.AbilitiesViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun WorkspaceTab(viewModel: AbilitiesViewModel) {
    val uiState by viewModel.uiState.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Workspace",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.SemiBold
            )
            Button(
                onClick = { viewModel.startCreatingFile() },
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)
            ) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("New File")
            }
        }

        // Stats
        uiState.workspaceStats?.let { stats ->
            Spacer(Modifier.height(12.dp))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                StatBox(label = "Files", value = "${stats.totalFiles}", modifier = Modifier.weight(1f))
                StatBox(label = "Size", value = formatBytes(stats.totalSize), modifier = Modifier.weight(1f))
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        if (uiState.isLoadingWorkspace) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else if (uiState.workspaceFiles.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Code, contentDescription = null, tint = LunaTheme.colors.textMuted, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("No files in workspace", color = LunaTheme.colors.textMuted)
                }
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(uiState.workspaceFiles, key = { it.filename }) { file ->
                    FileItem(
                        file = file,
                        onOpen = { viewModel.openFile(file.filename) },
                        onExecute = { viewModel.executeFile(file.filename) { } },
                        onDelete = { viewModel.deleteFile(file.filename) }
                    )
                }
            }
        }
    }

    // File editor dialog
    if (uiState.isCreatingFile || uiState.editingFile != null) {
        FileEditorDialog(
            filename = uiState.editingFile?.filename ?: "",
            content = uiState.editingFile?.content ?: "",
            isNew = uiState.isCreatingFile,
            onSave = { filename, content -> viewModel.saveFile(filename, content) },
            onDismiss = { viewModel.cancelEditingFile() }
        )
    }
}

@Composable
private fun StatBox(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(12.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(text = value, style = MaterialTheme.typography.titleLarge, color = LunaTheme.colors.textPrimary, fontWeight = FontWeight.Bold)
        Text(text = label, style = MaterialTheme.typography.bodySmall, color = LunaTheme.colors.textMuted)
    }
}

@Composable
private fun FileItem(
    file: WorkspaceFile,
    onOpen: () -> Unit,
    onExecute: () -> Unit,
    onDelete: () -> Unit
) {
    val languageIcon = when (file.language) {
        "python" -> Icons.Default.Code
        "javascript", "typescript" -> Icons.Default.Javascript
        else -> Icons.Default.Description
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .clickable(onClick = onOpen)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = languageIcon,
            contentDescription = null,
            tint = LunaTheme.colors.accentPrimary,
            modifier = Modifier.size(24.dp)
        )

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = file.filename,
                style = MaterialTheme.typography.bodyLarge,
                color = LunaTheme.colors.textPrimary,
                fontFamily = FontFamily.Monospace
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = formatBytes(file.size),
                    style = MaterialTheme.typography.bodySmall,
                    color = LunaTheme.colors.textMuted
                )
                file.language?.let {
                    Text(
                        text = it,
                        style = MaterialTheme.typography.bodySmall,
                        color = LunaTheme.colors.accentPrimary
                    )
                }
            }
        }

        if (file.language in listOf("python", "javascript", "typescript")) {
            IconButton(onClick = onExecute) {
                Icon(Icons.Default.PlayArrow, contentDescription = "Run", tint = LunaTheme.colors.success)
            }
        }

        IconButton(onClick = onDelete) {
            Icon(Icons.Default.Delete, contentDescription = "Delete", tint = LunaTheme.colors.error)
        }
    }
}

@Composable
private fun FileEditorDialog(
    filename: String,
    content: String,
    isNew: Boolean,
    onSave: (String, String) -> Unit,
    onDismiss: () -> Unit
) {
    var editedFilename by remember { mutableStateOf(filename) }
    var editedContent by remember { mutableStateOf(content) }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = LunaTheme.colors.bgSecondary,
        modifier = Modifier.fillMaxWidth().fillMaxHeight(0.8f),
        title = { Text(if (isNew) "New File" else "Edit File", color = LunaTheme.colors.textPrimary) },
        text = {
            Column(
                modifier = Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                OutlinedTextField(
                    value = editedFilename,
                    onValueChange = { editedFilename = it },
                    label = { Text("Filename") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    enabled = isNew,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = LunaTheme.colors.borderFocus,
                        unfocusedBorderColor = LunaTheme.colors.border,
                        focusedTextColor = LunaTheme.colors.textPrimary,
                        unfocusedTextColor = LunaTheme.colors.textPrimary
                    )
                )

                OutlinedTextField(
                    value = editedContent,
                    onValueChange = { editedContent = it },
                    label = { Text("Content") },
                    modifier = Modifier.fillMaxWidth().weight(1f),
                    textStyle = LocalTextStyle.current.copy(fontFamily = FontFamily.Monospace),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = LunaTheme.colors.borderFocus,
                        unfocusedBorderColor = LunaTheme.colors.border,
                        focusedTextColor = LunaTheme.colors.textPrimary,
                        unfocusedTextColor = LunaTheme.colors.textPrimary,
                        focusedContainerColor = LunaTheme.colors.bgInput,
                        unfocusedContainerColor = LunaTheme.colors.bgInput
                    )
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(editedFilename, editedContent) },
                enabled = editedFilename.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = LunaTheme.colors.textMuted) }
        }
    )
}

private fun formatBytes(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
        else -> String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024))
    }
}
