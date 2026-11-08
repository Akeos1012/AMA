import React from "react";
import { hasLessonText, lessonWordCount } from "./lessonContent.js";

export default function LessonPreview({
  title,
  topic,
  blocks,
  isEditing,
  savedStatus,
  classLabel,
  subjectLabel,
}) {
  return (
    <article className="lesson-student-preview" aria-label="Student lesson preview">
      <p className="lesson-preview-label">
        Preview only {"\u00b7"} {isEditing ? "Current saved status: " : ""}
        {isEditing ? savedStatus : "Not saved"}
      </p>
      <h1>{title.trim() || "Untitled lesson"}</h1>
      <p className="lesson-preview-topic">{topic.trim() || "No topic entered"}</p>
      <dl className="lesson-preview-metadata">
        <div>
          <dt>Class</dt>
          <dd>{classLabel}</dd>
        </div>
        <div>
          <dt>Subject</dt>
          <dd>{subjectLabel}</dd>
        </div>
      </dl>
      {lessonWordCount(blocks) < 15 && (
        <p className="lesson-notice info" role="note">
          This lesson is below the 15-word quiz-generation minimum. It can still be published, but quiz generation will require more content.
        </p>
      )}
      <div className="lesson-preview-content">
        {!hasLessonText(blocks) ? (
          <p className="lesson-preview-empty">
            No lesson content has been entered yet.
          </p>
        ) : (
          blocks.map((block, index) => {
            if (block.type === "heading") {
              const Heading = `h${Math.min(3, Math.max(1, block.level || 1))}`;
              return <Heading key={`preview-${index}`}>{block.text}</Heading>;
            }
            if (block.type === "bullet_list") {
              return (
                <ul key={`preview-${index}`}>
                  {block.items.filter((item) => item.trim()).map((item, itemIndex) => (
                    <li key={`preview-${index}-${itemIndex}`}>{item}</li>
                  ))}
                </ul>
              );
            }
            return <p key={`preview-${index}`}>{block.text}</p>;
          })
        )}
      </div>
    </article>
  );
}
