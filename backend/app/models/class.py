"""Class relationship models; services convert Firestore timestamps to datetimes."""

from typing import Annotated, Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints


NonEmptyText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, strict=True),
]
ClassStatus = Literal["active", "inactive"]
AssignmentStatus = Literal["active", "inactive"]
MembershipStatus = Literal["active", "inactive"]


class ClassCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: NonEmptyText
    grade_level: NonEmptyText
    section: NonEmptyText
    status: ClassStatus = "active"
    lead_teacher_uid: NonEmptyText | None = None


class ClassUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: NonEmptyText | None = None
    grade_level: NonEmptyText | None = None
    section: NonEmptyText | None = None
    status: ClassStatus | None = None
    lead_teacher_uid: NonEmptyText | None = None

    def model_post_init(self, __context: object) -> None:
        if not self.model_fields_set:
            raise ValueError("At least one class field must be provided.")

        for field_name in self.model_fields_set:
            if field_name != "lead_teacher_uid" and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null.")


class ClassResponse(BaseModel):
    """Persisted class data with timezone-aware datetimes."""

    model_config = ConfigDict(extra="forbid", strict=True)

    id: NonEmptyText
    name: NonEmptyText
    grade_level: NonEmptyText
    section: NonEmptyText
    status: ClassStatus
    lead_teacher_uid: NonEmptyText | None = None
    created_at: AwareDatetime
    updated_at: AwareDatetime


class TeacherSubjectAssignmentCreateRequest(BaseModel):
    """Assignment input; teacher_uid must be independently authorized by the API."""

    model_config = ConfigDict(extra="forbid", strict=True)

    class_id: NonEmptyText
    subject_id: NonEmptyText
    teacher_uid: NonEmptyText
    status: AssignmentStatus = "active"


class TeacherSubjectAssignmentResponse(BaseModel):
    """Persisted assignment data with timezone-aware datetimes."""

    model_config = ConfigDict(extra="forbid", strict=True)

    id: NonEmptyText
    class_id: NonEmptyText
    subject_id: NonEmptyText
    teacher_uid: NonEmptyText
    status: AssignmentStatus
    created_at: AwareDatetime
    updated_at: AwareDatetime


class StudentMembershipCreateRequest(BaseModel):
    """Membership input; student_uid must be verified by the API, not trusted."""

    model_config = ConfigDict(extra="forbid", strict=True)

    class_id: NonEmptyText
    student_uid: NonEmptyText
    status: MembershipStatus = "active"


class StudentMembershipResponse(BaseModel):
    """Persisted membership data with timezone-aware datetimes."""

    model_config = ConfigDict(extra="forbid", strict=True)

    id: NonEmptyText
    class_id: NonEmptyText
    student_uid: NonEmptyText
    status: MembershipStatus
    created_at: AwareDatetime
    updated_at: AwareDatetime
