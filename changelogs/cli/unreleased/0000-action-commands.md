type: minor

### Added
- **`chouse action`** — run the same AI write tools the CHouse Assistant and MCP agents use, checked the same way: `tools` lists what your token may run and how each is checked, `run` runs one (an undoable change runs at once; a change that asks once prompts on a terminal or needs `--yes`; a high-risk change is always sent to a second person in CHouse), plus `status`, `undo` and `activity`. Your token's write policy decides which tools you get.
