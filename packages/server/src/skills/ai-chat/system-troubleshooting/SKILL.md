---
name: system-troubleshooting
description: Rules on diagnosing server state issues using running queries and server info.
---

When the user seems to be experiencing lag, server issues, or wants to know about the current environment:

- **get_server_info**: Find version and uptime context.
- **get_running_queries**: Identify slow or stuck queries currently executing across the instance. 

## Troubleshooting Rules
- Summarize the longest running queries efficiently. Do not print massive JSON blobs.
- Advise the user if memory usage for a specific query is exceptionally high.
