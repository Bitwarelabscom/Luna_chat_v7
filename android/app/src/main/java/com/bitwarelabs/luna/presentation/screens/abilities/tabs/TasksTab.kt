package com.bitwarelabs.luna.presentation.screens.abilities.tabs

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.Task
import com.bitwarelabs.luna.domain.model.TaskPriority
import com.bitwarelabs.luna.domain.model.TaskStatus
import com.bitwarelabs.luna.presentation.screens.abilities.AbilitiesViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun TasksTab(viewModel: AbilitiesViewModel) {
    val uiState by viewModel.uiState.collectAsState()
    var statusFilter by remember { mutableStateOf<String?>(null) }

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "Tasks",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.SemiBold
            )
            Button(
                onClick = { viewModel.startCreatingTask() },
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)
            ) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("New")
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Filter chips
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            FilterChip(
                selected = statusFilter == null,
                onClick = { statusFilter = null; viewModel.loadTasks() },
                label = { Text("All") }
            )
            FilterChip(
                selected = statusFilter == "pending",
                onClick = { statusFilter = "pending"; viewModel.loadTasks(status = "pending") },
                label = { Text("Pending") }
            )
            FilterChip(
                selected = statusFilter == "in_progress",
                onClick = { statusFilter = "in_progress"; viewModel.loadTasks(status = "in_progress") },
                label = { Text("In Progress") }
            )
            FilterChip(
                selected = statusFilter == "completed",
                onClick = { statusFilter = "completed"; viewModel.loadTasks(status = "completed") },
                label = { Text("Completed") }
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        if (uiState.isLoadingTasks) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else if (uiState.tasks.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.CheckCircle, contentDescription = null, tint = LunaTheme.colors.textMuted, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("No tasks found", color = LunaTheme.colors.textMuted)
                }
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items(uiState.tasks, key = { it.id }) { task ->
                    TaskItem(
                        task = task,
                        onToggleStatus = { viewModel.updateTaskStatus(task.id, if (task.status == TaskStatus.COMPLETED) "pending" else "completed") },
                        onEdit = { viewModel.startEditingTask(task) },
                        onDelete = { viewModel.deleteTask(task.id) }
                    )
                }
            }
        }
    }

    if (uiState.isCreatingTask || uiState.editingTask != null) {
        TaskEditorDialog(
            task = uiState.editingTask,
            onSave = { title, desc, priority, dueDate, tags ->
                viewModel.saveTask(title, desc, priority, dueDate, tags)
            },
            onDismiss = { viewModel.cancelEditingTask() }
        )
    }
}

@Composable
private fun TaskItem(
    task: Task,
    onToggleStatus: () -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit
) {
    val isCompleted = task.status == TaskStatus.COMPLETED
    val priorityColor = when (task.priority) {
        TaskPriority.URGENT -> LunaTheme.colors.error
        TaskPriority.HIGH -> LunaTheme.colors.warning
        TaskPriority.MEDIUM -> LunaTheme.colors.accentPrimary
        TaskPriority.LOW -> LunaTheme.colors.textMuted
    }

    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .clickable(onClick = onEdit)
            .padding(12.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        // Checkbox
        Box(
            modifier = Modifier
                .size(24.dp)
                .clip(CircleShape)
                .border(2.dp, if (isCompleted) LunaTheme.colors.success else LunaTheme.colors.border, CircleShape)
                .background(if (isCompleted) LunaTheme.colors.success else LunaTheme.colors.bgTertiary)
                .clickable(onClick = onToggleStatus),
            contentAlignment = Alignment.Center
        ) {
            if (isCompleted) {
                Icon(Icons.Default.Check, contentDescription = null, tint = LunaTheme.colors.textPrimary, modifier = Modifier.size(16.dp))
            }
        }

        Spacer(Modifier.width(12.dp))

        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = task.title,
                style = MaterialTheme.typography.bodyLarge,
                color = LunaTheme.colors.textPrimary,
                textDecoration = if (isCompleted) TextDecoration.LineThrough else null,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            if (task.description != null) {
                Text(
                    text = task.description,
                    style = MaterialTheme.typography.bodySmall,
                    color = LunaTheme.colors.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
            if (task.dueDate != null || task.tags.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    task.dueDate?.let {
                        Text(
                            text = it.take(10),
                            style = MaterialTheme.typography.labelSmall,
                            color = LunaTheme.colors.textMuted
                        )
                    }
                    task.tags.take(2).forEach { tag ->
                        Text(
                            text = "#$tag",
                            style = MaterialTheme.typography.labelSmall,
                            color = LunaTheme.colors.accentPrimary
                        )
                    }
                }
            }
        }

        // Priority indicator
        Box(
            modifier = Modifier
                .size(8.dp)
                .clip(CircleShape)
                .background(priorityColor)
        )

        IconButton(onClick = onDelete) {
            Icon(Icons.Default.Delete, contentDescription = "Delete", tint = LunaTheme.colors.error)
        }
    }
}

@Composable
private fun TaskEditorDialog(
    task: Task?,
    onSave: (String, String?, String, String?, List<String>?) -> Unit,
    onDismiss: () -> Unit
) {
    var title by remember { mutableStateOf(task?.title ?: "") }
    var description by remember { mutableStateOf(task?.description ?: "") }
    var priority by remember { mutableStateOf(task?.priority?.value ?: "medium") }
    var dueDate by remember { mutableStateOf(task?.dueDate ?: "") }
    var tagsText by remember { mutableStateOf(task?.tags?.joinToString(", ") ?: "") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = LunaTheme.colors.bgSecondary,
        title = { Text(if (task != null) "Edit Task" else "New Task", color = LunaTheme.colors.textPrimary) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(
                    value = title,
                    onValueChange = { title = it },
                    label = { Text("Title") },
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
                    value = description,
                    onValueChange = { description = it },
                    label = { Text("Description") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 2,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = LunaTheme.colors.borderFocus,
                        unfocusedBorderColor = LunaTheme.colors.border,
                        focusedTextColor = LunaTheme.colors.textPrimary,
                        unfocusedTextColor = LunaTheme.colors.textPrimary
                    )
                )

                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("low" to "Low", "medium" to "Medium", "high" to "High", "urgent" to "Urgent").forEach { (value, label) ->
                        FilterChip(
                            selected = priority == value,
                            onClick = { priority = value },
                            label = { Text(label, style = MaterialTheme.typography.labelSmall) }
                        )
                    }
                }

                OutlinedTextField(
                    value = dueDate,
                    onValueChange = { dueDate = it },
                    label = { Text("Due Date (YYYY-MM-DD)") },
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
                    value = tagsText,
                    onValueChange = { tagsText = it },
                    label = { Text("Tags (comma separated)") },
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
                onClick = {
                    val tags = tagsText.split(",").map { it.trim() }.filter { it.isNotEmpty() }
                    onSave(title, description.ifBlank { null }, priority, dueDate.ifBlank { null }, tags.ifEmpty { null })
                },
                enabled = title.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)
            ) { Text("Save") }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("Cancel", color = LunaTheme.colors.textMuted) }
        }
    )
}
