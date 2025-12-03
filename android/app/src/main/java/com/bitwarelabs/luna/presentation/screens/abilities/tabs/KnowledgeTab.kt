package com.bitwarelabs.luna.presentation.screens.abilities.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.KnowledgeItem
import com.bitwarelabs.luna.presentation.screens.abilities.AbilitiesViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun KnowledgeTab(viewModel: AbilitiesViewModel) {
    val uiState by viewModel.uiState.collectAsState()

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Knowledge Base",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.SemiBold
            )
            Button(
                onClick = { viewModel.startCreatingKnowledge() },
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)
            ) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("Add")
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Category filters
        LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            item {
                FilterChip(
                    selected = uiState.selectedCategory == null,
                    onClick = { viewModel.loadKnowledge(null) },
                    label = { Text("All") }
                )
            }
            items(uiState.knowledgeCategories) { category ->
                FilterChip(
                    selected = uiState.selectedCategory == category,
                    onClick = { viewModel.loadKnowledge(category) },
                    label = { Text(category) }
                )
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        if (uiState.isLoadingKnowledge) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else if (uiState.knowledge.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Psychology, contentDescription = null, tint = LunaTheme.colors.textMuted, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("No knowledge items found", color = LunaTheme.colors.textMuted)
                }
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(uiState.knowledge, key = { it.id }) { item ->
                    KnowledgeItemCard(
                        item = item,
                        onEdit = { viewModel.startEditingKnowledge(item) },
                        onDelete = { viewModel.deleteKnowledge(item.id) }
                    )
                }
            }
        }
    }

    if (uiState.isCreatingKnowledge || uiState.editingKnowledge != null) {
        KnowledgeEditorDialog(
            item = uiState.editingKnowledge,
            categories = uiState.knowledgeCategories,
            onSave = { category, key, value, source ->
                viewModel.saveKnowledge(category, key, value, source)
            },
            onDismiss = { viewModel.cancelEditingKnowledge() }
        )
    }
}

@Composable
private fun KnowledgeItemCard(
    item: KnowledgeItem,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .clickable(onClick = onEdit)
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
                Surface(
                    shape = RoundedCornerShape(4.dp),
                    color = LunaTheme.colors.accentPrimary.copy(alpha = 0.2f)
                ) {
                    Text(
                        text = item.category,
                        style = MaterialTheme.typography.labelSmall,
                        color = LunaTheme.colors.accentPrimary,
                        modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                    )
                }
                Text(
                    text = item.key,
                    style = MaterialTheme.typography.bodyLarge,
                    color = LunaTheme.colors.textPrimary,
                    fontWeight = FontWeight.Medium
                )
            }
            Row {
                IconButton(onClick = onEdit) {
                    Icon(Icons.Default.Edit, contentDescription = "Edit", tint = LunaTheme.colors.textMuted, modifier = Modifier.size(20.dp))
                }
                IconButton(onClick = onDelete) {
                    Icon(Icons.Default.Delete, contentDescription = "Delete", tint = LunaTheme.colors.error, modifier = Modifier.size(20.dp))
                }
            }
        }

        Spacer(Modifier.height(8.dp))

        Text(
            text = item.value,
            style = MaterialTheme.typography.bodyMedium,
            color = LunaTheme.colors.textSecondary,
            maxLines = 3,
            overflow = TextOverflow.Ellipsis
        )

        if (item.source != null) {
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Source: ${item.source}",
                style = MaterialTheme.typography.labelSmall,
                color = LunaTheme.colors.textMuted
            )
        }
    }
}

@Composable
private fun KnowledgeEditorDialog(
    item: KnowledgeItem?,
    categories: List<String>,
    onSave: (String, String, String, String?) -> Unit,
    onDismiss: () -> Unit
) {
    var category by remember { mutableStateOf(item?.category ?: "") }
    var key by remember { mutableStateOf(item?.key ?: "") }
    var value by remember { mutableStateOf(item?.value ?: "") }
    var source by remember { mutableStateOf(item?.source ?: "") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = LunaTheme.colors.bgSecondary,
        title = { Text(if (item != null) "Edit Knowledge" else "Add Knowledge", color = LunaTheme.colors.textPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = category,
                    onValueChange = { category = it },
                    label = { Text("Category") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = LunaTheme.colors.borderFocus,
                        unfocusedBorderColor = LunaTheme.colors.border,
                        focusedTextColor = LunaTheme.colors.textPrimary,
                        unfocusedTextColor = LunaTheme.colors.textPrimary
                    )
                )

                // Category suggestions
                if (categories.isNotEmpty() && category.isNotBlank()) {
                    val suggestions = categories.filter { it.contains(category, ignoreCase = true) }
                    if (suggestions.isNotEmpty()) {
                        LazyRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            items(suggestions.take(3)) { suggestion ->
                                SuggestionChip(
                                    onClick = { category = suggestion },
                                    label = { Text(suggestion, style = MaterialTheme.typography.labelSmall) }
                                )
                            }
                        }
                    }
                }

                OutlinedTextField(
                    value = key,
                    onValueChange = { key = it },
                    label = { Text("Key") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = LunaTheme.colors.borderFocus,
                        unfocusedBorderColor = LunaTheme.colors.border,
                        focusedTextColor = LunaTheme.colors.textPrimary,
                        unfocusedTextColor = LunaTheme.colors.textPrimary
                    )
                )

                OutlinedTextField(
                    value = value,
                    onValueChange = { value = it },
                    label = { Text("Value") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = LunaTheme.colors.borderFocus,
                        unfocusedBorderColor = LunaTheme.colors.border,
                        focusedTextColor = LunaTheme.colors.textPrimary,
                        unfocusedTextColor = LunaTheme.colors.textPrimary
                    )
                )

                OutlinedTextField(
                    value = source,
                    onValueChange = { source = it },
                    label = { Text("Source (optional)") },
                    modifier = Modifier.fillMaxWidth(),
                    singleLine = true,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = LunaTheme.colors.borderFocus,
                        unfocusedBorderColor = LunaTheme.colors.border,
                        focusedTextColor = LunaTheme.colors.textPrimary,
                        unfocusedTextColor = LunaTheme.colors.textPrimary
                    )
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onSave(category, key, value, source.ifBlank { null }) },
                enabled = category.isNotBlank() && key.isNotBlank() && value.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = LunaTheme.colors.textMuted) }
        }
    )
}
