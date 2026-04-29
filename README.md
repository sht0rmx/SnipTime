# SnipTime

SnipTime is a lightweight VS Code extension that tracks your coding activity in real-time. It monitors file changes, saves, and focus events to build an accurate picture of your productivity.

## Key Features

- Smart Tracking: Automatically logs activity using a throttled heartbeat system to minimize overhead.
- Context Aware: Detects projects, file paths, and languages across multiple workspaces.
- Idle Detection: Automatically pauses tracking after 5 minutes of inactivity or when the window loses focus.
- Local & Secure: Persists all data to a local SQLite database—no external APIs or data leaks.
- Modular Design: Built with a clean OOP architecture for reliable event handling and interval calculation.