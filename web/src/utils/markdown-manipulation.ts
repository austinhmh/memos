// Utilities for manipulating markdown strings using AST parsing
// Uses mdast for accurate task detection that properly handles code blocks

import type { ListItem, Root } from "mdast";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { visit } from "unist-util-visit";

interface PositionedListItem extends ListItem {
  position?: {
    start: {
      line: number;
    };
  };
}

interface TaskInfo {
  lineNumber: number;
  checked: boolean;
}

const markdownImagePattern = /!\[[^\]]*\]\([^)]*\)/g;

export function hasMarkdownImageReferences(content: string): boolean {
  return /!\[[^\]]*\]\([^)]*\)/.test(content);
}

export function stripMarkdownImageReferences(content: string): string {
  return content
    .replace(markdownImagePattern, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// Extract all task list items from markdown using AST parsing
// This correctly ignores task-like patterns inside code blocks
function extractTasksFromAst(markdown: string): TaskInfo[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const tasks: TaskInfo[] = [];

  visit(tree as Root, "listItem", (node: PositionedListItem) => {
    // Only process actual task list items (those with a checkbox)
    if (typeof node.checked === "boolean" && node.position?.start.line) {
      tasks.push({
        lineNumber: node.position.start.line - 1, // Convert to 0-based
        checked: node.checked,
      });
    }
  });

  return tasks;
}

export function toggleTaskAtLine(markdown: string, lineNumber: number, checked: boolean): string {
  const lines = markdown.split("\n");

  if (lineNumber < 0 || lineNumber >= lines.length) {
    return markdown;
  }

  const line = lines[lineNumber];

  // Match task list patterns: - [ ], - [x], - [X], etc.
  const taskPattern = /^(\s*[-*+]\s+)\[([ xX])\](\s+.*)$/;
  const match = line.match(taskPattern);

  if (!match) {
    return markdown;
  }

  const [, prefix, , suffix] = match;
  const newCheckmark = checked ? "x" : " ";
  lines[lineNumber] = `${prefix}[${newCheckmark}]${suffix}`;

  return lines.join("\n");
}

export function toggleTaskAtIndex(markdown: string, taskIndex: number, checked: boolean): string {
  const tasks = extractTasksFromAst(markdown);

  if (taskIndex < 0 || taskIndex >= tasks.length) {
    return markdown;
  }

  const task = tasks[taskIndex];
  return toggleTaskAtLine(markdown, task.lineNumber, checked);
}

export function removeTaskAtLine(markdown: string, lineNumber: number): string {
  const lines = markdown.split("\n");

  if (lineNumber < 0 || lineNumber >= lines.length) {
    return markdown;
  }

  if (!/^\s*[-*+]\s+\[[ xX]\]\s+/.test(lines[lineNumber])) {
    return markdown;
  }

  lines.splice(lineNumber, 1);

  if (lineNumber < lines.length && lines[lineNumber].trim() === "") {
    lines.splice(lineNumber, 1);
  }

  return lines.join("\n");
}

export function removeTaskAtIndex(markdown: string, taskIndex: number): string {
  return removeTaskAtLine(markdown, getTaskLineNumber(markdown, taskIndex));
}

export function updateTaskContentAtLine(markdown: string, lineNumber: number, content: string): string {
  const lines = markdown.split("\n");
  const normalizedContent = content.replace(/\s*\n+\s*/g, " ").trim();
  const sanitizedContent = hasMarkdownImageReferences(normalizedContent)
    ? stripMarkdownImageReferences(normalizedContent)
    : normalizedContent;

  if (!sanitizedContent || lineNumber < 0 || lineNumber >= lines.length) {
    return markdown;
  }

  const match = lines[lineNumber].match(/^(\s*[-*+]\s+\[[ xX]\]\s+)(.*)$/);
  if (!match) {
    return markdown;
  }

  lines[lineNumber] = `${match[1]}${sanitizedContent}`;
  return lines.join("\n");
}

export function updateTaskContentAtIndex(markdown: string, taskIndex: number, content: string): string {
  return updateTaskContentAtLine(markdown, getTaskLineNumber(markdown, taskIndex), content);
}

export function removeCompletedTasks(markdown: string): string {
  const tasks = extractTasksFromAst(markdown);
  const completedLineNumbers = new Set(tasks.filter((t) => t.checked).map((t) => t.lineNumber));

  if (completedLineNumbers.size === 0) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (completedLineNumbers.has(i)) {
      // Also skip the following line if it's empty (preserve spacing)
      if (i + 1 < lines.length && lines[i + 1].trim() === "") {
        i++;
      }
      continue;
    }
    result.push(lines[i]);
  }

  return result.join("\n");
}

export function countTasks(markdown: string): {
  total: number;
  completed: number;
  incomplete: number;
} {
  const tasks = extractTasksFromAst(markdown);

  const total = tasks.length;
  const completed = tasks.filter((t) => t.checked).length;

  return {
    total,
    completed,
    incomplete: total - completed,
  };
}

export function hasCompletedTasks(markdown: string): boolean {
  const tasks = extractTasksFromAst(markdown);
  return tasks.some((t) => t.checked);
}

export function getTaskLineNumber(markdown: string, taskIndex: number): number {
  const tasks = extractTasksFromAst(markdown);

  if (taskIndex < 0 || taskIndex >= tasks.length) {
    return -1;
  }

  return tasks[taskIndex].lineNumber;
}

export interface TaskItem {
  lineNumber: number;
  taskIndex: number;
  checked: boolean;
  content: string;
  indentation: number;
}

export function extractTasks(markdown: string): TaskItem[] {
  const tree = fromMarkdown(markdown, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });

  const lines = markdown.split("\n");
  const tasks: TaskItem[] = [];
  let taskIndex = 0;

  visit(tree as Root, "listItem", (node: PositionedListItem) => {
    if (typeof node.checked === "boolean" && node.position?.start.line) {
      const lineNumber = node.position.start.line - 1;
      const line = lines[lineNumber];

      // Extract indentation
      const indentMatch = line.match(/^(\s*)/);
      const indentation = indentMatch ? indentMatch[1].length : 0;

      // Extract content (text after the checkbox)
      const contentMatch = line.match(/^\s*[-*+]\s+\[[ xX]\]\s+(.*)/);
      const content = contentMatch ? stripMarkdownImageReferences(contentMatch[1]) : "";

      tasks.push({
        lineNumber,
        taskIndex: taskIndex++,
        checked: node.checked,
        content,
        indentation,
      });
    }
  });

  return tasks;
}
