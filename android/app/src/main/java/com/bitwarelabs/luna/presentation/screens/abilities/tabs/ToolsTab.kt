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
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.Tool
import com.bitwarelabs.luna.presentation.screens.abilities.AbilitiesViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun ToolsTab(viewModel: AbilitiesViewModel) {
    val uiState by viewModel.uiState.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Custom Tools",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.SemiBold
            )
            Button(
                onClick = { /* TODO: Tool creation dialog */ },
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)
            ) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("New Tool")
            }
        }

        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Create custom tools that Luna can use during conversations.",
            style = MaterialTheme.typography.bodySmall,
            color = LunaTheme.colors.textMuted
        )

        Spacer(modifier = Modifier.height(16.dp))

        if (uiState.isLoadingTools) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else if (uiState.tools.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Build, contentDescription = null, tint = LunaTheme.colors.textMuted, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("No custom tools created", color = LunaTheme.colors.textMuted)
                }
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(uiState.tools, key = { it.id }) { tool ->
                    ToolItem(
                        tool = tool,
                        onDelete = { viewModel.deleteTool(tool.id) }
                    )
                }
            }
        }
    }
}

@Composable
private fun ToolItem(
    tool: Tool,
    onDelete: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Icon(
                    imageVector = Icons.Default.Build,
                    contentDescription = null,
                    tint = LunaTheme.colors.accentPrimary,
                    modifier = Modifier.size(24.dp)
                )
                Column {
                    Text(
                        text = tool.name,
                        style = MaterialTheme.typography.bodyLarge,
                        color = LunaTheme.colors.textPrimary,
                        fontWeight = FontWeight.Medium,
                        fontFamily = FontFamily.Monospace
                    )
                    Text(
                        text = if (tool.enabled) "Enabled" else "Disabled",
                        style = MaterialTheme.typography.labelSmall,
                        color = if (tool.enabled) LunaTheme.colors.success else LunaTheme.colors.textMuted
                    )
                }
            }

            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, contentDescription = "Delete", tint = LunaTheme.colors.error)
            }
        }

        Spacer(Modifier.height(8.dp))

        Text(
            text = tool.description,
            style = MaterialTheme.typography.bodyMedium,
            color = LunaTheme.colors.textSecondary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )

        if (tool.parameters.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Parameters:",
                style = MaterialTheme.typography.labelSmall,
                color = LunaTheme.colors.textMuted
            )
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                tool.parameters.take(3).forEach { param ->
                    Surface(
                        shape = RoundedCornerShape(4.dp),
                        color = LunaTheme.colors.bgTertiary
                    ) {
                        Text(
                            text = "${param.name}: ${param.type}",
                            style = MaterialTheme.typography.labelSmall,
                            color = LunaTheme.colors.textMuted,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }
                if (tool.parameters.size > 3) {
                    Text(
                        text = "+${tool.parameters.size - 3} more",
                        style = MaterialTheme.typography.labelSmall,
                        color = LunaTheme.colors.textMuted
                    )
                }
            }
        }
    }
}
