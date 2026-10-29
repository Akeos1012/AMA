# Lesson content contract

Status: Phase 1 contract. The page model and canonical conversion are defined in
`app/models/lesson.py`; the existing lesson API continues to accept and return
only the legacy `content` field. Page data is not persisted or exposed by the
API in this phase.

## Existing lesson data

Existing Firestore documents in the `lessons` collection store a `content`
object with `schema_version: 1` and an ordered `blocks` array. The accepted
block types are `heading`, `paragraph`, and `bullet_list`. `LessonCreateRequest`,
`LessonUpdateRequest`, and `LessonResponse` are strict Pydantic models that
reject unknown fields. Legacy Firestore documents remain valid without a
migration.

`PageLessonContent` is a separate, versioned authoring representation. It is
not interchangeable with `LessonContent` and is not yet a field in the current
lesson API contract. When page persistence is introduced, the API must explicitly
accept and validate it; storing an extra field today would make the strict
`LessonResponse` fail validation.

## Page representation and canonical projection

Page documents use `schema_version: 1` and an ordered `pages` array. Each page
has a persistent `id` and an ordered `elements` array. Each element has a
persistent `id` and a discriminating `type`.

| Page element | Canonical `LessonContent` mapping |
|---|---|
| `heading` | One `heading` block with the same text and heading level. |
| `paragraph` | One `paragraph` block with the same text. |
| `bullet_list` | One `bullet_list` block with the same ordered items. |
| Page boundary / page break | No text block. Page order defines reading order; a page boundary does not create an evidence block. |
| `image` | No text block. `asset_id` is an opaque future storage reference; `alt_text` is for accessibility and is not treated as factual lesson text. A teacher-authored caption must be a separate paragraph element. |

Flatten pages in array order, then elements in array order. Emit one canonical
block for each heading, paragraph, or bullet list. Do not emit placeholder
blocks for page boundaries or images. The result remains the existing
`LessonContent(schema_version=1, blocks=[...])` shape, so the existing text
extractor and AI pipeline do not need to understand page or image elements.

For a given saved content revision, this projection gives canonical blocks
stable zero-based positions. The extractor reports each passage's original
canonical block index, and quiz evidence uses that index. Page and element IDs
are useful for editor identity but do not replace the current integer evidence
reference.

Indexes cannot remain stable across arbitrary content edits or page/element
reordering: those operations change the canonical ordering. Current quiz drafts
store the quote and block index but do not store an immutable lesson-content
snapshot or content revision. Thus, evidence is traceable against the lesson
revision used for generation, but not guaranteed to resolve against a later
edited revision. Addressing cross-revision traceability requires a separately
reviewed snapshot/revision design; this phase does not change quiz persistence
or generation.

## Firestore and API compatibility

For the future page editor, keep `content` as the materialized canonical
projection used by current lesson endpoints and quiz generation. Page content
should be stored as an explicitly versioned field only after the API models and
read/write paths are deliberately extended. Write the page source and canonical
projection together from one validated request so that the two representations
cannot silently drift. Existing documents without page data continue to use
their current `content` unchanged.

Do not silently migrate legacy content or change `LessonResponse` to accept
arbitrary extra fields. During a later API extension, define how legacy records
without page data are represented in the editor (for example, one generated
page with stable element IDs) and test create, read, update, and round-trip
behavior before enabling page data persistence.

The canonical projection must remain nonempty to produce a `LessonContent`.
An image-only or blank page document is not a quiz source; the existing
extractor additionally requires at least 15 substantive words by default.

## Phase 4 text and PDF import policy

The authenticated teacher preview endpoints accept only `.txt` and `.pdf`
uploads. They validate the filename suffix and file bytes independently; the
browser-provided MIME type is ignored. Both endpoints require an active teacher
profile and an active assignment for the selected class and subject. They only
return an in-memory extraction preview: uploaded bytes and extracted text are
not persisted. A teacher must edit/confirm the preview and save through the
existing lesson create/update endpoint.

