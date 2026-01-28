#!/usr/bin/env python3
"""
FunctionGemma Training Data Generator for Luna Chat

Generates JSONL training data for fine-tuning FunctionGemma (270M) as Luna's tool-routing layer.
Target: 2000-5000 examples with good coverage across all tools.
"""

import json
import random
from typing import Any

# ============================================================================
# TOOL DEFINITIONS
# ============================================================================

TOOLS = {
    "research": {
        "name": "research",
        "description": "Conduct in-depth research using Claude Opus 4.5. Can search the web, analyze code, process documents, and perform data analysis.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The research question or topic to investigate thoroughly"},
                "depth": {"type": "string", "enum": ["quick", "thorough"], "description": "Research depth"},
                "save_to_file": {"type": "string", "description": "Optional filename to save results"}
            },
            "required": ["query"]
        }
    },
    "search_knowledge": {
        "name": "search_knowledge",
        "description": "Semantic search through user's knowledge base using embeddings",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Maximum results"}
            },
            "required": ["query"]
        }
    },
    "create_knowledge": {
        "name": "create_knowledge",
        "description": "Save knowledge to the user's knowledge base",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Title"},
                "content": {"type": "string", "description": "Content to save"},
                "category": {"type": "string", "description": "Category"},
                "tags": {"type": "array", "items": {"type": "string"}, "description": "Tags"}
            },
            "required": ["title", "content"]
        }
    },
    "get_user_facts": {
        "name": "get_user_facts",
        "description": "Retrieve stored facts about the user",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "create_task": {
        "name": "create_task",
        "description": "Create a new task or todo item",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Task title"},
                "description": {"type": "string", "description": "Task description"},
                "due_at": {"type": "string", "description": "Due date ISO format"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"], "description": "Priority"}
            },
            "required": ["title"]
        }
    },
    "get_tasks": {
        "name": "get_tasks",
        "description": "Get user's tasks with optional filtering",
        "parameters": {
            "type": "object",
            "properties": {
                "status": {"type": "string", "enum": ["pending", "completed"], "description": "Status filter"},
                "priority": {"type": "string", "enum": ["low", "medium", "high"], "description": "Priority filter"},
                "upcoming": {"type": "boolean", "description": "Only upcoming tasks"}
            },
            "required": []
        }
    },
    "complete_task": {
        "name": "complete_task",
        "description": "Mark a task as completed",
        "parameters": {
            "type": "object",
            "properties": {"task_id": {"type": "string", "description": "Task ID"}},
            "required": ["task_id"]
        }
    },
    "delete_task": {
        "name": "delete_task",
        "description": "Delete a task",
        "parameters": {
            "type": "object",
            "properties": {"task_id": {"type": "string", "description": "Task ID"}},
            "required": ["task_id"]
        }
    },
    "get_calendar_events": {
        "name": "get_calendar_events",
        "description": "Get upcoming calendar events",
        "parameters": {
            "type": "object",
            "properties": {
                "days_ahead": {"type": "integer", "description": "Days ahead to look"},
                "limit": {"type": "integer", "description": "Max events"}
            },
            "required": []
        }
    },
    "create_calendar_event": {
        "name": "create_calendar_event",
        "description": "Create a calendar event",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Event title"},
                "start_at": {"type": "string", "description": "Start time ISO"},
                "end_at": {"type": "string", "description": "End time ISO"},
                "location": {"type": "string", "description": "Location"}
            },
            "required": ["title", "start_at", "end_at"]
        }
    },
    "get_emails": {
        "name": "get_emails",
        "description": "Get user's emails",
        "parameters": {
            "type": "object",
            "properties": {
                "unread_only": {"type": "boolean", "description": "Only unread"},
                "limit": {"type": "integer", "description": "Max emails"}
            },
            "required": []
        }
    },
    "search_emails": {
        "name": "search_emails",
        "description": "Search emails",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Max results"}
            },
            "required": ["query"]
        }
    },
    "send_email": {
        "name": "send_email",
        "description": "Send an email",
        "parameters": {
            "type": "object",
            "properties": {
                "to": {"type": "string", "description": "Recipient"},
                "subject": {"type": "string", "description": "Subject"},
                "body": {"type": "string", "description": "Body"}
            },
            "required": ["to", "subject", "body"]
        }
    },
    "play_music": {
        "name": "play_music",
        "description": "Play music on Spotify",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query or URI"},
                "type": {"type": "string", "enum": ["track", "album", "artist", "playlist"], "description": "Content type"},
                "shuffle": {"type": "boolean", "description": "Enable shuffle"}
            },
            "required": ["query"]
        }
    },
    "pause_music": {
        "name": "pause_music",
        "description": "Pause Spotify playback",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "skip_track": {
        "name": "skip_track",
        "description": "Skip to next track",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "previous_track": {
        "name": "previous_track",
        "description": "Go to previous track",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "get_currently_playing": {
        "name": "get_currently_playing",
        "description": "Get currently playing track info",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "search_music": {
        "name": "search_music",
        "description": "Search Spotify",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Max results"}
            },
            "required": ["query"]
        }
    },
    "set_volume": {
        "name": "set_volume",
        "description": "Set Spotify volume",
        "parameters": {
            "type": "object",
            "properties": {"volume_percent": {"type": "integer", "description": "Volume 0-100"}},
            "required": ["volume_percent"]
        }
    },
    "navigate": {
        "name": "navigate",
        "description": "Navigate browser to URL",
        "parameters": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "Target URL"}},
            "required": ["url"]
        }
    },
    "screenshot": {
        "name": "screenshot",
        "description": "Take browser screenshot",
        "parameters": {
            "type": "object",
            "properties": {"full_page": {"type": "boolean", "description": "Full page capture"}},
            "required": []
        }
    },
    "click": {
        "name": "click",
        "description": "Click element by selector",
        "parameters": {
            "type": "object",
            "properties": {"selector": {"type": "string", "description": "CSS selector"}},
            "required": ["selector"]
        }
    },
    "fill": {
        "name": "fill",
        "description": "Fill form input",
        "parameters": {
            "type": "object",
            "properties": {
                "selector": {"type": "string", "description": "CSS selector"},
                "text": {"type": "string", "description": "Text to fill"}
            },
            "required": ["selector", "text"]
        }
    },
    "get_page_content": {
        "name": "get_page_content",
        "description": "Get page content",
        "parameters": {
            "type": "object",
            "properties": {"url": {"type": "string", "description": "URL"}},
            "required": ["url"]
        }
    },
    "execute_python": {
        "name": "execute_python",
        "description": "Execute Python code",
        "parameters": {
            "type": "object",
            "properties": {"code": {"type": "string", "description": "Python code"}},
            "required": ["code"]
        }
    },
    "execute_javascript": {
        "name": "execute_javascript",
        "description": "Execute JavaScript code",
        "parameters": {
            "type": "object",
            "properties": {"code": {"type": "string", "description": "JavaScript code"}},
            "required": ["code"]
        }
    },
    "create_reminder": {
        "name": "create_reminder",
        "description": "Create a reminder",
        "parameters": {
            "type": "object",
            "properties": {
                "message": {"type": "string", "description": "Reminder message"},
                "delay_minutes": {"type": "integer", "description": "Minutes until reminder"}
            },
            "required": ["message", "delay_minutes"]
        }
    },
    "list_reminders": {
        "name": "list_reminders",
        "description": "Get pending reminders",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "write_file": {
        "name": "write_file",
        "description": "Write file to workspace",
        "parameters": {
            "type": "object",
            "properties": {
                "filename": {"type": "string", "description": "Filename"},
                "content": {"type": "string", "description": "Content"}
            },
            "required": ["filename", "content"]
        }
    },
    "read_file": {
        "name": "read_file",
        "description": "Read file from workspace",
        "parameters": {
            "type": "object",
            "properties": {"filename": {"type": "string", "description": "Filename"}},
            "required": ["filename"]
        }
    },
    "list_files": {
        "name": "list_files",
        "description": "List workspace files",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "delete_file": {
        "name": "delete_file",
        "description": "Delete workspace file",
        "parameters": {
            "type": "object",
            "properties": {"filename": {"type": "string", "description": "Filename"}},
            "required": ["filename"]
        }
    },
    "generate_image": {
        "name": "generate_image",
        "description": "Generate image using AI",
        "parameters": {
            "type": "object",
            "properties": {"prompt": {"type": "string", "description": "Image prompt"}},
            "required": ["prompt"]
        }
    },
    "search_youtube": {
        "name": "search_youtube",
        "description": "Search YouTube videos",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Max results"}
            },
            "required": ["query"]
        }
    },
    "system_cpu_usage": {
        "name": "system_cpu_usage",
        "description": "Get CPU usage",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "system_memory": {
        "name": "system_memory",
        "description": "Get memory usage",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "system_disk": {
        "name": "system_disk",
        "description": "Get disk usage",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "system_uptime": {
        "name": "system_uptime",
        "description": "Get system uptime",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "system_load": {
        "name": "system_load",
        "description": "Get system load",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "docker_containers": {
        "name": "docker_containers",
        "description": "Get Docker containers",
        "parameters": {
            "type": "object",
            "properties": {"only_running": {"type": "boolean", "description": "Only running"}},
            "required": []
        }
    },
    "docker_logs": {
        "name": "docker_logs",
        "description": "Get Docker container logs",
        "parameters": {
            "type": "object",
            "properties": {
                "container_id": {"type": "string", "description": "Container ID"},
                "lines": {"type": "integer", "description": "Log lines"}
            },
            "required": ["container_id"]
        }
    },
    "docker_stats": {
        "name": "docker_stats",
        "description": "Get Docker container stats",
        "parameters": {
            "type": "object",
            "properties": {"container_id": {"type": "string", "description": "Container ID"}},
            "required": ["container_id"]
        }
    },
    "analyze_mood": {
        "name": "analyze_mood",
        "description": "Analyze mood in text",
        "parameters": {
            "type": "object",
            "properties": {"message": {"type": "string", "description": "Text to analyze"}},
            "required": ["message"]
        }
    },
    "get_mood_history": {
        "name": "get_mood_history",
        "description": "Get mood history",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "search_documents": {
        "name": "search_documents",
        "description": "Search uploaded documents",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "Search query"},
                "limit": {"type": "integer", "description": "Max results"}
            },
            "required": ["query"]
        }
    },
    "get_documents": {
        "name": "get_documents",
        "description": "List uploaded documents",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "generate_background": {
        "name": "generate_background",
        "description": "Generate desktop background",
        "parameters": {
            "type": "object",
            "properties": {
                "prompt": {"type": "string", "description": "Background description"},
                "style": {"type": "string", "enum": ["abstract", "nature", "artistic"], "description": "Style"}
            },
            "required": ["prompt"]
        }
    },
    "get_backgrounds": {
        "name": "get_backgrounds",
        "description": "Get saved backgrounds",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "create_project": {
        "name": "create_project",
        "description": "Create a project",
        "parameters": {
            "type": "object",
            "properties": {
                "name": {"type": "string", "description": "Project name"},
                "type": {"type": "string", "description": "Project type"},
                "description": {"type": "string", "description": "Description"}
            },
            "required": ["name", "type"]
        }
    },
    "get_projects": {
        "name": "get_projects",
        "description": "Get user's projects",
        "parameters": {"type": "object", "properties": {}, "required": []}
    },
    "analyze_image": {
        "name": "analyze_image",
        "description": "Analyze an image",
        "parameters": {
            "type": "object",
            "properties": {
                "image_url": {"type": "string", "description": "Image URL"},
                "prompt": {"type": "string", "description": "Analysis prompt"}
            },
            "required": ["image_url"]
        }
    },
}


def make_example(user_msg: str, tool_name: str, args: dict, tools: list[dict], thinking: str) -> dict:
    return {
        "messages": [
            {"role": "developer", "content": "You are a model that can do function calling with the following functions"},
            {"role": "user", "content": user_msg},
            {"role": "assistant", "content": f"<think>{thinking}</think>",
             "tool_calls": [{"type": "function", "function": {"name": tool_name, "arguments": args}}]}
        ],
        "tools": tools
    }


def make_no_tool(user_msg: str, response: str, tools: list[dict]) -> dict:
    return {
        "messages": [
            {"role": "developer", "content": "You are a model that can do function calling with the following functions"},
            {"role": "user", "content": user_msg},
            {"role": "assistant", "content": response}
        ],
        "tools": tools
    }


def make_multi_tool(user_msg: str, calls: list[tuple[str, dict]], tools: list[dict], thinking: str) -> dict:
    return {
        "messages": [
            {"role": "developer", "content": "You are a model that can do function calling with the following functions"},
            {"role": "user", "content": user_msg},
            {"role": "assistant", "content": f"<think>{thinking}</think>",
             "tool_calls": [{"type": "function", "function": {"name": n, "arguments": a}} for n, a in calls]}
        ],
        "tools": tools
    }


def vary_message(msg: str) -> list[str]:
    """Generate variations of a message"""
    variations = [msg]
    lower = msg.lower()

    prefixes = ["", "hey ", "hi ", "luna ", "hey luna ", "yo ", "um ", "ok ", "please "]
    suffixes = ["", " please", " pls", " plz", " thanks", " thx", " ty"]

    for p in random.sample(prefixes, 3):
        for s in random.sample(suffixes, 2):
            v = p + lower + s
            if v != msg and v not in variations:
                variations.append(v.strip())

    return variations[:5]


# ============================================================================
# GENERATORS
# ============================================================================

def gen_research() -> list[dict]:
    examples = []
    tools = [TOOLS["research"], TOOLS["search_knowledge"]]

    topics = [
        "quantum computing", "SpaceX Starship", "climate change", "Python async", "machine learning",
        "AI regulation", "James Webb telescope", "mRNA vaccines", "Internet history", "dark matter",
        "blockchain", "React best practices", "cryptocurrency", "healthy eating", "space exploration",
        "renewable energy", "neural networks", "web3", "rust programming", "kubernetes",
        "CRISPR", "electric vehicles", "5G networks", "cybersecurity", "quantum cryptography",
        "AGI", "fusion energy", "Mars colonization", "brain computer interface", "NVIDIA AI",
        "transformers architecture", "GPT models", "diffusion models", "reinforcement learning",
        "LLM fine-tuning", "RAG systems", "vector databases", "prompt engineering", "AI safety",
        "autonomous vehicles", "drone technology", "robotics", "IoT security", "edge computing",
        "microservices", "serverless", "GraphQL", "WebAssembly", "progressive web apps",
    ]

    patterns = [
        "Research {t}", "Look up {t}", "Research {t} for me", "Tell me about {t}",
        "What do we know about {t}?", "Find out about {t}", "Investigate {t}",
        "I'm curious about {t}", "Deep dive into {t}", "What's the latest on {t}?",
        "research {t}", "look into {t}", "whats going on with {t}", "info on {t}",
    ]

    for topic in topics:
        for pattern in random.sample(patterns, 4):
            user_msg = pattern.format(t=topic)
            query = f"{topic} latest developments"
            depth = random.choice(["quick", "thorough"])
            args = {"query": query}
            if depth == "thorough":
                args["depth"] = depth
            thinking = f"User wants research on {topic}. Using research tool."
            examples.append(make_example(user_msg, "research", args, tools, thinking))

            for var in vary_message(user_msg)[:2]:
                if var != user_msg:
                    examples.append(make_example(var, "research", args, tools, thinking))

    return examples


def gen_knowledge() -> list[dict]:
    examples = []
    tools = [TOOLS["search_knowledge"], TOOLS["create_knowledge"], TOOLS["get_user_facts"]]

    search_terms = [
        "Python", "Luna project", "databases", "transformers", "consciousness", "API endpoints",
        "training", "agent architecture", "memory", "embeddings", "Docker", "security",
        "async", "vector databases", "OpenAI API", "React hooks", "TypeScript", "testing",
        "deployment", "monitoring", "authentication", "caching", "performance", "debugging",
        "logging", "error handling", "git workflow", "code review", "refactoring", "design patterns",
    ]

    patterns = [
        "Search my notes for {t}", "Find {t} in my knowledge", "What did I write about {t}?",
        "Do I have notes on {t}?", "Look up {t} notes", "Search for {t}",
        "find {t} stuff", "search knowledge for {t}", "check my notes about {t}",
        "anything about {t}?", "{t} notes", "look for {t}",
    ]

    for term in search_terms:
        for pattern in random.sample(patterns, 3):
            user_msg = pattern.format(t=term)
            thinking = f"User wants to search knowledge for: {term}"
            examples.append(make_example(user_msg, "search_knowledge", {"query": term}, tools, thinking))

            for var in vary_message(user_msg)[:2]:
                examples.append(make_example(var, "search_knowledge", {"query": term}, tools, thinking))

    # Create knowledge
    creates = [
        ("Save this: {c}", "Saved Note", "{c}", "notes"),
        ("Remember that {c}", "Reminder", "{c}", "reminders"),
        ("Note: {c}", "Note", "{c}", "notes"),
    ]
    contents = [
        "Python list comprehensions are faster", "API key expires March 15",
        "Server IP is 192.168.1.100", "React hooks at top level",
        "TypeScript strict mode always", "Redis port 6379",
        "JWT tokens expire 15 minutes", "Use semantic versioning",
        "Always handle errors properly", "Cache frequently accessed data",
    ]

    for pattern, title, _, cat in creates:
        for content in contents[:5]:
            user_msg = pattern.format(c=content)
            thinking = f"User wants to save knowledge."
            examples.append(make_example(user_msg, "create_knowledge",
                {"title": title, "content": content, "category": cat}, tools, thinking))

    # Get facts
    fact_queries = [
        "What do you know about me?", "Show my preferences", "My profile",
        "What have you learned about me?", "my facts", "user facts",
    ]
    for q in fact_queries:
        examples.append(make_example(q, "get_user_facts", {}, tools, "User wants their facts."))

    return examples


def gen_tasks() -> list[dict]:
    examples = []
    tools = [TOOLS["create_task"], TOOLS["get_tasks"], TOOLS["complete_task"], TOOLS["delete_task"]]

    tasks = [
        ("review the code", "Review code", None, None),
        ("finish the report", "Finish report", "Complete report", "high"),
        ("call mom", "Call mom", None, None),
        ("deploy to production", "Deploy", "Deploy to prod", "high"),
        ("buy groceries", "Buy groceries", None, "low"),
        ("update documentation", "Update docs", None, "medium"),
        ("fix the login bug", "Fix login bug", "Fix auth issue", "high"),
        ("send invoice", "Send invoice", None, "medium"),
        ("review PRs", "Review PRs", "Review pull requests", "medium"),
        ("clean up database", "Clean DB", "Remove old entries", "low"),
        ("write unit tests", "Write tests", "Add unit tests", "medium"),
        ("backup server", "Backup server", None, "high"),
        ("update dependencies", "Update deps", "Update npm packages", "medium"),
        ("schedule meeting", "Schedule meeting", None, "low"),
        ("prepare presentation", "Prepare presentation", "Create slides", "high"),
        ("respond to emails", "Respond emails", None, "medium"),
        ("refactor auth module", "Refactor auth", "Improve auth code", "medium"),
        ("set up monitoring", "Setup monitoring", "Configure alerts", "high"),
        ("document API", "Document API", "Write API docs", "medium"),
        ("run performance tests", "Perf tests", "Run load tests", "high"),
        ("fix broken tests", "Fix tests", "Debug failing tests", "high"),
        ("optimize queries", "Optimize queries", "Improve DB queries", "medium"),
        ("review security", "Security review", "Check vulnerabilities", "high"),
        ("update README", "Update README", None, "low"),
        ("merge branches", "Merge branches", "Merge feature to main", "medium"),
    ]

    create_patterns = [
        "Add a task to {t}", "Create a todo: {t}", "Remind me to {t}", "Task: {t}",
        "I need to {t}", "todo: {t}", "add task {t}", "new task: {t}",
        "remember to {t}", "add to my list: {t}", "make a task {t}",
    ]

    for task_desc, title, desc, priority in tasks:
        for pattern in random.sample(create_patterns, 4):
            user_msg = pattern.format(t=task_desc)
            args = {"title": title}
            if desc:
                args["description"] = desc
            if priority:
                args["priority"] = priority
            thinking = f"User wants to create task: {title}"
            examples.append(make_example(user_msg, "create_task", args, tools, thinking))

            for var in vary_message(user_msg)[:2]:
                examples.append(make_example(var, "create_task", args, tools, thinking))

    # Get tasks
    get_patterns = [
        ("What are my tasks?", {}),
        ("Show my todo list", {}),
        ("What do I need to do?", {}),
        ("Show pending tasks", {"status": "pending"}),
        ("What have I completed?", {"status": "completed"}),
        ("High priority tasks", {"priority": "high"}),
        ("What's coming up?", {"upcoming": True}),
        ("list my todos", {}),
        ("my task list", {}),
        ("tasks please", {}),
        ("pending items", {"status": "pending"}),
        ("medium priority", {"priority": "medium"}),
        ("low priority stuff", {"priority": "low"}),
    ]

    for user_msg, args in get_patterns:
        examples.append(make_example(user_msg, "get_tasks", args, tools, "User wants their tasks."))
        for var in vary_message(user_msg)[:3]:
            examples.append(make_example(var, "get_tasks", args, tools, "User wants their tasks."))

    return examples


def gen_calendar() -> list[dict]:
    examples = []
    tools = [TOOLS["get_calendar_events"], TOOLS["create_calendar_event"]]

    get_patterns = [
        ("What's on my calendar?", {}),
        ("Show my schedule", {}),
        ("Any meetings today?", {"days_ahead": 1}),
        ("What's coming up this week?", {"days_ahead": 7}),
        ("Calendar for tomorrow", {"days_ahead": 2}),
        ("do i have appointments", {}),
        ("whats my schedule", {}),
        ("events this month", {"days_ahead": 30}),
        ("upcoming meetings", {"days_ahead": 7}),
        ("calendar please", {}),
        ("my schedule today", {"days_ahead": 1}),
        ("meetings today", {"days_ahead": 1}),
        ("schedule this week", {"days_ahead": 7}),
        ("any events", {}),
        ("check calendar", {}),
    ]

    for user_msg, args in get_patterns:
        examples.append(make_example(user_msg, "get_calendar_events", args, tools, "User wants calendar."))
        for var in vary_message(user_msg)[:3]:
            examples.append(make_example(var, "get_calendar_events", args, tools, "User wants calendar."))

    # Create events
    events = [
        "meeting with Henke", "dentist appointment", "lunch with Sarah", "team standup",
        "client call", "doctor appointment", "interview", "team lunch", "1:1 with manager",
        "project review", "demo presentation", "training session", "planning meeting",
    ]

    for event in events:
        patterns = [
            f"Schedule {event} tomorrow at 2pm",
            f"Add {event} on Friday at 10am",
            f"Book {event} next Monday noon",
            f"create event {event} at 3pm",
        ]
        for user_msg in patterns:
            args = {"title": event.title(), "start_at": "2024-01-16T14:00:00", "end_at": "2024-01-16T15:00:00"}
            thinking = f"User wants to create event: {event}"
            examples.append(make_example(user_msg, "create_calendar_event", args, tools, thinking))

    return examples


def gen_email() -> list[dict]:
    examples = []
    tools = [TOOLS["get_emails"], TOOLS["search_emails"], TOOLS["send_email"]]

    get_patterns = [
        ("Check my email", {}),
        ("Any new emails?", {"unread_only": True}),
        ("Show my inbox", {}),
        ("Unread messages?", {"unread_only": True}),
        ("show emails", {}),
        ("check mail", {"unread_only": True}),
        ("any messages?", {}),
        ("inbox please", {}),
        ("email inbox", {}),
        ("new mail?", {"unread_only": True}),
    ]

    for user_msg, args in get_patterns:
        examples.append(make_example(user_msg, "get_emails", args, tools, "User wants emails."))
        for var in vary_message(user_msg)[:3]:
            examples.append(make_example(var, "get_emails", args, tools, "User wants emails."))

    # Search
    searches = ["Henke", "project", "invoice", "meeting", "contract", "deployment",
                "Amazon", "shipping", "password reset", "order", "receipt", "support"]

    for term in searches:
        patterns = [f"Find emails from {term}", f"Search for {term} emails",
                    f"emails about {term}", f"search email {term}"]
        for pattern in patterns:
            examples.append(make_example(pattern, "search_emails", {"query": term}, tools, f"Search emails: {term}"))

    # Send
    sends = [
        ("henke@example.com", "Report Ready", "The report is ready."),
        ("sarah@company.com", "Meeting", "Reminder about meeting."),
        ("support@vendor.com", "Order", "Order status inquiry."),
        ("team@company.com", "Deadline", "Reminder: deadline Friday."),
    ]

    for to, subj, body in sends:
        user_msg = f"Send email to {to} about {subj.lower()}"
        examples.append(make_example(user_msg, "send_email",
            {"to": to, "subject": subj, "body": body}, tools, f"Send email to {to}"))

    return examples


def gen_music() -> list[dict]:
    examples = []
    tools = [TOOLS["play_music"], TOOLS["pause_music"], TOOLS["skip_track"],
             TOOLS["previous_track"], TOOLS["get_currently_playing"], TOOLS["search_music"], TOOLS["set_volume"]]

    items = [
        ("jazz", "playlist"), ("Bohemian Rhapsody", "track"), ("Taylor Swift", "artist"),
        ("Abbey Road", "album"), ("lo-fi beats", "playlist"), ("chill", "playlist"),
        ("Beethoven", "artist"), ("workout", "playlist"), ("classical", "playlist"),
        ("relaxing music", "playlist"), ("Daft Punk", "artist"), ("rock", "playlist"),
        ("hip hop", "playlist"), ("EDM", "playlist"), ("pop hits", "playlist"),
        ("80s music", "playlist"), ("country", "playlist"), ("indie", "playlist"),
        ("metal", "playlist"), ("R&B", "playlist"), ("Blinding Lights", "track"),
        ("Hotel California", "track"), ("Stairway to Heaven", "track"), ("Drake", "artist"),
        ("The Beatles", "artist"), ("Coldplay", "artist"), ("Pink Floyd", "artist"),
        ("Eminem", "artist"), ("Dark Side of the Moon", "album"), ("Thriller", "album"),
        ("focus music", "playlist"), ("study music", "playlist"), ("party music", "playlist"),
        ("ambient", "playlist"), ("acoustic", "playlist"), ("piano music", "playlist"),
    ]

    patterns = ["Play {i}", "Put on {i}", "play {i}", "i want to listen to {i}",
                "play me {i}", "lets hear {i}", "queue up {i}", "start {i}"]

    for item, typ in items:
        for pattern in random.sample(patterns, 3):
            user_msg = pattern.format(i=item)
            args = {"query": item, "type": typ}
            if random.random() > 0.8:
                args["shuffle"] = True
            thinking = f"Play music: {item}"
            examples.append(make_example(user_msg, "play_music", args, tools, thinking))

            for var in vary_message(user_msg)[:2]:
                examples.append(make_example(var, "play_music", args, tools, thinking))

    # Pause
    for msg in ["Pause", "Stop", "pause music", "stop playing", "hold on", "pause the music"]:
        examples.append(make_example(msg, "pause_music", {}, tools, "Pause music."))

    # Skip
    for msg in ["Skip", "Next", "skip track", "next song", "skip this", "play next"]:
        examples.append(make_example(msg, "skip_track", {}, tools, "Skip track."))

    # Previous
    for msg in ["Previous", "Go back", "last song", "previous track", "replay last"]:
        examples.append(make_example(msg, "previous_track", {}, tools, "Previous track."))

    # Currently playing
    for msg in ["What's playing?", "What song is this?", "current track", "now playing", "what am i listening to"]:
        examples.append(make_example(msg, "get_currently_playing", {}, tools, "Get current track."))

    # Volume
    volumes = [(70, "Turn up"), (30, "Turn down"), (50, "Set to 50"), (80, "Louder"),
               (25, "Quieter"), (100, "Max"), (0, "Mute")]
    for vol, prefix in volumes:
        msg = f"{prefix} the volume"
        examples.append(make_example(msg, "set_volume", {"volume_percent": vol}, tools, f"Set volume to {vol}."))

    return examples


def gen_code() -> list[dict]:
    examples = []
    tools = [TOOLS["execute_python"], TOOLS["execute_javascript"]]

    python_examples = [
        ("Calculate 2+2", "print(2 + 2)"),
        ("print hello", "print('hello')"),
        ("Fibonacci sequence", "def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        print(a)\n        a, b = b, a + b\nfib(10)"),
        ("Factorial of 5", "import math\nprint(math.factorial(5))"),
        ("Sort a list", "nums = [3, 1, 4, 1, 5]\nprint(sorted(nums))"),
        ("100 divided by 7", "print(100 / 7)"),
        ("Random number", "import random\nprint(random.randint(1, 100))"),
        ("Current date", "from datetime import datetime\nprint(datetime.now())"),
        ("List comprehension", "print([x**2 for x in range(10)])"),
        ("String reverse", "print('hello'[::-1])"),
        ("Is 17 prime", "print(all(17 % i != 0 for i in range(2, int(17**0.5)+1)))"),
        ("Sum of 1-5", "print(sum([1,2,3,4,5]))"),
        ("Max in list", "print(max([3, 7, 2, 9]))"),
        ("Celsius to Fahrenheit 25C", "print(25 * 9/5 + 32)"),
    ]

    for desc, code in python_examples:
        patterns = [f"Python: {desc}", f"Calculate {desc} in Python", f"run python {desc}",
                    f"execute python: {desc}", f"python code: {desc}"]
        for pattern in patterns:
            examples.append(make_example(pattern, "execute_python", {"code": code}, tools, "Execute Python."))

    js_examples = [
        ("console.log hi", "console.log('hi')"),
        ("Reverse string", "console.log('hello'.split('').reverse().join(''))"),
        ("Array sum", "console.log([1,2,3,4,5].reduce((a,b)=>a+b,0))"),
        ("Current timestamp", "console.log(Date.now())"),
    ]

    for desc, code in js_examples:
        patterns = [f"JavaScript: {desc}", f"Run JS: {desc}", f"execute javascript {desc}"]
        for pattern in patterns:
            examples.append(make_example(pattern, "execute_javascript", {"code": code}, tools, "Execute JavaScript."))

    return examples


def gen_reminders() -> list[dict]:
    examples = []
    tools = [TOOLS["create_reminder"], TOOLS["list_reminders"]]

    reminders = [
        ("take a break", 30), ("check the oven", 60), ("call Henke", 15), ("Timer", 5),
        ("review PR", 120), ("team meeting", 45), ("stretch", 10), ("pick up laundry", 180),
        ("the call", 20), ("lunch", 90), ("drink water", 30), ("take medicine", 240),
        ("check email", 60), ("stand up", 25), ("save work", 30),
    ]

    patterns = ["Remind me to {m} in {t} minutes", "Set reminder {t} min: {m}",
                "reminder in {t} mins {m}", "remind me in {t} minutes to {m}"]

    for msg, mins in reminders:
        for pattern in patterns:
            user_msg = pattern.format(m=msg, t=mins)
            thinking = f"Create reminder in {mins} minutes."
            examples.append(make_example(user_msg, "create_reminder",
                {"message": msg, "delay_minutes": mins}, tools, thinking))

    # List
    for msg in ["Show reminders", "My reminders", "list reminders", "pending reminders"]:
        examples.append(make_example(msg, "list_reminders", {}, tools, "List reminders."))

    return examples


def gen_files() -> list[dict]:
    examples = []
    tools = [TOOLS["write_file"], TOOLS["read_file"], TOOLS["list_files"], TOOLS["delete_file"]]

    # Write
    writes = [
        ("main.py", "print('hello')"), ("notes.txt", "Meeting notes"),
        ("config.json", '{"debug": true}'), ("greeting.txt", "hello world"),
        ("script.py", "import os"), ("data.csv", "name,age"),
        ("README.md", "# Project"), (".env", "DEBUG=true"),
    ]

    for filename, content in writes:
        patterns = [f"Save to {filename}: {content}", f"Create {filename} with {content}",
                    f"write to {filename}", f"save {content} to {filename}"]
        for pattern in patterns:
            thinking = f"Write file: {filename}"
            examples.append(make_example(pattern, "write_file",
                {"filename": filename, "content": content}, tools, thinking))

    # Read
    files = ["main.py", "notes.txt", "config.json", "readme.md", "log.txt",
             "data.csv", "script.py", "settings.json", ".env", "package.json"]

    for f in files:
        patterns = [f"Read {f}", f"Show {f}", f"What's in {f}?", f"open {f}", f"cat {f}"]
        for pattern in patterns:
            examples.append(make_example(pattern, "read_file", {"filename": f}, tools, f"Read file: {f}"))

    # List
    for msg in ["Show files", "List files", "my files", "workspace files", "ls"]:
        examples.append(make_example(msg, "list_files", {}, tools, "List files."))

    # Delete
    for f in ["old.txt", "temp.log", "backup.sql"]:
        examples.append(make_example(f"Delete {f}", "delete_file", {"filename": f}, tools, f"Delete: {f}"))

    return examples


def gen_images() -> list[dict]:
    examples = []
    tools = [TOOLS["generate_image"]]

    prompts = [
        ("sunset over mountains", "Beautiful sunset over mountain peaks"),
        ("cute cat", "Adorable fluffy cat with big eyes"),
        ("futuristic city", "Cyberpunk city at night with neon lights"),
        ("robot", "Friendly humanoid robot"),
        ("space scene", "Deep space with colorful nebulas"),
        ("abstract art", "Abstract modern art"),
        ("forest", "Mystical forest with sunlight"),
        ("dragon", "Majestic dragon breathing fire"),
        ("beach", "Tropical beach with palm trees"),
        ("castle", "Medieval castle at sunset"),
        ("winter scene", "Snowy mountain cabin"),
        ("aurora borealis", "Northern lights over frozen lake"),
        ("steampunk", "Steampunk airship"),
        ("garden", "Japanese zen garden"),
        ("coffee shop", "Cozy coffee shop interior"),
        ("spaceship", "Futuristic spaceship"),
        ("waterfall", "Majestic waterfall in jungle"),
        ("underwater", "Colorful coral reef"),
        ("city skyline", "City skyline at night"),
        ("landscape", "Rolling hills at golden hour"),
    ]

    patterns = ["Generate image of {s}", "Create picture of {s}", "Make {s}",
                "Draw {s}", "generate {s}", "picture of {s}", "image of {s}"]

    for subject, prompt in prompts:
        for pattern in patterns:
            user_msg = pattern.format(s=subject)
            examples.append(make_example(user_msg, "generate_image", {"prompt": prompt}, tools, "Generate image."))

    return examples


def gen_youtube() -> list[dict]:
    examples = []
    tools = [TOOLS["search_youtube"]]

    searches = [
        "Python tutorials", "machine learning", "cooking recipes", "guitar lessons",
        "workout routines", "React tutorial", "funny cats", "space documentary",
        "music videos", "ted talks", "how to tie a tie", "gaming highlights",
        "photography tips", "meditation", "tech unboxing", "learn Spanish",
        "science experiments", "travel vlogs", "DIY projects", "coding tutorials",
    ]

    patterns = ["Search YouTube for {s}", "Find {s} videos", "youtube {s}",
                "look up {s} on youtube", "youtube search {s}"]

    for search in searches:
        for pattern in patterns:
            user_msg = pattern.format(s=search)
            examples.append(make_example(user_msg, "search_youtube", {"query": search}, tools, f"YouTube search: {search}"))

    return examples


def gen_system() -> list[dict]:
    examples = []
    tools = [TOOLS["system_cpu_usage"], TOOLS["system_memory"], TOOLS["system_disk"],
             TOOLS["system_uptime"], TOOLS["system_load"], TOOLS["docker_containers"],
             TOOLS["docker_logs"], TOOLS["docker_stats"]]

    # CPU
    for msg in ["CPU usage", "Check CPU", "cpu stats", "processor usage", "how much cpu"]:
        examples.append(make_example(msg, "system_cpu_usage", {}, tools, "Check CPU."))

    # Memory
    for msg in ["Memory usage", "Check RAM", "memory stats", "how much memory", "ram usage"]:
        examples.append(make_example(msg, "system_memory", {}, tools, "Check memory."))

    # Disk
    for msg in ["Disk space", "Check storage", "disk usage", "how much disk", "storage left"]:
        examples.append(make_example(msg, "system_disk", {}, tools, "Check disk."))

    # Uptime
    for msg in ["Uptime", "How long running", "system uptime", "server uptime"]:
        examples.append(make_example(msg, "system_uptime", {}, tools, "Check uptime."))

    # Load
    for msg in ["System load", "Load average", "server load", "check load"]:
        examples.append(make_example(msg, "system_load", {}, tools, "Check load."))

    # Docker
    for msg in ["Docker containers", "Running containers", "docker ps", "container status"]:
        examples.append(make_example(msg, "docker_containers", {"only_running": True}, tools, "Docker containers."))

    # Docker logs
    containers = ["luna-api", "redis", "postgres", "nginx", "memorycore", "frontend"]
    for c in containers:
        for msg in [f"Logs for {c}", f"docker logs {c}", f"{c} logs"]:
            examples.append(make_example(msg, "docker_logs", {"container_id": c}, tools, f"Logs: {c}"))

    # Docker stats
    for c in containers[:3]:
        examples.append(make_example(f"Stats for {c}", "docker_stats", {"container_id": c}, tools, f"Stats: {c}"))

    return examples


def gen_browser() -> list[dict]:
    examples = []
    tools = [TOOLS["navigate"], TOOLS["screenshot"], TOOLS["click"], TOOLS["fill"], TOOLS["get_page_content"]]

    sites = [
        ("google.com", "https://google.com"), ("github.com", "https://github.com"),
        ("reddit", "https://reddit.com"), ("example.com", "https://example.com"),
        ("anthropic.com", "https://anthropic.com"), ("stackoverflow", "https://stackoverflow.com"),
        ("twitter", "https://twitter.com"), ("youtube", "https://youtube.com"),
        ("wikipedia", "https://wikipedia.org"), ("amazon", "https://amazon.com"),
    ]

    patterns = ["Go to {s}", "Open {s}", "Navigate to {s}", "browse {s}", "visit {s}"]

    for site, url in sites:
        for pattern in patterns:
            user_msg = pattern.format(s=site)
            examples.append(make_example(user_msg, "navigate", {"url": url}, tools, f"Navigate to {url}"))

    # Screenshot
    for msg in ["Screenshot", "Capture page", "take screenshot", "grab screenshot"]:
        examples.append(make_example(msg, "screenshot", {}, tools, "Take screenshot."))
        examples.append(make_example(msg + " full page", "screenshot", {"full_page": True}, tools, "Full page screenshot."))

    # Click
    clicks = [("submit button", "button[type='submit']"), ("login link", "a.login"),
              ("Sign In", "button:contains('Sign In')")]
    for desc, sel in clicks:
        examples.append(make_example(f"Click {desc}", "click", {"selector": sel}, tools, "Click element."))

    # Fill
    fills = [("search box", "input[type='search']", "hello"),
             ("email field", "input[name='email']", "user@example.com")]
    for desc, sel, text in fills:
        examples.append(make_example(f"Type {text} in {desc}", "fill",
            {"selector": sel, "text": text}, tools, "Fill form."))

    return examples


def gen_documents() -> list[dict]:
    examples = []
    tools = [TOOLS["search_documents"], TOOLS["get_documents"]]

    searches = ["project specs", "contract", "API docs", "meeting notes", "invoice",
                "budget", "report", "presentation", "proposal", "design", "requirements"]

    for term in searches:
        patterns = [f"Search docs for {term}", f"Find {term} in documents",
                    f"search documents {term}", f"look for {term}"]
        for pattern in patterns:
            examples.append(make_example(pattern, "search_documents", {"query": term}, tools, f"Search docs: {term}"))

    for msg in ["Show documents", "My documents", "list uploads", "uploaded files"]:
        examples.append(make_example(msg, "get_documents", {}, tools, "List documents."))

    return examples


def gen_mood() -> list[dict]:
    examples = []
    tools = [TOOLS["analyze_mood"], TOOLS["get_mood_history"]]

    texts = [
        "I'm feeling stressed about work",
        "This is the best day ever!",
        "I'm so frustrated",
        "feeling great today",
        "worried about tomorrow",
        "excited about the project",
        "tired but happy",
    ]

    for text in texts:
        patterns = [f"Analyze: {text}", f"How does this sound: {text}",
                    f"Sentiment of: {text}", f"mood of: {text}"]
        for pattern in patterns:
            examples.append(make_example(pattern, "analyze_mood", {"message": text}, tools, "Analyze mood."))

    for msg in ["Mood history", "How have I been feeling?", "mood trends", "my moods"]:
        examples.append(make_example(msg, "get_mood_history", {}, tools, "Mood history."))

    return examples


def gen_background() -> list[dict]:
    examples = []
    tools = [TOOLS["generate_background"], TOOLS["get_backgrounds"]]

    bgs = [
        ("mountains", "Mountain landscape", "nature"),
        ("abstract", "Abstract flowing shapes", "abstract"),
        ("space", "Deep space nebulas", "artistic"),
        ("forest", "Mystical forest", "nature"),
        ("minimalist", "Clean minimalist design", "abstract"),
        ("ocean", "Calm ocean waves", "nature"),
        ("city skyline", "City at night", "artistic"),
        ("geometric", "Geometric patterns", "abstract"),
        ("sunset", "Beautiful sunset", "nature"),
        ("aurora", "Northern lights", "nature"),
    ]

    for desc, prompt, style in bgs:
        patterns = [f"Generate background with {desc}", f"Create {desc} wallpaper",
                    f"make {desc} background", f"generate {desc}"]
        for pattern in patterns:
            examples.append(make_example(pattern, "generate_background",
                {"prompt": prompt, "style": style}, tools, "Generate background."))

    for msg in ["Show backgrounds", "My wallpapers", "background list"]:
        examples.append(make_example(msg, "get_backgrounds", {}, tools, "List backgrounds."))

    return examples


def gen_projects() -> list[dict]:
    examples = []
    tools = [TOOLS["create_project"], TOOLS["get_projects"]]

    projects = [
        ("Website Redesign", "web", "Redesign company website"),
        ("API Migration", "development", "Migrate to new API"),
        ("Mobile App", "mobile", "Develop mobile app"),
        ("Data Pipeline", "data", "Build ETL pipeline"),
        ("Security Audit", "security", "Security review"),
        ("Performance Optimization", "optimization", "Improve performance"),
        ("Documentation", "docs", "Update documentation"),
        ("Testing Framework", "testing", "Implement tests"),
    ]

    for name, typ, desc in projects:
        patterns = [f"Create project {name}", f"New project: {name}",
                    f"Start project {name}", f"create {name} project"]
        for pattern in patterns:
            examples.append(make_example(pattern, "create_project",
                {"name": name, "type": typ, "description": desc}, tools, f"Create project: {name}"))

    for msg in ["Show projects", "My projects", "list projects", "project list"]:
        examples.append(make_example(msg, "get_projects", {}, tools, "List projects."))

    return examples


def gen_negative() -> list[dict]:
    examples = []
    all_tools = list(TOOLS.values())

    no_tool = [
        ("What is the capital of France?", "Paris is the capital of France."),
        ("How many planets in solar system?", "There are 8 planets in our solar system."),
        ("Who wrote Romeo and Juliet?", "William Shakespeare wrote Romeo and Juliet."),
        ("What is 2 + 2?", "2 + 2 equals 4."),
        ("Tell me a joke", "Why don't scientists trust atoms? They make up everything!"),
        ("Hello!", "Hello! How can I help you?"),
        ("Thanks", "You're welcome!"),
        ("Good morning", "Good morning! How are you?"),
        ("What does Python mean?", "Python is a programming language named after Monty Python."),
        ("Explain machine learning", "Machine learning is AI that learns from data."),
        ("How do I cook pasta?", "Boil water, add pasta, cook 8-12 minutes, drain."),
        ("What is love?", "Love is deep affection and care for someone."),
        ("Bye", "Goodbye! Have a great day!"),
        ("What's your name?", "I'm Luna, your AI assistant."),
        ("How are you?", "I'm doing well, thank you!"),
        ("What can you do?", "I can help with tasks, research, music, and more."),
        ("Hi there", "Hi! What can I help you with?"),
        ("Thank you", "You're welcome!"),
        ("That's interesting", "Glad you find it interesting!"),
        ("I see", "Let me know if you have questions."),
        ("Okay", "What would you like to do next?"),
        ("Sure", "Great, how can I assist you?"),
        ("Never mind", "No problem! Let me know if you need anything."),
        ("Just checking", "I'm here if you need me."),
        ("What's 15% of 80?", "15% of 80 is 12."),
        ("Spell necessary", "necessary: N-E-C-E-S-S-A-R-Y"),
        ("Square root of 144?", "The square root of 144 is 12."),
        ("Define ephemeral", "Ephemeral means lasting a very short time."),
        ("What year is it?", "It's 2024."),
        ("How old is the Earth?", "Earth is about 4.5 billion years old."),
    ]

    for user_msg, response in no_tool:
        tools = random.sample(all_tools, min(5, len(all_tools)))
        examples.append(make_no_tool(user_msg, response, tools))

        for var in vary_message(user_msg)[:2]:
            examples.append(make_no_tool(var, response, tools))

    return examples


def gen_multi_tool() -> list[dict]:
    examples = []

    multi = [
        ("Play music and show tasks",
         [("play_music", {"query": "music", "type": "playlist"}), ("get_tasks", {})],
         [TOOLS["play_music"], TOOLS["get_tasks"]],
         "Music and tasks."),
        ("Check email and calendar",
         [("get_emails", {}), ("get_calendar_events", {})],
         [TOOLS["get_emails"], TOOLS["get_calendar_events"]],
         "Email and calendar."),
        ("System status CPU memory disk",
         [("system_cpu_usage", {}), ("system_memory", {}), ("system_disk", {})],
         [TOOLS["system_cpu_usage"], TOOLS["system_memory"], TOOLS["system_disk"]],
         "Full system status."),
        ("Tasks and calendar today",
         [("get_tasks", {}), ("get_calendar_events", {"days_ahead": 1})],
         [TOOLS["get_tasks"], TOOLS["get_calendar_events"]],
         "Tasks and calendar."),
        ("Search knowledge and documents for API",
         [("search_knowledge", {"query": "API"}), ("search_documents", {"query": "API"})],
         [TOOLS["search_knowledge"], TOOLS["search_documents"]],
         "Search both."),
        ("Show files and reminders",
         [("list_files", {}), ("list_reminders", {})],
         [TOOLS["list_files"], TOOLS["list_reminders"]],
         "Files and reminders."),
        ("Docker logs and stats for luna-api",
         [("docker_logs", {"container_id": "luna-api"}), ("docker_stats", {"container_id": "luna-api"})],
         [TOOLS["docker_logs"], TOOLS["docker_stats"]],
         "Docker logs and stats."),
        ("Show backgrounds and projects",
         [("get_backgrounds", {}), ("get_projects", {})],
         [TOOLS["get_backgrounds"], TOOLS["get_projects"]],
         "Backgrounds and projects."),
    ]

    for user_msg, calls, tools, thinking in multi:
        examples.append(make_multi_tool(user_msg, calls, tools, thinking))
        for var in vary_message(user_msg)[:2]:
            examples.append(make_multi_tool(var, calls, tools, thinking))

    return examples


def add_typos(examples: list[dict], rate: float = 0.1) -> list[dict]:
    typo_map = {
        "what": ["wat", "waht"], "the": ["teh", "hte"], "check": ["chekc"],
        "show": ["shwo"], "search": ["serach"], "play": ["paly"], "create": ["crate"],
    }

    augmented = []
    for ex in examples:
        augmented.append(ex)
        if random.random() < rate:
            user_msg = ex["messages"][1]["content"]
            words = user_msg.split()
            new_words = []
            for w in words:
                if w.lower() in typo_map and random.random() < 0.5:
                    new_words.append(random.choice(typo_map[w.lower()]))
                else:
                    new_words.append(w)
            new_msg = " ".join(new_words)
            if new_msg != user_msg:
                augmented.append({
                    "messages": [ex["messages"][0], {"role": "user", "content": new_msg}, ex["messages"][2]],
                    "tools": ex["tools"]
                })
    return augmented


def main():
    print("Generating FunctionGemma training data for Luna Chat...")
    print("Target: 2000-5000 examples\n")

    all_examples = []

    generators = [
        ("Research", gen_research),
        ("Knowledge", gen_knowledge),
        ("Tasks", gen_tasks),
        ("Calendar", gen_calendar),
        ("Email", gen_email),
        ("Music", gen_music),
        ("Code", gen_code),
        ("Reminders", gen_reminders),
        ("Files", gen_files),
        ("Images", gen_images),
        ("YouTube", gen_youtube),
        ("System", gen_system),
        ("Browser", gen_browser),
        ("Documents", gen_documents),
        ("Mood", gen_mood),
        ("Background", gen_background),
        ("Projects", gen_projects),
        ("Negative", gen_negative),
        ("Multi-tool", gen_multi_tool),
    ]

    for name, gen in generators:
        exs = gen()
        print(f"  {name}: {len(exs)}")
        all_examples.extend(exs)

    print(f"\nBase: {len(all_examples)}")

    all_examples = add_typos(all_examples, rate=0.15)
    print(f"After typos: {len(all_examples)}")

    random.seed(42)
    random.shuffle(all_examples)

    output = "/opt/luna-chat/data/luna_functiongemma_training.jsonl"
    with open(output, "w") as f:
        for ex in all_examples:
            f.write(json.dumps(ex) + "\n")

    print(f"\nWritten {len(all_examples)} examples to {output}")

    # Validate
    with open(output) as f:
        for i, line in enumerate(f, 1):
            try:
                json.loads(line)
            except json.JSONDecodeError as e:
                print(f"Error line {i}: {e}")
                return
    print("All JSON valid!")

    # Stats
    tool_counts: dict[str, int] = {}
    no_tool = 0
    multi_tool = 0

    for ex in all_examples:
        msg = ex["messages"][2]
        if "tool_calls" not in msg:
            no_tool += 1
        else:
            calls = msg["tool_calls"]
            if len(calls) > 1:
                multi_tool += 1
            for c in calls:
                name = c["function"]["name"]
                tool_counts[name] = tool_counts.get(name, 0) + 1

    print(f"\nTotal: {len(all_examples)}")
    print(f"No tool (negative): {no_tool} ({100*no_tool/len(all_examples):.1f}%)")
    print(f"Multi-tool: {multi_tool}")
    print("\nTool distribution:")
    for tool, count in sorted(tool_counts.items(), key=lambda x: -x[1])[:20]:
        print(f"  {tool}: {count}")


if __name__ == "__main__":
    main()
