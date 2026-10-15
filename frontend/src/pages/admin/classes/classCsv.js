import { parseCsv } from "../../../utils/csv.js";

const requiredHeaders = ["student_id", "name", "email", "sex"];

export function parseClassStudentsCsv(text, existingStudents) {
  const rows = parseCsv(text);
  if (rows.length < 2) {
    throw new Error("CSV must include a header row and at least one student.");
  }

  const headers = rows[0].map((header) => header.trim().toLowerCase());
  const missingHeaders = requiredHeaders.filter(
    (header) => !headers.includes(header),
  );
  if (missingHeaders.length) {
    throw new Error(
      `Missing required columns: ${missingHeaders.join(", ")}.`,
    );
  }

  const existingIds = new Set(
    existingStudents.map((student) => student.id.trim().toLowerCase()),
  );
  const importedIds = new Set();
  const validationErrors = [];
  const previewStudents = [];
  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const student = Object.fromEntries(
      requiredHeaders.map((header) => [
        header,
        row[headers.indexOf(header)]?.trim() ?? "",
      ]),
    );
    const rowErrors = [];

    if (row.length !== headers.length) {
      rowErrors.push("column count does not match the header");
    }
    requiredHeaders.forEach((header) => {
      if (!student[header]) rowErrors.push(`${header} is required`);
    });
    const normalizedId = student.student_id.toLowerCase();
    if (student.student_id && existingIds.has(normalizedId)) {
      rowErrors.push("Student ID is already assigned to this section");
    }
    if (student.student_id && importedIds.has(normalizedId)) {
      rowErrors.push("Student ID is duplicated in this CSV");
    }
    if (student.student_id) importedIds.add(normalizedId);
    if (
      student.email &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(student.email)
    ) {
      rowErrors.push("email is invalid");
    }
    if (student.sex && !["boy", "girl"].includes(student.sex.toLowerCase())) {
      rowErrors.push("sex must be boy or girl");
    }

    if (rowErrors.length) {
      validationErrors.push(`Row ${rowNumber}: ${rowErrors.join(", ")}.`);
    } else {
      previewStudents.push({
        id: student.student_id,
        name: student.name,
        email: student.email,
        sex: student.sex.toLowerCase(),
      });
    }
  });

  if (rows.length - 1 !== previewStudents.length + validationErrors.length) {
    validationErrors.push("One or more CSV rows could not be read.");
  }

  return { previewStudents, validationErrors };
}
