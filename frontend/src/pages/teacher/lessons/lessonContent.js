export function importedTextToBlocks(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => ({ type: "paragraph", text: paragraph }));
}

export function hasLessonText(blocks) {
  return blocks.some((block) =>
    /[\p{L}\p{N}]/u.test(
      block.type === "bullet_list" ? block.items.join(" ") : block.text,
    ),
  );
}

export function lessonContentText(blocks) {
  return blocks
    .map((block) =>
      block.type === "bullet_list" ? block.items.join(" ") : block.text,
    )
    .join(" ");
}

export function lessonWordCount(blocks) {
  return lessonContentText(blocks).trim().split(/\s+/).filter(Boolean).length;
}

export function contentBlocksFromLesson(lesson) {
  return lesson.content.blocks.map((block) => {
    if (block.type === "bullet_list") {
      return { type: block.type, items: [...block.items] };
    }
    if (block.type === "heading") {
      return { type: block.type, level: block.level, text: block.text };
    }
    return { type: "paragraph", text: block.text };
  });
}

export function blockError(block, index) {
  if (block.type === "bullet_list") {
    if (!block.items.length || block.items.some((item) => !item.trim())) {
      return `Block ${index + 1} needs at least one non-empty bullet item.`;
    }
    return "";
  }
  if (!block.text.trim()) {
    return `Block ${index + 1} must contain text.`;
  }
  return "";
}
