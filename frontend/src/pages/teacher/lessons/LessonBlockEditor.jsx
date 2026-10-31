import React from "react";

export const MAX_IMPORTED_TEXT_LENGTH = 256 * 1024;

export default function LessonBlockEditor({ block, index, total, onChange, onRemove, onMove }) {
  const update = (changes) => onChange(index, { ...block, ...changes });
  const typeLabel =
    block.type === "bullet_list"
      ? "Bullet list"
      : block.type === "heading"
        ? "Heading"
        : "Paragraph";

  return (
    <article className="lesson-content-block">
      <header className="lesson-block-header">
        <strong>{typeLabel} {index + 1}</strong>
        <div className="lesson-block-actions">
          <button
            type="button"
            className="secondary-button"
            aria-label={`Move block ${index + 1} up`}
            disabled={index === 0}
            onClick={() => onMove(index, -1)}
          >
            Move up
          </button>
          <button
            type="button"
            className="secondary-button"
            aria-label={`Move block ${index + 1} down`}
            disabled={index === total - 1}
            onClick={() => onMove(index, 1)}
          >
            Move down
          </button>
          <button
            type="button"
            className="lesson-delete-button"
            aria-label={`Remove block ${index + 1}`}
            onClick={() => onRemove(index)}
          >
            Remove
          </button>
        </div>
      </header>

      {block.type === "heading" && (
        <div className="lesson-block-fields">
          <label className="lesson-form-field">
            Heading level
            <select
              aria-label={`Block ${index + 1} heading level`}
              value={block.level}
              onChange={(event) => update({ level: Number(event.target.value) })}
            >
              <option value={1}>Heading 1</option>
              <option value={2}>Heading 2</option>
              <option value={3}>Heading 3</option>
            </select>
          </label>
          <label className="lesson-form-field">
            Heading text
            <input
              aria-label={`Block ${index + 1} heading text`}
              value={block.text}
              onChange={(event) => update({ text: event.target.value })}
              maxLength={500}
            />
          </label>
        </div>
      )}

      {block.type === "paragraph" && (
        <label className="lesson-form-field">
          Paragraph text
          <textarea
            aria-label={`Block ${index + 1} paragraph text`}
            rows={4}
            value={block.text}
            onChange={(event) => update({ text: event.target.value })}
            maxLength={MAX_IMPORTED_TEXT_LENGTH}
          />
        </label>
      )}

      {block.type === "bullet_list" && (
        <label className="lesson-form-field">
          Bullet items (one item per line)
          <textarea
            aria-label={`Block ${index + 1} bullet items`}
            rows={4}
            value={block.items.join("\n")}
            onChange={(event) =>
              update({
                items: event.target.value.split(/\r?\n/),
              })
            }
            maxLength={10000}
          />
        </label>
      )}
    </article>
  );
}
