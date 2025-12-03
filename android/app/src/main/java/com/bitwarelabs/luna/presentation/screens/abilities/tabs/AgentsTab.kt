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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.bitwarelabs.luna.domain.model.BuiltInAgent
import com.bitwarelabs.luna.domain.model.CustomAgent
import com.bitwarelabs.luna.presentation.screens.abilities.AbilitiesViewModel
import com.bitwarelabs.luna.presentation.theme.LunaTheme

@Composable
fun AgentsTab(viewModel: AbilitiesViewModel) {
    val uiState by viewModel.uiState.collectAsState()
    val agents = uiState.agents

    Column(modifier = Modifier.fillMaxSize().padding(16.dp)) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = "AI Agents",
                style = MaterialTheme.typography.titleMedium,
                color = LunaTheme.colors.textPrimary,
                fontWeight = FontWeight.SemiBold
            )
            Button(
                onClick = { /* TODO: Agent creation */ },
                colors = ButtonDefaults.buttonColors(containerColor = LunaTheme.colors.accentPrimary)
            ) {
                Icon(Icons.Default.Add, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(Modifier.width(4.dp))
                Text("New Agent")
            }
        }

        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = "Specialized AI agents for different tasks.",
            style = MaterialTheme.typography.bodySmall,
            color = LunaTheme.colors.textMuted
        )

        Spacer(modifier = Modifier.height(16.dp))

        if (uiState.isLoadingAgents) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = LunaTheme.colors.accentPrimary)
            }
        } else if (agents == null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text("Unable to load agents", color = LunaTheme.colors.textMuted)
            }
        } else {
            LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                // Built-in agents section
                if (agents.builtIn.isNotEmpty()) {
                    item {
                        Text(
                            text = "Built-in Agents",
                            style = MaterialTheme.typography.labelLarge,
                            color = LunaTheme.colors.textMuted,
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    }
                    items(agents.builtIn) { agent ->
                        BuiltInAgentItem(agent = agent)
                    }
                }

                // Custom agents section
                if (agents.custom.isNotEmpty()) {
                    item {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            text = "Custom Agents",
                            style = MaterialTheme.typography.labelLarge,
                            color = LunaTheme.colors.textMuted,
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    }
                    items(agents.custom, key = { it.id }) { agent ->
                        CustomAgentItem(
                            agent = agent,
                            onDelete = { viewModel.deleteAgent(agent.id) }
                        )
                    }
                }

                if (agents.builtIn.isEmpty() && agents.custom.isEmpty()) {
                    item {
                        Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Icon(Icons.Default.SmartToy, contentDescription = null, tint = LunaTheme.colors.textMuted, modifier = Modifier.size(48.dp))
                                Spacer(Modifier.height(8.dp))
                                Text("No agents available", color = LunaTheme.colors.textMuted)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun BuiltInAgentItem(agent: BuiltInAgent) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(LunaTheme.colors.bgSecondary)
            .padding(12.dp)
    ) {
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.SmartToy,
                contentDescription = null,
                tint = LunaTheme.colors.accentSecondary,
                modifier = Modifier.size(24.dp)
            )
            Column {
                Text(
                    text = agent.name,
                    style = MaterialTheme.typography.bodyLarge,
                    color = LunaTheme.colors.textPrimary,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = "Built-in",
                    style = MaterialTheme.typography.labelSmall,
                    color = LunaTheme.colors.accentSecondary
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        Text(
            text = agent.description,
            style = MaterialTheme.typography.bodyMedium,
            color = LunaTheme.colors.textSecondary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )

        if (agent.capabilities.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                agent.capabilities.take(3).forEach { cap ->
                    Surface(
                        shape = RoundedCornerShape(4.dp),
                        color = LunaTheme.colors.accentSecondary.copy(alpha = 0.2f)
                    ) {
                        Text(
                            text = cap,
                            style = MaterialTheme.typography.labelSmall,
                            color = LunaTheme.colors.accentSecondary,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun CustomAgentItem(
    agent: CustomAgent,
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
                    imageVector = Icons.Default.SmartToy,
                    contentDescription = null,
                    tint = LunaTheme.colors.accentPrimary,
                    modifier = Modifier.size(24.dp)
                )
                Column {
                    Text(
                        text = agent.name,
                        style = MaterialTheme.typography.bodyLarge,
                        color = LunaTheme.colors.textPrimary,
                        fontWeight = FontWeight.Medium
                    )
                    Text(
                        text = "Custom",
                        style = MaterialTheme.typography.labelSmall,
                        color = LunaTheme.colors.accentPrimary
                    )
                }
            }

            IconButton(onClick = onDelete) {
                Icon(Icons.Default.Delete, contentDescription = "Delete", tint = LunaTheme.colors.error)
            }
        }

        Spacer(Modifier.height(8.dp))

        Text(
            text = agent.description,
            style = MaterialTheme.typography.bodyMedium,
            color = LunaTheme.colors.textSecondary,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis
        )

        agent.model?.let { model ->
            Spacer(Modifier.height(4.dp))
            Text(
                text = "Model: $model",
                style = MaterialTheme.typography.labelSmall,
                color = LunaTheme.colors.textMuted
            )
        }

        if (agent.tools.isNotEmpty()) {
            Spacer(Modifier.height(8.dp))
            Text(
                text = "Tools: ${agent.tools.joinToString(", ")}",
                style = MaterialTheme.typography.labelSmall,
                color = LunaTheme.colors.textMuted,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }
    }
}
