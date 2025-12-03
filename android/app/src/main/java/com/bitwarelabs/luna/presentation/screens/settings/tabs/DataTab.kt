package com.bitwarelabs.luna.presentation.screens.settings.tabs

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudDownload
import androidx.compose.material.icons.filled.CloudUpload
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.DeleteForever
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.bitwarelabs.luna.presentation.screens.settings.SettingsViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun DataTab(modifier: Modifier = Modifier, viewModel: SettingsViewModel = hiltViewModel()) {
    val uiState by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    var showClearMemoryDialog by remember { mutableStateOf(false) }
    var showClearAllDialog by remember { mutableStateOf(false) }
    var clearAllConfirmText by remember { mutableStateOf("") }
    var importText by remember { mutableStateOf("") }
    var showImportDialog by remember { mutableStateOf(false) }

    Column(modifier = modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
        Text(text = "Data Management", style = MaterialTheme.typography.titleMedium, color = LunaTheme.colors.textPrimary, fontWeight = FontWeight.SemiBold)
        Spacer(modifier = Modifier.height(24.dp))

        DataSection(title = "Backup") {
            Text(text = "Export all your data including prompts, sessions, and messages.", style = MaterialTheme.typography.bodySmall, color = LunaTheme.colors.textMuted)
            Spacer(modifier = Modifier.height(12.dp))
            Button(onClick = {
                viewModel.exportData { jsonData ->
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("Luna Backup", jsonData))
                    Toast.makeText(context, "Backup copied to clipboard", Toast.LENGTH_SHORT).show()
                }
            }, modifier = Modifier.fillMaxWidth(), enabled = !uiState.isExporting, colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)) {
                if (uiState.isExporting) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = LunaTheme.colors.textPrimary, strokeWidth = 2.dp)
                else Icon(imageVector = Icons.Default.CloudDownload, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Export Data")
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        DataSection(title = "Restore") {
            Text(text = "Import data from a previously exported backup.", style = MaterialTheme.typography.bodySmall, color = LunaTheme.colors.textMuted)
            Spacer(modifier = Modifier.height(12.dp))
            Button(onClick = { showImportDialog = true }, modifier = Modifier.fillMaxWidth(), enabled = !uiState.isImporting,
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.bgTertiary, contentColor = LunaTheme.colors.textPrimary)) {
                if (uiState.isImporting) CircularProgressIndicator(modifier = Modifier.size(20.dp), color = LunaTheme.colors.textPrimary, strokeWidth = 2.dp)
                else Icon(imageVector = Icons.Default.CloudUpload, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Import Data")
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
        Text(text = "Danger Zone", style = MaterialTheme.typography.titleSmall, color = LunaTheme.colors.error, fontWeight = FontWeight.SemiBold)
        Spacer(modifier = Modifier.height(16.dp))

        DataSection(title = "Clear Memory", isDanger = true) {
            Text(text = "Remove all stored facts, embeddings, and summaries. Chat history will remain.", style = MaterialTheme.typography.bodySmall, color = LunaTheme.colors.textMuted)
            Spacer(modifier = Modifier.height(12.dp))
            Button(onClick = { showClearMemoryDialog = true }, modifier = Modifier.fillMaxWidth(), enabled = !uiState.isClearing,
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.error.copy(alpha = 0.2f), contentColor = LunaTheme.colors.error)) {
                Icon(imageVector = Icons.Default.Delete, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Clear Memory")
            }
        }

        Spacer(modifier = Modifier.height(16.dp))

        DataSection(title = "Clear All Data", isDanger = true) {
            Text(text = "Permanently delete all your data. This cannot be undone.", style = MaterialTheme.typography.bodySmall, color = LunaTheme.colors.textMuted)
            Spacer(modifier = Modifier.height(12.dp))
            Button(onClick = { showClearAllDialog = true }, modifier = Modifier.fillMaxWidth(), enabled = !uiState.isClearing,
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.error, contentColor = LunaTheme.colors.textPrimary)) {
                Icon(imageVector = Icons.Default.DeleteForever, contentDescription = null)
                Spacer(modifier = Modifier.width(8.dp))
                Text("Clear All Data")
            }
        }
    }

    if (showClearMemoryDialog) {
        AlertDialog(onDismissRequest = { showClearMemoryDialog = false }, containerColor = LunaTheme.colors.bgSecondary,
            icon = { Icon(imageVector = Icons.Default.Warning, contentDescription = null, tint = LunaTheme.colors.error) },
            title = { Text(text = "Clear Memory?", color = LunaTheme.colors.textPrimary) },
            text = { Text(text = "This will remove all stored facts and embeddings. This action cannot be undone.", color = LunaTheme.colors.textSecondary) },
            confirmButton = { Button(onClick = { viewModel.clearMemory(); showClearMemoryDialog = false }, colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.error)) { Text("Clear") } },
            dismissButton = { TextButton(onClick = { showClearMemoryDialog = false }) { Text("Cancel", color = LunaTheme.colors.textMuted) } })
    }

    if (showClearAllDialog) {
        AlertDialog(onDismissRequest = { showClearAllDialog = false; clearAllConfirmText = "" }, containerColor = LunaTheme.colors.bgSecondary,
            icon = { Icon(imageVector = Icons.Default.DeleteForever, contentDescription = null, tint = LunaTheme.colors.error) },
            title = { Text(text = "Delete All Data?", color = LunaTheme.colors.textPrimary) },
            text = { Column {
                Text(text = "This will permanently delete ALL your data. Type DELETE to confirm:", color = LunaTheme.colors.textSecondary)
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(value = clearAllConfirmText, onValueChange = { clearAllConfirmText = it }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = LunaTheme.colors.error, unfocusedBorderColor = LunaTheme.colors.border,
                        focusedTextColor = LunaTheme.colors.textPrimary, unfocusedTextColor = LunaTheme.colors.textPrimary, cursorColor = LunaTheme.colors.error))
            } },
            confirmButton = { Button(onClick = { viewModel.clearAllData(); showClearAllDialog = false; clearAllConfirmText = "" }, enabled = clearAllConfirmText == "DELETE",
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.error)) { Text("Delete Everything") } },
            dismissButton = { TextButton(onClick = { showClearAllDialog = false; clearAllConfirmText = "" }) { Text("Cancel", color = LunaTheme.colors.textMuted) } })
    }

    if (showImportDialog) {
        AlertDialog(onDismissRequest = { showImportDialog = false; importText = "" }, containerColor = LunaTheme.colors.bgSecondary,
            title = { Text(text = "Import Backup", color = LunaTheme.colors.textPrimary) },
            text = { Column {
                Text(text = "Paste your backup JSON data below:", color = LunaTheme.colors.textMuted, style = MaterialTheme.typography.bodySmall)
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(value = importText, onValueChange = { importText = it }, modifier = Modifier.fillMaxWidth().height(150.dp),
                    colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = LunaTheme.colors.borderFocus, unfocusedBorderColor = LunaTheme.colors.border,
                        focusedTextColor = LunaTheme.colors.textPrimary, unfocusedTextColor = LunaTheme.colors.textPrimary, cursorColor = LunaTheme.colors.accentPrimary))
            } },
            confirmButton = { Button(onClick = { viewModel.importData(importText); showImportDialog = false; importText = "" }, enabled = importText.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)) { Text("Import") } },
            dismissButton = { TextButton(onClick = { showImportDialog = false; importText = "" }) { Text("Cancel", color = LunaTheme.colors.textMuted) } })
    }
}

@Composable
private fun DataSection(title: String, isDanger: Boolean = false, content: @Composable () -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(LunaTheme.colors.bgSecondary).padding(16.dp)) {
        Text(text = title, style = MaterialTheme.typography.titleSmall, color = if (isDanger) LunaTheme.colors.error else LunaTheme.colors.textPrimary, fontWeight = FontWeight.Medium)
        Spacer(modifier = Modifier.height(8.dp))
        content()
    }
}