Enforced MVP limits:

- TXT file: 2 MiB maximum. Decode UTF-8, accepting an optional UTF-8 BOM;
  malformed UTF-8, NUL-containing files, empty files, and text with no
  alphanumeric content are rejected. Other encodings must be converted to
  UTF-8 by the teacher.
- PDF file: 20 MiB maximum, no more than 100 pages, and at most 256 KiB of
  extracted UTF-8 text. Parser safeguards cap decoded streams/image buffers at
  10 MiB each, stream decode work at 20 MiB per stream, content-stream parsing
  work at 500,000 operations per stream, cross-reference entries at 200,000,
  page-tree entries at 2,000, root-object recovery at 1,000 objects, and XObject
  form invocations at 500 per page. The limits leave room for normal lesson
  documents while bounding unusually complex input; extraction runs in a
  worker thread. These limits do not replace request-body limits at the reverse
  proxy/server boundary.
- `pypdf` extracts selectable text in page order. Blank-line-separated text
  becomes paragraphs; line order within each paragraph is retained. PDF page
  boundaries are separated in the editable preview but do not become canonical
  page metadata or separate evidence types. PDF layout, columns, and complex
  reading order may not be preserved exactly.
- Scanned/image-only PDFs and PDFs without usable text are rejected with an
  explanation that OCR is not supported. Teachers can enter or correct the
  text manually. Empty, corrupt, and password-protected PDFs are rejected.
- Imported text becomes ordinary ordered `paragraph` blocks after teacher
  preview/editing. No headings or other lesson meaning are inferred. All
  saved content continues to use `LessonContent(schema_version=1)` and
  existing lesson endpoints, so quiz extraction and block-index evidence
  remain based on the saved canonical block order.

Phase 4 does not retain original files or extracted text after returning the
preview. The editable preview becomes quiz source only when the teacher saves
it through the existing lesson API as canonical blocks. Any future attachment,
corrected lesson content, and rendered preview must remain distinct data; file
bytes must not be stored in Firestore.

Uploads are parsed by FastAPI's multipart handling before endpoint code can
check the teacher's assignment. The endpoint authorizes the selected class and
subject before reading or extracting the uploaded file and enforces the file
size during bounded reads. Deployments should additionally cap total request
body size at the reverse proxy/server boundary.

## Authorization boundary

The import endpoints verify the Firebase bearer token, teacher role, active
Firebase account/profile, and active class/subject, teacher eligibility, and
active assignment for the selected pair. They do not accept a teacher ID or
write lesson records. Existing lesson APIs continue to enforce lesson
ownership, class/subject access, and publication rules; student lesson reads
require a published lesson and active membership/assignment. Browser-supplied
teacher IDs, class access, MIME types, and object paths are not authorization.

Firestore Admin SDK calls bypass Firestore Security Rules, so backend endpoints
must enforce access themselves. Before enabling Storage, choose either an
authenticated backend upload/download boundary or private Storage rules with
equivalent owner/class/subject checks. Objects must not be public by default.
No Firebase Storage integration or Storage rules are introduced by this
contract.

## Phase 5 publication and student visibility

The existing teacher publish and unpublish operations remain
`POST /api/lessons/{lesson_id}/publish` and
`POST /api/lessons/{lesson_id}/unpublish`. Both use the Firebase teacher role,
active-account validation, lesson ownership, and current active class/subject
assignment checks. Publishing additionally requires a nonempty title and
topic, valid version-1 canonical content, and at least one block with
alphanumeric text. This publication rule does not impose the quiz generator's
15-word minimum; shorter lessons may be published, although quiz generation
will continue to reject insufficient lesson text.

Student list and direct-read access continue to require published status,
active class and subject, and the student's active class membership plus an
active class/subject teacher assignment. Unpublishing returns the lesson to
draft and removes it from student list and direct-read access.
