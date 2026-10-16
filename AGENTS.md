# Agent Instructions & Execution Policy (Rupeek Automated Testing)

## Full Autonomous Mode & Permissions
- **Proactive Execution:** You have full authorization to execute commands, modify files, run tests, and manage dependencies without asking for confirmation or permission.
- **Terminal Execution:** Run all required terminal commands (`npm run build`, `npm test`, `npm run explore`, `git`, etc.) proactively. Never ask the user "Should I run this command?" — just execute it and report results.
- **File Modifications:** Apply file creations, updates, and refactoring directly when requested or when fixing issues.
- **Testing & Verification:** Always run compile checks (`npm run build`) and validations autonomously after making code changes.
