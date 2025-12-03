package com.bitwarelabs.luna.presentation.screens.abilities.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.Document
import com.bitwarelabs.luna.domain.model.DocumentStatus
import com.bitwarelabs.luna.presentation.screens.abilities.AbilitiesViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun DocumentsTab(viewModel: AbilitiesViewModel) {
    val uiState by viewModel.uiState.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Documents",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.SemiBold
            )
            // Note: Upload functionality requires file picker integration
            Button(
                onClick = { /* TODO: Implement file picker */ },
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)
            ) {
                Icon(Icons.Default.Upload, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Upload")
            }
        }

        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Upload documents to enable semantic search across your files.",
            style = MaterialTheme.typography.bodySmall,
            color = LunaTheme.colors.textMuted
        )

        Spacer(modifier = Modifier.height(16.dp))

        if (uiState.isLoadingDocuments) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else if (uiState.documents.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Description, contentDescription = null, tint = LunaTheme.colors.textMuted, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("No documents uploaded", color = LunaTheme.colors.textMuted)
                }
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(uiState.documents, key = { it.id }) { doc ->
                    DocumentItem(
                        document = doc,
                        onDelete = { viewModel.deleteDocument(doc.id) }
                    )
                }
            }
        }
    }
}

@Composable
private fun DocumentItem(
    document: Document,
    onDelete: () -> Unit
) {
    val statusColor = when (document.status) {
        DocumentStatus.READY -> LunaTheme.colors.success
        DocumentStatus.PROCESSING -> LunaTheme.colors.warning
        DocumentStatus.FAILED -> LunaTheme.colors.error
        else -> LunaTheme.colors.textMuted
    }

    val statusIcon = when (document.status) {
        DocumentStatus.READY -> Icons.Default.CheckCircle
        DocumentStatus.PROCESSING -> Icons.Default.Sync
        DocumentStatus.FAILED -> Icons.Default.Error
        else -> Icons.Default.HourglassTop
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Icon(
            imageVector = getDocumentIcon(document.mimeType),
            contentDescription = null,
            tint = LunaTheme.colors.accentPrimary,
            modifier = Modifier.size(32.dp)
        )

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = document.filename,
                style = MaterialTheme.typography.bodyLarge,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.Medium
            )
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    text = formatBytes(document.size),
                    style = MaterialTheme.typography.bodySmall,
                    color = LunaTheme.colors.textMuted
                )
                if (document.chunkCount > 0) {
                    Text(
                        text = "${document.chunkCount} chunks",
                        style = MaterialTheme.typography.bodySmall,
                        color = LunaTheme.colors.textMuted
                    )
                }
            }
        }

        Icon(
            imageVector = statusIcon,
            contentDescription = document.status.value,
            tint = statusColor,
            modifier = Modifier.size(20.dp)
        )

        Spacer(Modifier.width(8.dp))

        IconButton(onClick = onDelete) {
            Icon(Icons.Default.Delete, contentDescription = "Delete", tint = LunaTheme.colors.error)
        }
    }
}

private fun getDocumentIcon(mimeType: String): androidx.compose.ui.graphics.vector.ImageVector {
    return when {
        mimeType.contains("pdf") -> Icons.Default.PictureAsPdf
        mimeType.contains("word") || mimeType.contains("document") -> Icons.Default.Article
        mimeType.contains("text") -> Icons.Default.TextSnippet
        mimeType.contains("spreadsheet") || mimeType.contains("excel") -> Icons.Default.TableChart
        else -> Icons.Default.Description
    }
}

private fun formatBytes(bytes: Long): String {
    return when {
        bytes < 1024 -> "$bytes B"
        bytes < 1024 * 1024 -> "${bytes / 1024} KB"
        bytes < 1024 * 1024 * 1024 -> "${bytes / (1024 * 1024)} MB"
        else -> String.format("%.1f GB", bytes / (1024.0 * 1024 * 1024))
    }
}
