import { parseCsv } from "../../../utils/csv.js";

export const userGrades = [
  "Grade 1",
  "Grade 2",
  "Grade 3",
  "Grade 4",
  "Grade 5",
  "Grade 6",
];

function normalizeCsvHeader(value) {
  return value.trim().toLowerCase().replace(/[_\s]+/g, " ");
}

export function parseUserCsv(text, fileName) {
  const parsedRows = parseCsv(text);
  if (parsedRows.length < 2) {
    throw new Error("The CSV must contain a header and at least one user.");
  }

  const headers = parsedRows[0].map(normalizeCsvHeader);
  const headerIndexes = {
    studentId: headers.findIndex((header) =>
      ["student id", "id"].includes(header),
    ),
    name: headers.indexOf("name"),
    email: headers.indexOf("email"),
    grade: headers.findIndex((header) =>
      ["grade", "grade level"].includes(header),
    ),
    section: headers.indexOf("section"),
    sex: headers.indexOf("sex"),
  };
  const missingColumns = Object.entries({
    "Student ID": headerIndexes.studentId,
    Name: headerIndexes.name,
    Email: headerIndexes.email,
    Grade: headerIndexes.grade,
    Section: headerIndexes.section,
    Sex: headerIndexes.sex,
  })
    .filter(([, index]) => index < 0)
    .map(([label]) => label);
  if (missingColumns.length) {
    throw new Error(`Missing CSV columns: ${missingColumns.join(", ")}.`);
  }

  const studentIds = new Set();
  const emails = new Set();
  const errors = [];
  const rows = parsedRows.slice(1).map((columns, index) => {
    const row = {
      student_id: columns[headerIndexes.studentId] ?? "",
      name: columns[headerIndexes.name] ?? "",
      email: columns[headerIndexes.email] ?? "",
      grade_level: columns[headerIndexes.grade] ?? "",
      section: columns[headerIndexes.section] ?? "",
      sex: (columns[headerIndexes.sex] ?? "").toLowerCase(),
    };
    const lineNumber = index + 2;
    if (Object.values(row).some((value) => !value.trim())) {
      errors.push(`Row ${lineNumber}: all student fields are required.`);
    }
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push(`Row ${lineNumber}: email address is invalid.`);
    }
    if (row.grade_level && !userGrades.includes(row.grade_level)) {
      errors.push(`Row ${lineNumber}: grade must be Grade 1 through Grade 6.`);
    }
    if (row.sex && !["boy", "girl"].includes(row.sex)) {
      errors.push(`Row ${lineNumber}: sex must be Boy or Girl.`);
    }
    if (row.student_id && studentIds.has(row.student_id.toLowerCase())) {
      errors.push(`Row ${lineNumber}: Student ID is duplicated in this file.`);
    }
    if (row.email && emails.has(row.email.toLowerCase())) {
      errors.push(`Row ${lineNumber}: email is duplicated in this file.`);
    }
    studentIds.add(row.student_id.toLowerCase());
    emails.add(row.email.toLowerCase());
    return row;
  });

  return { rows, errors, fileName };
}
