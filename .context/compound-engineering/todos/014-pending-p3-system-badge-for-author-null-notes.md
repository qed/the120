---
status: pending
priority: p3
issue_id: "014"
tags: [crm, ui, notes]
dependencies: []
---

# CRM family notes: render author-null system notes with a "System" badge

## Problem Statement

Trigger-written trace notes (group-preference changes, status syncs) have `author = null` by design. The CRM notes list renders them without visual distinction from staff notes, so an automated trace can read as if a teammate wrote it (Agent-native + maintainability reviewers, P3).

## Recommended Action

Render a small "System" badge (existing chip style) when `author` is null in the family drawer notes list and the reviews detail panel.

## Acceptance Criteria

- [ ] Author-null notes are visually labeled as system-generated in both note surfaces

## Work Log

### 2026-07-14 - Initial Discovery

**By:** Claude Code (ce:review autofix — agent-native reviewer)
